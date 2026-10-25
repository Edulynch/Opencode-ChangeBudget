import * as assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readdir, readFile, readlink, realpath, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import type { SessionMessageInfo } from '@opencode/client';
import { removeTestRepository } from '../utils/disposable-repository.js';

import { RUNTIME_RULES, projectRuntimeDecision } from '../../opencode-plugin/src/projection.js';
import { createAuthorityService } from '../../src/core/authority/authority-service.js';
import { installIntegration, MANAGED_RESOURCES, resolveChangeBudgetRoot } from '../../src/core/integration/opencode.js';
import { readContract, writeExecutionEnvelopeInPlace } from '../../src/core/state/contracts.js';
import type { ExecutionEnvelope } from '../../src/models/execution-gate.js';

type Hook = (event: any) => Promise<void> | void;

function publicRunningEditContext(
  messageID: string,
  toolID: string,
  input: { readonly path: string; readonly oldString: string; readonly newString: string },
): readonly SessionMessageInfo[] {
  return [{
    id: messageID,
    time: { created: 1 },
    type: 'assistant',
    agent: 'build',
    model: { id: 'fixture-model', providerID: 'fixture-provider' },
    content: [{
      type: 'tool',
      id: toolID,
      name: 'edit',
      state: { status: 'running', input, metadata: {} },
      time: { created: 1 },
    }],
  }];
}

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

async function createUnanchoredNodeInstallation(root: string): Promise<void> {
  const nodeRoot = join(root, 'unanchored-node-installation');
  const nodePath = join(nodeRoot, process.platform === 'win32' ? 'node.exe' : 'node');
  const npmRoot = join(nodeRoot, 'node_modules', 'npm');
  const npmBin = join(npmRoot, 'bin');
  await mkdir(npmBin, { recursive: true });
  await writeFile(nodePath, 'unattested node candidate; not executed\n', 'utf8');
  if (process.platform !== 'win32') await chmod(nodePath, 0o755);
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({
    name: 'npm',
    bin: { npm: 'bin/npm-cli.js', npx: 'bin/npx-cli.js' },
  }), 'utf8');

  for (const executable of ['npm', 'npx'] as const) {
    const cliPath = join(npmBin, `${executable}-cli.js`);
    await writeFile(cliPath, `// structural ${executable} fixture; never executed\n`, 'utf8');
    const launcherCliPath = process.platform === 'win32' ? cliPath.toLowerCase() : cliPath;
    if (process.platform === 'win32') {
      await writeFile(join(nodeRoot, `${executable}.cmd`), `@ECHO off\r\n"${nodePath}" "${launcherCliPath}" %*\r\n`, 'utf8');
    } else {
      await writeFile(join(nodeRoot, executable), `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(launcherCliPath)} "$@"\n`, 'utf8');
      await chmod(join(nodeRoot, executable), 0o755);
    }
  }

  process.env.PATH = [nodeRoot, process.env.PATH].filter(Boolean).join(delimiter);
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

async function withFilesystemWritesDenied<T>(operation: () => Promise<T>): Promise<{
  readonly value?: T;
  readonly error?: unknown;
  readonly attemptedWrites: readonly string[];
}> {
  const require = createRequire(import.meta.url);
  const fsPromises = require('node:fs/promises') as Record<string, (...args: any[]) => any>;
  const attemptedWrites: string[] = [];
  const originals = new Map<string, (...args: any[]) => any>();
  const deny = (name: string, path: unknown): never => {
    attemptedWrites.push(`${name}:${String(path)}`);
    throw Object.assign(new Error(`permission hook write denied: ${name}`), { code: 'EPERM' });
  };
  originals.set('open', fsPromises.open!);
  fsPromises.open = (path: unknown, flags: unknown, ...args: unknown[]) => {
    if ((typeof flags === 'string' && /[wax+]/u.test(flags))
      || (typeof flags === 'number' && (flags & 3) !== 0)) return deny('open', path);
    return originals.get('open')!(path, flags, ...args);
  };
  for (const name of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rename', 'unlink', 'rm', 'copyFile', 'truncate']) {
    originals.set(name, fsPromises[name]!);
    fsPromises[name] = (path: unknown) => deny(name, path);
  }
  syncBuiltinESMExports();
  try {
    return { value: await operation(), attemptedWrites };
  } catch (error) {
    return { error, attemptedWrites };
  } finally {
    for (const [name, original] of originals) fsPromises[name] = original;
    syncBuiltinESMExports();
  }
}

async function loadEvaluateHook(root: string, sessionReader: {
  readonly get?: (input: { readonly sessionID: string }) => Promise<unknown>;
  readonly context?: (input: { readonly sessionID: string }) => Promise<readonly SessionMessageInfo[]>;
} = {}): Promise<{ plugin: PluginModule['default']; hook: Hook }> {
  const url = pathToFileURL(join(root, MANAGED_RESOURCES.pluginWrapper)).href;
  const module = (await import(url)) as PluginModule;
  let hook: Hook | undefined;
  await module.default.setup({
    location: { directory: root },
    session: {
      hook: async (_name: string, _callback: Hook) => ({ dispose: async () => undefined }),
      get: sessionReader.get ?? (async ({ sessionID }: { readonly sessionID: string }) => ({
        id: sessionID,
        location: { directory: root },
      })),
      context: sessionReader.context ?? (async () => []),
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

test('G5: a present null authority reference is invalid, never equivalent to absence', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { hook } = await loadEvaluateHook(root);
    const absent = {
      sessionID: 'g5-absent-reference',
      action: 'edit',
      resources: ['README.md'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(absent);
    assert.equal(absent.effect, 'allow', 'absent reference preserves the existing Phase A projection');

    const presentNull = {
      sessionID: 'g5-present-null-reference',
      action: 'edit',
      resources: ['README.md'],
      effect: 'allow' as const,
      metadata: { changebudgetAuthority: null },
      message: undefined as string | undefined,
    };
    await hook(presentNull);
    assert.equal(presentNull.effect, 'deny', 'a present invalid reference must fail closed');
    assert.match(presentNull.message ?? '', /OCG-AUTHORITY-REFERENCE/);
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

test('inspection-limit segment overflow blocks the complete uncertain nested operation', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { hook } = await loadEvaluateHook(root);
    const canonicalCli = join(process.cwd(), 'dist', 'src', 'cli', 'index.js').replace(/\\/g, '/');
    const canonicalAdmin = `node "${canonicalCli}" authority grant revoke --grant-id fixture-grant --expected-digest fixture-digest`;
    const nestedInspectionBoundary = (command: string): string =>
      `cat README.md "$(sh -c 'sh -c "${command.replace(/"/g, '\\"')}"')"`;
    const benignSegments = (count: number): string[] =>
      Array.from({ length: count }, (_unused, index) => `echo benign-${index}`);
    const overflowHiddenBySubstitutionCount = [
      ...Array.from({ length: 16 }, (_unused, index) => `echo "$(echo nested-${index})"`),
      `echo "$( ${[...benignSegments(32), canonicalAdmin].join('; ')} )"`,
    ].join('; ');
    const cases: { readonly name: string; readonly command: string; readonly direct?: boolean; readonly expected: 'deny' | 'allow' }[] = [
      {
        name: 'below-32-segments',
        command: [...benignSegments(30), canonicalAdmin].join('; '),
        expected: 'deny',
      },
      {
        name: 'exactly-32-segments',
        command: [...benignSegments(31), canonicalAdmin].join('; '),
        expected: 'deny',
      },
      {
        name: 'canonical-administration-in-final-retained-segment',
        command: [...benignSegments(31), canonicalAdmin].join('; '),
        expected: 'deny',
      },
      {
        name: 'canonical-administration-beyond-segment-32',
        command: [...benignSegments(32), canonicalAdmin].join('; '),
        expected: 'deny',
      },
      {
        name: 'benign-prefix-cannot-hide-later-canonical-mutation',
        command: [...benignSegments(40), canonicalAdmin].join('; '),
        expected: 'deny',
      },
      {
        name: 'inspection-overflow-after-substitution-count-boundary',
        command: overflowHiddenBySubstitutionCount,
        direct: true,
        expected: 'deny',
      },
      {
        name: 'malformed-nested-compound-overflow',
        command: `${[...benignSegments(32), canonicalAdmin].join('; ')} "unterminated`,
        expected: 'deny',
      },
      {
        name: 'fully-inspected-unrelated-node-script-retains-policy',
        command: `node --inspect "${join(root, 'unrelated.js').replace(/\\/g, '/')}" authority grant revoke --grant-id fixture-grant`,
        expected: 'allow',
      },
    ] as const;

    for (const request of cases) {
      const event = {
        sessionID: `inspection-overflow-${request.name}`,
        action: 'shell',
        resources: [request.direct ? request.command : nestedInspectionBoundary(request.command)],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, request.expected, request.name);
      if (request.expected === 'deny') {
        assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, request.name);
        assert.doesNotMatch(event.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/, request.name);
      } else {
        assert.equal(event.message, undefined, request.name);
      }
    }

    const overflowWithAsk = {
      sessionID: 'inspection-overflow-preserves-ask',
      action: 'shell',
      resources: [nestedInspectionBoundary([...benignSegments(32), canonicalAdmin].join('; '))],
      effect: 'ask' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(overflowWithAsk);
    assert.equal(overflowWithAsk.effect, 'deny');
    assert.match(overflowWithAsk.message ?? '', /OCG-UNRESOLVED-MUTATION/);
    assert.doesNotMatch(overflowWithAsk.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/);
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

test('G5 Phase A evaluation makes no transient filesystem writes for untracked binary detection', async () => {
  const root = await repository();
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, '.gitattributes'), '*.bin binary\n', 'utf8');
    await writeFile(join(root, 'src', 'app.ts'), 'export const value = 1;\n', 'utf8');
    git(root, ['add', '.gitattributes', 'src/app.ts']);
    git(root, ['commit', '-m', 'baseline read-only binary fixture']);
    await installIntegration(root, process.cwd());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    cli(root, [
      'start', '--task', 'zero-write permission evaluation', '--base-revision', 'HEAD',
      '--allow-path', 'src/**', '--max-files', '10', '--max-changed-lines', '40',
    ]);
    await writeFile(join(root, 'src', 'untracked.bin'), Buffer.from([0, 1, 2, 3]));
    const { hook } = await loadEvaluateHook(root);
    const before = await snapshotChangeBudget(root);
    const event = {
      sessionID: 'zero-write-binary-detection',
      action: 'edit',
      resources: ['src/app.ts'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    const observed = await withFilesystemWritesDenied(async () => { await hook(event); });
    assert.deepEqual(observed.attemptedWrites, [], 'the entire Phase A hook must attempt no transient or persistent write');
    assert.equal(observed.error, undefined);
    assert.deepEqual(await snapshotChangeBudget(root), before, 'permission evaluation leaves ChangeBudget bytes unchanged');
  } finally {
    await removeTestRepository(root);
  }
});

test('G5 present-reference preflight attempts no filesystem writes or missing-registry initialization', {
  skip: process.platform === 'darwin' ? 'no isolated default registry override on macOS' : false,
}, async () => {
  const root = await repository();
  const envName = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_STATE_HOME';
  const priorRegistryHome = process.env[envName];
  const isolatedRegistryHome = `${root}-g5-local-data`;
  const registryPath = join(isolatedRegistryHome, 'ChangeBudget-Authority', 'registry-v1.json');
  const target = join(root, 'src', 'edit.ts');
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(target, 'const value = 1;\n', 'utf8');
    git(root, ['add', 'src/edit.ts']);
    git(root, ['commit', '-m', 'seed G5 read-only preflight fixture']);
    await installIntegration(root, resolveChangeBudgetRoot());
    process.env[envName] = isolatedRegistryHome;

    const { hook } = await loadEvaluateHook(root, {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: root } }),
      context: async () => publicRunningEditContext('g5-read-only-message', 'g5-read-only-tool', {
        path: target,
        oldString: 'const value = 1;\n',
        newString: 'const value = 2;\n',
      }),
    });
    const event = {
      sessionID: 'g5-read-only-session',
      source: { type: 'tool', messageID: 'g5-read-only-message', id: 'g5-read-only-tool' },
      action: 'edit',
      resources: [target],
      effect: 'allow' as const,
      metadata: {
        changebudgetAuthority: {
          schema_version: 1,
          reference_id: '00000000-0000-4000-8000-000000000002',
          request: {
            operation: 'file.write',
            capabilities: ['source.edit'],
            paths: ['src/edit.ts'],
            ceilings: { max_files: 1, max_changed_lines: 2 },
          },
        },
      },
      message: undefined as string | undefined,
    };
    const observed = await withFilesystemWritesDenied(async () => { await hook(event); });
    assert.deepEqual(observed.attemptedWrites, [], 'present-reference G4 preflight attempts no transient or persistent write');
    assert.equal(observed.error, undefined);
    assert.equal(event.effect, 'deny', 'the unknown reference remains invalid despite the incoming allow');
    assert.match(event.message ?? '', /OCG-AUTHORITY-REFERENCE/);
    await assert.rejects(readdir(isolatedRegistryHome), { code: 'ENOENT' }, 'verification must not initialize a registry');
    await assert.rejects(readFile(registryPath), { code: 'ENOENT' });
  } finally {
    if (priorRegistryHome === undefined) delete process.env[envName];
    else process.env[envName] = priorRegistryHome;
    await removeTestRepository(root);
    await removeTestRepository(isolatedRegistryHome);
  }
});

test('G5 verified reference preflight attempts no transient filesystem write', {
  skip: process.platform === 'darwin' ? 'no isolated default registry override on macOS' : false,
}, async () => {
  const createdRoot = await repository();
  let root: string;
  const envName = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_STATE_HOME';
  const priorRegistryHome = process.env[envName];
  let isolatedRegistryHome: string | undefined;
  try {
    root = await realpath(createdRoot);
    isolatedRegistryHome = `${root}-g5-valid-local-data`;
    const registryPath = join(isolatedRegistryHome, 'ChangeBudget-Authority', 'registry-v1.json');
    const target = join(root, 'src', 'edit.ts');
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(target, 'const value = 1;\n', 'utf8');
    git(root, ['add', 'src/edit.ts']);
    git(root, ['commit', '-m', 'seed G5 verified-reference fixture']);
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline G5 plugin']);
    cli(root, ['init']);
    cli(root, [
      'start', '--task', 'read-only authority preflight', '--base-revision', 'HEAD',
      '--allow-path', 'src/**', '--max-files', '60', '--max-changed-lines', '60',
    ]);
    process.env[envName] = isolatedRegistryHome;

    const service = createAuthorityService();
    const grant = await service.createGrant(root, {
      operations: ['file.write'],
      capabilities: ['source.edit'],
      path_scope: ['/src/**'],
      ceilings: { max_files: 60, max_changed_lines: 60 },
      permissions: {
        allow_new_files: false,
        allow_dependencies: false,
        allow_migrations: false,
        allow_configuration: false,
        allow_public_api: false,
      },
      mode: 'REUSABLE',
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const { hook } = await loadEvaluateHook(root, {
      get: async ({ sessionID }) => ({ id: sessionID, location: { directory: root } }),
      context: async () => publicRunningEditContext('g5-verified-message', 'g5-verified-tool', {
        path: target,
        oldString: 'const value = 1;\n',
        newString: 'const value = 2;\n',
      }),
    });
    const event = {
      sessionID: 'g5-verified-session',
      source: { type: 'tool', messageID: 'g5-verified-message', id: 'g5-verified-tool' },
      action: 'edit',
      resources: [target],
      effect: 'allow' as const,
      metadata: {
        changebudgetAuthority: {
          schema_version: 1,
          reference_id: grant.grant_id,
          request: {
            operation: 'file.write',
            capabilities: ['source.edit'],
            paths: ['src/edit.ts'],
            ceilings: { max_files: 1, max_changed_lines: 2 },
          },
        },
      },
      message: undefined as string | undefined,
    };
    const beforeRegistry = await readFile(registryPath);
    const beforeState = await snapshotChangeBudget(root);
    const observed = await withFilesystemWritesDenied(async () => { await hook(event); });
    assert.deepEqual(observed.attemptedWrites, [], 'verified reference preflight attempts no transient or persistent write');
    assert.equal(observed.error, undefined);
    assert.equal(event.effect, 'allow', 'a valid reference preserves the Phase A action without upgrading it');
    assert.deepEqual(await readFile(registryPath), beforeRegistry, 'verification does not append audit or consume state');
    assert.deepEqual(await snapshotChangeBudget(root), beforeState, 'verification leaves project authority state unchanged');
  } finally {
    if (priorRegistryHome === undefined) delete process.env[envName];
    else process.env[envName] = priorRegistryHome;
    await removeTestRepository(createdRoot);
    if (isolatedRegistryHome !== undefined) await removeTestRepository(isolatedRegistryHome);
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

    // This is the existing in-process V2 hook harness, not an observation of a
    // live installed OpenCode permission UI or an executed CLI command.
    const governedAdminCommands = [
      'changebudget authority grant create --grant-id known-grant',
      'changebudget authority grant revoke --grant-id known-grant',
      'changebudget authority rebind --repository-reference known-reference',
      'npm exec -- changebudget authority grant create --grant-id known-grant',
      'npm exec -- changebudget authority grant revoke --grant-id known-grant',
      'npm exec -- changebudget authority rebind --repository-reference known-reference',
      'npx changebudget authority grant create --grant-id known-grant',
      'npx changebudget authority grant revoke --grant-id known-grant',
      'npx changebudget authority rebind --repository-reference known-reference',
    ];
    for (const [index, command] of governedAdminCommands.entries()) {
      for (const effect of ['allow', 'ask'] as const) {
        const event = {
          sessionID: `governed-admin-deny-${index}-${effect}`,
          action: 'shell',
          resources: [command.startsWith('npm exec') || command.startsWith('npx ')
            ? command
            : throughCanonicalCli(command)],
          effect,
          metadata: { grantId: 'known-grant' },
          message: undefined as string | undefined,
        };
        await hook(event);
        assert.equal(event.effect, 'deny', command);
        if (command.startsWith('changebudget ')) {
          assert.match(event.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/, command);
        }
      }
    }

    for (const command of [
      'changebudget authority grant create --grant-id',
      'changebudget authority grant inspect',
      'changebudget authority unknown',
    ]) {
      const event = {
        sessionID: `governed-admin-malformed-${command}`,
        action: 'shell',
        resources: [throughCanonicalCli(command)],
        effect: 'allow' as const,
        metadata: { grantId: 'known-grant' },
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', command);
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

test('deny-only Node admin intent remains blocked when the Node interpreter anchor is ambiguous', async () => {
  const root = await repository();
  const originalPath = process.env.PATH;
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    const { hook } = await loadEvaluateHook(root);
    await createUnanchoredNodeInstallation(root);

    const canonicalCli = join(process.cwd(), 'dist', 'src', 'cli', 'index.js');
    const canonicalAdmin = {
      sessionID: 'deny-only-canonical-node-admin',
      action: 'shell',
      resources: [`node "${canonicalCli}" authority grant revoke --grant-id fixture-grant --expected-digest fixture-digest`],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    const beforeAdmin = await snapshotChangeBudget(root);
    await hook(canonicalAdmin);
    assert.equal(canonicalAdmin.effect, 'deny');
    assert.match(canonicalAdmin.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/);
    assert.deepEqual(await snapshotChangeBudget(root), beforeAdmin,
      'classifying a denial-only admin intent must not read or mutate authority state');

    const canonicalAdminWithUnsupportedNodeOption = {
      sessionID: 'deny-only-canonical-node-admin-unsupported-option',
      action: 'shell',
      resources: [`node --inspect "${canonicalCli}" authority grant revoke --grant-id fixture-grant --expected-digest fixture-digest`],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(canonicalAdminWithUnsupportedNodeOption);
    assert.equal(canonicalAdminWithUnsupportedNodeOption.effect, 'deny',
      'a canonical CLI admin target with an unsupported Node option must fail closed, not fall through to passive allow');
    assert.match(canonicalAdminWithUnsupportedNodeOption.message ?? '', /OCG-UNRESOLVED-MUTATION/);
    assert.doesNotMatch(canonicalAdminWithUnsupportedNodeOption.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/,
      'unsupported Node option interpretation is uncertainty, not proven admin intent');

    const unrelatedNode = {
      sessionID: 'deny-only-unrelated-node',
      action: 'shell',
      resources: [`node --inspect "${join(root, 'unrelated.js')}" authority grant revoke --grant-id fixture-grant`],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(unrelatedNode);
    assert.equal(unrelatedNode.effect, 'allow',
      'an unrelated Node script with options retains its pre-existing permissive passive-mode behavior');
    assert.doesNotMatch(unrelatedNode.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/);

    const unsupportedNodeChain = {
      sessionID: 'deny-only-unsupported-node-chain',
      action: 'shell',
      resources: [`node --inspect "${canonicalCli}" authority grant revoke --grant-id fixture-grant && echo done`],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(unsupportedNodeChain);
    assert.equal(unsupportedNodeChain.effect, 'deny');
    assert.match(unsupportedNodeChain.message ?? '', /OCG-UNRESOLVED-MUTATION/);
    assert.doesNotMatch(unsupportedNodeChain.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/);

    const unrelatedNodeChain = {
      sessionID: 'deny-only-unrelated-node-option-chain',
      action: 'shell',
      resources: [`node --inspect "${join(root, 'unrelated.js')}" authority grant revoke --grant-id fixture-grant && echo done`],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(unrelatedNodeChain);
    assert.equal(unrelatedNodeChain.effect, 'allow',
      'an unrelated Node script with options in an operator chain keeps its existing passive policy behavior');
    assert.doesNotMatch(unrelatedNodeChain.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/);

    const nodeCommandAtShellBoundary = `node --inspect "${canonicalCli}" authority grant revoke --grant-id fixture-grant --expected-digest fixture-digest`;
    const shellBoundaryCanonicalNode = {
      sessionID: 'deny-only-canonical-node-shell-boundary',
      action: 'shell',
      resources: [`cat README.md "$(sh -c 'sh -c "${nodeCommandAtShellBoundary.replace(/"/g, '\\"')}"')"`],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(shellBoundaryCanonicalNode);
    assert.equal(shellBoundaryCanonicalNode.effect, 'deny',
      'a canonical CLI candidate behind unsupported Node options at the bounded shell-inspection boundary must not fall through');
    assert.match(shellBoundaryCanonicalNode.message ?? '', /OCG-UNRESOLVED-MUTATION/);
    assert.doesNotMatch(shellBoundaryCanonicalNode.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/,
      'shell-boundary ambiguity remains uncertainty, not proven admin intent');

    const malformedCanonicalNodeOption = {
      sessionID: 'deny-only-canonical-node-option-malformed',
      action: 'shell',
      resources: [`node --inspect "${canonicalCli}" authority grant revoke --grant-id fixture-grant --expected-digest "fixture-digest`],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(malformedCanonicalNodeOption);
    assert.equal(malformedCanonicalNodeOption.effect, 'deny',
      'malformed input retaining a canonical CLI candidate must fail closed');
    assert.match(malformedCanonicalNodeOption.message ?? '', /OCG-UNRESOLVED-MUTATION/);
    assert.doesNotMatch(malformedCanonicalNodeOption.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/,
      'malformed potential intent is uncertainty, not proven admin intent');

    const canonicalAlias = join(root, 'canonical-cli-alias.js');
    try {
      await symlink(canonicalCli, canonicalAlias, 'file');
      const aliasedCanonicalAdmin = {
        sessionID: 'deny-only-canonical-node-symlink-alias',
        action: 'shell',
        resources: [`node "${canonicalAlias}" authority grant revoke --grant-id fixture-grant --expected-digest fixture-digest`],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(aliasedCanonicalAdmin);
      assert.equal(aliasedCanonicalAdmin.effect, 'deny',
        'a realpath-related but noncanonical Node script spelling must be blocked as uncertainty');
      assert.match(aliasedCanonicalAdmin.message ?? '', /OCG-UNRESOLVED-MUTATION/);
      assert.doesNotMatch(aliasedCanonicalAdmin.message ?? '', /OCG-CHANGEBUDGET-GOVERNED-ADMIN/,
        'a symlink alias cannot establish denial-only admin intent');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      assert.ok(['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(code ?? ''),
        `unexpected canonical CLI alias test failure: ${String(error)}`);
    }
    assert.deepEqual(await snapshotChangeBudget(root), beforeAdmin,
      'direct, ambiguous, chained, malformed, unrelated, and aliased denial-only checks do not touch authority state');
  } finally {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
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
