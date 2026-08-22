import * as assert from 'node:assert/strict';
import { access, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

type SmokeContract = {
  buildSmokeNpmArgs: (packageSpec: string) => string[];
  buildSmokePackageSpec: (tag: string) => string;
  buildGitAuthEnvironment: (token: string) => Record<string, string>;
  buildNpmChildEnvironment: (
    token: string,
    baseEnv?: NodeJS.ProcessEnv,
  ) => NodeJS.ProcessEnv;
  cleanupSmokeEnvironment: (
    environment: {
      root: string;
      prefix: string;
      cache: string;
      userConfig: string;
      project: string;
    },
    remove?: (
      path: string,
      options: { recursive: boolean; force: boolean },
    ) => Promise<void>,
    secrets?: string[],
  ) => Promise<void>;
  createSmokeEnvironment: () => Promise<{
    root: string;
    home: string;
    prefix: string;
    cache: string;
    userConfig: string;
    project: string;
    npmEnv: NodeJS.ProcessEnv;
  }>;
  runCommand: (
    command: string,
    args: string[],
    options: {
      env?: NodeJS.ProcessEnv;
      label?: string;
      secrets?: string[];
    },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  runSmoke: (options: { tag: string; token: string }) => Promise<unknown>;
  sanitizeSecretText: (value: unknown, secrets?: string[]) => string;
  parseSmokeTag: (tag: string) => { tag: string; version: string } | null;
  resolveInstalledCli: (prefix: string, platform: string) => string;
  resolveInstalledPackageRoot: (prefix: string, platform: string) => string;
};

async function smokeContract(): Promise<SmokeContract> {
  return import(
    pathToFileURL(join(process.cwd(), 'scripts', 'smoke-tagged-install.mjs')).href
  ) as Promise<SmokeContract>;
}

test('T006: strict stable tags parse to their package versions', async () => {
  const smoke = await smokeContract();

  assert.deepEqual(smoke.parseSmokeTag('v1.2.3'), {
    tag: 'v1.2.3',
    version: '1.2.3',
  });
  assert.equal(smoke.parseSmokeTag('1.2.3'), null);
  assert.equal(smoke.parseSmokeTag('v01.2.3'), null);
  assert.equal(smoke.parseSmokeTag('v1.2.3-beta.1'), null);
  assert.equal(smoke.parseSmokeTag('v1.2'), null);
});

test('T006: package spec and argv are deterministic', async () => {
  const smoke = await smokeContract();
  const spec = smoke.buildSmokePackageSpec('v9.8.7');

  assert.equal(
    spec,
    'git+https://github.com/Edulynch/Opencode-ChangeBudget.git#v9.8.7',
  );
  assert.deepEqual(smoke.buildSmokeNpmArgs(spec), [
    'install',
    '-g',
    '--ignore-scripts',
    '--allow-git=all',
    '--install-links=true',
    spec,
  ]);
  assert.throws(() => smoke.buildSmokePackageSpec('main'), /immutable/);
  assert.throws(() => smoke.buildSmokeNpmArgs('github:Edulynch/repo#v1.0.0'), /HTTPS/);
});

test('T006: installed package and CLI paths are platform-specific and space-safe', async () => {
  const smoke = await smokeContract();
  const windowsPrefix = 'C:\\temporary smoke\\prefix';
  const posixPrefix = '/tmp/temporary smoke/prefix';

  assert.equal(
    smoke.resolveInstalledPackageRoot(windowsPrefix, 'win32'),
    'C:\\temporary smoke\\prefix\\node_modules\\changebudget-cli',
  );
  assert.equal(
    smoke.resolveInstalledCli(windowsPrefix, 'win32'),
    'C:\\temporary smoke\\prefix\\changebudget.cmd',
  );
  assert.equal(
    smoke.resolveInstalledPackageRoot(posixPrefix, 'linux'),
    '/tmp/temporary smoke/prefix/lib/node_modules/changebudget-cli',
  );
  assert.equal(
    smoke.resolveInstalledCli(posixPrefix, 'linux'),
    '/tmp/temporary smoke/prefix/bin/changebudget',
  );
});

test('T016: private Git auth is process-scoped and never enters the package contract', async () => {
  const smoke = await smokeContract();
  const token = 'FAKE_SECRET_DO_NOT_PRINT_12345';
  const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  const spec = smoke.buildSmokePackageSpec('v1.2.3');
  const argv = smoke.buildSmokeNpmArgs(spec);
  const auth = smoke.buildGitAuthEnvironment(token);
  const childEnv = smoke.buildNpmChildEnvironment(token, {
    GITHUB_TOKEN: token,
    GH_TOKEN: token,
    PATH: process.env.PATH,
  });

  assert.deepEqual(auth, {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${encoded}`,
  });
  assert.equal(spec.includes(token), false);
  assert.equal(argv.join('\u0000').includes(token), false);
  assert.equal(childEnv.GITHUB_TOKEN, undefined);
  assert.equal(childEnv.GH_TOKEN, undefined);
  assert.equal(childEnv.GIT_CONFIG_COUNT, '1');
  assert.equal(childEnv.GIT_CONFIG_KEY_0, auth.GIT_CONFIG_KEY_0);
  assert.equal(childEnv.GIT_CONFIG_VALUE_0, auth.GIT_CONFIG_VALUE_0);
});

test('T016: Node -> npm -> Git receives auth without exposing encoded credentials', async () => {
  const smoke = await smokeContract();
  const token = 'FAKE_SECRET_DO_NOT_PRINT_12345';
  const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  const childEnv = smoke.buildNpmChildEnvironment(token);
  const fakeNpm = [
    '-e',
    [
      "const { spawnSync } = require('node:child_process');",
      "const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(JSON.stringify({ key: process.env.GIT_CONFIG_KEY_0, value: process.env.GIT_CONFIG_VALUE_0 }))'], { env: process.env });",
      'process.stdout.write(result.stdout);',
    ].join(''),
  ];
  const result = await smoke.runCommand(process.execPath, fakeNpm, {
    env: childEnv,
    label: 'fake npm to fake git propagation',
    secrets: [token],
  });
  const observed = JSON.parse(result.stdout) as { key: string; value: string };
  assert.equal(observed.key, 'http.https://github.com/.extraheader');
  assert.equal(observed.value, '[REDACTED]');
  assert.equal(result.stdout.includes(token), false);
  assert.equal(result.stdout.includes(encoded), false);
});

test('T016: missing private token fails before any install attempt', async () => {
  const smoke = await smokeContract();
  assert.throws(
    () => smoke.buildGitAuthEnvironment(''),
    /GITHUB_TOKEN is required for private tagged smoke/,
  );
  assert.throws(
    () => smoke.buildGitAuthEnvironment('   '),
    /GITHUB_TOKEN is required for private tagged smoke/,
  );
  await assert.rejects(
    smoke.runSmoke({ tag: 'v1.2.3', token: '' }),
    /GITHUB_TOKEN is required for private tagged smoke/,
  );
});

test('T016: failed child output and cleanup errors are sanitized', async () => {
  const smoke = await smokeContract();
  const token = 'FAKE_SECRET_DO_NOT_PRINT_12345';
  const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  await assert.rejects(
    smoke.runCommand(
      process.execPath,
      ['-e', `process.stderr.write(${JSON.stringify(`${token} ${encoded}`)}); process.exit(7);`],
      { label: 'sanitized fake failure', secrets: [token] },
    ),
    (error: unknown) => {
      const message = String(error);
      assert.equal(message.includes(token), false);
      assert.equal(message.includes(encoded), false);
      assert.match(message, /\[REDACTED\]/);
      return true;
    },
  );

  const environment = await smoke.createSmokeEnvironment();
  const remove = async (
    path: string,
    options: { recursive: boolean; force: boolean },
  ): Promise<void> => {
    if (path === environment.cache) throw new Error(token);
    await rm(path, options);
  };
  await assert.rejects(
    smoke.cleanupSmokeEnvironment(environment, remove, [token]),
    (error: unknown) => {
      const message = String(error);
      assert.equal(message.includes(token), false);
      assert.equal(message.includes(encoded), false);
      assert.match(message, /Cleanup failed/);
      return true;
    },
  );
  await assert.rejects(access(environment.root));
});

test('T016: disposable environment cleanup removes all space-safe resources', async () => {
  const smoke = await smokeContract();
  const environment = await smoke.createSmokeEnvironment();
  assert.match(environment.root, / /);
  await smoke.cleanupSmokeEnvironment(environment);
  await assert.rejects(access(environment.root));
  await assert.rejects(access(environment.prefix));
  await assert.rejects(access(environment.cache));
  await assert.rejects(access(environment.userConfig));
  await assert.rejects(access(environment.project));
});

test('T020/T021: platform isolation is carried by the harness environment', async () => {
  const smoke = await smokeContract();
  const environment = await smoke.createSmokeEnvironment();
  try {
    assert.equal(environment.npmEnv.HOME, environment.home);
    assert.equal(environment.npmEnv.USERPROFILE, environment.home);
    assert.equal(environment.npmEnv.GIT_CONFIG_NOSYSTEM, '1');
    assert.equal(environment.npmEnv.GIT_TERMINAL_PROMPT, '0');
    assert.equal(environment.npmEnv.npm_config_prefix, environment.prefix);
    assert.equal(environment.npmEnv.npm_config_cache, environment.cache);
    assert.equal(environment.npmEnv.npm_config_userconfig, environment.userConfig);
    assert.equal(environment.npmEnv.GITHUB_TOKEN, undefined);
    assert.equal(environment.npmEnv.GH_TOKEN, undefined);
    assert.equal(environment.npmEnv.SSH_AUTH_SOCK, undefined);
    if (process.platform !== 'win32') {
      assert.equal(environment.npmEnv.GIT_CONFIG_GLOBAL, '/dev/null');
    }
  } finally {
    await smoke.cleanupSmokeEnvironment(environment);
  }
});
