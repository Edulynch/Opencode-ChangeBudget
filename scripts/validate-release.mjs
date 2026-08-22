import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

export const REQUIRED_RUNTIME_FILES = [
  'dist/src/cli/index.js',
  'dist/src/cli/commands/update.js',
  'dist/src/cli/commands/version.js',
  'dist/src/core/package-root.js',
  'dist/src/core/update/github.js',
  'dist/src/core/update/npm.js',
  'dist/src/core/update/version.js',
  'opencode-plugin/dist/opencode-plugin/src/index.js',
];

const RUNTIME_ROOTS = [
  'dist/src',
  'opencode-plugin/dist/opencode-plugin',
];

const FORBIDDEN_PREFIXES = [
  'dist/tests/',
  'opencode-plugin/dist/src/',
  'tests/',
  'specs/',
  'src/',
  'node_modules/',
];

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function fail(message) {
  throw new Error(message);
}

function run(command, args, root, allowFailure = false) {
  const windowsNpm = process.platform === 'win32' && command.endsWith('.cmd');
  const executable = windowsNpm ? process.env.ComSpec || 'cmd.exe' : command;
  const spawnArgs = windowsNpm ? ['/C', ['npm', ...args].join(' ')] : args;
  const result = spawnSync(executable, spawnArgs, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error && !allowFailure) {
    fail(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0 && !allowFailure) {
    fail(`${command} ${args.join(' ')} failed: ${result.stderr ?? ''}`);
  }
  return result;
}

function readJson(root, path) {
  const absolute = join(root, path);
  if (!existsSync(absolute)) fail(`Missing ${path}`);
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function expectedReleaseTag(packageVersion) {
  if (!VERSION_PATTERN.test(packageVersion)) {
    fail(`Invalid package version: ${packageVersion}`);
  }
  return `v${packageVersion}`;
}

export function assertPackageMetadata(root) {
  const packageJson = readJson(root, 'package.json');
  const packageLock = readJson(root, 'package-lock.json');
  const version = packageJson.version;
  if (typeof version !== 'string') fail('package.json.version must be a string');
  expectedReleaseTag(version);
  if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
    fail('package.json and package-lock.json versions do not match');
  }
  return { packageJson, packageLock, version, tag: `v${version}` };
}

export function assertToolCompatibility(root) {
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (nodeMajor < 22) fail(`Release gate requires Node.js >=22; found ${process.versions.node}`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = run(npm, ['--version'], root);
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(result.stdout.trim());
  const npmVersion = match ? match.slice(1).map(Number) : null;
  const supported = npmVersion &&
    (npmVersion[0] === 11 && (npmVersion[1] > 9 || (npmVersion[1] === 9 && npmVersion[2] >= 0)));
  if (!supported) fail(`Release gate requires npm >=11.9 <12; found ${result.stdout.trim()}`);
}

function runtimeFiles(root) {
  const files = [];
  const visit = (directory) => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.js') || entry.name.endsWith('.js.map')) files.push(path);
    }
  };
  for (const runtimeRoot of RUNTIME_ROOTS) visit(join(root, runtimeRoot));
  return files;
}

export function assertRuntimePresence(root) {
  for (const path of REQUIRED_RUNTIME_FILES) {
    if (!existsSync(join(root, path))) fail(`Missing required runtime artifact: ${path}`);
  }
  for (const runtimeRoot of RUNTIME_ROOTS) {
    if (!existsSync(join(root, runtimeRoot))) fail(`Missing runtime root: ${runtimeRoot}`);
  }
}

export function assertRuntimeTracking(root) {
  const tracked = new Set(
    run('git', ['ls-files', '-z'], root).stdout.split('\0').filter(Boolean),
  );
  for (const absolute of runtimeFiles(root)) {
    const path = relative(root, absolute).replaceAll('\\', '/');
    if (!tracked.has(path)) fail(`Required runtime artifact is untracked: ${path}`);
    const ignored = run('git', ['check-ignore', '--no-index', '--quiet', '--', path], root, true);
    if (ignored.status === 0) fail(`Required runtime artifact is ignored: ${path}`);
  }
}

export function assertRuntimeFresh(root) {
  const result = run(
    'git',
    ['diff', '--exit-code', '--', 'dist/src', 'opencode-plugin/dist/opencode-plugin'],
    root,
    true,
  );
  if (result.status !== 0) fail('Tracked runtime artifacts differ from a clean build');
}

function normalizePackPaths(output) {
  const start = output.indexOf('[');
  if (start < 0) fail('npm pack did not return JSON');
  const packs = JSON.parse(output.slice(start));
  return packs.flatMap((pack) => pack.files ?? []).map((file) => file.path.replaceAll('\\', '/'));
}

export function assertPackageContents(root) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = run(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], root);
  const paths = normalizePackPaths(result.stdout);
  const required = ['package.json', ...REQUIRED_RUNTIME_FILES];
  for (const path of required) {
    if (!paths.includes(path)) fail(`Package is missing required runtime: ${path}`);
  }
  const forbidden = paths.filter((path) =>
    FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    path.endsWith('.ts') ||
    path.includes('.prepare-ran') ||
    path.includes('/tmp/'),
  );
  if (forbidden.length > 0) fail(`Package contains forbidden content: ${forbidden.join(', ')}`);
  return paths;
}

export function assertTagAvailable(root, tag, checkRemote = false) {
  const local = run('git', ['rev-parse', '--verify', `refs/tags/${tag}`], root, true);
  if (local.status === 0) fail(`Release tag already exists locally: ${tag}`);
  if (!checkRemote) return;
  const remote = run('git', ['ls-remote', '--exit-code', '--refs', 'origin', `refs/tags/${tag}`], root, true);
  if (remote.status === 0) fail(`Release tag already exists remotely: ${tag}`);
  if (remote.status !== 2) fail(`Unable to verify remote tag availability: ${tag}`);
}

export function assertCleanWorkingTree(root) {
  const unstaged = run('git', ['diff', '--quiet'], root, true);
  if (unstaged.status !== 0) fail('Release candidate has unstaged changes');
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], root);
  if (untracked.stdout.trim() !== '') fail('Release candidate has untracked files');
}

export function validateRelease({
  root = process.cwd(),
  build = true,
  checkRemote = false,
  requireClean = true,
  skipTagCheck = false,
} = {}) {
  const metadata = assertPackageMetadata(root);
  assertToolCompatibility(root);
  if (!skipTagCheck) assertTagAvailable(root, metadata.tag, checkRemote);
  if (build) {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    run(npm, ['run', 'build'], root);
  }
  assertRuntimePresence(root);
  assertRuntimeTracking(root);
  assertRuntimeFresh(root);
  assertPackageContents(root);
  if (requireClean) assertCleanWorkingTree(root);
  return metadata;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--root') options.root = argv[++index];
    else if (argument === '--skip-build') options.build = false;
    else if (argument === '--check-remote') options.checkRemote = true;
    else if (argument === '--require-clean') options.requireClean = true;
    else if (argument === '--skip-tag-check') options.skipTagCheck = true;
    else fail(`Unknown option: ${argument}`);
  }
  return options;
}

if (process.argv[1] && process.argv[1].endsWith('validate-release.mjs')) {
  try {
    const metadata = validateRelease(parseOptions(process.argv.slice(2)));
    console.log(`Release gate passed for ${metadata.tag}`);
  } catch (error) {
    console.error(`Release gate failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
