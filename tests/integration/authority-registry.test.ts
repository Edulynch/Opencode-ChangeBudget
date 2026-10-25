import * as assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createTestFixtureDirectory, removeTestRepository } from '../utils/disposable-repository.js';
import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runAmend } from '../../src/cli/commands/amend.js';
import {
  createCanonicalGrantRecord,
  normalizeGrantDraft,
  type GrantBindingContext,
  type GrantPermissions,
} from '../../src/core/authority/grants.js';
import { resolveRepositoryBindingCandidate } from '../../src/core/authority/repository-binding.js';
import { setAuthorityReadObservationTestHook } from '../../src/core/authority/work-context.js';
import {
  getContractFilePath,
  createLifecycleAuditRecord,
  getChangeBudgetDirectory,
  persistLifecycleAudit,
  readLifecycleState,
} from '../../src/core/state/state.js';
import {
  AuthorityRegistryError,
  inspectAuthorityRegistry,
  transactAuthorityRegistry,
  type AuthorityRegistrySnapshot,
  type RegistryLifecycleRecord,
} from '../../src/core/authority/registry.js';

function approvedTempBase(): string {
  if (process.env.SPEC015_TEST_TEMP_ROOT) return resolve(process.env.SPEC015_TEST_TEMP_ROOT);
  return process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : tmpdir();
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
    throw Object.assign(new Error(`G4 inspection write denied: ${name}`), { code: 'EPERM' });
  };

  originals.set('open', fsPromises.open!);
  fsPromises.open = (path: unknown, flags: unknown, ...args: unknown[]) => {
    if (typeof flags === 'string' && /[wax+]/u.test(flags)) return deny('open', path);
    return originals.get('open')!(path, flags, ...args);
  };
  for (const name of ['writeFile', 'mkdir', 'rename', 'unlink', 'rm']) {
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

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

interface Fixture {
  readonly root: string;
  readonly repositoryRoot: string;
  readonly file: string;
  readonly repositoryBinding: AuthorityRegistrySnapshot['repository_bindings'][number];
}

const CHILD_READINESS_DEADLINE_MS = 15_000;
const CHILD_OPERATION_DEADLINE_MS = 15_000;

interface ChildCloseOutcome {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface OwnedChildObservation {
  output: string;
  readonly errors: string[];
  readonly closeListeners: Set<() => void>;
  closed?: ChildCloseOutcome;
  termination?: Promise<void>;
  collection?: Promise<AuthorityUseWorkerOutcome>;
}

interface AuthorityUseWorkerOutcome extends ChildCloseOutcome {
  readonly output: string;
  readonly errors: readonly string[];
  readonly timedOut: boolean;
  readonly closeConfirmed: boolean;
  readonly terminationError?: string;
}

const ownedChildObservations = new WeakMap<ChildProcess, OwnedChildObservation>();

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function observeOwnedChild(child: ChildProcess): void {
  const observation: OwnedChildObservation = { output: '', errors: [], closeListeners: new Set() };
  const recordStreamError = (name: string) => (error: Error) => {
    observation.errors.push(`${name}: ${errorText(error)}`);
  };
  child.on('error', recordStreamError('child'));
  child.stdin?.on('error', recordStreamError('stdin'));
  child.stdout?.on('data', (chunk: Buffer) => { observation.output += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk: Buffer) => { observation.output += chunk.toString('utf8'); });
  child.stdout?.on('error', recordStreamError('stdout'));
  child.stderr?.on('error', recordStreamError('stderr'));
  child.once('close', (code, signal) => {
    observation.closed = { code, signal };
    for (const listener of observation.closeListeners) listener();
    observation.closeListeners.clear();
  });
  ownedChildObservations.set(child, observation);
}

function ownedChildObservation(child: ChildProcess): OwnedChildObservation {
  const observation = ownedChildObservations.get(child);
  assert.ok(observation, 'child process is an owned fixture worker');
  return observation;
}

function waitForOwnedChildClose(child: ChildProcess, timeoutMs: number): Promise<ChildCloseOutcome | undefined> {
  const observation = ownedChildObservation(child);
  if (observation.closed) return Promise.resolve(observation.closed);

  return new Promise((resolveClose) => {
    let settled = false;
    const finish = (closed: ChildCloseOutcome | undefined) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      observation.closeListeners.delete(onClose);
      resolveClose(closed);
    };
    const onClose = () => finish(observation.closed);
    const timeout = setTimeout(() => finish(undefined), timeoutMs);
    observation.closeListeners.add(onClose);
    if (observation.closed) finish(observation.closed);
  });
}

async function fixture(prefix: string): Promise<Fixture> {
  const root = await createTestFixtureDirectory(approvedTempBase(), prefix);
  const repositoryRoot = join(root, 'repo');
  await mkdir(repositoryRoot);
  git(repositoryRoot, ['init', '--quiet']);
  git(repositoryRoot, ['config', 'user.name', 'authority registry process fixture']);
  git(repositoryRoot, ['config', 'user.email', 'authority-registry-process@test.invalid']);
  await writeFile(join(repositoryRoot, 'README.md'), 'seed\n', 'utf8');
  git(repositoryRoot, ['add', 'README.md']);
  git(repositoryRoot, ['commit', '--quiet', '-m', 'seed']);
  const candidate = await resolveRepositoryBindingCandidate(repositoryRoot);
  const registryDirectory = join(root, 'user-local-registry');
  await mkdir(registryDirectory);
  return {
    root,
    repositoryRoot,
    file: join(registryDirectory, 'registry-v1.json'),
    repositoryBinding: {
      repository_reference_id: randomUUID(),
      anchor_kind: 'git-common-directory-object-v1',
      binding_epoch: 1,
      physical_identity: candidate.physical_identity,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  };
}

function repositoryMutation(fixtureValue: Fixture) {
  return {
    kind: 'BINDINGS' as const,
    target_ids: [fixtureValue.repositoryBinding.repository_reference_id],
    apply: (current: AuthorityRegistrySnapshot) => ({
      ...current,
      repository_bindings: [...current.repository_bindings, fixtureValue.repositoryBinding],
    }),
  };
}

function workBinding(fixtureValue: Fixture) {
  return {
    work_id: randomUUID(),
    repository_reference_id: fixtureValue.repositoryBinding.repository_reference_id,
    authority_id: randomUUID(),
    contract_id: null,
    task_id: null,
    work_activation_id: randomUUID(),
    work_activation_epoch: 1,
    contract_revision_digest: 'c'.repeat(64),
    scope_digest: 'd'.repeat(64),
    created_at: new Date().toISOString(),
  };
}

function childTransactionScript(
  file: string,
  work: ReturnType<typeof workBinding>,
  pauseAt: string,
): string {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/core/authority/registry.js')).href;
  const payload = JSON.stringify({ file, work, pauseAt });
  return [
    `const payload = ${payload};`,
    `const { transactAuthorityRegistry } = await import(${JSON.stringify(moduleUrl)});`,
    'await transactAuthorityRegistry(payload.file, {',
    '  kind: "BINDINGS",',
    '  target_ids: [payload.work.work_id],',
    '  apply: (current) => ({ ...current, work_bindings: [...current.work_bindings, payload.work] }),',
    '}, { hooks: { onStage: async (stage) => {',
    '  if (stage === payload.pauseAt) {',
    '    const keepAlive = setInterval(() => {}, 60_000);',
    '    keepAlive.ref();',
    '    process.stdout.write("STAGE:" + stage + "\\n");',
    '    await new Promise(() => {});',
    '  }',
    '} } });',
    'process.stdout.write("RETURNED\\n");',
  ].join('\n');
}

function startPausedTransaction(
  file: string,
  work: ReturnType<typeof workBinding>,
  stage: string,
): ChildProcess {
  const child = spawn(process.execPath, ['--input-type=module', '-e', childTransactionScript(file, work, stage)], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  observeOwnedChild(child);
  return child;
}

async function waitForStage(child: ChildProcess, stage: string): Promise<string> {
  const observation = ownedChildObservation(child);
  if (observation.output.includes(`STAGE:${stage}\n`)) return observation.output;
  if (observation.errors.length > 0) {
    throw new Error(`child readiness failed before ${stage}: ${JSON.stringify(observation.errors)} output=${observation.output}`);
  }
  if (observation.closed) {
    throw new Error(`child closed before ${stage}: code=${observation.closed.code} signal=${observation.closed.signal} output=${observation.output}`);
  }
  const stdout = child.stdout;
  if (!stdout) throw new Error(`child has no stdout readiness channel for ${stage}`);

  return new Promise((resolveStage, rejectStage) => {
    let output = '';
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      stdout.off('data', onStdout);
      child.stderr?.off('data', onStderr);
      stdout.off('error', onStdoutError);
      child.stderr?.off('error', onStderrError);
      child.off('error', onChildError);
      child.off('exit', onExit);
      child.off('close', onClose);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) rejectStage(error);
      else resolveStage(output);
    };
    const onStdout = (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes(`STAGE:${stage}\n`)) finish();
    };
    const onStderr = (chunk: Buffer) => { output += chunk.toString('utf8'); };
    const onStdoutError = (error: Error) => finish(new Error(`child stdout failed before ${stage}: ${errorText(error)} output=${output}`));
    const onStderrError = (error: Error) => finish(new Error(`child stderr failed before ${stage}: ${errorText(error)} output=${output}`));
    const onChildError = (error: Error) => finish(new Error(`child spawn failed before ${stage}: ${errorText(error)} output=${output}`));
    const onExit = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`child exited before ${stage}: code=${code} signal=${signal} output=${output}`));
    const onClose = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`child closed before ${stage}: code=${code} signal=${signal} output=${output}`));
    const timeout = setTimeout(() => {
      finish(new Error(`child readiness deadline expired before ${stage} after ${CHILD_READINESS_DEADLINE_MS}ms; output=${output}`));
    }, CHILD_READINESS_DEADLINE_MS);

    stdout.on('data', onStdout);
    child.stderr?.on('data', onStderr);
    stdout.on('error', onStdoutError);
    child.stderr?.on('error', onStderrError);
    child.once('error', onChildError);
    child.once('exit', onExit);
    child.once('close', onClose);
    if (observation.closed) onClose(observation.closed.code, observation.closed.signal);
  });
}

async function assertPausedChildAliveWithLock(child: ChildProcess, file: string): Promise<void> {
  assert.notEqual(child.pid, undefined, 'paused transaction child has a process ID');
  assert.equal(child.exitCode, null, 'paused transaction child remains alive');
  assert.equal(child.signalCode, null, 'paused transaction child has not received a termination signal');
  const lockPath = `${file}.lock`;
  const stats = await lstat(lockPath, { bigint: true });
  assert.ok(stats.isFile() && !stats.isSymbolicLink(), 'child-owned lock path remains a regular file');
  const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly pid?: number; readonly token?: string };
  assert.equal(lock.pid, child.pid, 'the live child PID owns the persisted lock payload');
  assert.equal(typeof lock.token, 'string');
}

async function terminateChild(child: ChildProcess): Promise<void> {
  const observation = ownedChildObservation(child);
  if (observation.closed) return;
  if (observation.termination) return observation.termination;

  observation.termination = (async () => {
    let killResult: boolean | undefined;
    let killError: string | undefined;
    if (!observation.closed && child.exitCode === null && child.signalCode === null && child.pid !== undefined) {
      try {
        killResult = child.kill();
      } catch (error) {
        killError = errorText(error);
      }
    }
    const closed = await waitForOwnedChildClose(child, CHILD_OPERATION_DEADLINE_MS);
    if (!closed) {
      throw new Error(
        `owned child termination was not confirmed within ${CHILD_OPERATION_DEADLINE_MS}ms; `
        + `pid=${child.pid ?? 'unavailable'} exitCode=${child.exitCode} signalCode=${child.signalCode} `
        + `killResult=${killResult ?? 'not-attempted'} killError=${killError ?? 'none'} `
        + `errors=${JSON.stringify(observation.errors)}`,
      );
    }
  })();
  return observation.termination;
}

test('T010: actual competing process holds the lock; contention and stale ownership fail closed without reclaim', async () => {
  const value = await fixture('cb-authority-registry-process-lock-');
  const children: ChildProcess[] = [];
  await withOwnedChildCleanup(value.root, children, async () => {
    const child = startPausedTransaction(value.file, workBinding(value), 'lock-acquired');
    children.push(child);
    await waitForStage(child, 'lock-acquired');
    await assertPausedChildAliveWithLock(child, value.file);
    await assert.rejects(transactAuthorityRegistry(value.file, repositoryMutation(value)), (error: unknown) =>
      error instanceof AuthorityRegistryError && error.code === 'LOCK_BUSY');
    await assertPausedChildAliveWithLock(child, value.file);

    await terminateChild(child);
    const afterTermination = await inspectAuthorityRegistry(value.file);
    assert.equal(afterTermination.revision, 0, 'the pre-commit child did not mutate the registry snapshot');
    await assert.rejects(transactAuthorityRegistry(value.file, repositoryMutation(value)), (error: unknown) =>
      error instanceof AuthorityRegistryError && error.code === 'LOCK_BUSY',
      'stale-but-unproven lock ownership is never reclaimed automatically');
  });
});

test('T010: process termination before/after replace, directory sync, and before acknowledgement never rolls back', async () => {
  const crashStages = ['before-replace', 'replaced', 'directory-synced', 'before-ack'] as const;
  for (const stage of crashStages) {
    const value = await fixture(`cb-authority-registry-crash-${stage}-`);
    const children: ChildProcess[] = [];
    await withOwnedChildCleanup(value.root, children, async () => {
      await transactAuthorityRegistry(value.file, repositoryMutation(value));
      const oldSnapshot = await inspectAuthorityRegistry(value.file);
      const expectedWork = workBinding(value);
      const child = startPausedTransaction(value.file, expectedWork, stage);
      children.push(child);
      await waitForStage(child, stage);
      await assertPausedChildAliveWithLock(child, value.file);
      await terminateChild(child);

      const reconciled = await inspectAuthorityRegistry(value.file);
      const replacementReached = stage !== 'before-replace';
      assert.equal(reconciled.revision, replacementReached ? oldSnapshot.revision + 1 : oldSnapshot.revision, stage);
      assert.equal(reconciled.work_bindings.some((item) => item.work_id === expectedWork.work_id), replacementReached, stage);
      if (replacementReached) {
        assert.equal(reconciled.audit.length, oldSnapshot.audit.length + 1,
          `${stage}: mutation and audit are visible together in one snapshot`);
      } else {
        assert.deepEqual(reconciled.audit, oldSnapshot.audit, 'pre-replace termination leaves the old snapshot intact');
      }
      await assert.rejects(transactAuthorityRegistry(value.file, repositoryMutation(value)), (error: unknown) =>
        error instanceof AuthorityRegistryError && error.code === 'LOCK_BUSY',
        `${stage}: uncertainty is read-only reconciled and never blindly retried`);
      assert.deepEqual(await inspectAuthorityRegistry(value.file), reconciled,
        `${stage}: repeated read-only reconciliation returns the exact same current snapshot`);
    });
  }
});

test('T010: repository locator equality alone is not accepted as physical binding equality', async () => {
  const value = await fixture('cb-authority-registry-locator-');
  try {
    await transactAuthorityRegistry(value.file, repositoryMutation(value));
    const snapshot = await inspectAuthorityRegistry(value.file);
    const copyOnlyCandidate = {
      ...value.repositoryBinding,
      physical_identity: {
        ...value.repositoryBinding.physical_identity,
        file_id: randomUUID(),
      },
    };
    assert.equal(copyOnlyCandidate.repository_reference_id, snapshot.repository_bindings[0]?.repository_reference_id);
    assert.notDeepEqual(copyOnlyCandidate.physical_identity, snapshot.repository_bindings[0]?.physical_identity,
      'matching/copyable public locator cannot substitute for current physical identity');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T010: representative consumed/revoked lifecycle records and their audit survive a separate process read', async () => {
  const value = await fixture('cb-authority-registry-terminal-restart-');
  try {
    await transactAuthorityRegistry(value.file, repositoryMutation(value));
    const consumedId = randomUUID();
    const revokedId = randomUUID();
    const terminal = await transactAuthorityRegistry(value.file, {
      kind: 'LIFECYCLE_RECORDS',
      target_ids: [consumedId, revokedId],
      apply: (current, context) => ({
        ...current,
        grant_lifecycle: [
          ...current.grant_lifecycle,
          {
            grant_id: consumedId,
            lifecycle: 'CONSUMED',
            terminal_event_id: context.event_id,
            updated_at: context.recorded_at,
          },
          {
            grant_id: revokedId,
            lifecycle: 'REVOKED',
            terminal_event_id: context.event_id,
            updated_at: context.recorded_at,
          },
        ] satisfies readonly RegistryLifecycleRecord[],
      }),
    });
    const expected = terminal.grant_lifecycle
      .map(({ grant_id, lifecycle, terminal_event_id }) => ({ grant_id, lifecycle, terminal_event_id }))
      .sort((left, right) => left.grant_id.localeCompare(right.grant_id));
    const moduleUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/core/authority/registry.js')).href;
    const script = [
      `const { inspectAuthorityRegistry } = await import(${JSON.stringify(moduleUrl)});`,
      `const snapshot = await inspectAuthorityRegistry(${JSON.stringify(value.file)});`,
      'process.stdout.write(JSON.stringify(snapshot.grant_lifecycle.map(({ grant_id, lifecycle, terminal_event_id }) => ({ grant_id, lifecycle, terminal_event_id })).sort((a, b) => a.grant_id.localeCompare(b.grant_id))));',
    ].join('\n');
    const restartedReader = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(restartedReader.status, 0, restartedReader.stderr);
    assert.deepEqual(JSON.parse(restartedReader.stdout), expected);
    assert.equal(terminal.audit.at(-1)?.kind, 'LIFECYCLE_RECORDS');
    assert.deepEqual(terminal.audit.at(-1)?.target_ids, [consumedId, revokedId].sort());
    // This is storage/restart evidence only, not verifier or G4 replay acceptance.
  } finally {
    await removeTestRepository(value.root);
  }
});

const serviceModuleUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/core/authority/authority-service.js')).href;

async function authorityServiceModule(): Promise<any> {
  return import(serviceModuleUrl);
}

function grantDraft(subject_label = 'pre-contract descriptive selection'): Record<string, unknown> {
  return {
    subject_label,
    operations: ['file.write'],
    capabilities: ['source.edit'],
    path_scope: ['/src/**'],
    ceilings: { max_files: 60, max_changed_lines: 240 },
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
  };
}

async function initializedAuthorityFixture(prefix: string): Promise<Fixture> {
  const value = await fixture(prefix);
  await runInit(value.repositoryRoot);
  return value;
}

async function injectActiveContractRevision(value: Fixture): Promise<void> {
  const state = await readLifecycleState(value.repositoryRoot);
  assert.equal(state?.lifecycle_state, 'active', 'revision injection requires a coherent active contract fixture');
  assert.ok(state.active_contract_id, 'active fixture has a canonical contract ID');
  const contractPath = getContractFilePath(value.repositoryRoot, state.active_contract_id);
  const contract = JSON.parse(await readFile(contractPath, 'utf8')) as { max_files: number | null };
  assert.ok(Number.isSafeInteger(contract.max_files), 'active fixture has a numeric file ceiling');
  await writeFile(contractPath, `${JSON.stringify({ ...contract, max_files: contract.max_files! + 1 }, null, 2)}\n`, 'utf8');
}

async function injectRepositoryIdentityReplacement(value: Fixture): Promise<void> {
  const alternateRoot = join(value.root, 'alternate-git-identity');
  await mkdir(alternateRoot);
  git(alternateRoot, ['init', '--quiet']);
  const originalGitDirectory = join(value.repositoryRoot, '.git');
  const alternateGitDirectory = join(alternateRoot, '.git');
  const displacedGitDirectory = join(value.root, 'displaced-original-git-identity');
  await rename(originalGitDirectory, displacedGitDirectory);
  try {
    await rename(alternateGitDirectory, originalGitDirectory);
  } catch (error) {
    await rename(displacedGitDirectory, originalGitDirectory);
    throw error;
  }
}

function grantDraftWithWindow(now: Date, expiresAt: string): Record<string, unknown> {
  return {
    ...grantDraft(),
    valid_from: new Date(now.getTime() - 60_000).toISOString(),
    expires_at: expiresAt,
  };
}

test('G3: already-expired and equality-expiry creates fail before first reference or registry writes', async () => {
  const now = new Date('2026-10-15T12:00:00.000Z');
  for (const [label, expiresAt] of [
    ['past', new Date(now.getTime() - 1).toISOString()],
    ['equal', now.toISOString()],
  ] as const) {
    const value = await initializedAuthorityFixture(`cb-authority-g3-expired-first-${label}-`);
    try {
      const { createAuthorityService } = await authorityServiceModule();
      const service = createAuthorityService({ registryPath: value.file, now: () => new Date(now) });
      await assert.rejects(service.createGrant(value.repositoryRoot, grantDraftWithWindow(now, expiresAt)), (error: unknown) =>
        (error as { code?: string }).code === 'GRANT_EXPIRED', label);

      const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
      await assert.rejects(readFile(referencePath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT', label);
      await assert.rejects(readFile(value.file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT', label);
      const empty = await inspectAuthorityRegistry(value.file);
      assert.equal(empty.revision, 0, label);
      assert.equal(empty.repository_bindings.length, 0, label);
      assert.equal(empty.grants.length, 0, label);
      assert.equal(empty.grant_lifecycle.length, 0, label);
      assert.equal(empty.audit.length, 0, label);
      await assert.rejects(readFile(value.file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT', label);
    } finally {
      await removeTestRepository(value.root);
    }
  }
});

test('G3: expiry reached during local context resolution is rejected before reference initialization', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-expiry-before-reference-');
  const initialTime = new Date('2026-10-15T12:00:00.000Z');
  const expiresAt = new Date(initialTime.getTime() + 60_000).toISOString();
  let clockReads = 0;
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({
      registryPath: value.file,
      now: () => {
        clockReads += 1;
        return clockReads === 1 ? new Date(initialTime) : new Date(expiresAt);
      },
    });
    await assert.rejects(service.createGrant(value.repositoryRoot, grantDraftWithWindow(initialTime, expiresAt)), (error: unknown) =>
      (error as { code?: string }).code === 'GRANT_EXPIRED');
    assert.equal(clockReads, 2, 'expiry is sampled before and after asynchronous local context resolution');

    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    await assert.rejects(readFile(referencePath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
    await assert.rejects(readFile(value.file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('G3: expiry reached during registry/reference resolution is rejected at the absent-locator initialization boundary', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-expiry-at-reference-init-');
  const initialTime = new Date('2026-10-15T12:00:00.000Z');
  const expiresAt = new Date(initialTime.getTime() + 60_000).toISOString();
  let clockReads = 0;
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({
      registryPath: value.file,
      now: () => {
        clockReads += 1;
        return clockReads <= 2 ? new Date(initialTime) : new Date(expiresAt);
      },
    });
    await assert.rejects(service.createGrant(value.repositoryRoot, grantDraftWithWindow(initialTime, expiresAt)), /expired/i);
    assert.equal(clockReads, 3, 'the fresh clock sample is taken after both preflight checks and asynchronous registry/reference resolution');

    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    await assert.rejects(readFile(referencePath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
      'expiry at the final pre-initialization boundary must not create a dangling locator');
    await assert.rejects(readFile(value.file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
      'failed creation must not create a registry, grant, or audit record');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('G3: expiry is rechecked under the registry lock and before replace, and never reported CURRENT after commit', async () => {
  for (const boundary of ['lock-acquired', 'before-replace', 'before-ack'] as const) {
    const value = await initializedAuthorityFixture(`cb-authority-g3-expiry-boundary-${boundary}-`);
    try {
      const { createAuthorityService } = await authorityServiceModule();
      let clock = new Date('2026-10-15T12:00:00.000Z');
      const expiresAt = new Date(clock.getTime() + 60_000).toISOString();
      const service = createAuthorityService({
        registryPath: value.file,
        now: () => new Date(clock),
        registryHooks: {
          onStage: (stage: string) => {
            if (stage === boundary) clock = new Date(expiresAt);
          },
        },
      });
      const request = grantDraftWithWindow(clock, expiresAt);
      const expectedCode = boundary === 'before-ack' ? 'COMMIT_UNCERTAIN' : 'PERSISTENCE_FAILED';
      await assert.rejects(service.createGrant(value.repositoryRoot, request), (error: unknown) =>
        (error as { code?: string }).code === expectedCode, boundary);

      const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
      assert.ok(await readFile(referencePath), `${boundary}: initialized locator remains inert unless the grant transaction commits`);
      const snapshot = await inspectAuthorityRegistry(value.file);
      if (boundary === 'before-ack') {
        assert.equal(snapshot.revision, 1);
        assert.equal(snapshot.grants.length, 1);
        assert.equal(snapshot.audit.length, 1);
        assert.equal(snapshot.audit[0]?.event_type, 'GRANT_CREATED');
        assert.equal((await service.inspectGrant(value.repositoryRoot, snapshot.grants[0]!.grant_id)).freshness_status, 'EXPIRED',
          'a post-commit clock advance is reported only as uncertain; inspection never says CURRENT');
      } else {
        assert.equal(snapshot.revision, 0, boundary);
        assert.equal(snapshot.grants.length, 0, boundary);
        assert.equal(snapshot.grant_lifecycle.length, 0, boundary);
        assert.equal(snapshot.audit.length, 0, boundary);
        await assert.rejects(readFile(value.file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT', boundary);
      }
    } finally {
      await removeTestRepository(value.root);
    }
  }
});

test('G3: stored expired grants remain readable, inspect as EXPIRED, and revocable', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-expired-readable-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    let clock = new Date();
    const service = createAuthorityService({ registryPath: value.file, now: () => new Date(clock) });
    const draft = grantDraftWithWindow(clock, new Date(clock.getTime() + 60_000).toISOString());
    const created = await service.createGrant(value.repositoryRoot, draft);
    const beforeRegistry = await readFile(value.file);
    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    const beforeReference = await readFile(referencePath);

    const equalExpiryDraft = grantDraftWithWindow(clock, clock.toISOString());
    await assert.rejects(service.createGrant(value.repositoryRoot, equalExpiryDraft), (error: unknown) =>
      (error as { code?: string }).code === 'GRANT_EXPIRED');
    assert.deepEqual(await readFile(value.file), beforeRegistry, 'expired create cannot append a grant or audit to existing state');
    assert.deepEqual(await readFile(referencePath), beforeReference, 'expired create cannot rewrite an existing locator');

    clock = new Date(created.expires_at);
    const inspected = await service.inspectGrant(value.repositoryRoot, created.grant_id);
    assert.equal(inspected.freshness_status, 'EXPIRED');
    assert.equal((await service.listGrants(value.repositoryRoot))[0]?.freshness_status, 'EXPIRED');
    const revoked = await service.revokeGrant(value.repositoryRoot, created.grant_id, created.grant_digest);
    assert.equal(revoked.lifecycle, 'REVOKED');
    assert.equal(revoked.freshness_status, 'EXPIRED');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: first grant, generated bindings, canonical body, and semantic audit commit in one G2 snapshot', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-first-grant-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, grantDraft());
    const snapshot = await inspectAuthorityRegistry(value.file);

    assert.equal(snapshot.schema_version, 2);
    assert.equal(snapshot.revision, 1, 'no intermediate binding-registration transaction exists');
    assert.equal(snapshot.repository_bindings.length, 1);
    assert.equal(snapshot.work_bindings.length, 1);
    assert.equal(snapshot.subject_bindings.length, 1);
    assert.equal(snapshot.grants.length, 1);
    assert.equal(snapshot.grant_lifecycle.length, 1);
    assert.equal(snapshot.audit.length, 1);
    const body = snapshot.grants[0]!;
    assert.equal(body.grant_id, created.grant_id);
    assert.equal(body.subject_label, 'pre-contract descriptive selection');
    assert.equal(body.subject_id, snapshot.subject_bindings[0]?.subject_id);
    assert.equal(body.work_id, snapshot.work_bindings[0]?.work_id);
    assert.equal(body.repository_reference_id, snapshot.repository_bindings[0]?.repository_reference_id);
    assert.notEqual(body.subject_id, body.subject_label, 'descriptive label is not a canonical identifier');
    assert.notEqual(body.work_id, 'caller-minted');
    assert.equal(body.grant_digest, created.grant_digest);
    assert.equal(snapshot.grant_lifecycle[0]?.lifecycle, 'ACTIVE');
    assert.equal(snapshot.audit[0]?.event_type, 'GRANT_CREATED');
    assert.equal(snapshot.audit[0]?.grant_id, body.grant_id);
    assert.equal(snapshot.audit[0]?.grant_digest, body.grant_digest);
    assert.equal(snapshot.audit[0]?.grant_id, snapshot.grant_lifecycle[0]?.grant_id);
    assert.deepEqual(snapshot.audit[0]?.target_ids, [
      body.grant_id,
      snapshot.repository_bindings[0]!.repository_reference_id,
      snapshot.work_bindings[0]!.work_id,
      snapshot.subject_bindings[0]!.subject_id,
    ].sort());
    assert.equal(snapshot.audit[0]?.event_id, body.issuer.audit_correlation_id);

    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    const referenceBytes = await readFile(referencePath);
    assert.deepEqual(JSON.parse(referenceBytes.toString('utf8')), {
      reference_schema_version: 1,
      repository_reference_id: body.repository_reference_id,
    });
    assert.deepEqual(await readFile(referencePath), referenceBytes);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: registry rejects a canonical grant with wrong repository, work, or subject binding without mutation', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-wrong-binding-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    await service.createGrant(value.repositoryRoot, grantDraft());
    const beforeBytes = await readFile(value.file);
    const snapshot = await inspectAuthorityRegistry(value.file);
    const existing = snapshot.grants[0]!;
    const binding: GrantBindingContext = {
      repository_reference_id: existing.repository_reference_id,
      repository_binding_epoch: existing.repository_binding_epoch,
      authority_id: existing.authority_id,
      work_id: existing.work_id,
      work_activation_id: existing.work_activation_id,
      work_activation_epoch: existing.work_activation_epoch,
      subject_id: existing.subject_id,
      subject_label: existing.subject_label,
      contract_id: existing.contract_id,
      task_id: existing.task_id,
      contract_revision_digest: existing.contract_revision_digest,
      scope_digest: existing.scope_digest,
      authority_revision: existing.authority_revision,
    };

    for (const field of ['repository_reference_id', 'work_id', 'subject_id'] as const) {
      await assert.rejects(transactAuthorityRegistry(value.file, {
        kind: 'GRANT_CREATED',
        apply: (current, context) => {
          const grant = createCanonicalGrantRecord(
            normalizeGrantDraft(grantDraft()),
            { ...binding, [field]: randomUUID() },
            { created_at: context.recorded_at, audit_correlation_id: context.event_id },
          );
          return {
            ...current,
            grants: [...current.grants, grant],
            grant_lifecycle: [...current.grant_lifecycle, {
              grant_id: grant.grant_id,
              lifecycle: 'ACTIVE' as const,
              terminal_event_id: null,
              updated_at: context.recorded_at,
            }],
          };
        },
      }), (error: unknown) => error instanceof AuthorityRegistryError && error.code === 'CORRUPT', field);
      assert.deepEqual(await readFile(value.file), beforeBytes, `${field}: mismatch does not change grant, bindings, lifecycle, or audit`);
    }
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: repeated create reuses persisted work and subject IDs, not fresh G1 candidate IDs', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-stable-binding-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const first = await service.createGrant(value.repositoryRoot, grantDraft());
    const second = await service.createGrant(value.repositoryRoot, grantDraft());
    assert.equal(second.work_id, first.work_id);
    assert.equal(second.subject_id, first.subject_id);
    assert.notEqual(second.grant_id, first.grant_id);

    const snapshot = await inspectAuthorityRegistry(value.file);
    assert.equal(snapshot.work_bindings.length, 1);
    assert.equal(snapshot.subject_bindings.length, 1);
    assert.equal(snapshot.grants.length, 2);
    assert.deepEqual(snapshot.audit.map((event) => event.event_type), ['GRANT_CREATED', 'GRANT_CREATED']);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: stale digest and terminal revoke fail closed; successful revoke updates only lifecycle plus matching audit', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-revoke-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, grantDraft());
    const before = await inspectAuthorityRegistry(value.file);
    const beforeBytes = await readFile(value.file);

    await assert.rejects(service.revokeGrant(value.repositoryRoot, created.grant_id, '0'.repeat(64)), /digest|stale/i);
    assert.deepEqual(await readFile(value.file), beforeBytes, 'wrong expected digest does not mutate grant, lifecycle, or audit');

    const revoked = await service.revokeGrant(value.repositoryRoot, created.grant_id, created.grant_digest);
    assert.equal(revoked.lifecycle, 'REVOKED');
    const after = await inspectAuthorityRegistry(value.file);
    assert.deepEqual(after.grants, before.grants, 'canonical grant body remains immutable');
    assert.equal(after.grant_lifecycle[0]?.lifecycle, 'REVOKED');
    assert.equal(after.grant_lifecycle[0]?.terminal_event_id, after.audit[1]?.event_id);
    assert.equal(after.audit.length, before.audit.length + 1);
    assert.equal(after.audit[1]?.event_type, 'GRANT_REVOKED');
    assert.equal(after.audit[1]?.grant_id, created.grant_id);
    assert.equal(after.audit[1]?.grant_digest, created.grant_digest);

    const terminalBytes = await readFile(value.file);
    await assert.rejects(service.revokeGrant(value.repositoryRoot, created.grant_id, created.grant_digest), /terminal|revoked|active/i);
    assert.deepEqual(await readFile(value.file), terminalBytes, 'terminal grant cannot be resurrected or re-audited as a successful revoke');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: list and inspect require a valid local binding and are byte-for-byte read-only', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-readonly-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    await assert.rejects(service.listGrants(value.repositoryRoot), /reference|missing|binding/i);
    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    await assert.rejects(readFile(referencePath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');

    const created = await service.createGrant(value.repositoryRoot, grantDraft());
    const snapshotBytes = await readFile(value.file);
    const referenceBytes = await readFile(referencePath);
    const listed = await service.listGrants(value.repositoryRoot);
    const inspected = await service.inspectGrant(value.repositoryRoot, created.grant_id);
    assert.equal(listed.length, 1);
    assert.equal(inspected.grant_id, created.grant_id);
    assert.deepEqual(await readFile(value.file), snapshotBytes);
    assert.deepEqual(await readFile(referencePath), referenceBytes);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014/T016: malformed, unsupported, duplicate-key, and dangling repository references fail without repair', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-reference-failclosed-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    const created = await service.createGrant(value.repositoryRoot, grantDraft());
    const validBytes = await readFile(referencePath);
    const registryBytes = await readFile(value.file);

    for (const invalid of [
      '{"reference_schema_version":1,"reference_schema_version":1,"repository_reference_id":"11111111-1111-4111-8111-111111111111"}\n',
      '{"reference_schema_version":99,"repository_reference_id":"11111111-1111-4111-8111-111111111111"}\n',
      '{"reference_schema_version":1,"repository_reference_id":"11111111-1111-4111-8111-111111111111","extra":true}\n',
      '{broken\n',
    ]) {
      await writeFile(referencePath, invalid, 'utf8');
      const before = await readFile(referencePath);
      await assert.rejects(service.listGrants(value.repositoryRoot), /reference|malformed|schema|corrupt/i);
      await assert.rejects(service.inspectGrant(value.repositoryRoot, created.grant_id), /reference|malformed|schema|corrupt/i);
      await assert.rejects(service.revokeGrant(value.repositoryRoot, created.grant_id, created.grant_digest), /reference|malformed|schema|corrupt/i);
      assert.deepEqual(await readFile(referencePath), before);
      assert.deepEqual(await readFile(value.file), registryBytes, 'read/revoke failures never repair or change canonical registry bytes');
    }

    await writeFile(referencePath, validBytes);
    const valid = JSON.parse(validBytes.toString('utf8')) as { repository_reference_id: string };
    await writeFile(referencePath, `${JSON.stringify({
      reference_schema_version: 1,
      repository_reference_id: '77777777-7777-4777-8777-777777777777',
    }, null, 2)}\n`, 'utf8');
    const danglingBytes = await readFile(referencePath);
    await assert.rejects(service.listGrants(value.repositoryRoot), /dangling|binding|reference/i);
    assert.deepEqual(await readFile(referencePath), danglingBytes);
    assert.notEqual(valid.repository_reference_id, '77777777-7777-4777-8777-777777777777');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: injected pre-commit and ambiguous post-replace failures never return success or auto-bind a locator', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-create-fault-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const preCommit = createAuthorityService({
      registryPath: value.file,
      registryHooks: { onStage: (stage: string) => { if (stage === 'before-temp-create') throw new Error('injected G3 pre-commit failure'); } },
    });
    await assert.rejects(preCommit.createGrant(value.repositoryRoot, grantDraft()), /injected|persistence|transaction/i);
    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    assert.ok(await readFile(referencePath), 'locator is written first and deliberately left inert after a failed commit');
    assert.equal((await inspectAuthorityRegistry(value.file)).revision, 0);
    const normal = createAuthorityService({ registryPath: value.file });
    await assert.rejects(normal.listGrants(value.repositoryRoot), /dangling|binding|reference/i);
    await assert.rejects(normal.createGrant(value.repositoryRoot, grantDraft()), /dangling|binding|reference/i,
      'an existing dangling locator is not silently repaired or rebound');
    assert.equal((await inspectAuthorityRegistry(value.file)).revision, 0);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: copied public locator cannot inherit a physical repository binding', async () => {
  const original = await initializedAuthorityFixture('cb-authority-g3-copy-source-');
  const copy = await initializedAuthorityFixture('cb-authority-g3-copy-target-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: original.file });
    const created = await service.createGrant(original.repositoryRoot, grantDraft());
    const originalReference = await readFile(join(getChangeBudgetDirectory(original.repositoryRoot), 'authority-reference.json'));
    await writeFile(join(getChangeBudgetDirectory(copy.repositoryRoot), 'authority-reference.json'), originalReference);
    await assert.rejects(service.inspectGrant(copy.repositoryRoot, created.grant_id), /physical|identity|repository|binding/i);
  } finally {
    await Promise.all([
      removeTestRepository(original.root),
      removeTestRepository(copy.root),
    ]);
  }
});

test('T014: create revalidates its locked work context before the G2 registry replacement', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-create-context-drift-');
  try {
    await runStart(value.repositoryRoot, [
      '--task', 'G3 deterministic context drift fixture',
      '--base-revision', 'HEAD',
      '--allow-path', 'src/**',
      '--max-files', '1',
    ]);
    const { createAuthorityService } = await authorityServiceModule();
    let injected = false;
    const service = createAuthorityService({
      registryPath: value.file,
      registryHooks: {
        onStage: async (stage: string) => {
          if (stage === 'lock-acquired' && !injected) {
            injected = true;
            await injectActiveContractRevision(value);
          }
        },
      },
    });

    await assert.rejects(service.createGrant(value.repositoryRoot, grantDraft()),
      'context drift after initial resolution must reject before durable replacement');
    assert.equal(injected, true, 'the deterministic raw-fixture change ran at the registry lock boundary');
    const unchanged = await inspectAuthorityRegistry(value.file);
    assert.equal(unchanged.revision, 0);
    assert.equal(unchanged.repository_bindings.length, 0);
    assert.equal(unchanged.work_bindings.length, 0);
    assert.equal(unchanged.subject_bindings.length, 0);
    assert.equal(unchanged.grants.length, 0);
    assert.equal(unchanged.grant_lifecycle.length, 0);
    assert.equal(unchanged.audit.length, 0);
    await assert.rejects(readFile(value.file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
      'a failed first create leaves no registry replacement');
    assert.ok(await readFile(join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json')),
      'the pre-existing G2 contract permits only an inert locator after a failed first create');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: create rejects a repository physical identity change before the G2 registry replacement', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-create-identity-drift-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    let injected = false;
    const service = createAuthorityService({
      registryPath: value.file,
      registryHooks: {
        onStage: async (stage: string) => {
          if (stage === 'lock-acquired' && !injected) {
            injected = true;
            await injectRepositoryIdentityReplacement(value);
          }
        },
      },
    });

    await assert.rejects(service.createGrant(value.repositoryRoot, grantDraft()),
      'physical repository replacement after initial resolution must reject before durable replacement');
    assert.equal(injected, true, 'the deterministic raw-fixture identity change ran at the registry lock boundary');
    const unchanged = await inspectAuthorityRegistry(value.file);
    assert.equal(unchanged.revision, 0);
    assert.equal(unchanged.repository_bindings.length, 0);
    assert.equal(unchanged.work_bindings.length, 0);
    assert.equal(unchanged.subject_bindings.length, 0);
    assert.equal(unchanged.grants.length, 0);
    assert.equal(unchanged.grant_lifecycle.length, 0);
    assert.equal(unchanged.audit.length, 0);
    await assert.rejects(readFile(value.file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
      'a failed first create leaves no registry replacement');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: revoke revalidates its locked work context before the G2 registry replacement', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-revoke-context-drift-');
  try {
    await runStart(value.repositoryRoot, [
      '--task', 'G3 deterministic revoke context drift fixture',
      '--base-revision', 'HEAD',
      '--allow-path', 'src/**',
      '--max-files', '1',
    ]);
    const { createAuthorityService } = await authorityServiceModule();
    const creator = createAuthorityService({ registryPath: value.file });
    const created = await creator.createGrant(value.repositoryRoot, grantDraft());
    const beforeBytes = await readFile(value.file);
    const before = await inspectAuthorityRegistry(value.file);
    let injected = false;
    const revoker = createAuthorityService({
      registryPath: value.file,
      registryHooks: {
        onStage: async (stage: string) => {
          if (stage === 'lock-acquired' && !injected) {
            injected = true;
            await injectActiveContractRevision(value);
          }
        },
      },
    });

    await assert.rejects(revoker.revokeGrant(value.repositoryRoot, created.grant_id, created.grant_digest),
      'context drift after revoke precheck must reject before durable replacement');
    assert.equal(injected, true, 'the deterministic raw-fixture change ran at the registry lock boundary');
    assert.deepEqual(await readFile(value.file), beforeBytes, 'pre-replace context drift leaves registry bytes unchanged');
    const unchanged = await inspectAuthorityRegistry(value.file);
    assert.equal(unchanged.revision, before.revision);
    assert.equal(unchanged.grant_lifecycle[0]?.lifecycle, 'ACTIVE');
    assert.deepEqual(unchanged.audit, before.audit, 'pre-replace context drift adds no mutation audit');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: revoke reports post-replace context drift as uncertain, not successful', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-revoke-postreplace-drift-');
  try {
    await runStart(value.repositoryRoot, [
      '--task', 'G3 deterministic post-replace context drift fixture',
      '--base-revision', 'HEAD',
      '--allow-path', 'src/**',
      '--max-files', '1',
    ]);
    const { createAuthorityService } = await authorityServiceModule();
    const creator = createAuthorityService({ registryPath: value.file });
    const created = await creator.createGrant(value.repositoryRoot, grantDraft());
    let injected = false;
    const revoker = createAuthorityService({
      registryPath: value.file,
      registryHooks: {
        onStage: async (stage: string) => {
          if (stage === 'readback-validated' && !injected) {
            injected = true;
            await injectActiveContractRevision(value);
          }
        },
      },
    });

    await assert.rejects(revoker.revokeGrant(value.repositoryRoot, created.grant_id, created.grant_digest), (error: unknown) =>
      (error as { code?: string }).code === 'COMMIT_UNCERTAIN',
      'post-replacement context drift cannot be acknowledged as a successful revoke');
    assert.equal(injected, true, 'the deterministic raw-fixture change ran after durable readback validation');
    const committed = await inspectAuthorityRegistry(value.file);
    assert.equal(committed.revision, 2, 'the replacement remains visible and is not rolled back');
    assert.equal(committed.grant_lifecycle[0]?.lifecycle, 'REVOKED');
    assert.equal(committed.audit.length, 2, 'revoke and audit remain one durable snapshot');
    assert.equal(committed.audit[1]?.event_type, 'GRANT_REVOKED');
    assert.equal(committed.audit[1]?.grant_id, created.grant_id);
    assert.equal(committed.audit[1]?.grant_digest, created.grant_digest);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: coherent active-contract revision changes make an existing grant stale and non-revocable', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-stale-work-');
  try {
    await runStart(value.repositoryRoot, [
      '--task', 'G3 active context fixture',
      '--base-revision', 'HEAD',
      '--allow-path', 'src/**',
      '--max-files', '1',
      '--allow-new-files',
    ]);
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const activeDraft = grantDraft();
    delete activeDraft.subject_label;
    const created = await service.createGrant(value.repositoryRoot, activeDraft);
    await runAmend(value.repositoryRoot, ['--max-files', '2', '--reason', 'advance coherent contract revision']);

    const inspected = await service.inspectGrant(value.repositoryRoot, created.grant_id);
    assert.equal(inspected.freshness_status, 'STALE');
    const before = await readFile(value.file);
    await assert.rejects(service.revokeGrant(value.repositoryRoot, created.grant_id, created.grant_digest), /stale|context|work/i);
    assert.deepEqual(await readFile(value.file), before, 'stale context cannot revoke or mutate the registry');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: actual grant snapshot survives a separate process read with matching create audit', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-restart-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, grantDraft());
    const moduleUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/core/authority/registry.js')).href;
    const script = [
      `const { inspectAuthorityRegistry } = await import(${JSON.stringify(moduleUrl)});`,
      `const state = await inspectAuthorityRegistry(${JSON.stringify(value.file)});`,
      'process.stdout.write(JSON.stringify({ grants: state.grants.map((grant) => ({ grant_id: grant.grant_id, grant_digest: grant.grant_digest, audit_correlation_id: grant.issuer.audit_correlation_id })), audit: state.audit.map((event) => ({ event_id: event.event_id, event_type: event.event_type, grant_id: event.grant_id, grant_digest: event.grant_digest })) }));',
    ].join('\n');
    const restarted = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' });
    assert.equal(restarted.status, 0, restarted.stderr);
    const observed = JSON.parse(restarted.stdout) as {
      grants: readonly { grant_id: string; grant_digest: string; audit_correlation_id: string }[];
      audit: readonly { event_id: string; event_type: string; grant_id: string | null; grant_digest: string | null }[];
    };
    assert.deepEqual(observed.grants, [{
      grant_id: created.grant_id,
      grant_digest: created.grant_digest,
      audit_correlation_id: observed.audit[0]?.event_id,
    }]);
    assert.equal(observed.audit.length, 1);
    assert.equal(observed.audit[0]?.event_type, 'GRANT_CREATED');
    assert.equal(observed.audit[0]?.grant_id, created.grant_id);
    assert.equal(observed.audit[0]?.grant_digest, created.grant_digest);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: a post-replace acknowledgement failure is ambiguous, not success or a blind retry', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-ambiguous-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({
      registryPath: value.file,
      registryHooks: { onStage: (stage: string) => { if (stage === 'before-ack') throw new Error('injected G3 acknowledgement loss'); } },
    });
    await assert.rejects(service.createGrant(value.repositoryRoot, grantDraft()), /uncertain|acknowledgement|persistence|replacement was attempted|reconcile/i);
    const observed = await inspectAuthorityRegistry(value.file);
    assert.equal(observed.revision, 1);
    assert.equal(observed.grants.length, 1);
    assert.equal(observed.audit.length, 1);
    assert.equal(observed.audit[0]?.event_type, 'GRANT_CREATED');
    assert.equal(observed.audit[0]?.grant_id, observed.grants[0]?.grant_id);
    assert.equal(observed.grant_lifecycle[0]?.lifecycle, 'ACTIVE');
    const readOnly = createAuthorityService({ registryPath: value.file });
    assert.equal((await readOnly.listGrants(value.repositoryRoot)).length, 1,
      'read-only reconciliation observes committed snapshot; no create retry is attempted');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: malformed persisted grant body fails closed without repair', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-corrupt-grant-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    await service.createGrant(value.repositoryRoot, grantDraft());
    const valid = await inspectAuthorityRegistry(value.file);
    const tampered = {
      ...valid,
      grants: valid.grants.map((grant) => ({ ...grant, path_scope: ['/src/**', '/docs/**'] })),
    };
    const malformedBytes = `${JSON.stringify(tampered, null, 2)}\n`;
    await writeFile(value.file, malformedBytes, 'utf8');
    const before = await readFile(value.file);
    await assert.rejects(service.listGrants(value.repositoryRoot), /grant|digest|corrupt/i);
    assert.deepEqual(await readFile(value.file), before, 'inspection does not repair or normalize a tampered grant');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: competing grant creates serialize or fail without duplicate partial records', async () => {
  const value = await initializedAuthorityFixture('cb-authority-g3-concurrent-create-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const initial = await service.createGrant(value.repositoryRoot, grantDraft());
    const outcomes = await Promise.allSettled([
      service.createGrant(value.repositoryRoot, grantDraft('concurrent descriptive selection A')),
      service.createGrant(value.repositoryRoot, grantDraft('concurrent descriptive selection B')),
    ]);
    const successCount = outcomes.filter((outcome) => outcome.status === 'fulfilled').length;
    assert.ok(successCount >= 1, 'at least one competing explicit grant request completes');

    const snapshot = await inspectAuthorityRegistry(value.file);
    assert.equal(snapshot.grants.length, 1 + successCount);
    assert.equal(snapshot.audit.length, snapshot.grants.length);
    assert.equal(snapshot.grant_lifecycle.length, snapshot.grants.length);
    assert.equal(new Set(snapshot.grants.map((grant) => grant.grant_id)).size, snapshot.grants.length);
    assert.ok(snapshot.grants.every((grant) => grant.work_id === initial.work_id));
    assert.ok(snapshot.audit.every((event) => event.event_type === 'GRANT_CREATED'));
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T014: failed pre-replace write, file-sync, and replace barriers never report a new grant', async () => {
  const failures = [
    {
      label: 'pre-write',
      hooks: { onStage: (stage: string) => { if (stage === 'before-temp-create') throw new Error('injected pre-write failure'); } },
    },
    {
      label: 'file-sync',
      hooks: { syncFile: async () => { throw new Error('injected grant file-sync failure'); } },
    },
    {
      label: 'replace',
      hooks: { replace: async () => { throw new Error('injected grant replace failure'); } },
    },
  ] as const;
  for (const failure of failures) {
    const value = await initializedAuthorityFixture(`cb-authority-g3-fault-${failure.label}-`);
    try {
      const { createAuthorityService } = await authorityServiceModule();
      const service = createAuthorityService({ registryPath: value.file, registryHooks: failure.hooks });
      await assert.rejects(service.createGrant(value.repositoryRoot, grantDraft()), /injected|persistence|replacement|commit/i, failure.label);
      const snapshot = await inspectAuthorityRegistry(value.file);
      assert.equal(snapshot.revision, 0, failure.label);
      assert.equal(snapshot.repository_bindings.length, 0, failure.label);
      assert.equal(snapshot.work_bindings.length, 0, failure.label);
      assert.equal(snapshot.subject_bindings.length, 0, failure.label);
      assert.equal(snapshot.grants.length, 0, failure.label);
      assert.equal(snapshot.audit.length, 0, failure.label);
    } finally {
      await removeTestRepository(value.root);
    }
  }
});

const G4_ALL_PERMISSIONS: GrantPermissions = {
  allow_new_files: true,
  allow_dependencies: true,
  allow_migrations: true,
  allow_configuration: true,
  allow_public_api: true,
};

function g4NewFilePermissionOnly(allowNewFiles: boolean): GrantPermissions {
  return {
    allow_new_files: allowNewFiles,
    allow_dependencies: false,
    allow_migrations: false,
    allow_configuration: false,
    allow_public_api: false,
  };
}

function g4UseRequest(
  grantReferenceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    grant_reference_id: grantReferenceId,
    requested_operation: 'file.write',
    requested_capabilities: ['source.edit'],
    requested_paths: ['src/feature.ts'],
    requested_ceilings: { max_files: 18, max_changed_lines: 200 },
    requested_permissions: {
      allow_new_files: false,
      allow_dependencies: false,
      allow_migrations: false,
      allow_configuration: false,
      allow_public_api: false,
    },
    ...overrides,
  };
}

async function activeG4Fixture(prefix: string, options: {
  readonly allowPaths?: readonly string[];
  readonly denyPaths?: readonly string[];
  readonly maxFiles?: number;
  readonly maxChangedLines?: number;
  readonly permissions?: GrantPermissions;
} = {}): Promise<Fixture> {
  const value = await initializedAuthorityFixture(prefix);
  const existingTarget = join(value.repositoryRoot, 'src', 'feature.ts');
  await mkdir(join(value.repositoryRoot, 'src'), { recursive: true });
  await writeFile(existingTarget, 'existing G4 file.write target\n', 'utf8');
  git(value.repositoryRoot, ['add', 'src/feature.ts']);
  git(value.repositoryRoot, ['commit', '--quiet', '-m', 'seed existing G4 file.write target']);
  await runStart(value.repositoryRoot, [
    '--task', 'offline G4 authority fixture',
    '--base-revision', 'HEAD',
    ...((options.allowPaths ?? ['src/**']).flatMap((path) => ['--allow-path', path])),
    ...((options.denyPaths ?? ['src/denied/**']).flatMap((path) => ['--deny-path', path])),
    '--max-files', String(options.maxFiles ?? 60),
    '--max-changed-lines', String(options.maxChangedLines ?? 240),
    ...(options.permissions?.allow_new_files ? ['--allow-new-files'] : []),
    ...(options.permissions?.allow_dependencies ? ['--allow-new-dependencies'] : []),
    ...(options.permissions?.allow_migrations ? ['--allow-migrations'] : []),
    ...(options.permissions?.allow_configuration ? ['--allow-config-changes'] : []),
    ...(options.permissions?.allow_public_api ? ['--allow-public-api-changes'] : []),
  ]);
  return value;
}

function g4GrantDraft(mode: 'REUSABLE' | 'ONE_SHOT' = 'REUSABLE', permissions = G4_ALL_PERMISSIONS): Record<string, unknown> {
  const draft = grantDraft();
  delete draft.subject_label;
  draft.mode = mode;
  draft.path_scope = ['/src/**'];
  draft.ceilings = { max_files: 60, max_changed_lines: 240 };
  draft.permissions = { ...permissions };
  return draft;
}

test('T018: missing file.write targets require new-file permission even when the request omits it', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-missing-target-permission-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const missingPath = 'src/new-parent/new-authorization-target.ts';
    const target = join(value.repositoryRoot, ...missingPath.split('/'));
    await assert.rejects(lstat(target), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
    const beforeBytes = await readFile(value.file);
    const before = await inspectAuthorityRegistry(value.file);
    const request = g4UseRequest(created.grant_id, {
      requested_paths: [missingPath],
      requested_permissions: {
        allow_new_files: false,
        allow_dependencies: false,
        allow_migrations: false,
        allow_configuration: false,
        allow_public_api: false,
      },
    });

    const preview = await service.verifyGrant(value.repositoryRoot, request);
    assert.equal(preview.status, 'REJECTED', 'a missing file.write target is a new-file permission requirement');
    assert.ok(preview.reasons.includes('CAPABILITY_MISMATCH'));
    assert.deepEqual(await readFile(value.file), beforeBytes, 'denied preview is byte-for-byte read-only');
    assert.deepEqual(await inspectAuthorityRegistry(value.file), before, 'denied preview appends no audit or consumes no grant');

    const use = await service.authorizeUse(value.repositoryRoot, request);
    assert.equal(use.status, 'USE_REJECTED');
    assert.equal(use.reason, 'CAPABILITY_MISMATCH');
    const after = await inspectAuthorityRegistry(value.file);
    assert.equal(after.grant_lifecycle[0]?.lifecycle, 'ACTIVE', 'denial cannot consume a one-shot grant');
    assert.equal(after.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED');
    assert.equal(after.audit.some((event) => event.event_type === 'GRANT_CONSUMED'), false);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: missing file.write target requires both grant and contract new-file permission for all request flag combinations', async () => {
  for (const grantAllowsNewFiles of [false, true]) {
    for (const contractAllowsNewFiles of [false, true]) {
      for (const requestAllowsNewFiles of [false, true]) {
        const label = `g${Number(grantAllowsNewFiles)}-c${Number(contractAllowsNewFiles)}-r${Number(requestAllowsNewFiles)}`;
        const value = await activeG4Fixture(`cb-authority-g4-new-file-matrix-${label}-`, {
          permissions: g4NewFilePermissionOnly(contractAllowsNewFiles),
        });
        try {
          const { createAuthorityService } = await authorityServiceModule();
          const service = createAuthorityService({ registryPath: value.file });
          const created = await service.createGrant(value.repositoryRoot, g4GrantDraft(
            'ONE_SHOT',
            g4NewFilePermissionOnly(grantAllowsNewFiles),
          ));
          const missingPath = 'src/new-parent/feature.ts';
          const target = join(value.repositoryRoot, ...missingPath.split('/'));
          await assert.rejects(lstat(target), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
          const request = g4UseRequest(created.grant_id, {
            requested_paths: [missingPath],
            requested_permissions: g4NewFilePermissionOnly(requestAllowsNewFiles),
          });
          const beforeBytes = await readFile(value.file);
          const before = await inspectAuthorityRegistry(value.file);
          const shouldAccept = grantAllowsNewFiles && contractAllowsNewFiles;

          const preview = await service.verifyGrant(value.repositoryRoot, request);
          assert.equal(preview.status, shouldAccept ? 'VERIFIED' : 'REJECTED', `${label}: preview decision`);
          if (shouldAccept) assert.deepEqual(preview.reasons, [], `${label}: positive preview reasons`);
          else assert.ok(preview.reasons.includes('CAPABILITY_MISMATCH'), `${label}: deny reason ${preview.reasons}`);
          assert.deepEqual(await readFile(value.file), beforeBytes, `${label}: preview is byte-for-byte read-only`);
          assert.deepEqual(await inspectAuthorityRegistry(value.file), before, `${label}: preview changes no audit or lifecycle`);

          const use = await service.authorizeUse(value.repositoryRoot, request);
          if (shouldAccept) {
            assert.equal(use.status, 'USE_ACCEPTED', `${label}: durable permission acceptance`);
            const after = await inspectAuthorityRegistry(value.file);
            assert.equal(after.grant_lifecycle[0]?.lifecycle, 'CONSUMED', `${label}: accepted one-shot is consumed`);
            assert.equal(after.audit.at(-1)?.event_type, 'GRANT_CONSUMED', `${label}: consumption evidence`);
            assert.equal(after.audit.at(-1)?.event_id, use.audit_event_id, `${label}: returned event matches durable evidence`);
          } else {
            assert.equal(use.status, 'USE_REJECTED', `${label}: durable permission denial`);
            assert.equal(use.reason, 'CAPABILITY_MISMATCH', `${label}: denial reason`);
            const after = await inspectAuthorityRegistry(value.file);
            assert.deepEqual(after.grants, before.grants, `${label}: denial preserves canonical grant`);
            assert.equal(after.grant_lifecycle[0]?.lifecycle, 'ACTIVE', `${label}: denial does not consume one-shot`);
            assert.equal(after.audit.length, before.audit.length + 1, `${label}: only rejection evidence is appended`);
            assert.equal(after.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED', `${label}: no accepted-use evidence`);
            assert.equal(after.audit.at(-1)?.event_id, use.audit_event_id, `${label}: returned event matches rejection evidence`);
            assert.equal(after.audit.some((event) => event.event_type === 'GRANT_CONSUMED'), false,
              `${label}: no consumption audit on denial`);
          }
          await assert.rejects(lstat(target), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT',
            `${label}: authorizeUse records authority only and does not create files`);
        } finally {
          await removeTestRepository(value.root);
        }
      }
    }
  }
});

test('T018: existing file.write targets do not require new-file permission unless explicitly requested', async () => {
  const value = await activeG4Fixture('cb-authority-g4-existing-target-permission-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft(
      'ONE_SHOT',
      g4NewFilePermissionOnly(false),
    ));
    const target = join(value.repositoryRoot, 'src', 'feature.ts');
    assert.equal((await lstat(target)).isFile(), true, 'the positive fixture target really exists');
    const request = g4UseRequest(created.grant_id, {
      requested_permissions: g4NewFilePermissionOnly(false),
    });
    const beforeBytes = await readFile(value.file);
    const preview = await service.verifyGrant(value.repositoryRoot, request);
    assert.equal(preview.status, 'VERIFIED', 'existing target plus caller false does not need new-file permission');
    assert.deepEqual(await readFile(value.file), beforeBytes, 'existing-target preview remains byte-for-byte read-only');
    const use = await service.authorizeUse(value.repositoryRoot, request);
    assert.equal(use.status, 'USE_ACCEPTED');
    const after = await inspectAuthorityRegistry(value.file);
    assert.equal(after.grant_lifecycle[0]?.lifecycle, 'CONSUMED');
    assert.equal(after.audit.at(-1)?.event_type, 'GRANT_CONSUMED');
    assert.equal((await lstat(target)).isFile(), true, 'G4 does not itself mutate the target');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: explicit new-file request on an existing target still requires both permission flags', async () => {
  for (const grantAllowsNewFiles of [false, true]) {
    for (const contractAllowsNewFiles of [false, true]) {
      const label = `g${Number(grantAllowsNewFiles)}-c${Number(contractAllowsNewFiles)}`;
      const value = await activeG4Fixture(`cb-authority-g4-existing-explicit-new-${label}-`, {
        permissions: g4NewFilePermissionOnly(contractAllowsNewFiles),
      });
      try {
        const { createAuthorityService } = await authorityServiceModule();
        const service = createAuthorityService({ registryPath: value.file });
        const created = await service.createGrant(value.repositoryRoot, g4GrantDraft(
          'ONE_SHOT',
          g4NewFilePermissionOnly(grantAllowsNewFiles),
        ));
        const target = join(value.repositoryRoot, 'src', 'feature.ts');
        assert.equal((await lstat(target)).isFile(), true, `${label}: target exists`);
        const request = g4UseRequest(created.grant_id, {
          requested_permissions: g4NewFilePermissionOnly(true),
        });
        const beforeBytes = await readFile(value.file);
        const before = await inspectAuthorityRegistry(value.file);
        const shouldAccept = grantAllowsNewFiles && contractAllowsNewFiles;
        const preview = await service.verifyGrant(value.repositoryRoot, request);
        assert.equal(preview.status, shouldAccept ? 'VERIFIED' : 'REJECTED', `${label}: preview decision`);
        assert.deepEqual(await readFile(value.file), beforeBytes, `${label}: preview is read-only`);
        const use = await service.authorizeUse(value.repositoryRoot, request);
        if (shouldAccept) {
          assert.equal(use.status, 'USE_ACCEPTED', `${label}: explicit new-file permission accepted`);
          assert.equal((await inspectAuthorityRegistry(value.file)).grant_lifecycle[0]?.lifecycle, 'CONSUMED');
        } else {
          assert.equal(use.status, 'USE_REJECTED', `${label}: missing either permission denies`);
          assert.equal(use.reason, 'CAPABILITY_MISMATCH');
          const after = await inspectAuthorityRegistry(value.file);
          assert.equal(after.grant_lifecycle[0]?.lifecycle, 'ACTIVE', `${label}: denial preserves one-shot`);
          assert.equal(after.audit.length, before.audit.length + 1, `${label}: only rejection audit is added`);
          assert.equal(after.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED');
        }
      } finally {
        await removeTestRepository(value.root);
      }
    }
  }
});

test('T018: file deleted after preview requires fresh new-file permission during durable use', async () => {
  const value = await activeG4Fixture('cb-authority-g4-delete-after-preview-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft(
      'ONE_SHOT',
      g4NewFilePermissionOnly(false),
    ));
    const target = join(value.repositoryRoot, 'src', 'feature.ts');
    const request = g4UseRequest(created.grant_id, {
      requested_permissions: g4NewFilePermissionOnly(false),
    });
    const before = await readFile(value.file);
    const preview = await service.verifyGrant(value.repositoryRoot, request);
    assert.equal(preview.status, 'VERIFIED', 'existing file is valid under false new-file permissions');
    assert.deepEqual(await readFile(value.file), before, 'preview is read-only');

    await unlink(target);
    await assert.rejects(lstat(target), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
    const use = await service.authorizeUse(value.repositoryRoot, request);
    assert.equal(use.status, 'USE_REJECTED', 'durable use must not trust an earlier existing-target preview');
    assert.equal(use.reason, 'CAPABILITY_MISMATCH');
    const after = await inspectAuthorityRegistry(value.file);
    assert.equal(after.grant_lifecycle[0]?.lifecycle, 'ACTIVE', 'fresh denial does not consume one-shot');
    assert.equal(after.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED');
    assert.equal(after.audit.some((event) => event.event_type === 'GRANT_CONSUMED'), false);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: target disappearing at pre-replace boundary denies before one-shot commit', async () => {
  const value = await activeG4Fixture('cb-authority-g4-delete-before-replace-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const normal = createAuthorityService({ registryPath: value.file });
    const created = await normal.createGrant(value.repositoryRoot, g4GrantDraft(
      'ONE_SHOT',
      g4NewFilePermissionOnly(false),
    ));
    const target = join(value.repositoryRoot, 'src', 'feature.ts');
    let removedAtPreReplace = false;
    const racing = createAuthorityService({
      registryPath: value.file,
      registryHooks: {
        onStage: async (stage: string) => {
          if (stage !== 'before-replace' || removedAtPreReplace) return;
          removedAtPreReplace = true;
          await unlink(target);
        },
      },
    });
    const request = g4UseRequest(created.grant_id, {
      requested_permissions: g4NewFilePermissionOnly(false),
    });
    const use = await racing.authorizeUse(value.repositoryRoot, request);
    assert.equal(removedAtPreReplace, true, 'the fixture target changed at the actual pre-replace boundary');
    assert.equal(use.status, 'USE_REJECTED');
    assert.equal(use.reason, 'CAPABILITY_MISMATCH');
    const after = await inspectAuthorityRegistry(value.file);
    assert.equal(after.grant_lifecycle[0]?.lifecycle, 'ACTIVE', 'pre-replace denial leaves one-shot active');
    assert.equal(after.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED');
    assert.equal(after.audit.some((event) => event.event_type === 'GRANT_CONSUMED'), false);
    await assert.rejects(lstat(target), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: G4 preview is byte-for-byte read-only and one-shot use atomically consumes with matching evidence', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-readonly-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const beforeBytes = await readFile(value.file);
    const before = await inspectAuthorityRegistry(value.file);

    const preview = await service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(preview.status, 'VERIFIED');
    assert.equal(preview.match, true);
    assert.deepEqual(preview.reasons, []);
    assert.deepEqual(preview.request.requested_ceilings, { max_files: 18, max_changed_lines: 200 },
      'the preview preserves the request and does not fill it from the grant maximum');
    assert.deepEqual(await readFile(value.file), beforeBytes, 'verification writes no registry or audit bytes');
    assert.deepEqual(await inspectAuthorityRegistry(value.file), before, 'verification does not consume or append evidence');

    const accepted = await service.authorizeUse(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(accepted.status, 'USE_ACCEPTED');
    const consumed = await inspectAuthorityRegistry(value.file);
    assert.deepEqual(consumed.grants, before.grants, 'canonical grant body and digest remain immutable');
    assert.equal(consumed.grant_lifecycle[0]?.lifecycle, 'CONSUMED');
    assert.equal(consumed.grant_lifecycle[0]?.terminal_event_id, accepted.audit_event_id);
    assert.equal(consumed.audit.length, before.audit.length + 1);
    assert.equal(consumed.audit.at(-1)?.event_type, 'GRANT_CONSUMED');
    assert.equal(consumed.audit.at(-1)?.grant_id, created.grant_id);
    assert.equal(consumed.audit.at(-1)?.grant_digest, created.grant_digest);
    assert.deepEqual(consumed.audit.at(-1)?.target_ids, [created.grant_id]);

    const replay = await service.authorizeUse(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(replay.status, 'USE_REJECTED');
    assert.ok(['CONSUMED', 'REPLAY'].includes(replay.reason));
    const afterReplay = await inspectAuthorityRegistry(value.file);
    assert.equal(afterReplay.grant_lifecycle[0]?.lifecycle, 'CONSUMED');
    assert.equal(afterReplay.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: reusable uses preserve narrower requests and durably record each successful use without consumption', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-reusable-', {
    permissions: G4_ALL_PERMISSIONS,
  });
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    const request = g4UseRequest(created.grant_id, {
      requested_permissions: { ...G4_ALL_PERMISSIONS },
    });

    const first = await service.authorizeUse(value.repositoryRoot, request);
    const second = await service.authorizeUse(value.repositoryRoot, request);
    assert.equal(first.status, 'USE_ACCEPTED');
    assert.equal(second.status, 'USE_ACCEPTED');
    assert.notEqual(first.audit_event_id, second.audit_event_id);
    const snapshot = await inspectAuthorityRegistry(value.file);
    assert.equal(snapshot.grant_lifecycle[0]?.lifecycle, 'ACTIVE');
    assert.equal(snapshot.audit.length, 3, 'create and both reusable uses are durable audit events');
    assert.deepEqual(snapshot.audit.slice(1).map((event) => event.event_type), ['GRANT_USE_RECORDED', 'GRANT_USE_RECORDED']);
    assert.deepEqual(snapshot.audit.slice(1).map((event) => event.grant_digest), [created.grant_digest, created.grant_digest]);
    assert.deepEqual(snapshot.grants[0]?.ceilings, { max_files: 60, max_changed_lines: 240 });
    assert.deepEqual(request.requested_ceilings, { max_files: 18, max_changed_lines: 200 },
      'request values remain narrower instead of being replaced by ceilings');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: operation, capability, contract deny, sibling-prefix, ceiling, and every permission remain independent', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-boundaries-', {
    maxFiles: 40,
    maxChangedLines: 180,
    permissions: G4_ALL_PERMISSIONS,
  });
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    const good = g4UseRequest(created.grant_id, {
      requested_ceilings: { max_files: 18, max_changed_lines: 120 },
    });
    const cases: readonly [string, Record<string, unknown>, string][] = [
      ['operation mismatch', { requested_operation: 'file.delete' }, 'OPERATION_MISMATCH'],
      ['capability mismatch', { requested_capabilities: ['source.read'] }, 'CAPABILITY_MISMATCH'],
      ['contract deny wins', { requested_paths: ['src/denied/private.ts'] }, 'PATH_MISMATCH'],
      ['prefix sibling does not match', { requested_paths: ['src-evil/file.ts'] }, 'PATH_MISMATCH'],
      ['unsupported path case does not match', { requested_paths: ['SRC/feature.ts'] }, 'PATH_MISMATCH'],
      ['contract max_files independently bounds a broader grant', { requested_ceilings: { max_files: 41, max_changed_lines: 120 } }, 'CEILING_EXCEEDED'],
      ['contract max_changed_lines independently bounds a broader grant', { requested_ceilings: { max_files: 18, max_changed_lines: 181 } }, 'CEILING_EXCEEDED'],
    ];
    const beforeBytes = await readFile(value.file);
    for (const [label, overrides, expectedReason] of cases) {
      const result = await service.verifyGrant(value.repositoryRoot, { ...good, ...overrides });
      assert.equal(result.status, 'REJECTED', label);
      assert.ok(result.reasons.includes(expectedReason), `${label}: ${JSON.stringify(result.reasons)}`);
      assert.deepEqual(await readFile(value.file), beforeBytes, `${label}: read-only rejection does not append audit`);
    }

    const falsePermissions = {
      allow_new_files: false,
      allow_dependencies: false,
      allow_migrations: false,
      allow_configuration: false,
      allow_public_api: false,
    };
    const narrowGrant = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE', falsePermissions));
    for (const permission of Object.keys(falsePermissions)) {
      const requested = { ...falsePermissions, [permission]: true };
      const result = await service.verifyGrant(value.repositoryRoot, g4UseRequest(narrowGrant.grant_id, {
        requested_permissions: requested,
        requested_ceilings: { max_files: 18, max_changed_lines: 120 },
      }));
      assert.equal(result.status, 'REJECTED', `${permission} is not implied by operation or path scope`);
      assert.ok(result.reasons.some((reason: string) => reason === 'CAPABILITY_MISMATCH'), permission);
    }

    const grantLimitedDraft = g4GrantDraft('REUSABLE');
    grantLimitedDraft.ceilings = { max_files: 30, max_changed_lines: 100 };
    const grantLimited = await service.createGrant(value.repositoryRoot, grantLimitedDraft);
    for (const requestedCeilings of [
      { max_files: 31, max_changed_lines: 100 },
      { max_files: 18, max_changed_lines: 101 },
    ]) {
      const result = await service.verifyGrant(value.repositoryRoot, g4UseRequest(grantLimited.grant_id, {
        requested_ceilings: requestedCeilings,
      }));
      assert.equal(result.status, 'REJECTED');
      assert.ok(result.reasons.includes('CEILING_EXCEEDED'));
    }
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: missing grant ceiling dimensions are not unlimited and symlink escapes fail closed', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-path-and-ceiling-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const draft = g4GrantDraft('REUSABLE');
    draft.ceilings = { max_changed_lines: 240 };
    const created = await service.createGrant(value.repositoryRoot, draft);
    const missingDimension = await service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id, {
      requested_ceilings: { max_files: 1, max_changed_lines: 1 },
    }));
    assert.equal(missingDimension.status, 'REJECTED');
    assert.ok(missingDimension.reasons.includes('CEILING_EXCEEDED'));

    const outside = join(value.root, 'outside-repository');
    const source = join(value.repositoryRoot, 'src');
    await mkdir(outside);
    await mkdir(source, { recursive: true });
    const junction = join(source, 'escaped');
    await symlink(outside, junction, 'junction');
    const escaped = await service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id, {
      requested_paths: ['src/escaped/untrusted.ts'],
      requested_ceilings: { max_files: 1, max_changed_lines: 1 },
    }));
    assert.equal(escaped.status, 'REJECTED');
    assert.ok(escaped.reasons.includes('PATH_MISMATCH'));
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: omitted request ceiling dimensions fail closed without preview writes or one-shot consumption', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-missing-request-ceiling-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const beforeBytes = await readFile(value.file);
    const before = await inspectAuthorityRegistry(value.file);

    for (const missingField of ['max_files', 'max_changed_lines'] as const) {
      const valid = g4UseRequest(created.grant_id);
      const requestedCeilings: Record<string, unknown> = { max_files: 18, max_changed_lines: 200 };
      delete requestedCeilings[missingField];
      const request = { ...valid, requested_ceilings: requestedCeilings };

      const preview = await service.verifyGrant(value.repositoryRoot, request);
      assert.equal(preview.status, 'REJECTED', `${missingField} omission is not an unlimited request`);
      assert.ok(preview.reasons.includes('INVALID_REQUEST'));
      assert.deepEqual(await readFile(value.file), beforeBytes, `${missingField}: invalid preview remains byte-for-byte read-only`);

      const use = await service.authorizeUse(value.repositoryRoot, request);
      assert.equal(use.status, 'USE_REJECTED', `${missingField} omission cannot durably authorize use`);
      assert.equal(use.reason, 'INVALID_REQUEST');
      assert.deepEqual(await readFile(value.file), beforeBytes, `${missingField}: malformed use cannot consume or append evidence`);
    }

    assert.deepEqual(await inspectAuthorityRegistry(value.file), before,
      'neither missing dimension changes the active one-shot lifecycle or audit');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: each requested permission is independently bounded by the current contract as well as the grant', async () => {
  const value = await activeG4Fixture('cb-authority-g4-contract-permissions-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE', G4_ALL_PERMISSIONS));
    const allDenied = {
      allow_new_files: false,
      allow_dependencies: false,
      allow_migrations: false,
      allow_configuration: false,
      allow_public_api: false,
    };
    for (const permission of Object.keys(allDenied)) {
      const result = await service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id, {
        requested_permissions: { ...allDenied, [permission]: true },
        requested_ceilings: { max_files: 18, max_changed_lines: 100 },
      }));
      assert.equal(result.status, 'REJECTED', `${permission} cannot exceed current contract flags`);
      assert.ok(result.reasons.includes('CAPABILITY_MISMATCH'), permission);
    }
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: expiry, revocation, and contract revision staleness reject without preview writes', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-freshness-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    let clock = new Date();
    const service = createAuthorityService({ registryPath: value.file, now: () => new Date(clock) });
    const expiry = new Date(clock.getTime() + 60_000).toISOString();
    const expiringDraft = g4GrantDraft('REUSABLE');
    expiringDraft.valid_from = new Date(clock.getTime() - 1_000).toISOString();
    expiringDraft.expires_at = expiry;
    const expiring = await service.createGrant(value.repositoryRoot, expiringDraft);
    const beforeExpiredPreview = await readFile(value.file);
    await writeFile(join(value.repositoryRoot, 'head-only-g4.txt'), 'ordinary HEAD movement does not change authority scope\n', 'utf8');
    git(value.repositoryRoot, ['add', 'head-only-g4.txt']);
    git(value.repositoryRoot, ['commit', '--quiet', '-m', 'ordinary HEAD-only G4 fixture change']);
    const headOnly = await service.verifyGrant(value.repositoryRoot, g4UseRequest(expiring.grant_id));
    assert.equal(headOnly.status, 'VERIFIED', 'routine Git HEAD movement does not stale a grant');
    assert.deepEqual(await readFile(value.file), beforeExpiredPreview, 'HEAD-only verification remains read-only');
    clock = new Date(expiry);
    const expired = await service.verifyGrant(value.repositoryRoot, g4UseRequest(expiring.grant_id));
    assert.equal(expired.status, 'REJECTED');
    assert.ok(expired.reasons.includes('EXPIRED'));
    assert.deepEqual(await readFile(value.file), beforeExpiredPreview, 'expiry preview is strictly read-only');

    clock = new Date();
    const notBeforeDraft = g4GrantDraft('REUSABLE');
    notBeforeDraft.valid_from = new Date(clock.getTime() + 60_000).toISOString();
    notBeforeDraft.expires_at = new Date(clock.getTime() + 120_000).toISOString();
    const notBefore = await service.createGrant(value.repositoryRoot, notBeforeDraft);
    const notBeforeResult = await service.verifyGrant(value.repositoryRoot, g4UseRequest(notBefore.grant_id));
    assert.equal(notBeforeResult.status, 'REJECTED');
    assert.ok(notBeforeResult.reasons.includes('NOT_YET_VALID'));

    clock = new Date();
    const revokedGrant = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    await service.revokeGrant(value.repositoryRoot, revokedGrant.grant_id, revokedGrant.grant_digest);
    const revoked = await service.verifyGrant(value.repositoryRoot, g4UseRequest(revokedGrant.grant_id));
    assert.equal(revoked.status, 'REJECTED');
    assert.ok(revoked.reasons.includes('REVOKED'));

    const staleGrant = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    await runAmend(value.repositoryRoot, ['--max-files', '61', '--reason', 'make the G4 work context stale']);
    const beforeStalePreview = await readFile(value.file);
    const stale = await service.verifyGrant(value.repositoryRoot, g4UseRequest(staleGrant.grant_id));
    assert.equal(stale.status, 'REJECTED');
    assert.ok(stale.reasons.includes('STALE_AUTHORITY'));
    assert.deepEqual(await readFile(value.file), beforeStalePreview, 'stale context preview is strictly read-only');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: authority revision mismatch and copied-reference repository mismatch fail closed', async () => {
  const value = await activeG4Fixture('cb-authority-g4-authority-revision-');
  const copied = await activeG4Fixture('cb-authority-g4-copied-reference-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const original = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    const snapshot = await inspectAuthorityRegistry(value.file);
    const base = snapshot.grants.find((grant) => grant.grant_id === original.grant_id)!;
    const binding: GrantBindingContext = {
      repository_reference_id: base.repository_reference_id,
      repository_binding_epoch: base.repository_binding_epoch,
      authority_id: base.authority_id,
      work_id: base.work_id,
      work_activation_id: base.work_activation_id,
      work_activation_epoch: base.work_activation_epoch,
      subject_id: base.subject_id,
      subject_label: base.subject_label,
      contract_id: base.contract_id,
      task_id: base.task_id,
      contract_revision_digest: base.contract_revision_digest,
      scope_digest: base.scope_digest,
      authority_revision: 2,
    };
    await transactAuthorityRegistry(value.file, {
      kind: 'GRANT_CREATED',
      apply: (current, context) => {
        const staleRevisionGrant = createCanonicalGrantRecord(
          normalizeGrantDraft(g4GrantDraft('REUSABLE')),
          binding,
          { created_at: context.recorded_at, audit_correlation_id: context.event_id },
        );
        return {
          ...current,
          grants: [...current.grants, staleRevisionGrant],
          grant_lifecycle: [...current.grant_lifecycle, {
            grant_id: staleRevisionGrant.grant_id,
            lifecycle: 'ACTIVE' as const,
            terminal_event_id: null,
            updated_at: context.recorded_at,
          }],
        };
      },
    });
    const altered = (await inspectAuthorityRegistry(value.file)).grants.find((grant) => grant.grant_id !== original.grant_id)!;
    const revisionResult = await service.verifyGrant(value.repositoryRoot, g4UseRequest(altered.grant_id));
    assert.equal(revisionResult.status, 'REJECTED');
    assert.ok(revisionResult.reasons.includes('STALE_AUTHORITY'));

    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    await writeFile(join(getChangeBudgetDirectory(copied.repositoryRoot), 'authority-reference.json'), await readFile(referencePath));
    const beforeCopiedCheck = await readFile(value.file);
    const copiedResult = await service.verifyGrant(copied.repositoryRoot, g4UseRequest(original.grant_id));
    assert.equal(copiedResult.status, 'REJECTED');
    assert.ok(copiedResult.reasons.includes('REPOSITORY_MISMATCH'));
    assert.deepEqual(await readFile(value.file), beforeCopiedCheck, 'copied locator cannot change source registry or inherit physical authority');
  } finally {
    await Promise.all([
      removeTestRepository(value.root),
      removeTestRepository(copied.root),
    ]);
  }
});

test('T018: ambiguous stable work bindings reject verification and use without consuming one-shot authority', async () => {
  const value = await activeG4Fixture('cb-authority-g4-ambiguous-work-binding-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const initial = await inspectAuthorityRegistry(value.file);
    const existingWork = initial.work_bindings.find((binding) => binding.work_id === created.work_id);
    assert.ok(existingWork);
    const existingSubject = initial.subject_bindings.find((binding) => binding.work_id === existingWork.work_id);
    assert.ok(existingSubject);

    const duplicateWork = {
      ...existingWork,
      work_id: randomUUID(),
      authority_id: randomUUID(),
      work_activation_id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    const duplicateSubject = {
      ...existingSubject,
      subject_id: randomUUID(),
      work_id: duplicateWork.work_id,
      created_at: new Date().toISOString(),
    };
    await transactAuthorityRegistry(value.file, {
      kind: 'BINDINGS',
      target_ids: [duplicateWork.work_id, duplicateSubject.subject_id],
      apply: (current) => ({
        ...current,
        work_bindings: [...current.work_bindings, duplicateWork],
        subject_bindings: [...current.subject_bindings, duplicateSubject],
      }),
    });
    const beforePreview = await readFile(value.file);

    const preview = await service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(preview.status, 'REJECTED');
    assert.ok(preview.reasons.includes('WORK_MISMATCH'));
    assert.deepEqual(await readFile(value.file), beforePreview, 'ambiguous binding preview remains read-only');

    const use = await service.authorizeUse(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(use.status, 'USE_REJECTED');
    assert.equal(use.reason, 'WORK_MISMATCH');
    const after = await inspectAuthorityRegistry(value.file);
    assert.equal(after.grant_lifecycle.find((record) => record.grant_id === created.grant_id)?.lifecycle, 'ACTIVE');
    assert.equal(after.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED');
    assert.equal(after.audit.some((event) => event.grant_id === created.grant_id && event.event_type === 'GRANT_CONSUMED'), false);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: authorizeUse revalidates work context after acquiring the registry lock', async () => {
  const value = await activeG4Fixture('cb-authority-g4-in-transaction-context-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const normal = createAuthorityService({ registryPath: value.file });
    const created = await normal.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const initial = await inspectAuthorityRegistry(value.file);
    const contractId = initial.work_bindings[0]?.contract_id;
    assert.ok(contractId);
    const contractPath = join(getChangeBudgetDirectory(value.repositoryRoot), 'contracts', `${contractId}.json`);
    let mutated = false;
    const racing = createAuthorityService({
      registryPath: value.file,
      registryHooks: {
        onStage: async (stage: string) => {
          if (stage !== 'lock-acquired' || mutated) return;
          mutated = true;
          const contract = JSON.parse(await readFile(contractPath, 'utf8')) as Record<string, unknown>;
          await writeFile(contractPath, `${JSON.stringify({
            ...contract,
            max_files: Number(contract.max_files) + 1,
          }, null, 2)}\n`, 'utf8');
        },
      },
    });
    const result = await racing.authorizeUse(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(result.status, 'USE_REJECTED');
    assert.equal(result.reason, 'STALE_AUTHORITY');
    assert.equal(mutated, true, 'the deterministic context change happened after the registry lock was acquired');
    const after = await inspectAuthorityRegistry(value.file);
    assert.equal(after.grant_lifecycle[0]?.lifecycle, 'ACTIVE', 'fresh in-transaction revalidation prevents stale consumption');
    assert.equal(after.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED');
    assert.equal(after.audit.at(-1)?.grant_digest, created.grant_digest);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: expiry is checked again at the atomic pre-replace boundary before one-shot consumption', async () => {
  const value = await activeG4Fixture('cb-authority-g4-expiry-at-replace-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    let clock = new Date();
    const expiresAt = new Date(clock.getTime() + 60_000).toISOString();
    const normal = createAuthorityService({ registryPath: value.file, now: () => new Date(clock) });
    const draft = g4GrantDraft('ONE_SHOT');
    draft.valid_from = new Date(clock.getTime() - 1_000).toISOString();
    draft.expires_at = expiresAt;
    const created = await normal.createGrant(value.repositoryRoot, draft);
    const racing = createAuthorityService({
      registryPath: value.file,
      now: () => new Date(clock),
      registryHooks: {
        onStage: (stage: string) => {
          if (stage === 'before-replace') clock = new Date(expiresAt);
        },
      },
    });
    const result = await racing.authorizeUse(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(result.status, 'USE_REJECTED');
    assert.equal(result.reason, 'EXPIRED');
    const after = await inspectAuthorityRegistry(value.file);
    assert.equal(after.grant_lifecycle[0]?.lifecycle, 'ACTIVE', 'expiry before replacement prevents partial consumption');
    assert.equal(after.audit.at(-1)?.event_type, 'GRANT_USE_REJECTED');
    assert.equal(after.audit.some((event) => String(event.event_type) === 'GRANT_CONSUMED'), false);
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: persisted CONSUMED grants require one-shot matching terminal evidence and reject tampering', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-consumed-proof-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const accepted = await service.authorizeUse(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(accepted.status, 'USE_ACCEPTED');
    const snapshot = await inspectAuthorityRegistry(value.file);
    const tampered = {
      ...snapshot,
      grant_lifecycle: snapshot.grant_lifecycle.map((row) => ({
        ...row,
        terminal_event_id: randomUUID(),
      })),
    };
    await writeFile(value.file, `${JSON.stringify(tampered, null, 2)}\n`, 'utf8');
    const before = await readFile(value.file);
    await assert.rejects(inspectAuthorityRegistry(value.file), (error: unknown) =>
      error instanceof AuthorityRegistryError && error.code === 'CORRUPT');
    assert.deepEqual(await readFile(value.file), before, 'malformed terminal proof is rejected without repair');
  } finally {
    await removeTestRepository(value.root);
  }
});

function authorityUseWorkerScript(
  file: string,
  repositoryRoot: string,
  request: Record<string, unknown>,
  pauseAt?: string,
  resumeAt?: string,
  gateTimeoutMs = CHILD_OPERATION_DEADLINE_MS,
): string {
  const moduleUrl = pathToFileURL(resolve(process.cwd(), 'dist/src/core/authority/authority-service.js')).href;
  const payload = JSON.stringify({ file, repositoryRoot, request, pauseAt, resumeAt, gateTimeoutMs });
  return [
    `const payload = ${payload};`,
    `const { createAuthorityService } = await import(${JSON.stringify(moduleUrl)});`,
    'let resumeGatePassed = false;',
    'const service = createAuthorityService({',
    '  registryPath: payload.file,',
    '  ...(payload.pauseAt || payload.resumeAt ? { registryHooks: { onStage: async (stage) => {',
    '    if (stage === payload.pauseAt) {',
    '      const keepAlive = setInterval(() => {}, 60_000); keepAlive.ref();',
    '      process.stdout.write("STAGE:" + stage + "\\n");',
    '      await new Promise(() => {});',
    '    }',
    '    if (stage === payload.resumeAt && !resumeGatePassed) {',
    '      const keepAlive = setInterval(() => {}, 60_000); keepAlive.ref();',
    '      let control = "";',
    '      await new Promise((resolveRelease, rejectRelease) => {',
    '        let settled = false;',
    '        const gateDeadline = setTimeout(() => finish(new Error("test gate control deadline expired")), payload.gateTimeoutMs);',
    '        const cleanup = () => {',
    '          clearTimeout(gateDeadline);',
    '          clearInterval(keepAlive);',
    '          process.stdin.off("data", onData);',
    '          process.stdin.off("end", onEnd);',
    '          process.stdin.off("error", onError);',
    '          process.stdin.pause();',
    '          process.stdin.unref?.();',
    '        };',
    '        const finish = (error) => {',
    '          if (settled) return;',
    '          settled = true;',
    '          cleanup();',
    '          if (error) rejectRelease(error); else resolveRelease();',
    '        };',
    '        const onData = (chunk) => {',
    '          control += chunk.toString("utf8");',
    '          const lineEnd = control.indexOf("\\n");',
    '          if (lineEnd < 0) return;',
    '          if (control.slice(0, lineEnd) !== "RELEASE") {',
    '            finish(new Error("invalid test gate release"));',
    '            return;',
    '          }',
    '          resumeGatePassed = true;',
    '          finish();',
    '        };',
    '        const onEnd = () => finish(new Error("test gate control stdin ended before RELEASE"));',
    '        const onError = (error) => finish(new Error("test gate control stdin error: " + error.message));',
    '        process.stdin.on("data", onData);',
    '        process.stdin.once("end", onEnd);',
    '        process.stdin.once("error", onError);',
    '        process.stdin.resume();',
    '        process.stdout.write("STAGE:" + stage + "\\n");',
    '      });',
    '    }',
    '  } } } : {}),',
    '});',
    'try {',
    '  const result = await service.authorizeUse(payload.repositoryRoot, payload.request);',
    '  process.stdout.write("RESULT:" + JSON.stringify(result) + "\\n");',
    '} catch (error) {',
    '  const causes = []; let cause = error?.cause; while (cause && causes.length < 4) {',
    '    causes.push({ name: cause?.name, code: cause?.code, message: cause?.message }); cause = cause?.cause;',
    '  }',
    '  process.stdout.write("ERROR:" + JSON.stringify({ name: error?.name, code: error?.code, message: error?.message, causes }) + "\\n");',
    '  process.exitCode = 1;',
    '}',
  ].join('\n');
}

function startAuthorityUseWorker(
  file: string,
  repositoryRoot: string,
  request: Record<string, unknown>,
  pauseAt?: string,
  resumeAt?: string,
  gateTimeoutMs = CHILD_OPERATION_DEADLINE_MS,
): ChildProcess {
  const child = spawn(process.execPath, [
    '--input-type=module', '-e', authorityUseWorkerScript(file, repositoryRoot, request, pauseAt, resumeAt, gateTimeoutMs),
  ], {
    cwd: process.cwd(),
    stdio: [resumeAt === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  observeOwnedChild(child);
  return child;
}

function collectAuthorityUseWorker(
  child: ChildProcess,
  operationDeadlineMs = CHILD_OPERATION_DEADLINE_MS,
): Promise<AuthorityUseWorkerOutcome> {
  const observation = ownedChildObservation(child);
  if (observation.collection) return observation.collection;

  observation.collection = (async () => {
    const timelyClose = await waitForOwnedChildClose(child, operationDeadlineMs);
    let terminationError: string | undefined;
    if (!timelyClose) {
      try {
        await terminateChild(child);
      } catch (error) {
        terminationError = errorText(error);
      }
    }
    const closed = observation.closed;
    return {
      code: closed?.code ?? null,
      signal: closed?.signal ?? null,
      output: observation.output,
      errors: [...observation.errors],
      timedOut: timelyClose === undefined,
      closeConfirmed: closed !== undefined,
      ...(terminationError === undefined ? {} : { terminationError }),
    };
  })();
  return observation.collection;
}

async function sendAuthorityUseControlLine(child: ChildProcess, line: string): Promise<void> {
  const control = child.stdin;
  assert.ok(control, 'resumable worker has a native stdin control pipe');
  assert.ok(!control.destroyed && !control.writableEnded, 'resumable worker control pipe remains writable');

  await new Promise<void>((resolveWrite, rejectWrite) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      control.off('error', onControlError);
      control.off('close', onControlClose);
      child.off('error', onChildError);
      child.off('close', onChildClose);
      if (error) rejectWrite(error);
      else resolveWrite();
    };
    const onControlError = (error: Error) => finish(new Error(`test gate control write failed: ${errorText(error)}`));
    const onControlClose = () => finish(new Error('test gate control stdin closed before write completion'));
    const onChildError = (error: Error) => finish(new Error(`test gate worker spawn failed during control write: ${errorText(error)}`));
    const onChildClose = (code: number | null, signal: NodeJS.Signals | null) =>
      finish(new Error(`test gate worker closed during control write: code=${code} signal=${signal}`));
    const timeout = setTimeout(() => {
      finish(new Error(`test gate control write deadline expired after ${CHILD_OPERATION_DEADLINE_MS}ms`));
    }, CHILD_OPERATION_DEADLINE_MS);
    control.once('error', onControlError);
    control.once('close', onControlClose);
    child.once('error', onChildError);
    child.once('close', onChildClose);
    try {
      control.write(line, (error) => {
        if (error) finish(new Error(`test gate control write failed: ${errorText(error)}`));
        else finish();
      });
    } catch (error) {
      finish(new Error(`test gate control write threw: ${errorText(error)}`));
    }
  });
}

async function endAuthorityUseControl(child: ChildProcess): Promise<void> {
  const control = child.stdin;
  assert.ok(control, 'resumable worker has a native stdin control pipe');
  assert.ok(!control.destroyed && !control.writableEnded, 'resumable worker control pipe remains open');

  await new Promise<void>((resolveEnd, rejectEnd) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      control.off('finish', onFinish);
      control.off('error', onControlError);
      control.off('close', onControlClose);
      child.off('error', onChildError);
      child.off('close', onChildClose);
      if (error) rejectEnd(error);
      else resolveEnd();
    };
    const onFinish = () => finish();
    const onControlError = (error: Error) => finish(new Error(`test gate control EOF failed: ${errorText(error)}`));
    const onControlClose = () => {
      if (!control.writableFinished) finish(new Error('test gate control pipe closed before EOF was flushed'));
    };
    const onChildError = (error: Error) => finish(new Error(`test gate worker spawn failed during control EOF: ${errorText(error)}`));
    const onChildClose = (code: number | null, signal: NodeJS.Signals | null) => {
      if (!control.writableFinished) finish(new Error(`test gate worker closed before control EOF: code=${code} signal=${signal}`));
    };
    const timeout = setTimeout(() => {
      finish(new Error(`test gate control EOF deadline expired after ${CHILD_OPERATION_DEADLINE_MS}ms`));
    }, CHILD_OPERATION_DEADLINE_MS);
    control.once('finish', onFinish);
    control.once('error', onControlError);
    control.once('close', onControlClose);
    child.once('error', onChildError);
    child.once('close', onChildClose);
    try {
      control.end();
    } catch (error) {
      finish(new Error(`test gate control EOF threw: ${errorText(error)}`));
    }
  });
}

function authorityUseWorkerDiagnostic(outcome: AuthorityUseWorkerOutcome): {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly status: string | null;
  readonly reason: string | null;
  readonly errorCode: string | null;
  readonly timedOut: boolean;
  readonly closeConfirmed: boolean;
  readonly errors: readonly string[];
} {
  const { code, output } = outcome;
  const diagnostic = {
    exitCode: code,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    closeConfirmed: outcome.closeConfirmed,
    errors: outcome.errors,
  };
  const resultLine = output.split(/\r?\n/u).find((entry) => entry.startsWith('RESULT:'));
  if (resultLine) {
    try {
      const result = JSON.parse(resultLine.slice('RESULT:'.length)) as {
        readonly status?: unknown;
        readonly reason?: unknown;
      };
      return {
        ...diagnostic,
        status: typeof result.status === 'string' ? result.status : null,
        reason: typeof result.reason === 'string' ? result.reason : null,
        errorCode: null,
      };
    } catch {
      return { ...diagnostic, status: null, reason: null, errorCode: null };
    }
  }

  const errorLine = output.split(/\r?\n/u).find((entry) => entry.startsWith('ERROR:'));
  if (errorLine) {
    try {
      const error = JSON.parse(errorLine.slice('ERROR:'.length)) as { readonly code?: unknown };
      return {
        ...diagnostic,
        status: null,
        reason: null,
        errorCode: typeof error.code === 'string' ? error.code : null,
      };
    } catch {
      return { ...diagnostic, status: null, reason: null, errorCode: null };
    }
  }

  return { ...diagnostic, status: null, reason: null, errorCode: null };
}

interface OwnedChildCleanupOverrides {
  readonly settleChild?: (child: ChildProcess) => Promise<AuthorityUseWorkerOutcome>;
  readonly removeFixture?: (root: string) => Promise<void>;
  readonly expectedTimeoutChildren?: ReadonlySet<ChildProcess>;
}

async function withOwnedChildCleanup(
  fixtureRoot: string,
  children: readonly ChildProcess[],
  operation: () => Promise<void>,
  overrides: OwnedChildCleanupOverrides = {},
): Promise<void> {
  let failed = false;
  let primaryError: unknown;
  try {
    await operation();
  } catch (error) {
    failed = true;
    primaryError = error;
  }

  let allChildrenClosed = true;
  const cleanupErrors: unknown[] = [];
  for (const child of children) {
    try {
      const outcome = await (overrides.settleChild ?? collectAuthorityUseWorker)(child);
      if (outcome.timedOut && !overrides.expectedTimeoutChildren?.has(child)) {
        cleanupErrors.push(new Error(
          `owned child operation deadline expired; pid=${child.pid ?? 'unavailable'} `
          + `exitCode=${child.exitCode} signalCode=${child.signalCode} `
          + `terminationError=${outcome.terminationError ?? 'none'}`,
        ));
      }
      if (!outcome.closeConfirmed) {
        allChildrenClosed = false;
        cleanupErrors.push(new Error(
          `owned child close was not confirmed; pid=${child.pid ?? 'unavailable'} `
          + `exitCode=${child.exitCode} signalCode=${child.signalCode} `
          + `terminationError=${outcome.terminationError ?? 'none'} errors=${JSON.stringify(outcome.errors)}`,
        ));
      }
    } catch (error) {
      allChildrenClosed = false;
      cleanupErrors.push(error);
    }
  }

  if (allChildrenClosed) {
    try {
      await (overrides.removeFixture ?? removeTestRepository)(fixtureRoot);
    } catch (error) {
      cleanupErrors.push(error);
    }
  } else {
    cleanupErrors.push(new Error(`active or unconfirmed child retained fixture for safety: ${fixtureRoot}`));
  }

  if (failed && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'owned child primary test failure and cleanup failures', {
      cause: primaryError,
    });
  }
  if (failed) throw primaryError;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'owned child cleanup failed');
  }
}

test('T010/T018: owned cleanup preserves assertion errors and retains fixtures until child close', async () => {
  const value = await fixture('cb-authority-owned-cleanup-errors-');
  const children: ChildProcess[] = [];
  await withOwnedChildCleanup(value.root, children, async () => {
    const child = startPausedTransaction(value.file, workBinding(value), 'lock-acquired');
    children.push(child);
    await waitForStage(child, 'lock-acquired');
    await assertPausedChildAliveWithLock(child, value.file);

    let primaryError: unknown;
    try {
      assert.fail('injected primary assertion failure for cleanup preservation');
    } catch (error) {
      primaryError = error;
    }
    assert.ok(primaryError instanceof Error);
    assert.equal(primaryError.name, 'AssertionError');

    let removeAttempts = 0;
    let combinedFailure: unknown;
    try {
      await withOwnedChildCleanup(value.root, [child], async () => { throw primaryError; }, {
        settleChild: async () => ({
          code: null,
          signal: null,
          output: '',
          errors: [],
          timedOut: true,
          closeConfirmed: false,
          terminationError: 'injected child-close uncertainty',
        }),
        removeFixture: async (root) => {
          removeAttempts += 1;
          await removeTestRepository(root);
        },
      });
    } catch (error) {
      combinedFailure = error;
    }

    assert.ok(combinedFailure instanceof AggregateError,
      'a body assertion plus unconfirmed child cleanup fails as an aggregate');
    assert.strictEqual(combinedFailure.cause, primaryError, 'AggregateError cause retains the original assertion object');
    assert.strictEqual(combinedFailure.errors[0], primaryError, 'aggregate members retain the original assertion object');
    assert.ok(combinedFailure.errors.some((error) =>
      error instanceof Error && error.message.includes('terminationError=injected child-close uncertainty')),
    'aggregate members retain cleanup uncertainty and owned-child diagnostics');
    assert.ok(combinedFailure.errors.some((error) =>
      error instanceof Error && error.message.includes('active or unconfirmed child retained fixture')),
    'aggregate records why fixture removal was withheld');
    assert.equal(removeAttempts, 0, 'fixture remover is not called while child closure is unconfirmed');
    await lstat(value.root);
    await assertPausedChildAliveWithLock(child, value.file);

    const cleanupOnlyFailure = new Error('injected fixture-removal failure');
    let cleanupOnlyAggregate: unknown;
    try {
      await withOwnedChildCleanup(value.root, [], async () => {}, {
        removeFixture: async () => { throw cleanupOnlyFailure; },
      });
    } catch (error) {
      cleanupOnlyAggregate = error;
    }
    assert.ok(cleanupOnlyAggregate instanceof AggregateError,
      'a cleanup-only failure cannot be reported as a passing helper operation');
    assert.deepEqual(cleanupOnlyAggregate.errors, [cleanupOnlyFailure]);
    await lstat(value.root);

    await terminateChild(child);
    assert.ok(child.exitCode !== null || child.signalCode !== null,
      'outer owned cleanup starts only after this child has been confirmed terminated');
  });
  await assert.rejects(lstat(value.root), (error: unknown) =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT',
  'the outer owner removes the fixture only after actual child close');
});

test('T018: cross-process one-shot overlap accepts once and restart/replay remains denied', async () => {
  const value = await activeG4Fixture('cb-authority-g4-red-process-race-');
  const children: ChildProcess[] = [];
  await withOwnedChildCleanup(value.root, children, async () => {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const request = g4UseRequest(created.grant_id);
    const first = startAuthorityUseWorker(value.file, value.repositoryRoot, request, undefined, 'before-replace');
    children.push(first);
    await waitForStage(first, 'before-replace');
    await assertPausedChildAliveWithLock(first, value.file);

    const second = startAuthorityUseWorker(value.file, value.repositoryRoot, request);
    children.push(second);
    const secondOutcome = await collectAuthorityUseWorker(second);
    const secondDiagnostics = JSON.stringify(authorityUseWorkerDiagnostic(secondOutcome));
    assert.equal(secondOutcome.closeConfirmed, true, `overlapping worker must be closed; ${secondDiagnostics}`);
    assert.equal(secondOutcome.timedOut, false, `overlapping worker must finish within its operation deadline; ${secondDiagnostics}`);
    assert.deepEqual(secondOutcome.errors, [], `overlapping worker has no spawn or stream errors; ${secondDiagnostics}`);
    assert.equal(secondOutcome.code, 0, `overlapping worker must exit normally; child outcomes=${secondDiagnostics}`);
    assert.equal(secondOutcome.signal, null, `overlapping worker must not be signaled; child outcomes=${secondDiagnostics}`);
    const secondLine = secondOutcome.output.split(/\r?\n/u).find((entry) => entry.startsWith('RESULT:'));
    assert.ok(secondLine, `overlapping worker must report a parsed service result; child outcomes=${secondDiagnostics}`);
    let secondResult: { readonly status: string; readonly reason?: string };
    try {
      secondResult = JSON.parse(secondLine.slice('RESULT:'.length)) as {
        readonly status: string;
        readonly reason?: string;
      };
    } catch {
      assert.fail(`overlapping worker RESULT JSON could not be parsed; child outcomes=${secondDiagnostics}`);
    }
    assert.equal(secondResult.status, 'USE_REJECTED',
      `the request made while the first worker owns the lock must reject normally; child outcomes=${secondDiagnostics}`);
    assert.equal(typeof secondResult.reason, 'string',
      `the overlapping rejection must have a normal reason code; child outcomes=${secondDiagnostics}`);
    await assertPausedChildAliveWithLock(first, value.file);

    await sendAuthorityUseControlLine(first, 'RELEASE\n');
    const firstOutcome = await collectAuthorityUseWorker(first);
    const firstOutcomeDiagnostics = JSON.stringify(authorityUseWorkerDiagnostic(firstOutcome));
    assert.equal(firstOutcome.closeConfirmed, true, `designated holder close is confirmed; ${firstOutcomeDiagnostics}`);
    assert.equal(firstOutcome.timedOut, false, `designated holder finishes within its operation deadline; ${firstOutcomeDiagnostics}`);
    assert.deepEqual(firstOutcome.errors, [], `designated holder has no spawn or stream errors; ${firstOutcomeDiagnostics}`);
    const firstDiagnostics = JSON.stringify({
      holder: authorityUseWorkerDiagnostic(firstOutcome),
      overlappingWorker: authorityUseWorkerDiagnostic(secondOutcome),
    });
    assert.equal(firstOutcome.code, 0, `designated holder must complete normally; child outcomes=${firstDiagnostics}`);
    assert.equal(firstOutcome.signal, null, `designated holder must not be signaled; child outcomes=${firstDiagnostics}`);
    const firstLine = firstOutcome.output.split(/\r?\n/u).find((entry) => entry.startsWith('RESULT:'));
    assert.ok(firstLine, `designated holder must report a parsed service result; child outcomes=${firstDiagnostics}`);
    let firstResult: { readonly status: string; readonly audit_event_id?: string };
    try {
      firstResult = JSON.parse(firstLine.slice('RESULT:'.length)) as {
        readonly status: string;
        readonly audit_event_id?: string;
      };
    } catch {
      assert.fail(`designated holder RESULT JSON could not be parsed; child outcomes=${firstDiagnostics}`);
    }
    const results = [firstResult, secondResult];
    const childDiagnostics = JSON.stringify(results.map((result, index) => ({
      ...authorityUseWorkerDiagnostic(
        index === 0 ? firstOutcome : secondOutcome,
      ),
      status: result.status,
    })));
    const acceptedCount = results.filter((result) => result.status === 'USE_ACCEPTED').length;
    const rejectedCount = results.filter((result) => result.status === 'USE_REJECTED').length;
    let postRaceState: string | undefined;
    if (acceptedCount !== 1 || rejectedCount !== 1) {
      try {
        const diagnosticSnapshot = await inspectAuthorityRegistry(value.file);
        postRaceState = JSON.stringify({
          grantLifecycle: diagnosticSnapshot.grant_lifecycle
            .find((record) => record.grant_id === created.grant_id)?.lifecycle ?? null,
          consumptionAuditCount: diagnosticSnapshot.audit.filter((event) =>
            event.grant_id === created.grant_id && String(event.event_type) === 'GRANT_CONSUMED').length,
        });
      } catch (error) {
        const errorCode = error instanceof AuthorityRegistryError
          ? error.code
          : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
            ? error.code
            : null;
        postRaceState = JSON.stringify({ inspectionErrorCode: errorCode });
      }
    }
    const failureDiagnostics = `child outcomes=${childDiagnostics}; post-race state=${postRaceState ?? 'not-inspected'}`;
    assert.equal(acceptedCount, 1,
      `two independent processes cannot both accept a one-shot grant; ${failureDiagnostics}`);
    assert.equal(rejectedCount, 1,
      `two independent processes produce exactly one rejection; ${failureDiagnostics}`);
    assert.equal(firstResult.status, 'USE_ACCEPTED',
      `the designated holder completes acceptance after explicit release; ${failureDiagnostics}`);
    assert.equal(secondResult.status, 'USE_REJECTED',
      `the overlapping contender remains normally rejected; ${failureDiagnostics}`);
    const snapshot = await inspectAuthorityRegistry(value.file);
    assert.equal(snapshot.grant_lifecycle.find((record) => record.grant_id === created.grant_id)?.lifecycle, 'CONSUMED');
    assert.equal(snapshot.audit.filter((event) => String(event.event_type) === 'GRANT_CONSUMED').length, 1);
    const consumptionEvents = snapshot.audit.filter((event) =>
      event.grant_id === created.grant_id && String(event.event_type) === 'GRANT_CONSUMED');
    assert.equal(consumptionEvents.length, 1,
      `the designated holder has exactly one correlated consumption audit; child outcomes=${childDiagnostics}`);
    assert.equal(firstResult.audit_event_id, consumptionEvents[0]?.event_id,
      `the holder result identifies the durable consumption audit; child outcomes=${childDiagnostics}`);

    const restarted = startAuthorityUseWorker(value.file, value.repositoryRoot, request);
    children.push(restarted);
    const restartOutcome = await collectAuthorityUseWorker(restarted);
    const restartDiagnostics = JSON.stringify(authorityUseWorkerDiagnostic(restartOutcome));
    assert.equal(restartOutcome.closeConfirmed, true, `restart child close is confirmed; ${restartDiagnostics}`);
    assert.equal(restartOutcome.timedOut, false, `restart child finishes within its operation deadline; ${restartDiagnostics}`);
    assert.deepEqual(restartOutcome.errors, [], `restart child has no spawn or stream errors; ${restartDiagnostics}`);
    assert.equal(restartOutcome.code, 0, `restart child outcome=${restartDiagnostics}`);
    assert.equal(restartOutcome.signal, null, `restart child must not be signaled; ${restartDiagnostics}`);
    const restartLine = restartOutcome.output.split(/\r?\n/u).find((entry) => entry.startsWith('RESULT:'));
    assert.ok(restartLine, `restart child outcome=${restartDiagnostics}`);
    let restartResult: { readonly status: string; readonly reason?: string };
    try {
      restartResult = JSON.parse(restartLine.slice('RESULT:'.length)) as {
        readonly status: string;
        readonly reason?: string;
      };
    } catch {
      assert.fail(`restart worker RESULT JSON could not be parsed; child outcome=${restartDiagnostics}`);
    }
    assert.equal(restartResult.status, 'USE_REJECTED',
      `a separate Node process after restart cannot replay a durable consumption; child outcome=${restartDiagnostics}`);
    assert.equal(restartResult.reason, 'REPLAY',
      `restart rejection is the durable one-shot replay denial, not an unrelated operational rejection; child outcome=${restartDiagnostics}`);
  });
});

test('T018: resumable gate rejects stdin EOF and malformed control without retaining its lock', async () => {
  for (const protocol of ['EOF', 'INVALID_RELEASE'] as const) {
    const value = await activeG4Fixture(`cb-authority-g4-resume-${protocol.toLowerCase()}-`);
    const children: ChildProcess[] = [];
    await withOwnedChildCleanup(value.root, children, async () => {
      const { createAuthorityService } = await authorityServiceModule();
      const service = createAuthorityService({ registryPath: value.file });
      const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
      const child = startAuthorityUseWorker(
        value.file,
        value.repositoryRoot,
        g4UseRequest(created.grant_id),
        undefined,
        'before-replace',
      );
      children.push(child);
      await waitForStage(child, 'before-replace');
      await assertPausedChildAliveWithLock(child, value.file);

      if (protocol === 'EOF') {
        await endAuthorityUseControl(child);
      } else {
        await sendAuthorityUseControlLine(child, 'NOT_RELEASE\n');
      }
      const outcome = await collectAuthorityUseWorker(child);
      const diagnostic = JSON.stringify(authorityUseWorkerDiagnostic(outcome));
      assert.equal(outcome.closeConfirmed, true, `${protocol}: gate failure is settled by actual child close; ${diagnostic}`);
      assert.equal(outcome.timedOut, false, `${protocol}: explicit protocol failure is not a deadline; ${diagnostic}`);
      assert.deepEqual(outcome.errors, [], `${protocol}: child control failure is reported by the worker protocol; ${diagnostic}`);
      assert.equal(outcome.code, 1, `${protocol}: invalid/missing release fails the worker; ${diagnostic}`);
      assert.equal(outcome.signal, null, `${protocol}: gate protocol error is not process termination; ${diagnostic}`);
      assert.match(outcome.output, /^ERROR:/mu, `${protocol}: worker reports the gate error; ${diagnostic}`);
      assert.match(outcome.output, protocol === 'EOF'
        ? /test gate control stdin ended before RELEASE/u
        : /invalid test gate release/u, `${protocol}: the exact control failure is observable; ${diagnostic}`);
      assert.equal(outcome.output.includes('RESULT:'), false, `${protocol}: rejected gate cannot report a use result`);
      await assert.rejects(lstat(`${value.file}.lock`), (error: unknown) =>
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT',
      `${protocol}: the settled operation releases its lock before fixture cleanup`);
      const snapshot = await inspectAuthorityRegistry(value.file);
      assert.notEqual(snapshot.grant_lifecycle.find((row) => row.grant_id === created.grant_id)?.lifecycle, 'CONSUMED');
      assert.equal(snapshot.audit.some((event) =>
        event.grant_id === created.grant_id && String(event.event_type) === 'GRANT_CONSUMED'), false);
    });
  }
});

test('T018: operation deadline terminates and awaits a deterministically paused worker', async () => {
  const value = await activeG4Fixture('cb-authority-g4-resume-operation-deadline-');
  const children: ChildProcess[] = [];
  const expectedTimeoutChildren = new Set<ChildProcess>();
  await withOwnedChildCleanup(value.root, children, async () => {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const child = startAuthorityUseWorker(
      value.file,
      value.repositoryRoot,
      g4UseRequest(created.grant_id),
      undefined,
      'before-replace',
    );
    children.push(child);
    expectedTimeoutChildren.add(child);
    await waitForStage(child, 'before-replace');
    await assertPausedChildAliveWithLock(child, value.file);

    // The short operation budget starts only after readiness proves the child
    // is blocked in the resumable gate while holding the live registry lock.
    const outcome = await collectAuthorityUseWorker(child, 100);
    const diagnostic = JSON.stringify(authorityUseWorkerDiagnostic(outcome));
    assert.equal(outcome.timedOut, true, `operation deadline is a failure, not worker success; ${diagnostic}`);
    assert.equal(outcome.closeConfirmed, true, `deadline cancellation awaits actual child close; ${diagnostic}`);
    assert.equal(outcome.code, null, `terminated gate worker has no normal exit code; ${diagnostic}`);
    assert.notEqual(outcome.signal, null, `deadline cancellation has an observed terminating signal; ${diagnostic}`);
    assert.equal(outcome.output.includes('RESULT:'), false, `timed-out worker never reports an authorization result; ${diagnostic}`);
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'owned worker is reaped before its fixture can be removed');
  }, { expectedTimeoutChildren });
});

test('T018: readiness fails promptly when a worker closes before the requested stage', async () => {
  const value = await activeG4Fixture('cb-authority-g4-resume-readiness-exit-');
  const children: ChildProcess[] = [];
  await withOwnedChildCleanup(value.root, children, async () => {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const child = startAuthorityUseWorker(
      value.file,
      value.repositoryRoot,
      g4UseRequest(created.grant_id),
      'stage-that-does-not-exist',
    );
    children.push(child);

    await assert.rejects(waitForStage(child, 'stage-that-does-not-exist'), /child exited before|child closed before/u,
      'readiness observes an early exit/close rather than waiting for its full deadline');
    const outcome = await collectAuthorityUseWorker(child);
    const diagnostic = JSON.stringify(authorityUseWorkerDiagnostic(outcome));
    assert.equal(outcome.closeConfirmed, true, `early stage failure still waits for process close; ${diagnostic}`);
    assert.equal(outcome.timedOut, false, `early process completion is not misreported as a timeout; ${diagnostic}`);
    assert.equal(outcome.code, 0, `the worker independently completed its ordinary request; ${diagnostic}`);
    assert.equal(outcome.signal, null, `readiness failure did not terminate the worker; ${diagnostic}`);
    assert.match(outcome.output, /^RESULT:/mu, `the collector preserves output after readiness rejection; ${diagnostic}`);
  });
});

test('T018: process death before replace leaves no consumption; death after durable consumption never reports acceptance', async () => {
  for (const pauseAt of ['before-replace', 'before-ack'] as const) {
    const value = await activeG4Fixture(`cb-authority-g4-red-crash-${pauseAt}-`);
    const children: ChildProcess[] = [];
    await withOwnedChildCleanup(value.root, children, async () => {
      const { createAuthorityService } = await authorityServiceModule();
      const service = createAuthorityService({ registryPath: value.file });
      const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
      const before = await inspectAuthorityRegistry(value.file);
      const child = startAuthorityUseWorker(value.file, value.repositoryRoot, g4UseRequest(created.grant_id), pauseAt);
      children.push(child);
      const output = await waitForStage(child, pauseAt);
      await assertPausedChildAliveWithLock(child, value.file);
      await terminateChild(child);
      assert.equal(output.includes('RESULT:'), false, `${pauseAt}: the terminated process never reported an outcome`);

      const reconciled = await inspectAuthorityRegistry(value.file);
      if (pauseAt === 'before-replace') {
        assert.deepEqual(reconciled, before, 'pre-replace death leaves grant, lifecycle, and audit unchanged');
      } else {
        assert.equal(reconciled.grant_lifecycle[0]?.lifecycle, 'CONSUMED',
          'post-replace death retains terminal consumption rather than refunding it');
        assert.equal(reconciled.audit.at(-1)?.event_type, 'GRANT_CONSUMED');
        assert.equal(reconciled.grant_lifecycle[0]?.terminal_event_id, reconciled.audit.at(-1)?.event_id);
        assert.equal(reconciled.audit.at(-1)?.grant_digest, created.grant_digest);
      }
      // No downstream operation is dispatched by the G4 worker. The missing
      // RESULT line and durable snapshot are the only observable outcomes.
    });
  }
});

test('T018: pre-commit and ambiguous post-replace failures never report accepted use or refund consumption', async () => {
  const beforeCommit = await activeG4Fixture('cb-authority-g4-red-fault-before-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const normal = createAuthorityService({ registryPath: beforeCommit.file });
    const created = await normal.createGrant(beforeCommit.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const before = await readFile(beforeCommit.file);
    const failing = createAuthorityService({
      registryPath: beforeCommit.file,
      registryHooks: { onStage: (stage: string) => { if (stage === 'before-temp-create') throw new Error('injected G4 before-commit failure'); } },
    });
    await assert.rejects(failing.authorizeUse(beforeCommit.repositoryRoot, g4UseRequest(created.grant_id)));
    assert.deepEqual(await readFile(beforeCommit.file), before, 'pre-commit failure leaves no consumption and no partial audit');
  } finally {
    await removeTestRepository(beforeCommit.root);
  }

  const afterCommit = await activeG4Fixture('cb-authority-g4-red-fault-after-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const normal = createAuthorityService({ registryPath: afterCommit.file });
    const created = await normal.createGrant(afterCommit.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const uncertain = createAuthorityService({
      registryPath: afterCommit.file,
      registryHooks: { onStage: (stage: string) => { if (stage === 'before-ack') throw new Error('injected G4 acknowledgement loss'); } },
    });
    await assert.rejects(uncertain.authorizeUse(afterCommit.repositoryRoot, g4UseRequest(created.grant_id)), (error: unknown) =>
      error instanceof AuthorityRegistryError && error.code === 'COMMIT_UNCERTAIN');
    const reconciled = await inspectAuthorityRegistry(afterCommit.file);
    assert.equal(reconciled.grant_lifecycle[0]?.lifecycle, 'CONSUMED');
    assert.equal(reconciled.audit.at(-1)?.event_type, 'GRANT_CONSUMED');
    const retry = await normal.authorizeUse(afterCommit.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(retry.status, 'USE_REJECTED');
    assert.equal((await inspectAuthorityRegistry(afterCommit.file)).grant_lifecycle[0]?.lifecycle, 'CONSUMED');
  } finally {
    await removeTestRepository(afterCommit.root);
  }
});

test('T018: write, file-sync, replace, directory-sync, readback and lock failures fail closed without refund', async () => {
  const cases = [
    { label: 'partial-write', outcome: 'ACTIVE' as const },
    { label: 'file-sync', outcome: 'ACTIVE' as const },
    { label: 'replace', outcome: 'ACTIVE' as const },
    { label: 'directory-sync', outcome: 'CONSUMED' as const },
    { label: 'readback', outcome: 'CONSUMED' as const },
  ];
  for (const failure of cases) {
    const value = await activeG4Fixture(`cb-authority-g4-barrier-${failure.label}-`);
    try {
      const { createAuthorityService } = await authorityServiceModule();
      const normal = createAuthorityService({ registryPath: value.file });
      const created = await normal.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
      const before = await inspectAuthorityRegistry(value.file);
      let directorySyncCalls = 0;
      const hooks = failure.label === 'partial-write'
        ? {
          writeTemporary: async (handle: any, bytes: Buffer) => {
            await handle.writeFile(bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 3))));
            throw new Error('injected G4 partial write');
          },
        }
        : failure.label === 'file-sync'
          ? { syncFile: async () => { throw new Error('injected G4 file sync'); } }
          : failure.label === 'replace'
            ? { replace: async () => { throw new Error('injected G4 replace'); } }
            : failure.label === 'directory-sync'
              ? {
                syncDirectory: async () => {
                  directorySyncCalls += 1;
                  if (directorySyncCalls === 2) throw new Error('injected G4 directory sync after replace');
                },
              }
              : { readback: async () => { throw new Error('injected G4 readback'); } };
      const failing = createAuthorityService({ registryPath: value.file, registryHooks: hooks });
      await assert.rejects(failing.authorizeUse(value.repositoryRoot, g4UseRequest(created.grant_id)));
      const observed = await inspectAuthorityRegistry(value.file);
      assert.equal(observed.grant_lifecycle[0]?.lifecycle, failure.outcome, failure.label);
      assert.equal(observed.audit.some((event) => String(event.event_type) === 'GRANT_CONSUMED'),
        failure.outcome === 'CONSUMED', failure.label);
      if (failure.outcome === 'CONSUMED') {
        assert.equal(observed.audit.length, before.audit.length + 1,
          `${failure.label}: one-shot audit and consumption remain colocated when replacement is visible`);
      } else {
        assert.deepEqual(observed.audit, before.audit, `${failure.label}: pre-replace failure leaves no use audit`);
      }
    } finally {
      await removeTestRepository(value.root);
    }
  }

  const locked = await activeG4Fixture('cb-authority-g4-barrier-lock-');
  let owner: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: locked.file });
    const created = await service.createGrant(locked.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const before = await readFile(locked.file);
    owner = await open(`${locked.file}.lock`, 'wx', 0o600);
    const result = await service.authorizeUse(locked.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(result.status, 'USE_REJECTED');
    assert.equal(result.reason, 'AUDIT_UNAVAILABLE', 'unable to persist required rejection evidence fails closed');
    assert.deepEqual(await readFile(locked.file), before, 'lock contention cannot report acceptance or change grant state');
  } finally {
    await owner?.close();
    await removeTestRepository(locked.root);
  }
});

test('T018: repeated verification denies real filesystem writes and leaves reusable/one-shot grants reusable', async () => {
  const value = await activeG4Fixture('cb-authority-g4-zero-write-inspection-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const reusable = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    const oneShot = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const beforeRegistry = await readFile(value.file);
    const budgetDirectory = getChangeBudgetDirectory(value.repositoryRoot);
    const beforeState = await readFile(join(budgetDirectory, 'state.json'));
    const contractId = (await inspectAuthorityRegistry(value.file)).work_bindings[0]?.contract_id;
    assert.ok(contractId);
    const contractPath = join(budgetDirectory, 'contracts', `${contractId}.json`);
    const beforeContract = await readFile(contractPath);
    const referencePath = join(budgetDirectory, 'authority-reference.json');
    const beforeReference = await readFile(referencePath);

    const guarded = await withFilesystemWritesDenied(async () => {
      const results = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        results.push(await service.verifyGrant(value.repositoryRoot, g4UseRequest(reusable.grant_id)));
        results.push(await service.verifyGrant(value.repositoryRoot, g4UseRequest(oneShot.grant_id)));
      }
      return results;
    });

    assert.deepEqual(guarded.attemptedWrites, [],
      `verification must not even attempt a transient filesystem mutation: ${guarded.attemptedWrites.join(', ')}`);
    assert.equal(guarded.error, undefined, 'the write-denying filesystem guard does not disrupt inspection');
    assert.ok(guarded.value?.every((result: any) => result.status === 'VERIFIED'),
      'valid reusable and one-shot grants remain verifiable on repeated previews');
    assert.deepEqual(await readFile(value.file), beforeRegistry);
    assert.deepEqual(await readFile(join(budgetDirectory, 'state.json')), beforeState);
    assert.deepEqual(await readFile(contractPath), beforeContract);
    assert.deepEqual(await readFile(referencePath), beforeReference);
    assert.equal((await inspectAuthorityRegistry(value.file)).grant_lifecycle
      .find((record) => record.grant_id === oneShot.grant_id)?.lifecycle, 'ACTIVE',
    'verification never consumes a one-shot grant');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: verification rejects state, contract, and registry atomic replacements before returning a positive preview', async () => {
  const value = await activeG4Fixture('cb-authority-g4-observation-replacement-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const statePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'state.json');
    const contractId = (await inspectAuthorityRegistry(value.file)).work_bindings[0]?.contract_id;
    assert.ok(contractId);
    const contractPath = join(getChangeBudgetDirectory(value.repositoryRoot), 'contracts', `${contractId}.json`);
    const targets = [statePath, contractPath, value.file] as const;

    for (const targetPath of targets) {
      let replaced = false;
      let replacementBlockedByPinnedHandle = false;
      let hookEntered = false;
      let replacementError: string | undefined;
      const bytesBefore = await readFile(targetPath);
      const restoreHook = setAuthorityReadObservationTestHook(async (paths) => {
        hookEntered = true;
        assert.ok(paths.statePath);
        const replacementPath = `${targetPath}.${randomUUID()}.tmp`;
        try {
          await writeFile(replacementPath, bytesBefore);
          await rename(replacementPath, targetPath);
          replaced = true;
        } catch (error) {
          if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') {
            replacementBlockedByPinnedHandle = true;
            await unlink(replacementPath);
            return;
          }
          replacementError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      });
      let result;
      try {
        result = await service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id));
      } finally {
        restoreHook();
      }
      assert.ok(replaced || replacementBlockedByPinnedHandle,
        `${targetPath}: replacement was attempted after collection; entered=${hookEntered}; injectionError=${replacementError}; result=${JSON.stringify(result)}`);
      if (replaced) {
        assert.equal(result?.status, 'REJECTED', `${targetPath}: unstable observation cannot verify a grant`);
        assert.ok(result?.reasons.length, `${targetPath}: failure remains an explicit bounded non-verifying result`);
      } else {
        assert.equal(replacementBlockedByPinnedHandle, true, `${targetPath}: Windows denied atomic rename over the live pinned read handle`);
        assert.equal(result?.status, 'VERIFIED', `${targetPath}: the input remained unchanged because the pinned handle blocked replacement`);
        assert.deepEqual(await readFile(targetPath), bytesBefore, `${targetPath}: blocked replacement left pinned bytes untouched`);
      }
    }
    assert.equal((await inspectAuthorityRegistry(value.file)).grant_lifecycle[0]?.lifecycle, 'ACTIVE',
      'failed previews never consume one-shot authority');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: present state, contract, or registry locks fail closed without trying to write', async () => {
  const value = await activeG4Fixture('cb-authority-g4-observation-locks-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    const budgetDirectory = getChangeBudgetDirectory(value.repositoryRoot);
    const contractId = (await inspectAuthorityRegistry(value.file)).work_bindings[0]?.contract_id;
    assert.ok(contractId);
    const locks = [
      join(budgetDirectory, 'state.json.lock'),
      join(budgetDirectory, 'contracts', `${contractId}.json.lock`),
      `${value.file}.lock`,
    ];

    for (const lockPath of locks) {
      await writeFile(lockPath, 'malformed and present lock must still reject\n', 'utf8');
      try {
        const guarded = await withFilesystemWritesDenied(() =>
          service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id)));
        const result = guarded.value as { readonly status: string; readonly reasons: readonly string[] } | undefined;
        assert.deepEqual(guarded.attemptedWrites, [], `${lockPath}: inspection attempts no mutation`);
        assert.equal(result?.status, 'REJECTED', `${lockPath}: any present lock rejects inspection`);
        assert.ok(result?.reasons.includes('LOCK_BUSY'), `${lockPath}: explicit lock failure reason`);
        assert.equal(await readFile(lockPath, 'utf8'), 'malformed and present lock must still reject\n');
      } finally {
        await unlink(lockPath);
      }
    }
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: malformed or incomplete state, active contract, and registry reject without repair', async () => {
  const value = await activeG4Fixture('cb-authority-g4-observation-corrupt-inputs-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    const budgetDirectory = getChangeBudgetDirectory(value.repositoryRoot);
    const contractId = (await inspectAuthorityRegistry(value.file)).work_bindings[0]?.contract_id;
    assert.ok(contractId);
    const cases = [
      { path: join(budgetDirectory, 'state.json'), invalid: Buffer.from('{broken\n', 'utf8') },
      { path: join(budgetDirectory, 'contracts', `${contractId}.json`), invalid: Buffer.from('{}\n', 'utf8') },
      { path: value.file, invalid: Buffer.from('{}\n', 'utf8') },
    ] as const;

    for (const item of cases) {
      const original = await readFile(item.path);
      await writeFile(item.path, item.invalid);
      try {
        const guarded = await withFilesystemWritesDenied(() =>
          service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id)));
        const result = guarded.value as { readonly status: string; readonly reasons: readonly string[] } | undefined;
        assert.deepEqual(guarded.attemptedWrites, [], `${item.path}: corrupted inspection attempts no repair`);
        assert.equal(result?.status, 'REJECTED', `${item.path}: malformed/incomplete evidence is non-verifying`);
        assert.ok(result?.reasons.length, `${item.path}: a bounded failure reason is returned`);
        assert.deepEqual(await readFile(item.path), item.invalid, `${item.path}: corrupt evidence remains unchanged`);
      } finally {
        await writeFile(item.path, original);
      }
    }
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: a missing registry is not initialized by verification', async () => {
  const value = await activeG4Fixture('cb-authority-g4-observation-missing-registry-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const referencePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'authority-reference.json');
    const referenceBefore = await readFile(referencePath);
    await unlink(value.file);

    const guarded = await withFilesystemWritesDenied(() =>
      service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id)));
    const result = guarded.value as { readonly status: string } | undefined;
    assert.deepEqual(guarded.attemptedWrites, [], 'missing-registry inspection performs no initialization attempt');
    assert.equal(result?.status, 'REJECTED');
    await assert.rejects(lstat(value.file), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
    assert.deepEqual(await readFile(referencePath), referenceBefore, 'the existing repository locator remains untouched');

    const missingParentRegistry = join(value.root, 'not-created', 'registry-v1.json');
    const missingParentService = createAuthorityService({ registryPath: missingParentRegistry });
    const secondGuard = await withFilesystemWritesDenied(() =>
      missingParentService.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id)));
    assert.deepEqual(secondGuard.attemptedWrites, [], 'a missing registry parent is not created during inspection');
    await assert.rejects(lstat(join(value.root, 'not-created')),
      (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: pending lifecycle audit evidence blocks verification without recovery or state rewrite', async () => {
  const value = await activeG4Fixture('cb-authority-g4-observation-pending-audit-');
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const service = createAuthorityService({ registryPath: value.file });
    const created = await service.createGrant(value.repositoryRoot, g4GrantDraft('REUSABLE'));
    const snapshot = await inspectAuthorityRegistry(value.file);
    const contractId = snapshot.work_bindings[0]?.contract_id;
    assert.ok(contractId);
    const contractPath = join(getChangeBudgetDirectory(value.repositoryRoot), 'contracts', `${contractId}.json`);
    const contract = JSON.parse(await readFile(contractPath, 'utf8'));
    const audit = createLifecycleAuditRecord({
      operation: 'amend',
      repositoryRoot: value.repositoryRoot,
      lifecycleBefore: 'active',
      lifecycleAfter: 'active',
      beforeContract: contract,
      afterContract: contract,
    });
    await persistLifecycleAudit(value.repositoryRoot, audit);
    const statePath = join(getChangeBudgetDirectory(value.repositoryRoot), 'state.json');
    const stateBefore = await readFile(statePath);

    const result = await service.verifyGrant(value.repositoryRoot, g4UseRequest(created.grant_id));
    assert.equal(result.status, 'REJECTED');
    assert.ok(result.reasons.includes('WORK_CONTEXT_UNAVAILABLE'));
    assert.deepEqual(await readFile(statePath), stateBefore, 'inspection does not resolve pending lifecycle evidence');
    assert.equal((await inspectAuthorityRegistry(value.file)).grant_lifecycle[0]?.lifecycle, 'ACTIVE');
  } finally {
    await removeTestRepository(value.root);
  }
});

test('T018: a concurrent revocation cannot make a stale verified preview durable authority', async () => {
  const value = await activeG4Fixture('cb-authority-g4-observation-stale-preview-');
  let releaseRevocation: (() => void) | undefined;
  let revocationLockAcquired: (() => void) | undefined;
  const acquired = new Promise<void>((resolveAcquired) => { revocationLockAcquired = resolveAcquired; });
  const continueRevocation = new Promise<void>((resolveContinue) => { releaseRevocation = resolveContinue; });
  try {
    const { createAuthorityService } = await authorityServiceModule();
    const normal = createAuthorityService({ registryPath: value.file });
    const created = await normal.createGrant(value.repositoryRoot, g4GrantDraft('ONE_SHOT'));
    const request = g4UseRequest(created.grant_id);
    const preview = await normal.verifyGrant(value.repositoryRoot, request);
    assert.equal(preview.status, 'VERIFIED');

    const revoker = createAuthorityService({
      registryPath: value.file,
      registryHooks: {
        onStage: async (stage: string) => {
          if (stage !== 'lock-acquired') return;
          revocationLockAcquired?.();
          await continueRevocation;
        },
      },
    });
    const revocation = revoker.revokeGrant(value.repositoryRoot, created.grant_id, created.grant_digest);
    await acquired;
    const concurrentUse = await normal.authorizeUse(value.repositoryRoot, request);
    assert.notEqual(concurrentUse.status, 'USE_ACCEPTED', 'a contending use never reports acceptance while revocation owns the registry lock');
    releaseRevocation?.();
    const revoked = await revocation;
    assert.equal(revoked.lifecycle, 'REVOKED');

    const staleUse = await normal.authorizeUse(value.repositoryRoot, request);
    assert.equal(staleUse.status, 'USE_REJECTED', 'durable use reloads the now-revoked lifecycle instead of trusting preview');
    assert.equal(staleUse.reason, 'REVOKED');
    const after = await inspectAuthorityRegistry(value.file);
    assert.equal(after.grant_lifecycle[0]?.lifecycle, 'REVOKED');
    assert.equal(after.audit.some((event) => event.event_type === 'GRANT_CONSUMED'), false);
  } finally {
    releaseRevocation?.();
    await removeTestRepository(value.root);
  }
});
