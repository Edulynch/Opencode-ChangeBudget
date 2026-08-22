import { spawn } from 'node:child_process';
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PACKAGE_NAME = 'changebudget-cli';
export const REPOSITORY_URL =
  'https://github.com/Edulynch/Opencode-ChangeBudget.git';
export const CANONICAL_PACKAGE_SPEC_TEMPLATE =
  `git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z`;
export const INSTALL_FLAGS = Object.freeze([
  'install',
  '-g',
  '--ignore-scripts',
  '--allow-git=all',
  '--install-links=true',
]);
export const GIT_AUTH_CONFIG_KEY =
  'http.https://github.com/.extraheader';
export const EXPECTED_INSTRUCTION = '.opencode/instructions/changebudget.md';

const TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const AUTH_ENV_KEYS = [/^GIT_CONFIG_KEY_\d+$/, /^GIT_CONFIG_VALUE_\d+$/];
const SECRET_ENV_KEYS = ['GITHUB_TOKEN', 'GH_TOKEN'];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Parse a strict stable release tag without importing production version code.
 *
 * @param {string} tag
 * @returns {{ tag: string, version: string } | null}
 */
export function parseSmokeTag(tag) {
  if (typeof tag !== 'string' || !TAG_PATTERN.test(tag)) return null;
  return { tag, version: tag.slice(1) };
}

/**
 * Require a strict stable release tag.
 *
 * @param {string} tag
 * @returns {{ tag: string, version: string }}
 */
export function assertSmokeTag(tag) {
  const parsed = parseSmokeTag(tag);
  if (!parsed) {
    throw new Error('Expected immutable vMAJOR.MINOR.PATCH tag');
  }
  return parsed;
}

/**
 * Construct the private HTTPS Git package spec independently of the updater.
 *
 * @param {string} tag
 * @returns {string}
 */
export function buildSmokePackageSpec(tag) {
  const parsed = assertSmokeTag(tag);
  return `git+${REPOSITORY_URL}#${parsed.tag}`;
}

/**
 * Construct the exact npm argv independently of the updater.
 *
 * @param {string} packageSpec
 * @returns {string[]}
 */
export function buildSmokeNpmArgs(packageSpec) {
  if (typeof packageSpec !== 'string' || !packageSpec.startsWith('git+https://')) {
    throw new Error('Expected an HTTPS Git package spec');
  }
  return [...INSTALL_FLAGS, packageSpec];
}

/**
 * Resolve the installed package root for a disposable npm global prefix.
 *
 * @param {string} prefix
 * @param {'win32' | 'linux' | 'darwin' | 'posix'} platform
 * @returns {string}
 */
export function resolveInstalledPackageRoot(prefix, platform = process.platform) {
  const pathApi = platform === 'win32' ? win32 : posix;
  const globalRoot = platform === 'win32' ? prefix : pathApi.join(prefix, 'lib');
  return pathApi.join(globalRoot, 'node_modules', PACKAGE_NAME);
}

/**
 * Resolve the installed CLI shim for a disposable npm global prefix.
 *
 * @param {string} prefix
 * @param {'win32' | 'linux' | 'darwin' | 'posix'} platform
 * @returns {string}
 */
export function resolveInstalledCli(prefix, platform = process.platform) {
  const pathApi = platform === 'win32' ? win32 : posix;
  return platform === 'win32'
    ? pathApi.join(prefix, 'changebudget.cmd')
    : pathApi.join(prefix, 'bin', 'changebudget');
}

/**
 * Resolve a path using the host platform when callers need a temporary path.
 *
 * @param {...string} parts
 * @returns {string}
 */
export function joinSmokePath(...parts) {
  return join(...parts);
}

function secretVariants(secret) {
  if (!secret) return [];
  const rawCredential = `x-access-token:${secret}`;
  const encodedCredential = Buffer.from(rawCredential, 'utf8').toString('base64');
  return [
    secret,
    rawCredential,
    encodedCredential,
    `Authorization: Basic ${encodedCredential}`,
    encodeURIComponent(secret),
  ];
}

/**
 * Remove raw and derived credentials from diagnostic text.
 *
 * @param {unknown} value
 * @param {string[]} secrets
 * @returns {string}
 */
export function sanitizeSecretText(value, secrets = []) {
  let text = String(value ?? '');
  const variants = new Set(secrets.flatMap(secretVariants));
  for (const variant of [...variants].sort((left, right) => right.length - left.length)) {
    if (variant) text = text.split(variant).join('[REDACTED]');
  }
  return text;
}

/**
 * Construct the only Git authentication values passed to the install child.
 *
 * @param {string} token
 * @returns {Record<string, string>}
 */
export function buildGitAuthEnvironment(token) {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('GITHUB_TOKEN is required for private tagged smoke');
  }
  const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: GIT_AUTH_CONFIG_KEY,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
  };
}

/**
 * Build the npm child environment without passing the raw workflow token.
 *
 * @param {string} token
 * @param {NodeJS.ProcessEnv} baseEnv
 * @returns {NodeJS.ProcessEnv}
 */
export function buildNpmChildEnvironment(token, baseEnv = process.env) {
  const environment = { ...baseEnv };
  for (const key of Object.keys(environment)) {
    if (AUTH_ENV_KEYS.some((pattern) => pattern.test(key))) delete environment[key];
  }
  for (const key of SECRET_ENV_KEYS) delete environment[key];
  delete environment.GIT_CONFIG_PARAMETERS;
  return { ...environment, ...buildGitAuthEnvironment(token) };
}

function shellForExecutable(command) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(command);
}

/**
 * Run a structured child process and expose only sanitized output.
 *
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: NodeJS.ProcessEnv, secrets?: string[], label?: string, timeout?: number }} options
 * @returns {Promise<{ code: number, stdout: string, stderr: string }>}
 */
export function runCommand(command, args, options = {}) {
  const {
    cwd,
    env,
    secrets = [],
    label = command,
    timeout = 240_000,
  } = options;
  return new Promise((resolveResult, rejectResult) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd,
        env,
        shell: shellForExecutable(command),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      rejectResult(new Error(`Unable to start ${label}: ${sanitizeSecretText(error, secrets)}`));
      return;
    }

    const stdout = [];
    const stderr = [];
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finishError(new Error(`Command timed out: ${label}`));
    }, timeout);

    const finishError = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectResult(error);
    };

    child.stdout?.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr?.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      finishError(new Error(`Unable to run ${label}: ${sanitizeSecretText(error, secrets)}`));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const cleanStdout = sanitizeSecretText(Buffer.concat(stdout), secrets);
      const cleanStderr = sanitizeSecretText(Buffer.concat(stderr), secrets);
      if (code !== 0) {
        const signalText = signal ? ` (${signal})` : '';
        rejectResult(
          new Error(
            `Command failed: ${label}${signalText}\n${cleanStdout}\n${cleanStderr}`.trim(),
          ),
        );
        return;
      }
      resolveResult({ code: 0, stdout: cleanStdout, stderr: cleanStderr });
    });
  });
}

function platformPrefixPath(prefix, platform = process.platform) {
  return platform === 'win32' ? prefix : join(prefix, 'bin');
}

/**
 * Create all disposable resources used by one smoke run.
 *
 * @returns {Promise<{ root: string, home: string, prefix: string, cache: string, userConfig: string, project: string, npmEnv: NodeJS.ProcessEnv, initialAgents: string, initialConfig: string }>}
 */
export async function createSmokeEnvironment() {
  const root = await mkdtemp(join(tmpdir(), 'changebudget tagged smoke '));
  const home = join(root, 'temporary home with spaces');
  const prefix = join(root, 'global prefix');
  const cache = join(root, 'npm cache');
  const userConfig = join(root, 'npm userconfig');
  const project = join(root, 'smoke project with spaces');
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(prefix, { recursive: true }),
    mkdir(cache, { recursive: true }),
    mkdir(project, { recursive: true }),
    writeFile(userConfig, '', 'utf8'),
  ]);

  const initialConfig = JSON.stringify(
    {
      $schema: 'https://example.test/schema.json',
      model: 'tagged-smoke',
      permissions: { read: 'allow' },
      theme: 'dark',
    },
    null,
    2,
  ) + '\n';
  const initialAgents = 'tagged-smoke-owned\n';
  await Promise.all([
    writeFile(join(project, 'package.json'), '{"name":"tagged-smoke-project"}\n', 'utf8'),
    writeFile(join(project, 'AGENTS.md'), initialAgents, 'utf8'),
    writeFile(join(project, 'opencode.json'), initialConfig, 'utf8'),
  ]);

  const npmBin = platformPrefixPath(prefix);
  const npmEnv = { ...process.env };
  for (const key of SECRET_ENV_KEYS) delete npmEnv[key];
  for (const key of Object.keys(npmEnv)) {
    if (AUTH_ENV_KEYS.some((pattern) => pattern.test(key))) delete npmEnv[key];
  }
  delete npmEnv.GIT_CONFIG_COUNT;
  delete npmEnv.GIT_CONFIG_PARAMETERS;
  delete npmEnv.GIT_CONFIG_GLOBAL;
  delete npmEnv.GIT_CONFIG_SYSTEM;
  delete npmEnv.GIT_ASKPASS;
  delete npmEnv.SSH_AUTH_SOCK;
  delete npmEnv.GIT_SSH;
  delete npmEnv.GIT_SSH_COMMAND;
  delete npmEnv.GH_CONFIG_DIR;
  npmEnv.HOME = home;
  npmEnv.USERPROFILE = home;
  npmEnv.GIT_CONFIG_NOSYSTEM = '1';
  npmEnv.GIT_TERMINAL_PROMPT = '0';
  if (process.platform !== 'win32') npmEnv.GIT_CONFIG_GLOBAL = '/dev/null';
  Object.assign(npmEnv, {
    npm_config_prefix: prefix,
    NPM_CONFIG_PREFIX: prefix,
    npm_config_cache: cache,
    NPM_CONFIG_CACHE: cache,
    npm_config_userconfig: userConfig,
    NPM_CONFIG_USERCONFIG: userConfig,
    PATH: [npmBin, process.env.PATH].filter(Boolean).join(process.platform === 'win32' ? ';' : ':'),
  });
  return {
    root,
    home,
    prefix,
    cache,
    userConfig,
    project,
    npmEnv,
    initialAgents,
    initialConfig,
  };
}

/**
 * Remove and verify all disposable smoke resources.
 *
 * @param {{ root: string, prefix: string, cache: string, userConfig: string, project: string }} environment
 * @param {(path: string, options: { recursive: boolean, force: boolean }) => Promise<void>} remove
 * @param {string[]} secrets
 */
export async function cleanupSmokeEnvironment(
  environment,
  remove = rm,
  secrets = [],
) {
  const paths = [environment.project, environment.userConfig, environment.cache, environment.prefix, environment.home, environment.root];
  const errors = [];
  for (const path of paths) {
    try {
      await remove(path, { recursive: true, force: true });
    } catch (error) {
      errors.push(sanitizeSecretText(error, secrets));
    }
  }
  for (const path of paths) {
    try {
      await access(path);
      errors.push(`Disposable path remains: ${path}`);
    } catch {
      // Expected: cleanup removed the path.
    }
  }
  if (errors.length > 0) {
    throw new Error(`Cleanup failed: ${errors.join('; ')}`);
  }
}

/** @param {string} path @param {string} parent */
function assertPathUnder(path, parent) {
  const child = resolve(path);
  const root = resolve(parent);
  const childRelative = relative(root, child);
  if (childRelative === '..' || childRelative.startsWith(`..${sep}`)) {
    throw new Error('Installed package escaped the disposable prefix');
  }
}

async function requirePath(path, label) {
  try {
    await access(path);
  } catch {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

async function readPackageVersion(packageRoot) {
  const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (typeof packageJson.version !== 'string') {
    throw new Error('Installed package has no version');
  }
  return packageJson.version;
}

async function runInstalledCli(executable, args, environment, secrets = []) {
  return runCommand(executable, args, {
    cwd: environment.project,
    env: environment.npmEnv,
    label: `installed ChangeBudget ${args.join(' ')}`,
    secrets,
  });
}

async function assertInstalledBehavior(environment, packageRoot, expectedVersion) {
  await requirePath(join(packageRoot, 'package.json'), 'installed package metadata');
  await requirePath(join(packageRoot, 'dist', 'src', 'cli', 'index.js'), 'installed CLI runtime');
  const runtimeGuard = join(
    packageRoot,
    'opencode-plugin',
    'dist',
    'opencode-plugin',
    'src',
    'index.js',
  );
  await requirePath(runtimeGuard, 'installed Runtime Guard');
  if ((await readPackageVersion(packageRoot)) !== expectedVersion) {
    throw new Error('Installed package version does not match the immutable tag');
  }

  const version = await runInstalledCli(
    resolveInstalledCli(environment.prefix),
    ['--version'],
    environment,
  );
  if (version.stdout.trim() !== expectedVersion) {
    throw new Error('Installed CLI version does not match the immutable tag');
  }
  const help = await runInstalledCli(
    resolveInstalledCli(environment.prefix),
    ['--help'],
    environment,
  );
  if (!/changebudget update \[--check\]/.test(help.stdout)) {
    throw new Error('Installed CLI help output is incomplete');
  }
  await runInstalledCli(resolveInstalledCli(environment.prefix), ['init'], environment);
  await runInstalledCli(
    resolveInstalledCli(environment.prefix),
    ['integrate', 'opencode'],
    environment,
  );

  const agents = await readFile(join(environment.project, 'AGENTS.md'), 'utf8');
  if (agents !== environment.initialAgents) {
    throw new Error('AGENTS.md was not preserved');
  }
  const config = JSON.parse(await readFile(join(environment.project, 'opencode.json'), 'utf8'));
  const beforeConfig = JSON.parse(environment.initialConfig);
  const { instructions: _beforeInstructions, ...beforeWithoutInstructions } = beforeConfig;
  const { instructions: _afterInstructions, ...afterWithoutInstructions } = config;
  if (JSON.stringify(beforeWithoutInstructions) !== JSON.stringify(afterWithoutInstructions)) {
    throw new Error('Unrelated opencode.json fields were changed');
  }
  if (!Array.isArray(config.instructions) || !config.instructions.includes(EXPECTED_INSTRUCTION)) {
    throw new Error('Expected ChangeBudget instruction was not integrated');
  }
  const wrapper = await readFile(
    join(environment.project, '.opencode', 'plugins', 'changebudget.js'),
    'utf8',
  );
  if (!wrapper.includes(pathToFileURL(runtimeGuard).href)) {
    throw new Error('Installed wrapper does not target the installed Runtime Guard');
  }
}

async function queryGlobalPrefix(baseEnv = process.env) {
  const environment = { ...baseEnv };
  for (const key of SECRET_ENV_KEYS) delete environment[key];
  delete environment.npm_config_prefix;
  delete environment.NPM_CONFIG_PREFIX;
  delete environment.npm_config_cache;
  delete environment.NPM_CONFIG_CACHE;
  delete environment.npm_config_userconfig;
  delete environment.NPM_CONFIG_USERCONFIG;
  const result = await runCommand(npmCommand, ['prefix', '--global'], {
    env: environment,
    label: 'real global npm prefix query',
  });
  const prefix = result.stdout.trim();
  if (!prefix) throw new Error('Real global npm prefix query returned no path');
  return prefix;
}

/**
 * Parse the future workflow-facing harness arguments.
 *
 * @param {string[]} args
 * @returns {{ tag: string, repository: string }}
 */
export function parseSmokeArguments(args, environment = process.env) {
  let tag = null;
  let repository = REPOSITORY_URL;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--tag') tag = args[++index] ?? null;
    else if (argument === '--repository') repository = args[++index] ?? '';
    else if (argument === '--help') return { tag: '--help', repository };
    else throw new Error(`Unknown smoke argument: ${argument}`);
  }
  if (!tag) tag = environment.CHANGE_BUDGET_TAG ?? null;
  if (!tag) throw new Error('Missing required --tag argument');
  if (repository !== REPOSITORY_URL) {
    throw new Error('Only the canonical private repository is supported');
  }
  return { tag, repository };
}

export async function runSmoke({ tag, token = process.env.GITHUB_TOKEN } = {}) {
  const parsed = assertSmokeTag(tag);
  const packageSpec = buildSmokePackageSpec(parsed.tag);
  const npmArgs = buildSmokeNpmArgs(packageSpec);
  buildGitAuthEnvironment(token);
  const environment = await createSmokeEnvironment();
  const npmChildEnv = buildNpmChildEnvironment(token, environment.npmEnv);
  const secrets = [token];
  let failure = null;
  try {
    const realPrefixBefore = await queryGlobalPrefix(environment.npmEnv);
    await runCommand(npmCommand, npmArgs, {
      cwd: environment.project,
      env: npmChildEnv,
      label: 'private remote tag installation',
      secrets,
    });

    const rootResult = await runCommand(npmCommand, ['root', '--global'], {
      cwd: environment.project,
      env: environment.npmEnv,
      label: 'disposable npm package root query',
    });
    const packageRoot = resolveInstalledPackageRoot(environment.prefix);
    assertPathUnder(packageRoot, environment.prefix);
    assertPathUnder(rootResult.stdout.trim(), environment.prefix);
    await assertInstalledBehavior(environment, packageRoot, parsed.version);

    const realPrefixAfter = await queryGlobalPrefix(environment.npmEnv);
    if (realPrefixBefore !== realPrefixAfter) {
      throw new Error('Real global npm prefix changed during smoke');
    }
  } catch (error) {
    failure = error;
  } finally {
    try {
      await cleanupSmokeEnvironment(environment, rm, secrets);
    } catch (cleanupError) {
      failure = failure
        ? new Error(`${sanitizeSecretText(failure, secrets)}; ${sanitizeSecretText(cleanupError, secrets)}`)
        : cleanupError;
    }
  }
  if (failure) throw failure;
  return { tag: parsed.tag, version: parsed.version, packageSpec, npmArgs };
}

async function main() {
  const parsed = parseSmokeArguments(process.argv.slice(2), process.env);
  if (parsed.tag === '--help') {
    console.log('Usage: node scripts/smoke-tagged-install.mjs --tag vMAJOR.MINOR.PATCH [--repository URL]');
    return;
  }
  await runSmoke({ tag: parsed.tag });
  console.log('Tagged smoke passed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(sanitizeSecretText(error));
    process.exitCode = 1;
  });
}
