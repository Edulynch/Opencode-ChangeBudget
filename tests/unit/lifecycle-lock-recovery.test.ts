import * as assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { removeTestRepository } from '../utils/disposable-repository.js';
import { runRecover } from '../../src/cli/commands/recover.js';
import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import {
  acquireLifecycleStateLock,
  getLifecycleLockPath,
  getLifecycleLockRecoveryAuditPath,
  readLifecycleLockRecoveryAudit,
  recoverLifecycleLock,
  setLifecycleLockRecoveryTestHooks,
} from '../../src/core/state/lifecycle-lock-recovery.js';
import {
  getBaselineEvidencePath,
  getStateFilePath,
  readLifecycleState,
  setLifecycleAuditTestHooks,
} from '../../src/core/state/state.js';
import { StateConflictError } from '../../src/models/errors.js';

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-lock-recovery-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'lock recovery test']);
  git(root, ['config', 'user.email', 'lock-recovery@test']);
  git(root, ['commit', '--allow-empty', '-m', 'seed']);
  return root;
}

async function waitForReady(child: ReturnType<typeof spawn>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('lock owner did not complete its ready handshake')), 10_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
      if (output.includes('READY\n')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      if (!output.includes('READY\n')) {
        clearTimeout(timeout);
        reject(new Error(`lock owner exited before ready (code=${code}, signal=${signal})`));
      }
    });
  });
}

function runCompiledCli(root: string, command: string, args: string[] = []) {
  const result = spawnSync(process.execPath, [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), command, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('recover lifecycle-lock enforces exact grammar and writes durable pre-init NOOP evidence', async () => {
  const root = await repository();
  try {
    await assert.rejects(
      () => runRecover(root, ['lifecycle-lock', '--reason', '   ']),
      (error: unknown) => error instanceof Error && error.message.includes('non-empty'),
    );
    await assert.rejects(() => runRecover(root, ['lifecycle-lock', '--reason', 'reason', '--unknown']));
    await assert.rejects(() => runRecover(root, ['lifecycle-lock', '--reason', 'reason', '--force']));
    await assert.rejects(() => runRecover(root, ['lifecycle-lock', '--force', '--reason', '   ']));
    await assert.rejects(() => runRecover(root, ['lifecycle-lock', '--reason', 'duplicate', '--reason', 'reason']));
    await assert.rejects(() => runRecover(root, ['lifecycle-lock', '--force', '--reason', 'reason', '--force']));
    await assert.rejects(() => runRecover(root, ['other', '--reason', 'reason']));

    const first = await runRecover(root, ['lifecycle-lock', '--reason', 'operator requested a safe check']);
    assert.equal(first.outcome, 'NOOP');
    assert.equal(first.classification, 'ABSENT');
    assert.equal(await readLifecycleState(root), null, 'recovery does not initialize lifecycle state');

    const restartedRead = await readLifecycleLockRecoveryAudit(root);
    assert.equal(restartedRead.length, 1);
    assert.equal(restartedRead[0]?.operation, 'lifecycle_lock_recovery');
    assert.equal(restartedRead[0]?.reason, 'operator requested a safe check');
    assert.equal(restartedRead[0]?.force, false);
    assert.equal(restartedRead[0]?.observed.classification, 'ABSENT');
    assert.equal(restartedRead[0]?.outcome, 'NOOP');
    assert.equal('authority' in (restartedRead[0] ?? {}), false);
    assert.equal('grant' in (restartedRead[0] ?? {}), false);
    const forcedNoop = await runRecover(root, ['lifecycle-lock', '--force', '--reason', 'operator force no-op']);
    assert.equal(forcedNoop.outcome, 'NOOP');
    assert.equal((await runRecover(root, ['lifecycle-lock', '--reason', 'second operator check'])).outcome, 'NOOP');
    assert.equal((await readLifecycleLockRecoveryAudit(root)).length, 3);
    assert.equal(getLifecycleLockRecoveryAuditPath(root).endsWith('lifecycle-lock-recovery.json'), true);
  } finally {
    await removeTestRepository(root);
  }
});

test('LIVE owner is BUSY and operator recovery refuses it with or without --force', async () => {
  const root = await repository();
  const release = await acquireLifecycleStateLock(root);
  try {
    const observation = await import('../../src/core/state/lifecycle-lock-recovery.js')
      .then(({ inspectLifecycleLock }) => inspectLifecycleLock(root));
    assert.equal(observation.classification, 'LIVE');
    assert.equal(observation.owner_metadata?.pid, process.pid);

    await assert.rejects(() => runInit(root), (error: unknown) => (
      error instanceof StateConflictError && error.message.includes('busy')
    ));
    for (const force of [false, true]) {
      const result = await recoverLifecycleLock(root, { reason: `live owner refusal ${force}`, force }, async () => {
        assert.fail('must not reconcile or remove a live lock');
      });
      assert.equal(result.outcome, 'REFUSED');
      assert.equal(result.classification, 'LIVE');
      assert.equal(result.pendingAuditReconciliation, 'not_required');
      assert.equal(await stat(getLifecycleLockPath(root)).then(() => true), true);
    }
    const refusals = await readLifecycleLockRecoveryAudit(root);
    assert.deepEqual(refusals.map((entry) => [entry.observed.classification, entry.outcome]), [
      ['LIVE', 'REFUSED'],
      ['LIVE', 'REFUSED'],
    ]);
  } finally {
    await release();
    await removeTestRepository(root);
  }
});

test('MALFORMED and UNVERIFIABLE locks require --force; force removes only the exact lock file', async () => {
  const root = await repository();
  try {
    await mkdir(join(root, '.changebudget'));
    const lockPath = getLifecycleLockPath(root);
    await writeFile(lockPath, '{malformed owner metadata', 'utf8');
    const normal = await recoverLifecycleLock(root, { reason: 'inspect malformed lock', force: false }, async () => undefined);
    assert.equal(normal.outcome, 'REFUSED');
    assert.equal(normal.classification, 'MALFORMED');
    assert.equal((await readFile(lockPath, 'utf8')).startsWith('{malformed'), true);

    const forced = await recoverLifecycleLock(root, { reason: 'operator confirms quiescence', force: true }, async () => undefined);
    assert.equal(forced.outcome, 'RECOVERED');
    assert.equal(forced.classification, 'MALFORMED');
    await assert.rejects(() => readFile(lockPath, 'utf8'), { code: 'ENOENT' });

    await writeFile(lockPath, JSON.stringify({
      lock_schema_version: 1,
      pid: 92345678,
      token: 'unverifiable-owner-token',
      acquired_at: '2026-01-01T00:00:00.000Z',
    }), 'utf8');
    const restoreProbe = setLifecycleLockRecoveryTestHooks({ probeProcess: () => 'UNVERIFIABLE' });
    try {
      const uncertain = await recoverLifecycleLock(root, { reason: 'unknown process probe', force: false }, async () => undefined);
      assert.equal(uncertain.outcome, 'REFUSED');
      assert.equal(uncertain.classification, 'UNVERIFIABLE');
      const forcedUnknown = await recoverLifecycleLock(root, { reason: 'operator confirms quiescence after unknown probe', force: true }, async () => undefined);
      assert.equal(forcedUnknown.outcome, 'RECOVERED');
      assert.equal(forcedUnknown.classification, 'UNVERIFIABLE');
    } finally {
      restoreProbe();
    }
    assert.equal((await readLifecycleLockRecoveryAudit(root)).map((entry) => entry.outcome).join(','), 'REFUSED,RECOVERED,REFUSED,RECOVERED');
  } finally {
    await removeTestRepository(root);
  }
});

test('a write-ahead recovery audit failure prevents removal of a dead lock', async () => {
  const root = await repository();
  try {
    await mkdir(join(root, '.changebudget'));
    const lockPath = getLifecycleLockPath(root);
    await writeFile(lockPath, JSON.stringify({
      lock_schema_version: 1,
      pid: 92345679,
      token: 'dead-owner-token',
      acquired_at: '2026-01-01T00:00:00.000Z',
    }), 'utf8');
    const restore = setLifecycleLockRecoveryTestHooks({
      probeProcess: () => 'DEAD',
      beforeAuditWrite: async (record) => {
        if (record.outcome === 'PENDING') throw new Error('injected recovery audit barrier failure');
      },
    });
    try {
      await assert.rejects(
        () => recoverLifecycleLock(root, { reason: 'audit must precede removal', force: false }, async () => undefined),
        /injected recovery audit barrier failure/,
      );
    } finally {
      restore();
    }
    assert.equal((await readFile(lockPath, 'utf8')).includes('dead-owner-token'), true);
    assert.equal(await readLifecycleLockRecoveryAudit(root).then((records) => records.length), 0);
  } finally {
    await removeTestRepository(root);
  }
});

test('final identity and liveness re-read prevents stale or newly-live lock unlink', async () => {
  const root = await repository();
  try {
    await mkdir(join(root, '.changebudget'));
    const lockPath = getLifecycleLockPath(root);
    const original = {
      lock_schema_version: 1,
      pid: 92345682,
      token: 'dead-then-live-owner-token',
      acquired_at: '2026-01-01T00:00:00.000Z',
    };
    await writeFile(lockPath, JSON.stringify(original), 'utf8');
    let probes = 0;
    const restoreLiveProbe = setLifecycleLockRecoveryTestHooks({
      probeProcess: () => (++probes === 1 ? 'DEAD' : 'LIVE'),
    });
    try {
      const nowLive = await recoverLifecycleLock(root, { reason: 'owner became live before unlink', force: false }, async () => undefined);
      assert.equal(nowLive.outcome, 'REFUSED');
      assert.equal(await readFile(lockPath, 'utf8'), JSON.stringify(original));
    } finally {
      restoreLiveProbe();
    }

    let replacement = '';
    const restoreIdentityChange = setLifecycleLockRecoveryTestHooks({
      probeProcess: () => 'DEAD',
      beforeAuditWrite: async (record) => {
        if (record.outcome === 'PENDING') {
          const changedOwner = { ...original, token: 'replacement-owner-token' };
          replacement = JSON.stringify(changedOwner);
          await writeFile(lockPath, replacement, 'utf8');
        }
      },
    });
    try {
      const changed = await recoverLifecycleLock(root, { reason: 'lock identity changed before unlink', force: false }, async () => undefined);
      assert.equal(changed.outcome, 'REFUSED');
      assert.equal(await readFile(lockPath, 'utf8'), replacement);
    } finally {
      restoreIdentityChange();
    }
    assert.deepEqual((await readLifecycleLockRecoveryAudit(root)).map((entry) => entry.outcome), ['REFUSED', 'REFUSED']);
  } finally {
    await removeTestRepository(root);
  }
});

test('a path anomaly is never force-removed and no neighboring contract is cleaned', async () => {
  const root = await repository();
  try {
    await mkdir(join(root, '.changebudget', 'contracts'), { recursive: true });
    const retainedContract = join(root, '.changebudget', 'contracts', 'keep.json');
    await writeFile(retainedContract, '{"retained":true}', 'utf8');
    const lockPath = getLifecycleLockPath(root);
    await mkdir(lockPath);

    const result = await recoverLifecycleLock(root, { reason: 'refuse lock path anomaly', force: true }, async () => undefined);
    assert.equal(result.outcome, 'REFUSED');
    assert.equal(result.classification, 'MALFORMED');
    assert.equal(await stat(lockPath).then((entry) => entry.isDirectory()), true);
    assert.equal(await readFile(retainedContract, 'utf8'), '{"retained":true}');
  } finally {
    await removeTestRepository(root);
  }
});

test('owner-token change prevents normal lock cleanup from unlinking a replacement', async () => {
  const root = await repository();
  try {
    const release = await acquireLifecycleStateLock(root);
    const lockPath = getLifecycleLockPath(root);
    const replacement = {
      lock_schema_version: 1,
      pid: process.pid,
      token: 'replacement-token-from-another-owner',
      acquired_at: '2026-01-01T00:00:00.000Z',
    };
    await writeFile(lockPath, `${JSON.stringify(replacement)}\n`, 'utf8');
    await assert.rejects(() => release(), /owner|identity changed/);
    assert.equal((await readFile(lockPath, 'utf8')).includes(replacement.token), true);
  } finally {
    await removeTestRepository(root);
  }
});

test('valid dead owner is re-read, recovered, and reconciles pending lifecycle audits', async () => {
  const root = await repository();
  try {
    const restoreLifecycleAudit = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'init' && record.outcome.status === 'committed') {
          throw new Error('injected INIT completion audit failure');
        }
      },
    });
    try {
      await assert.rejects(() => runInit(root), /injected INIT completion audit failure/);
    } finally {
      restoreLifecycleAudit();
    }
    assert.equal((await readLifecycleState(root))?.audit_history?.[0]?.outcome.status, 'pending');

    const lockPath = getLifecycleLockPath(root);
    await writeFile(lockPath, JSON.stringify({
      lock_schema_version: 1,
      pid: 92345680,
      token: 'dead-owner-for-init-reconcile',
      acquired_at: '2026-01-01T00:00:00.000Z',
    }), 'utf8');
    const restoreProbe = setLifecycleLockRecoveryTestHooks({ probeProcess: () => 'DEAD' });
    try {
      const recovered = await runRecover(root, ['lifecycle-lock', '--reason', 'recover dead init writer']);
      assert.equal(recovered.outcome, 'RECOVERED');
      assert.equal(recovered.classification, 'DEAD');
      assert.equal(recovered.pendingAuditReconciliation, 'completed');
    } finally {
      restoreProbe();
    }
    const state = await readLifecycleState(root);
    assert.equal(state?.audit_history?.[0]?.outcome.status, 'reconciled');
    const record = (await readLifecycleLockRecoveryAudit(root)).at(-1);
    assert.equal(record?.outcome, 'RECOVERED');
    assert.equal(record?.pending_audit_reconciliation, 'completed');
  } finally {
    await removeTestRepository(root);
  }
});

test('contradictory pending lifecycle evidence is reported after removal without a fabricated completion', async () => {
  const root = await repository();
  try {
    await runInit(root);
    const started = await runStart(root, ['--task', 'contradictory pending audit', '--base-revision', 'HEAD']);
    const statePath = getStateFilePath(root);
    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      audit_history: Array<{ operation: string; outcome: { status: string; confirmation: string } }>;
    };
    const startAudit = state.audit_history.find((entry) => entry.operation === 'start');
    assert.ok(startAudit);
    startAudit.outcome = { status: 'pending', confirmation: 'operation_outcome_uncertain' };
    await writeFile(statePath, JSON.stringify(state), 'utf8');
    await rm(getBaselineEvidencePath(root, started.contractId), { force: true });

    const lockPath = getLifecycleLockPath(root);
    await writeFile(lockPath, JSON.stringify({
      lock_schema_version: 1,
      pid: 92345681,
      token: 'dead-owner-with-contradictory-pending-audit',
      acquired_at: '2026-01-01T00:00:00.000Z',
    }), 'utf8');
    const restoreProbe = setLifecycleLockRecoveryTestHooks({ probeProcess: () => 'DEAD' });
    try {
      await assert.rejects(
        () => runRecover(root, ['lifecycle-lock', '--reason', 'recover lock then inspect pending evidence']),
        (error: unknown) => error instanceof StateConflictError && error.message.includes('reconciliation failed'),
      );
    } finally {
      restoreProbe();
    }

    await assert.rejects(() => readFile(lockPath, 'utf8'), { code: 'ENOENT' });
    const recoveredAudit = (await readLifecycleLockRecoveryAudit(root)).at(-1);
    assert.equal(recoveredAudit?.outcome, 'RECOVERED');
    assert.equal(recoveredAudit?.pending_audit_reconciliation, 'failed');
    assert.match(recoveredAudit?.reconciliation_error ?? '', /uncertain outcome/);
    const after = await readLifecycleState(root);
    assert.equal(after?.audit_history?.find((entry) => entry.operation === 'start')?.outcome.status, 'pending');
  } finally {
    await removeTestRepository(root);
  }
});

test('a dead subprocess lock requires explicit operator recovery before INIT and START', async () => {
  const root = await repository();
  let owner: ReturnType<typeof spawn> | undefined;
  try {
    const moduleUrl = pathToFileURL(join(process.cwd(), 'dist', 'src', 'core', 'state', 'lifecycle-lock-recovery.js')).href;
    const script = `import { acquireLifecycleStateLock } from ${JSON.stringify(moduleUrl)};\n`
      + `await acquireLifecycleStateLock(${JSON.stringify(root)});\n`
      + `process.stdout.write('READY\\n');\n`
      + `setInterval(() => undefined, 1000);\n`;
    owner = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await waitForReady(owner);
    assert.equal(owner.kill('SIGTERM'), true);
    await new Promise<void>((resolve, reject) => {
      owner!.once('exit', () => resolve());
      owner!.once('error', reject);
    });

    const initBlocked = runCompiledCli(root, 'init');
    assert.equal(initBlocked.status, 3);
    assert.match(initBlocked.stderr, /recovery is required/);
    assert.equal((await readFile(getLifecycleLockPath(root), 'utf8')).includes('"pid"'), true);

    const recovery = runCompiledCli(root, 'recover', [
      'lifecycle-lock', '--reason', 'recover abandoned subprocess writer',
    ]);
    assert.equal(recovery.status, 0, recovery.stderr);
    assert.match(recovery.stdout, /outcome: RECOVERED/);
    assert.equal(runCompiledCli(root, 'init').status, 0);
    const start = runCompiledCli(root, 'start', ['--task', 'continue after recovery', '--base-revision', 'HEAD']);
    assert.equal(start.status, 0, start.stderr);
  } finally {
    if (owner && owner.exitCode === null && owner.signalCode === null) owner.kill('SIGTERM');
    await removeTestRepository(root);
  }
});

test('compiled CLI records no-lock NOOP and rejects malformed recovery syntax', async () => {
  const root = await repository();
  try {
    const missingReason = runCompiledCli(root, 'recover', ['lifecycle-lock']);
    assert.equal(missingReason.status, 2);
    assert.match(missingReason.stderr, /Usage:/);
    assert.equal(await stat(join(root, '.changebudget')).then(() => true).catch(() => false), false);

    const noop = runCompiledCli(root, 'recover', ['lifecycle-lock', '--reason', 'operator confirms no lock']);
    assert.equal(noop.status, 0, noop.stderr);
    assert.match(noop.stdout, /outcome: NOOP/);
    assert.equal((await readLifecycleLockRecoveryAudit(root)).length, 1);

    const lockPath = getLifecycleLockPath(root);
    await writeFile(lockPath, 'malformed by test fixture', 'utf8');
    const refused = runCompiledCli(root, 'recover', [
      'lifecycle-lock', '--reason', 'normal recovery must refuse malformed metadata',
    ]);
    assert.equal(refused.status, 3);
    assert.match(refused.stderr, /recovery refused/);
    assert.equal(await readFile(lockPath, 'utf8'), 'malformed by test fixture');

    const forced = runCompiledCli(root, 'recover', [
      'lifecycle-lock', '--force', '--reason', 'operator confirms quiescence for malformed lock',
    ]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.match(forced.stdout, /outcome: RECOVERED/);
    const records = await readLifecycleLockRecoveryAudit(root);
    assert.deepEqual(records.map((record) => [record.outcome, record.force, record.observed.classification]), [
      ['NOOP', false, 'ABSENT'],
      ['REFUSED', false, 'MALFORMED'],
      ['RECOVERED', true, 'MALFORMED'],
    ]);
  } finally {
    await removeTestRepository(root);
  }
});
