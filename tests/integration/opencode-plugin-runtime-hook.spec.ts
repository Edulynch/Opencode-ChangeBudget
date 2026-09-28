import * as assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, readlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { removeTestRepository } from '../utils/disposable-repository.js';

import { RUNTIME_RULES, projectRuntimeDecision } from '../../opencode-plugin/src/projection.js';
import { installIntegration, MANAGED_RESOURCES, resolveChangeBudgetRoot } from '../../src/core/integration/opencode.js';
import { readContract, writeExecutionEnvelopeInPlace } from '../../src/core/state/contracts.js';
import type { ExecutionEnvelope } from '../../src/models/execution-gate.js';

type Hook = (event: any) => Promise<void> | void;

interface PluginModule {
  readonly default: {
    readonly id: string;
    readonly setup: (context: unknown) => Promise<unknown>;
  };
}

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function cli(root: string, args: string[]): void {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), ...args],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function createNpmSpoofLaunchers(root: string): Promise<void> {
  const npmRoot = join(root, 'node_modules', 'npm');
  const npmBinDirectory = join(npmRoot, 'bin');
  await mkdir(npmBinDirectory, { recursive: true });
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({
    name: 'npm',
    bin: { npm: 'bin/npm-cli.js', npx: 'bin/npx-cli.js' },
  }), 'utf8');

  for (const executable of ['npm', 'npx'] as const) {
    const cliPath = join(npmBinDirectory, `${executable}-cli.js`);
    await writeFile(cliPath, `// attacker-controlled ${executable} CLI\n`, 'utf8');
    if (process.platform === 'win32') {
      await writeFile(
        join(root, `${executable}.cmd`),
        `@ECHO off\r\n"${process.execPath}" "${cliPath}" %*\r\n`,
        'utf8',
      );
    } else {
      const launcher = join(root, executable);
      await writeFile(
        launcher,
        `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"\n`,
        'utf8',
      );
      await chmod(launcher, 0o755);
    }
  }
}

async function withUnverifiedLauncherPath<T>(operation: () => Promise<T>): Promise<T> {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'cb-unverified-launchers-'));
  const originalPath = process.env.PATH;
  try {
    const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
    const fakeNode = join(fixtureRoot, nodeName);
    await writeFile(fakeNode, 'inert shadow node\n', 'utf8');
    if (process.platform !== 'win32') await chmod(fakeNode, 0o755);
    await createNpmSpoofLaunchers(fixtureRoot);
    process.env.PATH = [fixtureRoot, originalPath].filter(Boolean).join(delimiter);
    return await operation();
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    await removeTestRepository(fixtureRoot);
  }
}

function throughCanonicalCli(command: string): string {
  const canonicalCliEntry = join(process.cwd(), 'dist', 'src', 'cli', 'index.js').replace(/\\/g, '/');
  const canonicalInvocation = `node ${canonicalCliEntry}`;
  return command
    .replace(/\bnpm exec -- changebudget(?=\s|$)/g, canonicalInvocation)
    .replace(/\bnpx changebudget(?=\s|$)/g, canonicalInvocation)
    .replace(/\bchangebudget(?=\s|$)/g, canonicalInvocation);
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-v2-plugin-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'plugin test']);
  git(root, ['config', 'user.email', 'plugin@test']);
  git(root, ['commit', '--allow-empty', '-m', 'seed']);
  return root;
}

async function snapshotChangeBudget(root: string): Promise<readonly (readonly [string, string])[]> {
  const changeBudgetRoot = join(root, '.changebudget');
  const snapshot: Array<readonly [string, string]> = [];

  async function walk(directory: string, relativeDirectory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = relativeDirectory.length > 0
        ? `${relativeDirectory}/${entry.name}`
        : entry.name;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        snapshot.push([relativePath, 'directory']);
        await walk(absolutePath, relativePath);
      } else if (entry.isFile()) {
        snapshot.push([relativePath, `file:${(await readFile(absolutePath)).toString('base64')}`]);
      } else if (entry.isSymbolicLink()) {
        snapshot.push([relativePath, `symlink:${await readlink(absolutePath)}`]);
      } else {
        snapshot.push([relativePath, 'other']);
      }
    }
  }

  try {
    await walk(changeBudgetRoot, '');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return snapshot;
}

async function loadEvaluateHook(root: string): Promise<{ plugin: PluginModule['default']; hook: Hook }> {
  const url = pathToFileURL(join(root, MANAGED_RESOURCES.pluginWrapper)).href;
  const module = (await import(url)) as PluginModule;
  let hook: Hook | undefined;
  await module.default.setup({
    location: { directory: root },
    session: {
      hook: async (_name: string, _callback: Hook) => ({ dispose: async () => undefined }),
    },
    permission: {
      hook: async (_name: string, callback: Hook) => {
        hook = callback;
        return { dispose: async () => undefined };
      },
    },
  });
  assert.ok(hook);
  return { plugin: module.default, hook: hook! };
}

async function loadPackageRootEvaluateHook(packageRoot: string): Promise<Hook> {
  const url = pathToFileURL(join(
    packageRoot,
    'opencode-plugin',
    'dist',
    'opencode-plugin',
    'src',
    'index.js',
  )).href;
  const module = (await import(url)) as PluginModule;
  let hook: Hook | undefined;
  await module.default.setup({
    location: { directory: packageRoot },
    session: {
      hook: async (_name: string, _callback: Hook) => ({ dispose: async () => undefined }),
    },
    permission: {
      hook: async (_name: string, callback: Hook) => {
        hook = callback;
        return { dispose: async () => undefined };
      },
    },
  });
  assert.ok(hook);
  return hook!;
}

test('V2 plugin exports the native id and no legacy hook adapter', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { plugin } = await loadEvaluateHook(root);
    assert.equal(plugin.id, 'changebudget');
    assert.equal('server' in plugin, false);
  } finally {
    await removeTestRepository(root);
  }
});

test('V2 permission evaluation accepts normal metadata without inventing a decision', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { hook } = await loadEvaluateHook(root);
    const event = {
      sessionID: 'ordinary',
      action: 'edit',
      resources: ['src/app.ts'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(event);
    assert.equal(event.effect, 'allow');
    assert.equal(event.message, undefined);

    const unknownChangeBudget = {
      sessionID: 'unknown-changebudget-before-init',
      action: 'shell',
      resources: ['changebudget unknown-command'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(unknownChangeBudget);
    assert.equal(unknownChangeBudget.effect, 'deny');
    assert.match(unknownChangeBudget.message ?? '', /OCG-UNRESOLVED-MUTATION/);

    const unprovenBareRecovery = {
      sessionID: 'unproven-bare-recovery-before-init',
      action: 'shell',
      resources: ['changebudget recover lifecycle-lock --reason "unproven PATH identity"'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(unprovenBareRecovery);
    assert.equal(unprovenBareRecovery.effect, 'deny');
    assert.match(unprovenBareRecovery.message ?? '', /OCG-UNRESOLVED-MUTATION/);
    assert.doesNotMatch(unprovenBareRecovery.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

    const updateBeforeInit = {
      sessionID: 'update-changebudget-before-init',
      action: 'shell',
      resources: [throughCanonicalCli('changebudget update')],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(updateBeforeInit);
    assert.equal(updateBeforeInit.effect, 'ask');
    assert.match(updateBeforeInit.message ?? '', /OCG-CHANGEBUDGET-EXTERNAL-MUTATION/);
  } finally {
    await removeTestRepository(root);
  }
});

test('command substitutions and supported command-string recovery are blocked in passive mode', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { hook } = await loadEvaluateHook(root);

    const recoveryCommands = [
      { command: "echo \"$(changebudget recover lifecycle-lock --reason 'direct substitution')\"", effect: 'allow' as const },
      { command: 'echo "$(npm exec -- changebudget recover lifecycle-lock --force --reason nested-npm)"', effect: 'ask' as const },
      { command: "sh -c 'echo \"$(changebudget recover lifecycle-lock --force --reason nested-shell)\"'", effect: 'allow' as const },
      { command: "npx -c 'changebudget recover lifecycle-lock --force --reason npx-call'", effect: 'ask' as const },
      { command: "npm exec --call='echo \"$(changebudget recover lifecycle-lock --force --reason npm-call)\"'", effect: 'allow' as const },
    ];
    for (const [index, request] of recoveryCommands.entries()) {
      const event = {
        sessionID: `passive-substitution-recovery-${index}`,
        action: 'shell',
        resources: [throughCanonicalCli(request.command)],
        effect: request.effect,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', request.command);
      assert.match(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, request.command);
    }

    const depthBoundaryDirect = throughCanonicalCli(String.raw`cat README.md "$(sh -c 'sh -c "changebudget recover lifecycle-lock --reason /tmp/gv2"')"`);
    const depthBelowBoundaryDirect = throughCanonicalCli(String.raw`cat README.md "$(sh -c 'changebudget recover lifecycle-lock --reason /tmp/gv2')"`);
    const depthBeyondBoundaryDirect = throughCanonicalCli(String.raw`cat README.md "$(sh -c 'sh -c "sh -c \"changebudget recover lifecycle-lock --reason /tmp/gv2\""')"`);
    const escapedMalformedDepthBoundaryDirect = throughCanonicalCli(String.raw`cat README.md "$(sh -c 'sh -c \"changebudget recover lifecycle-lock --reason /tmp/gv2\"')"`);
    const depthBoundaryNpm = String.raw`cat README.md "$(sh -c 'sh -c "npm exec -- changebudget recover lifecycle-lock --reason /tmp/gv2"')"`;
    const depthBoundaryNpxCall = String.raw`cat README.md "$(sh -c 'sh -c "npx -c \"changebudget recover lifecycle-lock --reason /tmp/gv2\""')"`;
    const depthBoundaryNpmCall = String.raw`cat README.md "$(sh -c 'sh -c "npm exec --call=\"changebudget recover lifecycle-lock --reason /tmp/gv2\""')"`;
    const depthBoundaryBenign = String.raw`cat README.md "$(sh -c 'sh -c \"echo benign\"')"`;
    const depthBoundaryRecoveryCommands = [
      { command: depthBelowBoundaryDirect, effect: 'allow' as const, message: /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/ },
      { command: depthBoundaryDirect, effect: 'allow' as const, message: /OCG-UNRESOLVED-MUTATION/ },
      { command: depthBoundaryDirect, effect: 'ask' as const, message: /OCG-UNRESOLVED-MUTATION/ },
      { command: depthBeyondBoundaryDirect, effect: 'allow' as const, message: /OCG-UNRESOLVED-MUTATION/ },
      { command: depthBoundaryNpm, effect: 'allow' as const, message: /OCG-UNRESOLVED-MUTATION/ },
      { command: depthBoundaryNpxCall, effect: 'ask' as const, message: /OCG-UNRESOLVED-MUTATION/ },
      { command: depthBoundaryNpmCall, effect: 'allow' as const, message: /OCG-UNRESOLVED-MUTATION/ },
    ];
    for (const [index, request] of depthBoundaryRecoveryCommands.entries()) {
      const event = {
        sessionID: `passive-depth-boundary-recovery-${index}`,
        action: 'shell',
        resources: [request.command],
        effect: request.effect,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', request.command);
      assert.match(event.message ?? '', request.message, request.command);
    }

    const escapedMalformedDepthBoundaryEvent = {
      sessionID: 'passive-escaped-malformed-depth-boundary',
      action: 'shell',
      resources: [escapedMalformedDepthBoundaryDirect],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(escapedMalformedDepthBoundaryEvent);
    assert.equal(escapedMalformedDepthBoundaryEvent.effect, 'allow');
    assert.equal(escapedMalformedDepthBoundaryEvent.message, undefined);
    assert.doesNotMatch(escapedMalformedDepthBoundaryEvent.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

    const unrelatedCommands = [
      "echo '$(changebudget recover lifecycle-lock --force --reason literal)'",
      "npx -c 'echo hello'",
      'npm exec -- eslint',
      depthBoundaryBenign,
    ];
    for (const command of unrelatedCommands) {
      const event = {
        sessionID: `passive-unrelated-command-${command}`,
        action: 'shell',
        resources: [command],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'allow', command);
      assert.equal(event.message, undefined, command);
    }
  } finally {
    await removeTestRepository(root);
  }
});

test('V2 runtime guard blocks Node CLI lifecycle-lock recovery as operator-only', async () => {
  const packageRoot = resolveChangeBudgetRoot();
  const hook = await loadPackageRootEvaluateHook(packageRoot);
  const recoveryRequests = [
    { script: 'dist/src/cli/index.js', force: false, effect: 'allow' as const },
    { script: './dist/src/cli/index.js', force: false, effect: 'ask' as const },
    { script: String.raw`".\dist\src\cli\index.js"`, force: true, effect: 'allow' as const },
    { script: '"dist/src/cli/index.js"', force: true, effect: 'ask' as const },
  ];

  for (const [index, request] of recoveryRequests.entries()) {
    const command = [
      `node ${request.script} recover lifecycle-lock`,
      ...(request.force ? ['--force'] : []),
      '--reason "operator approved stale-lock recovery"',
    ].join(' ');
    const event = {
      sessionID: `node-cli-operator-only-recovery-${index}`,
      action: 'shell',
      resources: [command],
      effect: request.effect,
      metadata: {},
      message: undefined as string | undefined,
    };

    await hook(event);
    const observed = `${event.effect}: ${event.message ?? '(no message)'}`;
    assert.equal(event.effect, 'deny', `${command}; observed ${observed}`);
    assert.match(
      event.message ?? '',
      /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/,
      `${command}; observed ${observed}`,
    );
  }

  const nestedRecovery = {
    sessionID: 'node-cli-nested-operator-only-recovery',
    action: 'shell',
    resources: [
      `sh -c 'node ./dist/src/cli/index.js recover lifecycle-lock --force --reason "nested operator recovery"'`,
    ],
    effect: 'allow' as const,
    metadata: {},
    message: undefined as string | undefined,
  };
  await hook(nestedRecovery);
  assert.equal(nestedRecovery.effect, 'deny');
  assert.match(nestedRecovery.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

  const normalNodePolicy = {
    sessionID: 'node-cli-noncanonical-policy-baseline',
    action: 'shell',
    resources: ['node ./some-other-package/dist/src/cli/index.js --version'],
    effect: 'allow' as const,
    metadata: {},
    message: undefined as string | undefined,
  };
  await hook(normalNodePolicy);
  const observedNormalNodeEffect: string = normalNodePolicy.effect;
  const observedNormalNodeMessage = normalNodePolicy.message;
  assert.doesNotMatch(normalNodePolicy.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

  const noncanonicalRecovery = {
    sessionID: 'node-cli-similarly-named-noncanonical-script',
    action: 'shell',
    resources: ['node ./some-other-package/dist/src/cli/index.js recover lifecycle-lock --reason "not canonical"'],
    effect: 'allow' as const,
    metadata: {},
    message: undefined as string | undefined,
  };
  await hook(noncanonicalRecovery);
  assert.equal(noncanonicalRecovery.effect, observedNormalNodeEffect);
  assert.equal(noncanonicalRecovery.message, observedNormalNodeMessage);
  assert.doesNotMatch(noncanonicalRecovery.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

  const benignNode = {
    sessionID: 'node-cli-benign-version-control',
    action: 'shell',
    resources: ['node --version'],
    effect: 'allow' as const,
    metadata: {},
    message: undefined as string | undefined,
  };
  await hook(benignNode);
  assert.doesNotMatch(benignNode.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);
});

test('V2 runtime guard proves Node-option recovery and fails closed for unproven package npm-start', async () => {
  const packageRoot = resolveChangeBudgetRoot();
  const hook = await loadPackageRootEvaluateHook(packageRoot);
  const routes = [
    {
      name: 'node-option',
      command: 'node --enable-source-maps dist/src/cli/index.js recover lifecycle-lock',
      reason: /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/,
    },
    {
      name: 'package-npm-start',
      command: 'npm start -- recover lifecycle-lock',
      reason: /OCG-UNRESOLVED-MUTATION/,
    },
  ];
  const requests = routes.flatMap((route) => [
    { ...route, force: false, effect: 'allow' as const },
    { ...route, force: false, effect: 'ask' as const },
    { ...route, force: true, effect: 'allow' as const },
    { ...route, force: true, effect: 'ask' as const },
  ]);

  for (const [index, request] of requests.entries()) {
    const command = [
      request.command,
      ...(request.force ? ['--force'] : []),
      '--reason "operator approved stale-lock recovery"',
    ].join(' ');
    const event = {
      sessionID: `bounded-entrypoint-recovery-${request.name}-${index}`,
      action: 'shell',
      resources: [command],
      effect: request.effect,
      metadata: {},
      message: undefined as string | undefined,
    };

    await hook(event);
    const observed = `${event.effect}: ${event.message ?? '(no message)'}`;
    assert.equal(event.effect, 'deny', `${command}; observed ${observed}`);
    assert.match(event.message ?? '', request.reason, `${command}; observed ${observed}`);
  }
});

test('unproven npm-run-start recovery is blocked as unresolved for incoming allow and ask', async () => {
  const packageRoot = resolveChangeBudgetRoot();
  const hook = await loadPackageRootEvaluateHook(packageRoot);
  const recoveryRequests = [
    { force: false, effect: 'allow' as const },
    { force: false, effect: 'ask' as const },
    { force: true, effect: 'allow' as const },
    { force: true, effect: 'ask' as const },
  ];

  for (const [index, request] of recoveryRequests.entries()) {
    const command = [
      'npm run start -- recover lifecycle-lock',
      ...(request.force ? ['--force'] : []),
      '--reason "operator approved stale-lock recovery"',
    ].join(' ');
    const event = {
      sessionID: `npm-run-start-operator-recovery-${index}`,
      action: 'shell',
      resources: [command],
      effect: request.effect,
      metadata: {},
      message: undefined as string | undefined,
    };

    await hook(event);
    const observed = `${event.effect}: ${event.message ?? '(no message)'}`;
    assert.equal(event.effect, 'deny', `${command}; observed ${observed}`);
    assert.match(
      event.message ?? '',
      /OCG-UNRESOLVED-MUTATION/,
      `${command}; observed ${observed}`,
    );
    assert.doesNotMatch(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, command);
  }
});

test('unproven bare Node and npm launchers fail closed rather than receiving operator-only recovery policy', async () => withUnverifiedLauncherPath(async () => {
  const hook = await loadPackageRootEvaluateHook(resolveChangeBudgetRoot());
  const commands = [
    'node --enable-source-maps dist/src/cli/index.js recover lifecycle-lock --reason "unproven node PATH"',
    'npm start -- recover lifecycle-lock --reason "unproven npm PATH"',
  ];
  for (const [index, command] of commands.entries()) {
    for (const effect of ['allow', 'ask'] as const) {
      const event = {
        sessionID: `unproven-launcher-recovery-${index}-${effect}`,
        action: 'shell',
        resources: [command],
        effect,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', command);
      assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, command);
      assert.doesNotMatch(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, command);
    }
  }

  for (const command of [
    'npm exec -- changebudget status',
    'npx changebudget status',
  ]) {
    const event = {
      sessionID: `shadow-npm-read-only-decoy-${command}`,
      action: 'shell',
      resources: [command],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(event);
    assert.equal(event.effect, 'deny', `spoofed wrapper must not make a read-only-looking command safe: ${command}`);
    assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, command);
  }
}));

test('V2 runtime allows non-material unresolved numeric ceilings and blocks material overruns', async () => {
  const root = await repository();
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'one.ts'), 'export const one = 1;\n');
    await writeFile(join(root, 'src', 'two.ts'), 'export const two = 2;\n');
    git(root, ['add', 'src/one.ts', 'src/two.ts']);
    git(root, ['commit', '-m', 'seed runtime budget files']);

    await installIntegration(root, process.cwd());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    cli(root, ['start', '--task', 'numeric materiality runtime fixture', '--base-revision', 'HEAD', '--max-files', '1', '--max-changed-lines', '100']);

    const { hook } = await loadEvaluateHook(root);
    await writeFile(join(root, 'src', 'one.ts'), 'export const one = 1;\nexport const nextOne = 3;\n');
    const withinEvent = {
      sessionID: 'unresolved-numeric-within-limit',
      action: 'edit',
      resources: ['src/one.ts'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    const beforeWithin = await snapshotChangeBudget(root);
    await hook(withinEvent);
    assert.equal(withinEvent.effect, 'allow', 'an unresolved numeric value at its exact observed ceiling is non-material');
    assert.deepEqual(await snapshotChangeBudget(root), beforeWithin, 'permission evaluation remains read-only');

    await writeFile(join(root, 'src', 'two.ts'), 'export const two = 2;\nexport const nextTwo = 4;\n');
    const overrunEvent = {
      sessionID: 'unresolved-numeric-over-limit',
      action: 'edit',
      resources: ['src/two.ts'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(overrunEvent);
    assert.equal(overrunEvent.effect, 'deny', 'a material unresolved numeric overrun is blocked');
    assert.match(overrunEvent.message ?? '', /OCG-HUMAN-REVIEW/);
  } finally {
    await removeTestRepository(root);
  }
});

test('V2 permission evaluation rejects malformed material-decision metadata safely', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    await mkdir(join(root, '.changebudget'), { recursive: true });
    await writeFile(
      join(root, '.changebudget', 'state.json'),
      JSON.stringify({
        schema_version: '1',
        lifecycle_state: 'initialized',
        active_contract_id: null,
        last_closed_contract_id: null,
        updated_at: new Date().toISOString(),
      }),
      'utf8',
    );
    const { hook } = await loadEvaluateHook(root);
    const event = {
      sessionID: 'malformed-proposal',
      action: 'edit',
      resources: ['src/app.ts'],
      effect: 'allow' as const,
      metadata: { materialDecision: { kind: 'scope_expansion' } },
      message: undefined as string | undefined,
    };
    await hook(event);
    assert.equal(event.effect, 'deny');
    assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/);
  } finally {
    await removeTestRepository(root);
  }
});

test('registered V2 permission evaluation is byte-for-byte read-only while lifecycle START retains its owner audit', async () => {
  const root = await repository();
  const priorProposal = {
    id: 'existing-ledger-entry',
    kind: 'documentation_expansion',
    requested: { value: 'docs.release' },
    necessity: 'optional',
    criterion_refs: ['runtime'],
    evidence: ['release documentation is needed'],
  } as const;
  const envelope: ExecutionEnvelope = {
    goal: 'Verify read-only permission evaluation',
    acceptance_criteria: [{
      id: 'runtime',
      outcome: 'Permission evaluation does not persist decisions',
      required_evidence: ['hook-run'],
    }],
    authority: {
      documentation_expansion: { allowed: ['docs.release'], constraint: 'HARD' },
    },
    satisfaction: { state: 'OPEN', evidence_by_criterion: {} },
    ledger: [{
      proposal_id: priorProposal.id,
      proposal: priorProposal,
      outcome: { verdict: 'APPROVE', reason: 'Existing owner record' },
    }],
  };
  const validProposal = {
    id: 'runtime-hook-proposal',
    kind: 'documentation_expansion',
    requested: { value: 'docs.release' },
    necessity: 'optional',
    criterion_refs: ['runtime'],
    evidence: ['release documentation is needed'],
  } as const;

  try {
    await installIntegration(root, process.cwd());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    cli(root, ['start', '--task', 'permission read-only fixture', '--base-revision', 'HEAD']);

    const lifecycleState = JSON.parse(await readFile(join(root, '.changebudget', 'state.json'), 'utf8')) as {
      active_contract_id: string | null;
      audit_history?: Array<{ operation: string; outcome: { status: string; confirmation: string } }>;
    };
    const startAudit = lifecycleState.audit_history?.find((record) => record.operation === 'start');
    assert.deepEqual(startAudit?.outcome, {
      status: 'committed',
      confirmation: 'operation_write_returned',
    }, 'ChangeBudget-owned START retains its structured lifecycle audit');

    assert.ok(lifecycleState.active_contract_id, 'START must activate the lifecycle-owned contract');
    const startedContract = await readContract(root, lifecycleState.active_contract_id);
    await writeExecutionEnvelopeInPlace(root, {
      contract: startedContract,
      envelope,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const { hook } = await loadEvaluateHook(root);

    const validEvent = {
      sessionID: 'read-only-valid',
      action: 'read',
      resources: [],
      effect: 'allow' as const,
      metadata: { materialDecision: validProposal },
      message: undefined as string | undefined,
    };
    const beforeValid = await snapshotChangeBudget(root);
    await hook(validEvent);
    assert.equal(validEvent.effect, 'allow');
    assert.deepEqual(await snapshotChangeBudget(root), beforeValid, 'valid evaluation must not alter state, contract, ledger, or audit bytes');

    const repeatedEvent = {
      ...validEvent,
      sessionID: 'read-only-repeated',
      effect: 'allow' as const,
    };
    const beforeRepeated = await snapshotChangeBudget(root);
    await hook(repeatedEvent);
    assert.equal(repeatedEvent.effect, 'allow');
    assert.deepEqual(await snapshotChangeBudget(root), beforeRepeated, 'repeated evaluation must not append a ledger entry');

    const conflictEvent = {
      sessionID: 'read-only-conflict',
      action: 'read',
      resources: [],
      effect: 'allow' as const,
      metadata: {
        materialDecision: { ...priorProposal, requested: { value: 'docs.conflicting' } },
      },
      message: undefined as string | undefined,
    };
    const beforeConflict = await snapshotChangeBudget(root);
    await hook(conflictEvent);
    assert.equal(conflictEvent.effect, 'deny', 'a proposal ID conflict in the existing envelope ledger fails closed');
    assert.deepEqual(await snapshotChangeBudget(root), beforeConflict, 'conflict evaluation must not alter ChangeBudget bytes');

    const invalidEvent = {
      sessionID: 'read-only-invalid',
      action: 'read',
      resources: [],
      effect: 'allow' as const,
      metadata: { materialDecision: { kind: 'scope_expansion' } },
      message: undefined as string | undefined,
    };
    const beforeInvalid = await snapshotChangeBudget(root);
    await hook(invalidEvent);
    assert.equal(invalidEvent.effect, 'deny');
    assert.deepEqual(await snapshotChangeBudget(root), beforeInvalid, 'invalid metadata must not persist audit or authority');

    const failedEvent: Record<string, unknown> = {
      sessionID: 'read-only-failed',
      action: 'read',
      resources: [],
      effect: 'allow',
      message: undefined,
    };
    Object.defineProperty(failedEvent, 'metadata', {
      get() {
        throw new Error('injected permission metadata evaluation failure');
      },
    });
    const beforeFailed = await snapshotChangeBudget(root);
    await hook(failedEvent);
    assert.equal(failedEvent.effect, 'deny', 'a failed registered evaluation denies the intercepted request');
    assert.deepEqual(await snapshotChangeBudget(root), beforeFailed, 'failed evaluation must not alter ChangeBudget bytes');
  } finally {
    await removeTestRepository(root);
  }
});

test('projection keeps V2 permission status mapping explicit', () => {
  const result = projectRuntimeDecision({
    policyDecision: 'PASS',
    mutationIntent: 'mutate',
    targetPath: null,
    isInited: true,
    isPathDenied: false,
    isPathNotAllowed: false,
    isSensitive: { dependencies: false, migrations: false, config: false, publicApi: false },
    newFileDenied: false,
    targetInChangeBudget: false,
    isTargetResolved: false,
  });
  assert.equal(result.runtimeAction, 'block');
  assert.equal(result.reasonCode, RUNTIME_RULES.UNRESOLVED_MUTATION);
});

test('V2 permission evaluation classifies Git inspection, mutation, and wrapped commands safely', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    const { hook } = await loadEvaluateHook(root);

    const readOnlyCommands = [
      'git status',
      'git status --short',
      'git status --porcelain=v1',
      'git status --untracked-files=all',
      'git status --short --untracked-files=all .opencode opencode.jsonc',
      'git status --short --ignored=matching --untracked-files=all .opencode opencode.jsonc',
      'git ls-files',
      'git ls-files .opencode',
      'git ls-files --others --exclude-standard',
      'git check-ignore .opencode/foo',
      'git check-ignore -v .opencode/foo',
      'git check-ignore --stdin',
      'git diff',
      'git diff --name-only',
      'git diff -- .opencode/foo',
      'git show HEAD:file',
      'git log --oneline -- path',
      'git rev-parse HEAD',
      'git branch --show-current',
      'git remote -v',
      'git fetch',
      'git -C . status --short',
      'git --no-pager status --short',
      'sh -c "git status --short .opencode"',
      'bash -lc "git check-ignore -v .opencode/foo"',
      'changebudget --version',
      'changebudget --help',
      'changebudget help',
      'changebudget help status',
      'changebudget status',
      'changebudget status --budget',
      'changebudget status --budget --json',
      'changebudget status --json=false',
      'sh -c "changebudget status"',
      "bash -lc 'changebudget status'",
      'changebudget diagnose --allow-path src/example.ts --json',
      'changebudget check',
      'changebudget check --json',
      'changebudget check --draft .changebudget/draft.json',
      'changebudget update --check',
      'changebudget integrate opencode --dry-run',
    ];
    for (const command of readOnlyCommands) {
      const event = {
        sessionID: `readonly-${command}`,
        action: 'shell',
        resources: [throughCanonicalCli(command)],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'allow', command);
      assert.equal(event.message, undefined, command);
    }

    const managedChangeBudgetCommands = [
      'changebudget init',
      'changebudget start --task "Runtime guard lifecycle test" --allow-path src/example.ts',
      'changebudget amend --max-files 2',
      'changebudget close',
      'changebudget integrate opencode',
      'changebudget integrate opencode --remove',
      "changebudget check --satisfaction-evidence-json '{\"satisfied\":[{\"criterion_ref\":\"AC-1\",\"evidence\":[\"verified\"]}]}'",
    ];
    for (const command of managedChangeBudgetCommands) {
      const event = {
        sessionID: `managed-changebudget-${command}`,
        action: 'shell',
        resources: [throughCanonicalCli(command)],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'ask', command);
      assert.match(event.message ?? '', /OCG-CHANGEBUDGET-MANAGED-MUTATION/, command);
    }

    const forceCloseEvent = {
      sessionID: 'managed-changebudget-force-close',
      action: 'shell',
      resources: [throughCanonicalCli('changebudget close --force --reason "developer-authorized recovery"')],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(forceCloseEvent);
    assert.equal(forceCloseEvent.effect, 'ask');
    assert.match(forceCloseEvent.message ?? '', /OCG-CHANGEBUDGET-FORCE-CLOSE/);

    // A saved `always` permission arrives as an incoming `allow` effect here.
    const operatorRecoveryCommands = [
      { command: 'changebudget recover lifecycle-lock --reason "operator approved stale-lock recovery"', effect: 'allow' as const },
      { command: 'changebudget recover lifecycle-lock --reason "operator approved stale-lock recovery"', effect: 'ask' as const },
      { command: 'changebudget recover lifecycle-lock --force --reason "operator approved stale-lock recovery"', effect: 'allow' as const },
      { command: 'changebudget recover lifecycle-lock --force --reason "operator approved stale-lock recovery"', effect: 'ask' as const },
    ];
    for (const [index, request] of operatorRecoveryCommands.entries()) {
      const event = {
        sessionID: `operator-only-recovery-${index}`,
        action: 'shell',
        resources: [throughCanonicalCli(request.command)],
        effect: request.effect,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', request.command);
      assert.match(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, request.command);
    }

    const deeplyNestedDirect = throughCanonicalCli(String.raw`cat README.md "$(sh -c 'sh -c "changebudget recover lifecycle-lock --reason /tmp/gv2"')"`);
    const deeplyNestedRecoveryCommands = [
      { command: deeplyNestedDirect, effect: 'allow' as const },
      { command: deeplyNestedDirect, effect: 'ask' as const },
    ];
    for (const [index, request] of deeplyNestedRecoveryCommands.entries()) {
      const event = {
        sessionID: `initialized-depth-boundary-recovery-${index}`,
        action: 'shell',
        resources: [request.command],
        effect: request.effect,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', request.command);
      assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, request.command);
    }

    const malformedWrappedRecoveryCommands = [
      'npm exec changebudget recover lifecycle-lock --reason "missing npm separator"',
      'npm exec --package=changebudget -- changebudget recover lifecycle-lock --reason "wrapper option not allowlisted"',
      'npx --yes changebudget recover lifecycle-lock --reason "wrapper option not allowlisted"',
      'npm exec -- changebudget recover lifecycle-lock --reason "unclosed quote',
    ];
    for (const command of malformedWrappedRecoveryCommands) {
      const event = {
        sessionID: `malformed-wrapped-recovery-${command}`,
        action: 'shell',
        resources: [command],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', command);
      assert.doesNotMatch(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, command);
    }

    const nestedWrappedRecovery = {
      sessionID: 'nested-wrapped-recovery',
      action: 'shell',
      resources: ["sh -c \"npm exec -- changebudget recover lifecycle-lock --reason 'nested wrapper'\""],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(nestedWrappedRecovery);
    assert.equal(nestedWrappedRecovery.effect, 'deny');
    assert.doesNotMatch(nestedWrappedRecovery.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

    const composedWrappedRecovery = {
      sessionID: 'composed-wrapped-recovery',
      action: 'shell',
      resources: ['echo ok && npm exec -- changebudget recover lifecycle-lock --reason "composed"'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(composedWrappedRecovery);
    assert.equal(composedWrappedRecovery.effect, 'deny');
    assert.doesNotMatch(composedWrappedRecovery.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

    const quotedUnrelatedWords = {
      sessionID: 'quoted-unrelated-changebudget-words',
      action: 'shell',
      resources: ['echo "npm exec -- changebudget recover lifecycle-lock --reason unrelated"'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(quotedUnrelatedWords);
    assert.equal(quotedUnrelatedWords.effect, 'deny');
    assert.match(quotedUnrelatedWords.message ?? '', /OCG-UNRESOLVED-MUTATION/);
    assert.doesNotMatch(quotedUnrelatedWords.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

    const unrelatedNpmExec = {
      sessionID: 'unrelated-npm-exec-command',
      action: 'shell',
      resources: ['npm exec -- eslint --fix'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(unrelatedNpmExec);
    assert.equal(unrelatedNpmExec.effect, 'deny');
    assert.match(unrelatedNpmExec.message ?? '', /OCG-UNRESOLVED-MUTATION/);
    assert.doesNotMatch(unrelatedNpmExec.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/);

    const scannerSplitWrappedRecovery = {
      sessionID: 'scanner-split-wrapped-recovery',
      action: 'shell',
      resources: [
        'npm exec --',
        'changebudget recover lifecycle-lock --reason "scanner split"',
      ],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(scannerSplitWrappedRecovery);
    assert.equal(scannerSplitWrappedRecovery.effect, 'deny');

    const updateEvent = {
      sessionID: 'managed-changebudget-update',
      action: 'shell',
      resources: [throughCanonicalCli('changebudget update')],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(updateEvent);
    assert.equal(updateEvent.effect, 'ask');
    assert.match(updateEvent.message ?? '', /OCG-CHANGEBUDGET-EXTERNAL-MUTATION/);

    const scannerSplitReadOnlyResources = [
      ['git status --short --untracked-files', '.opencode opencode.jsonc'],
      ['git status --short --ignored', '.opencode opencode.jsonc'],
      ['git status --short --untracked-files', '.opencode/plugins/changebudget.js'],
    ];
    for (const resources of scannerSplitReadOnlyResources) {
      const event = {
        sessionID: `readonly-scanner-split-${resources.join('-')}`,
        action: 'shell',
        resources,
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'allow', resources.join(' | '));
      assert.equal(event.message, undefined, resources.join(' | '));
    }

    const mutatingCommands = [
      'git add .changebudget/state.json',
      'git commit -m change',
      'git rm .changebudget/state.json',
      'git mv .changebudget/state.json .changebudget/state-copy.json',
      'git restore .changebudget/state.json',
      'git restore --staged .changebudget/state.json',
      'git checkout -- .changebudget/state.json',
      'git reset --hard',
      'git clean -fd',
      'git merge feature',
      'git rebase feature',
      'git cherry-pick HEAD',
      'git revert HEAD',
      'git switch feature',
      'git push origin HEAD',
      'git tag v2.0.0-test',
      'git update-ref refs/heads/test HEAD',
      'git unknown-subcommand',
      'changebudget unknown-command',
      'changebudget status --unknown',
      'changebudget status --json',
      'changebudget start --task',
      'changebudget close --force',
      'changebudget recover',
      'changebudget recover lifecycle-lock --reason ""',
      'changebudget recover lifecycle-lock --reason "trailing force is malformed" --force',
      'changebudget recover lifecycle-lock --reason "valid reason" --force --unknown',
      'changebudget check --satisfaction-evidence-json',
      'changebudget integrate wrong-target',
      'changebudget update --unknown',
      'changebudget status && git add .changebudget/state.json',
      'echo corrupt > .changebudget/state.json',
      'rm .changebudget/state.json',
      'git ls-files .opencode && git commit -am change',
      'git check-ignore -v .opencode/plugins/changebudget.js > ignored.txt',
    ];
    for (const command of mutatingCommands) {
      const event = {
        sessionID: `mutation-${command}`,
        action: 'shell',
        resources: [command],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', command);
      assert.doesNotMatch(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, command);
    }

    const scannerSplitMutatingResources = [
      ['git status --short --untracked-files', 'git add .changebudget/state.json'],
      ['git status --short --untracked-files', './scripts/mutate.ps1'],
      ['git status --short --untracked-files', '.opencode > status.txt'],
      ['git status --short --untracked-files', 'git unknown-subcommand'],
    ];
    for (const resources of scannerSplitMutatingResources) {
      const event = {
        sessionID: `mutation-scanner-split-${resources.join('-')}`,
        action: 'shell',
        resources,
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', resources.join(' | '));
      assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, resources.join(' | '));
    }
  } finally {
    await removeTestRepository(root);
  }
});

test('initialized repositories without a contract block unresolved V2 mutations', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    const { hook } = await loadEvaluateHook(root);
    const event = {
      sessionID: 'unresolved',
      action: 'shell',
      resources: ['git commit -am change'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(event);
    assert.equal(event.effect, 'deny');
    assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/);
  } finally {
    await removeTestRepository(root);
  }
});

test('ChangeBudget-owned state stays protected from direct V2 shell and file mutations', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    cli(root, ['start', '--task', 'protect ChangeBudget state', '--base-revision', 'HEAD']);
    const { hook } = await loadEvaluateHook(root);

    const directMutations = [
      { action: 'shell', resources: ['echo corrupt > .changebudget/state.json'] },
      { action: 'shell', resources: ['git add .changebudget/state.json'] },
      { action: 'shell', resources: ['rm .changebudget/state.json'] },
      { action: 'edit', resources: ['.changebudget/state.json'] },
    ];
    for (const [index, mutation] of directMutations.entries()) {
      const event = {
        sessionID: `direct-changebudget-mutation-${index}`,
        ...mutation,
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', JSON.stringify(mutation));
      assert.match(event.message ?? '', /OCG-CHANGEBUDGET-PROTECT/, JSON.stringify(mutation));
    }
  } finally {
    await removeTestRepository(root);
  }
});
