import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createTestFixtureDirectory, removeTestRepository } from '../utils/disposable-repository.js';
import { resolveRepositoryBindingCandidate } from '../../src/core/authority/repository-binding.js';
import {
  AuthorityRegistryError,
  createEmptyAuthorityRegistrySnapshot,
  inspectAuthorityRegistry,
  transactAuthorityRegistry,
  type AuthorityRegistrySnapshot,
  type RegistryLifecycleRecord,
  type RegistryMutation,
} from '../../src/core/authority/registry.js';

type BarrierStage = 'lock' | 'temporary-write' | 'file-sync' | 'replace' | 'directory-sync' | 'readback';

interface BarrierOutcome {
  readonly success: boolean;
  readonly stage: BarrierStage;
  readonly error?: string;
  readonly code?: string;
}

interface BarrierProbeOptions {
  readonly failAt?: BarrierStage;
  /** Injection-only seam; never used for the actual platform feasibility result. */
  readonly syncDirectory?: (handle: FileHandle) => Promise<void>;
}

function approvedTempBase(): string {
  if (process.env.SPEC015_TEST_TEMP_ROOT) return resolve(process.env.SPEC015_TEST_TEMP_ROOT);
  return process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : tmpdir();
}

function errorText(error: unknown): { readonly error: string; readonly code?: string } {
  const candidate = error as NodeJS.ErrnoException;
  return {
    error: error instanceof Error ? error.message : String(error),
    ...(typeof candidate?.code === 'string' ? { code: candidate.code } : {}),
  };
}

/**
 * A T005-only candidate barrier probe, not a production registry or persistence
 * framework. The actual test uses the platform directory sync; injected phase
 * tests only verify that a failed barrier never returns success.
 */
async function candidateBarrier(targetPath: string, options: BarrierProbeOptions = {}): Promise<BarrierOutcome> {
  const lockPath = `${targetPath}.lock`;
  const temporaryPath = join(dirname(targetPath), `.authority-candidate-${randomUUID()}.tmp`);
  let stage: BarrierStage = 'lock';
  let lockHandle: FileHandle | undefined;
  let dataHandle: FileHandle | undefined;
  let directoryHandle: FileHandle | undefined;

  const inject = (at: BarrierStage): void => {
    stage = at;
    if (options.failAt === at) throw new Error(`injected T005 failure at ${at}`);
  };

  try {
    inject('lock');
    lockHandle = await open(lockPath, 'wx', 0o600);
    await lockHandle.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() }));
    await lockHandle.sync();

    inject('temporary-write');
    dataHandle = await open(temporaryPath, 'wx', 0o600);
    await dataHandle.writeFile(JSON.stringify({ schema_version: 1, candidate: 'snapshot' }));

    inject('file-sync');
    await dataHandle.sync();
    await dataHandle.close();
    dataHandle = undefined;

    inject('replace');
    await rename(temporaryPath, targetPath);

    inject('directory-sync');
    // Node/libuv opens a Windows 'r' directory handle read-only, which cannot
    // satisfy FlushFileBuffers; use write access there. POSIX keeps its proven
    // read-only directory-open mode.
    directoryHandle = await open(dirname(targetPath), process.platform === 'win32' ? 'r+' : 'r');
    await (options.syncDirectory ?? ((handle) => handle.sync()))(directoryHandle);
    await directoryHandle.close();
    directoryHandle = undefined;

    inject('readback');
    const persisted = await readFile(targetPath, 'utf8');
    assert.equal(persisted, JSON.stringify({ schema_version: 1, candidate: 'snapshot' }));
    return { success: true, stage };
  } catch (error) {
    return { success: false, stage, ...errorText(error) };
  } finally {
    await Promise.all([
      lockHandle?.close().catch(() => undefined),
      dataHandle?.close().catch(() => undefined),
      directoryHandle?.close().catch(() => undefined),
    ]);
  }
}

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function initRepository(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'authority registry fixture']);
  git(root, ['config', 'user.email', 'authority-registry@test.invalid']);
  await writeFile(join(root, 'README.md'), 'seed\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'seed']);
}

interface RegistryFixture {
  readonly root: string;
  readonly file: string;
  readonly repository: AuthorityRegistrySnapshot['repository_bindings'][number];
  readonly work: AuthorityRegistrySnapshot['work_bindings'][number];
  readonly subject: AuthorityRegistrySnapshot['subject_bindings'][number];
}

async function registryFixture(prefix: string): Promise<RegistryFixture> {
  const root = await createTestFixtureDirectory(approvedTempBase(), prefix);
  const repositoryRoot = join(root, 'repo');
  const registryDirectory = join(root, 'user-local-registry');
  await initRepository(repositoryRoot);
  await mkdir(registryDirectory);
  const candidate = await resolveRepositoryBindingCandidate(repositoryRoot);
  const now = new Date().toISOString();
  const repositoryReferenceId = randomUUID();
  const workId = randomUUID();
  const repository = {
    repository_reference_id: repositoryReferenceId,
    anchor_kind: 'git-common-directory-object-v1' as const,
    binding_epoch: 1,
    physical_identity: candidate.physical_identity,
    created_at: now,
    updated_at: now,
  };
  const work = {
    work_id: workId,
    repository_reference_id: repositoryReferenceId,
    authority_id: randomUUID(),
    contract_id: null,
    task_id: null,
    work_activation_id: randomUUID(),
    work_activation_epoch: 1,
    contract_revision_digest: 'a'.repeat(64),
    scope_digest: 'b'.repeat(64),
    created_at: now,
  };
  const subject = {
    subject_id: randomUUID(),
    repository_reference_id: repositoryReferenceId,
    work_id: workId,
    subject_label: 'descriptive only',
    created_at: now,
  };
  return {
    root,
    file: join(registryDirectory, 'registry-v1.json'),
    repository,
    work,
    subject,
  };
}

function addInitialBindings(fixture: RegistryFixture): RegistryMutation {
  return {
    kind: 'BINDINGS',
    target_ids: [
      fixture.repository.repository_reference_id,
      fixture.work.work_id,
      fixture.subject.subject_id,
    ],
    apply: (current) => ({
      ...current,
      repository_bindings: [...current.repository_bindings, fixture.repository],
      work_bindings: [...current.work_bindings, fixture.work],
      subject_bindings: [...current.subject_bindings, fixture.subject],
    }),
  };
}

function sortedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, nested]) => [key, sortedValue(nested)]));
}

function canonicalSnapshotBytes(snapshot: AuthorityRegistrySnapshot): Buffer {
  return Buffer.from(`${JSON.stringify(sortedValue(snapshot), null, 2)}\n`, 'utf8');
}

test('T005: current target filesystem completes the candidate lock/sync/replace/directory-sync/readback barrier', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-registry-barrier-');
  try {
    const targetPath = join(root, 'registry.json');
    await writeFile(targetPath, JSON.stringify({ schema_version: 1, candidate: 'old' }), 'utf8');
    const outcome = await candidateBarrier(targetPath);
    assert.equal(outcome.success, true,
      `G0 ENTRY storage feasibility failed on ${process.platform} at ${outcome.stage}: ${outcome.code ?? ''} ${outcome.error ?? ''}`);
    assert.equal(await readFile(targetPath, 'utf8'), JSON.stringify({ schema_version: 1, candidate: 'snapshot' }));
  } finally {
    await removeTestRepository(root);
  }
});

test('T005: on Windows a read-only directory handle fails fsync while a write-capable handle succeeds', async (context) => {
  if (process.platform !== 'win32') {
    context.skip('Windows handle-access behavior is platform-specific; POSIX uses the read-only directory handle.');
    return;
  }

  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-directory-sync-mode-');
  let readOnlyHandle: FileHandle | undefined;
  let writableHandle: FileHandle | undefined;
  try {
    readOnlyHandle = await open(root, 'r');
    await assert.rejects(readOnlyHandle.sync(), (error: unknown) =>
      (error as NodeJS.ErrnoException).code === 'EPERM',
      'a read-only Windows directory handle must expose the observed EPERM rather than masking it');
    await readOnlyHandle.close();
    readOnlyHandle = undefined;

    writableHandle = await open(root, 'r+');
    await writableHandle.sync();
  } finally {
    await Promise.all([
      readOnlyHandle?.close().catch(() => undefined),
      writableHandle?.close().catch(() => undefined),
    ]);
    await removeTestRepository(root);
  }
});

test('T005: an exclusive lock held by this process prevents a competing Node process from acquiring it', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-registry-lock-');
  let owner: FileHandle | undefined;
  try {
    const lockPath = join(root, 'registry.lock');
    owner = await open(lockPath, 'wx', 0o600);
    await owner.writeFile(JSON.stringify({ pid: process.pid, token: randomUUID() }));
    await owner.sync();

    const script = [
      'const fs = require("node:fs");',
      'try { const fd = fs.openSync(process.argv.at(-1), "wx"); fs.closeSync(fd); process.exit(2); }',
      'catch (error) { process.exit(error.code === "EEXIST" ? 0 : 3); }',
    ].join(' ');
    const contender = spawnSync(process.execPath, ['-e', script, lockPath], { encoding: 'utf8' });
    assert.equal(contender.status, 0, contender.stderr);
  } finally {
    await owner?.close();
    await removeTestRepository(root);
  }
});

test('T005: injected barrier failures at each phase never return a successful persistence result', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-registry-faults-');
  try {
    const stages: readonly BarrierStage[] = [
      'lock', 'temporary-write', 'file-sync', 'replace', 'directory-sync', 'readback',
    ];
    for (const stage of stages) {
      const targetPath = join(root, `registry-${stage}.json`);
      await writeFile(targetPath, JSON.stringify({ schema_version: 1, candidate: 'old' }), 'utf8');
      const outcome = await candidateBarrier(targetPath, {
        failAt: stage,
        // The real filesystem probe above exercises directory sync. This
        // injection-only no-op lets later barriers be fault-tested on hosts
        // where the actual directory fsync is unavailable.
        syncDirectory: async () => undefined,
      });
      assert.equal(outcome.success, false, stage);
      assert.equal(outcome.stage, stage, stage);
      assert.match(outcome.error ?? '', /injected T005 failure/, stage);
    }
  } finally {
    await removeTestRepository(root);
  }
});

test('T010: inspection is byte-for-byte read-only and binding plus audit share one durable snapshot', async () => {
  const fixture = await registryFixture('cb-authority-registry-atomic-');
  try {
    const missing = join(fixture.root, 'not-created', 'registry-v1.json');
    const empty = await inspectAuthorityRegistry(missing);
    assert.equal(empty.revision, 0);
    assert.deepEqual((await readdir(fixture.root)).sort(), ['repo', 'user-local-registry']);

    const committed = await transactAuthorityRegistry(fixture.file, addInitialBindings(fixture));
    assert.equal(committed.revision, 1);
    assert.equal(committed.repository_bindings.length, 1);
    assert.equal(committed.work_bindings.length, 1);
    assert.equal(committed.subject_bindings.length, 1);
    assert.equal(committed.audit.length, 1);
    assert.equal(committed.audit[0]?.revision, committed.revision);
    assert.equal(committed.audit[0]?.kind, 'BINDINGS');
    assert.deepEqual(committed.audit[0]?.target_ids, [
      fixture.repository.repository_reference_id,
      fixture.work.work_id,
      fixture.subject.subject_id,
    ].sort());

    const beforeInspect = await readFile(fixture.file);
    const inspected = await inspectAuthorityRegistry(fixture.file);
    assert.deepEqual(inspected, committed);
    assert.deepEqual(await readFile(fixture.file), beforeInspect,
      'inspection does not rewrite, repair, migrate, or append audit');
    assert.notEqual(inspected.repository_bindings[0]?.repository_reference_id,
      inspected.repository_bindings[0]?.physical_identity.file_id,
      'the public locator is distinct from physical identity and is not identity proof');
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('T010: a new repository/work/subject binding and lifecycle storage row can share one snapshot transaction', async () => {
  const fixture = await registryFixture('cb-authority-registry-combined-');
  try {
    const lifecycle: RegistryLifecycleRecord = {
      grant_id: randomUUID(),
      lifecycle: 'ACTIVE',
      terminal_event_id: null,
      updated_at: new Date().toISOString(),
    };
    const committed = await transactAuthorityRegistry(fixture.file, {
      kind: 'BINDINGS_AND_LIFECYCLE_STORAGE',
      target_ids: [
        fixture.repository.repository_reference_id,
        fixture.work.work_id,
        fixture.subject.subject_id,
        lifecycle.grant_id,
      ],
      apply: (current) => ({
        ...current,
        repository_bindings: [...current.repository_bindings, fixture.repository],
        work_bindings: [...current.work_bindings, fixture.work],
        subject_bindings: [...current.subject_bindings, fixture.subject],
        grant_lifecycle: [...current.grant_lifecycle, lifecycle],
      }),
    });
    assert.equal(committed.revision, 1);
    assert.equal(committed.audit.length, 1);
    assert.equal(committed.repository_bindings.length, 1);
    assert.equal(committed.work_bindings.length, 1);
    assert.equal(committed.subject_bindings.length, 1);
    assert.equal(committed.grant_lifecycle.length, 1);
    assert.equal(committed.audit[0]?.kind, 'BINDINGS_AND_LIFECYCLE_STORAGE');
    assert.deepEqual(committed.audit[0]?.target_ids, [
      fixture.repository.repository_reference_id,
      fixture.work.work_id,
      fixture.subject.subject_id,
      lifecycle.grant_id,
    ].sort());
    assert.deepEqual(await inspectAuthorityRegistry(fixture.file), committed);
    // This storage composition test does not create a grant body or implement issuance.
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('T010: unknown versions, duplicate JSON keys, unknown fields, and duplicate IDs reject without repair', async () => {
  const fixture = await registryFixture('cb-authority-registry-strict-');
  try {
    const valid = await transactAuthorityRegistry(fixture.file, addInitialBindings(fixture));
    const duplicateRepository: typeof fixture.repository = { ...fixture.repository };
    await assert.rejects(transactAuthorityRegistry(fixture.file, {
      kind: 'BINDINGS',
      target_ids: [fixture.repository.repository_reference_id],
      apply: (current) => ({
        ...current,
        repository_bindings: [...current.repository_bindings, duplicateRepository],
      }),
    }), (error: unknown) => error instanceof AuthorityRegistryError && error.code === 'CORRUPT');
    assert.deepEqual(await inspectAuthorityRegistry(fixture.file), valid,
      'duplicate-ID mutation is rejected without repairing or replacing the existing snapshot');

    const unknownVersion = {
      ...createEmptyAuthorityRegistrySnapshot(),
      schema_version: 99,
    };
    await writeFile(fixture.file, `${JSON.stringify(unknownVersion, null, 2)}\n`, 'utf8');
    const beforeUnknownVersion = await readFile(fixture.file);
    await assert.rejects(inspectAuthorityRegistry(fixture.file), (error: unknown) =>
      error instanceof AuthorityRegistryError && error.code === 'UNSUPPORTED_VERSION');
    assert.deepEqual(await readFile(fixture.file), beforeUnknownVersion);

    const versionOne = '{"schema_version":1,"revision":0,"repository_bindings":[],"work_bindings":[],"subject_bindings":[],"grant_lifecycle":[],"audit":[]}\n';
    await writeFile(fixture.file, versionOne, 'utf8');
    const beforeVersionOne = await readFile(fixture.file);
    await assert.rejects(inspectAuthorityRegistry(fixture.file), (error: unknown) =>
      error instanceof AuthorityRegistryError && error.code === 'UNSUPPORTED_VERSION');
    assert.deepEqual(await readFile(fixture.file), beforeVersionOne, 'schema v1 is rejected without migration or byte changes');

    const duplicateKey = '{"schema_version":2,"schema_version":2,"revision":0,"repository_bindings":[],"work_bindings":[],"subject_bindings":[],"grants":[],"grant_lifecycle":[],"audit":[]}\n';
    await writeFile(fixture.file, duplicateKey, 'utf8');
    const beforeDuplicate = await readFile(fixture.file);
    await assert.rejects(inspectAuthorityRegistry(fixture.file), (error: unknown) =>
      error instanceof AuthorityRegistryError && error.code === 'CORRUPT');
    assert.deepEqual(await readFile(fixture.file), beforeDuplicate);

    await writeFile(fixture.file, `${JSON.stringify({
      ...createEmptyAuthorityRegistrySnapshot(),
      unexpected_authority_field: 'must reject',
    }, null, 2)}\n`, 'utf8');
    await assert.rejects(inspectAuthorityRegistry(fixture.file), (error: unknown) =>
      error instanceof AuthorityRegistryError && error.code === 'CORRUPT');

  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('T010: seeded terminal lifecycle records and audit are append-only across restart-like reads', async () => {
  const fixture = await registryFixture('cb-authority-registry-terminal-');
  try {
    await transactAuthorityRegistry(fixture.file, addInitialBindings(fixture));
    const grantId = randomUUID();
    const terminal = await transactAuthorityRegistry(fixture.file, {
      kind: 'LIFECYCLE_RECORDS',
      target_ids: [grantId],
      apply: (current, context) => ({
        ...current,
        grant_lifecycle: [...current.grant_lifecycle, {
          grant_id: grantId,
          lifecycle: 'CONSUMED',
          terminal_event_id: context.event_id,
          updated_at: context.recorded_at,
        } satisfies RegistryLifecycleRecord],
      }),
    });
    assert.equal(terminal.audit.length, 2);
    assert.equal(terminal.grant_lifecycle[0]?.lifecycle, 'CONSUMED');
    const persistedBytes = await readFile(fixture.file);
    assert.deepEqual(await inspectAuthorityRegistry(fixture.file), terminal);
    assert.deepEqual(await readFile(fixture.file), persistedBytes);

    const activeAgain: RegistryLifecycleRecord = {
      grant_id: grantId,
      lifecycle: 'ACTIVE',
      terminal_event_id: null,
      updated_at: new Date().toISOString(),
    };
    await assert.rejects(transactAuthorityRegistry(fixture.file, {
      kind: 'LIFECYCLE_RECORDS',
      target_ids: [grantId],
      apply: (current) => ({
        ...current,
        grant_lifecycle: current.grant_lifecycle.map((item) =>
          item.grant_id === grantId ? activeAgain : item),
      }),
    }), (error: unknown) => error instanceof AuthorityRegistryError && error.code === 'CORRUPT');
    const afterRejectedResurrection = await inspectAuthorityRegistry(fixture.file);
    assert.equal(afterRejectedResurrection.grant_lifecycle[0]?.lifecycle, 'CONSUMED');
    assert.deepEqual(afterRejectedResurrection.audit, terminal.audit);
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('T010: partial writes and every failed barrier stage never report success or roll back visible committed state', async () => {
  const cases = [
    'before-temp-create',
    'partial-write',
    'file-sync',
    'replace',
    'directory-sync',
    'readback',
  ] as const;
  for (const failure of cases) {
    const fixture = await registryFixture(`cb-authority-registry-fault-${failure}-`);
    try {
      const old = await transactAuthorityRegistry(fixture.file, addInitialBindings(fixture));
      const nextWork = {
        ...fixture.work,
        work_id: randomUUID(),
        work_activation_id: randomUUID(),
      };
      const mutation: RegistryMutation = {
        kind: 'BINDINGS',
        target_ids: [nextWork.work_id],
        apply: (current) => ({
          ...current,
          work_bindings: [...current.work_bindings, nextWork],
        }),
      };
      let directorySyncCalls = 0;
      const options = {
        hooks: {
          onStage: async (stage: string) => {
            if (failure === 'before-temp-create' && stage === 'before-temp-create') {
              throw new Error('injected before temp creation');
            }
          },
          ...(failure === 'partial-write' ? {
            writeTemporary: async (handle: FileHandle, bytes: Buffer) => {
              await handle.writeFile(bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 3))));
              throw new Error('injected after actual partial temp write');
            },
          } : {}),
          ...(failure === 'file-sync' ? {
            syncFile: async () => { throw new Error('injected file sync failure'); },
          } : {}),
          ...(failure === 'replace' ? {
            replace: async () => { throw new Error('injected atomic replace failure'); },
          } : {}),
          ...(failure === 'directory-sync' ? {
            syncDirectory: async (directory: string) => {
              directorySyncCalls += 1;
              if (directorySyncCalls === 1) {
                const { open: openDirectory } = await import('node:fs/promises');
                const handle = await openDirectory(directory, process.platform === 'win32' ? 'r+' : 'r');
                try { await handle.sync(); } finally { await handle.close(); }
                return;
              }
              throw new Error('injected parent-directory sync failure after replace');
            },
          } : {}),
          ...(failure === 'readback' ? {
            readback: async () => { throw new Error('injected readback failure'); },
          } : {}),
        },
      };

      await assert.rejects(transactAuthorityRegistry(fixture.file, mutation, options),
        `must fail at ${failure}, never return success`);
      const observed = await inspectAuthorityRegistry(fixture.file);
      const committedBeforeFailure = failure === 'directory-sync' || failure === 'readback';
      assert.equal(observed.revision, committedBeforeFailure ? old.revision + 1 : old.revision, failure);
      assert.equal(observed.work_bindings.some((binding) => binding.work_id === nextWork.work_id), committedBeforeFailure,
        `${failure}: inspect observes exactly the current atomic snapshot; no rollback or success is inferred`);
      if (committedBeforeFailure || failure === 'replace') {
        await assert.rejects(transactAuthorityRegistry(fixture.file, mutation), (error: unknown) =>
          error instanceof AuthorityRegistryError && error.code === 'LOCK_BUSY');
      }
    } finally {
      await removeTestRepository(fixture.root);
    }
  }
});

test('T018: bounded registry/audit byte capacity rejects a use-sized append without changing the prior snapshot', async () => {
  const fixture = await registryFixture('cb-authority-g4-audit-capacity-');
  try {
    const initial = await transactAuthorityRegistry(fixture.file, addInitialBindings(fixture));
    const auditRows = Array.from({ length: 13_000 }, (_, index) => ({
      event_id: randomUUID(),
      revision: index + 1,
      kind: 'BINDINGS' as const,
      event_type: 'BINDINGS_COMMITTED' as const,
      grant_id: null,
      grant_digest: null,
      target_ids: [fixture.repository.repository_reference_id],
      recorded_at: '2026-10-19T00:00:00.000Z',
    }));
    const maxBytes = 4 * 1024 * 1024;
    let low = 0;
    let high = auditRows.length;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      const candidate = { ...initial, revision: middle, audit: auditRows.slice(0, middle) };
      if (canonicalSnapshotBytes(candidate).length <= maxBytes) low = middle;
      else high = middle - 1;
    }
    assert.ok(low > 10_000 && low < 20_000, `test fixture reaches the bounded serialized snapshot limit: rows=${low}`);

    const prior = { ...initial, revision: low, audit: auditRows.slice(0, low) };
    const priorBytes = canonicalSnapshotBytes(prior);
    await writeFile(fixture.file, priorBytes);
    const inspected = await inspectAuthorityRegistry(fixture.file);
    assert.equal(inspected.revision, low);
    assert.deepEqual(await readFile(fixture.file), priorBytes, 'the near-cap canonical snapshot is readable without rewriting');

    const nextWork = {
      ...fixture.work,
      work_id: randomUUID(),
      authority_id: randomUUID(),
      work_activation_id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    const next = {
      ...prior,
      work_bindings: [...prior.work_bindings, nextWork],
      revision: low + 1,
      audit: [...prior.audit, {
        event_id: randomUUID(),
        revision: low + 1,
        kind: 'BINDINGS' as const,
        event_type: 'BINDINGS_COMMITTED' as const,
        grant_id: null,
        grant_digest: null,
        target_ids: [nextWork.work_id],
        recorded_at: new Date().toISOString(),
      }],
    };
    assert.ok(canonicalSnapshotBytes(next).length > maxBytes, 'the next bounded transaction would exceed the existing byte limit');
    await assert.rejects(transactAuthorityRegistry(fixture.file, {
      kind: 'BINDINGS',
      target_ids: [nextWork.work_id],
      apply: (current) => ({ ...current, work_bindings: [...current.work_bindings, nextWork] }),
    }), (error: unknown) => error instanceof AuthorityRegistryError && error.code === 'CORRUPT');
    assert.deepEqual(await readFile(fixture.file), priorBytes, 'audit-capacity failure leaves no partial registry or evidence');
  } finally {
    await removeTestRepository(fixture.root);
  }
});
