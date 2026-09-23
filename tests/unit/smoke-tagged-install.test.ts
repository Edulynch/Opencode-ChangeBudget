import * as assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

type SmokeContract = {
  DEFAULT_COMMAND_TIMEOUT_MS: number;
  REMOTE_TAG_INSTALL_TIMEOUT_MS: number;
  REMOTE_TAG_INSTALL_HEARTBEAT_INTERVAL_MS: number;
  REMOTE_TAG_INSTALL_OPTIONS: {
    timeout: number;
    heartbeatIntervalMs: number;
    heartbeatLabel: string;
  };
  buildSmokeNpmArgs: (packageSpec: string) => string[];
  buildSmokePackageSpec: (tag: string) => string;
  buildGitAuthEnvironment: (token: string) => Record<string, string>;
  buildNpmChildEnvironment: (
    authentication: { mode: 'private' | 'public'; token?: string },
    baseEnv?: NodeJS.ProcessEnv,
  ) => NodeJS.ProcessEnv;
  buildCommandInvocation: (
    command: string,
    args: string[],
    platform: string,
    comSpec: string,
  ) => {
    command: string;
    args: string[];
    windowsVerbatimArguments: boolean;
  };
  composeSmokeFailureWithCleanup: (
    failure: unknown,
    cleanupFailure: unknown,
    secrets?: string[],
  ) => Error;
  windowsCommandLine: (args: string[]) => string;
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
      cwd?: string;
      label?: string;
      secrets?: string[];
      timeout?: number;
      heartbeatIntervalMs?: number;
      heartbeatLabel?: string;
      onHeartbeat?: (message: string) => void;
    },
  ) => Promise<{ code: number; stdout: string; stderr: string }>;
  parseSmokeArguments: (
    args: string[],
    environment?: NodeJS.ProcessEnv,
  ) => { tag: string; repository: string; authMode: 'private' | 'public' };
  runSmoke: (options: {
    tag: string;
    authMode: 'private' | 'public';
    token?: string;
  }) => Promise<unknown>;
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

test('T006: stable and supported prerelease tags parse to exact package versions', async () => {
  const smoke = await smokeContract();

  assert.deepEqual(smoke.parseSmokeTag('v1.2.3'), {
    tag: 'v1.2.3',
    version: '1.2.3',
  });
  assert.equal(smoke.parseSmokeTag('1.2.3'), null);
  assert.equal(smoke.parseSmokeTag('v01.2.3'), null);
  for (const version of ['1.2.3-alpha.1', '1.2.3-beta.1', '1.2.3-rc.20']) {
    assert.deepEqual(smoke.parseSmokeTag(`v${version}`), { tag: `v${version}`, version });
  }
  for (const tag of [
    'v1.2.3-beta',
    'v1.2.3-beta.x',
    'v1.2.3-beta.01',
    'v1.2.3-preview.1',
    'v1.2.3-beta.1.2',
    'v1.2.3+build',
    'v1.2.3-beta.1+build',
    'v1.2.3\n',
  ]) assert.equal(smoke.parseSmokeTag(tag), null, tag);
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

test('T016: remote tag installation has a 10-minute timeout and ordinary commands retain 4 minutes', async () => {
  const smoke = await smokeContract();

  assert.equal(smoke.DEFAULT_COMMAND_TIMEOUT_MS, 240_000);
  assert.equal(smoke.REMOTE_TAG_INSTALL_TIMEOUT_MS, 600_000);
  assert.equal(smoke.REMOTE_TAG_INSTALL_HEARTBEAT_INTERVAL_MS, 60_000);
  assert.deepEqual(smoke.REMOTE_TAG_INSTALL_OPTIONS, {
    timeout: 600_000,
    heartbeatIntervalMs: 60_000,
    heartbeatLabel: 'Tagged smoke install',
  });
});

test('T006: installed package and CLI paths are platform-specific and space-safe', async () => {
  const smoke = await smokeContract();
  const windowsPrefix = 'C:\\temporary smoke\\prefix';
  const posixPrefix = '/tmp/temporary smoke/prefix';

  assert.equal(
    smoke.resolveInstalledPackageRoot(windowsPrefix, 'win32'),
    'C:\\temporary smoke\\prefix\\node_modules\\changebudget',
  );
  assert.equal(
    smoke.resolveInstalledCli(windowsPrefix, 'win32'),
    'C:\\temporary smoke\\prefix\\changebudget.cmd',
  );
  assert.equal(
    smoke.resolveInstalledPackageRoot(posixPrefix, 'linux'),
    '/tmp/temporary smoke/prefix/lib/node_modules/changebudget',
  );
  assert.equal(
    smoke.resolveInstalledCli(posixPrefix, 'linux'),
    '/tmp/temporary smoke/prefix/bin/changebudget',
  );
});

test('T016: disposable smoke project is a committed Git repository with preserved baseline files', async () => {
  const smoke = await smokeContract();
  const environment = await smoke.createSmokeEnvironment();
  try {
    const head = await smoke.runCommand('git', ['rev-parse', '--verify', 'HEAD'], {
      cwd: environment.project,
      label: 'inspect disposable smoke HEAD',
    });
    assert.match(head.stdout.trim(), /^[0-9a-f]{40}$/);
    const status = await smoke.runCommand('git', ['status', '--porcelain'], {
      cwd: environment.project,
      label: 'inspect disposable smoke status',
    });
    assert.equal(status.stdout, '');
    assert.equal(await readFile(join(environment.project, 'AGENTS.md'), 'utf8'), 'tagged-smoke-owned\n');
    assert.equal(await readFile(join(environment.project, 'package.json'), 'utf8'), '{"name":"tagged-smoke-project"}\n');
  } finally {
    await smoke.cleanupSmokeEnvironment(environment);
  }
});

test('T016: Windows .cmd commands use ComSpec, shell false, and preserve spaces and args', async () => {
  const smoke = await smokeContract();
  const executable = 'C:\\temporary smoke\\global prefix\\changebudget.cmd';
  const args = ['--help', 'project with spaces'];
  assert.deepEqual(
    smoke.buildCommandInvocation(executable, args, 'win32', 'C:\\Windows\\System32\\cmd.exe'),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/D', '/S', '/C', '""C:\\temporary smoke\\global prefix\\changebudget.cmd" --help "project with spaces""'],
      windowsVerbatimArguments: true,
    },
  );
  assert.deepEqual(
    smoke.buildCommandInvocation('npm.cmd', ['install', 'git+https://github.com/Edulynch/Opencode-ChangeBudget.git#v1.2.3'], 'win32', 'cmd.exe').command,
    'cmd.exe',
  );
  const posix = smoke.buildCommandInvocation('/tmp/changebudget', ['--version'], 'linux', 'cmd.exe');
  assert.deepEqual(posix, {
    command: '/tmp/changebudget',
    args: ['--version'],
    windowsVerbatimArguments: false,
  });
});

test('T016: private Git auth is process-scoped and never enters the package contract', async () => {
  const smoke = await smokeContract();
  const token = 'FAKE_SECRET_DO_NOT_PRINT_12345';
  const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  const spec = smoke.buildSmokePackageSpec('v1.2.3');
  const argv = smoke.buildSmokeNpmArgs(spec);
  const auth = smoke.buildGitAuthEnvironment(token);
  const childEnv = smoke.buildNpmChildEnvironment({ mode: 'private', token }, {
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
  const childEnv = smoke.buildNpmChildEnvironment({ mode: 'private', token });
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
    smoke.runSmoke({ tag: 'v1.2.3', authMode: 'private', token: '' }),
    /GITHUB_TOKEN is required for private tagged smoke/,
  );
});

test('T025: public tagged smoke rejects tokens and removes inherited Git authentication', async () => {
  const smoke = await smokeContract();
  const token = 'FAKE_PUBLIC_MODE_TOKEN_DO_NOT_PRINT';

  const childEnv = smoke.buildNpmChildEnvironment(
    { mode: 'public' },
    {
      GITHUB_TOKEN: token,
      GH_TOKEN: token,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: 'Authorization: Basic token',
      GIT_CONFIG_PARAMETERS: 'credential.helper=store',
      GIT_ASKPASS: 'askpass',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      GIT_SSH: 'ssh',
      GIT_SSH_COMMAND: 'ssh -i key',
      GH_CONFIG_DIR: '/tmp/gh',
    },
  );

  assert.equal(childEnv.GITHUB_TOKEN, undefined);
  assert.equal(childEnv.GH_TOKEN, undefined);
  assert.equal(childEnv.GIT_CONFIG_COUNT, undefined);
  assert.equal(childEnv.GIT_CONFIG_KEY_0, undefined);
  assert.equal(childEnv.GIT_CONFIG_VALUE_0, undefined);
  assert.equal(childEnv.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(childEnv.GIT_ASKPASS, undefined);
  assert.equal(childEnv.SSH_AUTH_SOCK, undefined);
  assert.equal(childEnv.GIT_SSH, undefined);
  assert.equal(childEnv.GIT_SSH_COMMAND, undefined);
  assert.equal(childEnv.GH_CONFIG_DIR, undefined);
  assert.throws(
    () => smoke.buildNpmChildEnvironment({ mode: 'public', token }),
    /Public tagged smoke must not receive authentication credentials/,
  );
  await assert.rejects(
    smoke.runSmoke({ tag: 'v1.2.3', authMode: 'public', token }),
    /Public tagged smoke must not receive authentication credentials/,
  );
});

test('T025: smoke arguments make authentication mode explicit and reject unknown modes', async () => {
  const smoke = await smokeContract();

  assert.deepEqual(
    smoke.parseSmokeArguments(['--tag', 'v1.2.3', '--auth-mode', 'public']),
    {
      tag: 'v1.2.3',
      repository: 'https://github.com/Edulynch/Opencode-ChangeBudget.git',
      authMode: 'public',
    },
  );
  assert.throws(
    () => smoke.parseSmokeArguments(['--tag', 'v1.2.3', '--auth-mode', 'anonymous']),
    /Expected smoke authentication mode: private or public/,
  );
});

test('T016: failed child output and cleanup errors are sanitized', async () => {
  const smoke = await smokeContract();
  const token = 'FAKE_SECRET_DO_NOT_PRINT_12345';
  const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  await assert.rejects(
    smoke.runCommand(
      process.execPath,
      [
        '-e',
        `process.stdout.write('safe stdout marker\\n'); process.stderr.write(${JSON.stringify(`safe stderr marker ${token} ${encoded}`)}); process.exit(7);`,
      ],
      { label: 'sanitized fake failure', secrets: [token] },
    ),
    (error: unknown) => {
      const message = String(error);
      assert.equal(message.includes(token), false);
      assert.equal(message.includes(encoded), false);
      assert.match(message, /\[REDACTED\]/);
      assert.match(message, /safe stdout marker/);
      assert.match(message, /safe stderr marker/);
      assert.match(message, /Command failed: sanitized fake failure/);
      assert.doesNotMatch(message, /timed out/i);
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

test('T016: timeout preserves partial stdout and stderr and remains a failure', async () => {
  const smoke = await smokeContract();
  await assert.rejects(
    smoke.runCommand(
      process.execPath,
      [
        '-e',
        "process.stdout.write('partial stdout marker\\n'); process.stderr.write('partial stderr marker\\n'); setInterval(() => {}, 1000);",
      ],
      { label: 'timeout output fixture', timeout: 500 },
    ),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /Command timed out: timeout output fixture/);
      assert.match(message, /Timeout limit: 500 ms/);
      assert.match(message, /stdout:\npartial stdout marker/);
      assert.match(message, /stderr:\npartial stderr marker/);
      return true;
    },
  );
});

test('T016: timeout output sanitizes raw and encoded secrets', async () => {
  const smoke = await smokeContract();
  const token = 'FAKE_TIMEOUT_SECRET_DO_NOT_PRINT_98765';
  const encoded = Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64');
  const output = `${token} ${encoded}`;
  await assert.rejects(
    smoke.runCommand(
      process.execPath,
      [
        '-e',
        `process.stdout.write(${JSON.stringify(output)}); process.stderr.write(${JSON.stringify(output)}); setInterval(() => {}, 1000);`,
      ],
      { label: 'timeout secret fixture', secrets: [token], timeout: 500 },
    ),
    (error: unknown) => {
      const message = String(error);
      assert.match(message, /Command timed out: timeout secret fixture/);
      assert.match(message, /Timeout limit: 500 ms/);
      assert.equal(message.includes(token), false);
      assert.equal(message.includes(encoded), false);
      assert.match(message, /\[REDACTED\]/);
      return true;
    },
  );
});

test('T016: timeout terminates descendants before cleanup begins', async () => {
  const smoke = await smokeContract();
  const root = await mkdtemp(join(tmpdir(), 'changebudget timeout cleanup '));
  const markerPath = join(root, 'processes.json');
  const heartbeatPath = join(root, 'descendant heartbeat.txt');
  const descendantScript = [
    "const fs = require('node:fs');",
    `const path = ${JSON.stringify(heartbeatPath)};`,
    "setInterval(() => { try { fs.appendFileSync(path, '.'); } catch {} }, 10);",
  ].join('');
  const parentScript = [
    "const { spawn } = require('node:child_process');",
    "const { writeFileSync } = require('node:fs');",
    `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantScript)}], { stdio: 'ignore' });`,
    `writeFileSync(${JSON.stringify(markerPath)}, JSON.stringify({ parent: process.pid, descendant: descendant.pid }));`,
    "process.stdout.write(`parent=${process.pid} descendant=${descendant.pid}\\n`);",
    "process.stderr.write('descendant fixture active\\n');",
    'setInterval(() => {}, 1000);',
  ].join('');
  let processes: { parent: number; descendant: number } | undefined;
  let cleanupStarted = false;
  try {
    let failure: unknown;
    try {
      await smoke.runCommand(process.execPath, ['-e', parentScript], {
        label: 'descendant timeout fixture',
        timeout: 750,
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, 'the long-running command must time out');
    const message = String(failure);
    assert.match(message, /Command timed out: descendant timeout fixture/);
    assert.match(message, /Timeout limit: 750 ms/);
    assert.match(message, /parent=\d+ descendant=\d+/);
    assert.match(message, /descendant fixture active/);
    processes = JSON.parse(await readFile(markerPath, 'utf8')) as {
      parent: number;
      descendant: number;
    };
    assert.equal(isProcessRunning(processes.parent), false, 'the timed-out parent must be gone');
    assert.equal(isProcessRunning(processes.descendant), false, 'the timed-out descendant must be gone');

    cleanupStarted = true;
    await rm(root, { recursive: true, force: true });
    await assert.rejects(access(root));
    assert.equal(cleanupStarted, true);
  } finally {
    if (!processes) {
      try {
        processes = JSON.parse(await readFile(markerPath, 'utf8')) as {
          parent: number;
          descendant: number;
        };
      } catch {
        // The fixture may not have started before the assertion failed.
      }
    }
    if (processes) {
      await terminateTestProcess(processes.parent);
      await terminateTestProcess(processes.descendant);
    }
    await rm(root, { recursive: true, force: true });
  }
});

test('T016: cleanup failure is composed after the primary timeout and sanitized', async () => {
  const smoke = await smokeContract();
  const token = 'FAKE_COMPOSED_ERROR_SECRET_98765';
  const primary = new Error(`Command timed out: install\nstdout: ${token}`);
  const cleanup = new Error(`Cleanup failed: ENOTEMPTY ${token}`);
  const combined = smoke.composeSmokeFailureWithCleanup(primary, cleanup, [token]);
  assert.match(combined.message, /Command timed out: install/);
  assert.match(combined.message, /Cleanup also failed: Cleanup failed: ENOTEMPTY/);
  assert.equal(combined.message.includes(token), false);
  assert.equal((combined.message.match(/\[REDACTED\]/g) ?? []).length, 2);
});

test('T016: successful commands preserve code and sanitized output', async () => {
  const smoke = await smokeContract();
  const result = await smoke.runCommand(
    process.execPath,
    [
      '-e',
      "process.stdout.write('normal stdout\\n'); process.stderr.write('normal stderr\\n');",
    ],
    { label: 'normal command fixture' },
  );
  assert.deepEqual(result, {
    code: 0,
    stdout: 'normal stdout\n',
    stderr: 'normal stderr\n',
  });
});

test('T016: install heartbeat reports progress and stops when the command succeeds', async () => {
  const smoke = await smokeContract();
  const heartbeats: string[] = [];
  const result = await smoke.runCommand(
    process.execPath,
    [
      '-e',
      "setTimeout(() => process.stdout.write('install complete\\n'), 220);",
    ],
    {
      label: 'heartbeat success fixture',
      heartbeatIntervalMs: 40,
      heartbeatLabel: 'Tagged smoke install',
      onHeartbeat: (message) => heartbeats.push(message),
    },
  );

  assert.ok(heartbeats.length >= 2);
  assert.equal(heartbeats[0], 'Tagged smoke install still running (0.04s)');
  assert.equal(result.stdout, 'install complete\n');
  const heartbeatCountAtCompletion = heartbeats.length;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(heartbeats.length, heartbeatCountAtCompletion);
});

test('T016: install heartbeat stops as soon as the command times out', async () => {
  const smoke = await smokeContract();
  const heartbeats: string[] = [];

  await assert.rejects(
    smoke.runCommand(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000);'],
      {
        label: 'heartbeat timeout fixture',
        timeout: 180,
        heartbeatIntervalMs: 30,
        heartbeatLabel: 'Tagged smoke install',
        onHeartbeat: (message) => heartbeats.push(message),
      },
    ),
    /Timeout limit: 180 ms/,
  );

  assert.ok(heartbeats.length >= 2);
  const heartbeatCountAtTimeout = heartbeats.length;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(heartbeats.length, heartbeatCountAtTimeout);
});

test('T016: a completed install leaves no heartbeat timer keeping the harness alive', async () => {
  const smoke = await smokeContract();
  const smokeModuleUrl = pathToFileURL(
    join(process.cwd(), 'scripts', 'smoke-tagged-install.mjs'),
  ).href;
  const wrapperScript = [
    `const smoke = await import(${JSON.stringify(smokeModuleUrl)});`,
    "await smoke.runCommand(process.execPath, ['-e', ''], { timeout: 5000, heartbeatIntervalMs: 60_000 });",
    "process.stdout.write('wrapper complete');",
  ].join('\n');
  const result = await smoke.runCommand(
    process.execPath,
    ['--input-type=module', '-e', wrapperScript],
    { label: 'heartbeat timer lifecycle fixture', timeout: 2000 },
  );

  assert.equal(result.stdout, 'wrapper complete');
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

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(isProcessRunning(pid), false, `process ${pid} should have exited`);
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    throw error;
  }
}

async function terminateTestProcess(pid: number): Promise<void> {
  if (!isProcessRunning(pid)) return;
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  await waitForProcessExit(pid);
}
