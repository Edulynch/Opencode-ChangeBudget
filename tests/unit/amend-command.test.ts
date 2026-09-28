import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { removeTestRepository } from '../utils/disposable-repository.js';

import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runAmend } from '../../src/cli/commands/amend.js';
import { runClose } from '../../src/cli/commands/close.js';
import { readContract } from '../../src/core/state/contracts.js';
import {
  getBaselineEvidencePath,
  getContractFilePath,
  getStateFilePath,
  readLifecycleState,
  setLifecycleAuditTestHooks,
} from '../../src/core/state/state.js';
import { InputValidationError, StateConflictError, StateCorruptionError } from '../../src/models/errors.js';

function runGit(root: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function bounded<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 10_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function createActiveContract(): Promise<{ readonly root: string; readonly contractId: string }> {
  const root = await mkdtemp(join(tmpdir(), 'cb-amend-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'amend test']);
  runGit(root, ['config', 'user.email', 'amend@test']);
  runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
  await runInit(root);
  const started = await runStart(root, [
    '--task', 'amend budget',
    '--base-revision', 'HEAD',
    '--max-files', '2',
    '--max-changed-lines', '20',
  ]);
  return { root, contractId: started.contractId };
}

test('runAmend records only effective mixed changes and preserves state and baseline evidence', async () => {
  const fixture = await createActiveContract();
  try {
    // Given an active contract with numeric limits and captured lifecycle artifacts
    const before = await readContract(fixture.root, fixture.contractId);
    const baselineBefore = await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8');

    // When one requested limit is unchanged and the other changes
    const first = await runAmend(fixture.root, [
      '--max-files', '2',
      '--max-changed-lines=40',
      '--reason', 'Tests require two more files',
    ]);

    // Then only the effective limit appears in the first audit entry
    assert.equal(first.contract.max_files, 2);
    assert.equal(first.contract.max_changed_lines, 40);
    const firstAmendments = first.contract.budget_amendments ?? [];
    assert.deepEqual(firstAmendments, [{
      sequence: 1,
      contract_id: fixture.contractId,
      amended_at: first.contract.updated_at,
      reason: 'Tests require two more files',
      changes: { max_changed_lines: { before: 20, after: 40 } },
    }]);
    const auditedState = await readLifecycleState(fixture.root);
    assert.equal(auditedState?.lifecycle_state, 'active');
    assert.deepEqual(auditedState?.audit_history?.map((entry) => [entry.operation, entry.outcome.status]), [
      ['init', 'committed'],
      ['start', 'committed'],
      ['amend', 'committed'],
    ]);
    assert.equal(await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8'), baselineBefore);

    // When a later amendment changes the remaining numeric limit
    const result = await runAmend(fixture.root, ['--max-files', '4']);

    // Then the second audit entry continues the sequence without replaying unchanged fields
    assert.equal(result.contract.max_files, 4);
    assert.equal(result.contract.max_changed_lines, 40);
    const amendments = result.contract.budget_amendments ?? [];
    assert.deepEqual(amendments, [{
      sequence: 1,
      contract_id: fixture.contractId,
      amended_at: first.contract.updated_at,
      reason: 'Tests require two more files',
      changes: { max_changed_lines: { before: 20, after: 40 } },
    }, {
      sequence: 2,
      contract_id: fixture.contractId,
      amended_at: result.contract.updated_at,
      reason: null,
      changes: { max_files: { before: 2, after: 4 } },
    }]);
    assert.deepEqual(result.contract.allow_paths, before.allow_paths);
    assert.equal(result.contract.status, 'active');
    assert.equal(result.contract.baseline_ref, before.baseline_ref);
    assert.equal((await readLifecycleState(fixture.root))?.active_contract_id, fixture.contractId);
    assert.deepEqual((await readLifecycleState(fixture.root))?.audit_history?.map((entry) => entry.operation), [
      'init', 'start', 'amend', 'amend',
    ]);
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('AMEND and CLOSE share state-first lock order and finish without a cross-lock deadlock', async () => {
  const fixture = await createActiveContract();
  let releaseAmend!: () => void;
  let announceAmend!: () => void;
  const amendCanContinue = new Promise<void>((resolve) => { releaseAmend = resolve; });
  const amendAtAuditBarrier = new Promise<void>((resolve) => { announceAmend = resolve; });
  const restore = setLifecycleAuditTestHooks({
    beforeWrite: async (record) => {
      if (record.operation === 'amend' && record.outcome.status === 'pending') {
        announceAmend();
        await amendCanContinue;
      }
    },
  });

  try {
    const amendment = runAmend(fixture.root, ['--max-files', '3']);
    await bounded(amendAtAuditBarrier, 'AMEND pending-audit barrier');
    await assert.rejects(
      () => bounded(runClose(fixture.root, ['--actor', 'concurrent-close']), 'CLOSE contention result'),
      (error: unknown) => error instanceof StateConflictError && error.message.toLowerCase().includes('busy'),
    );

    releaseAmend();
    const amended = await bounded(amendment, 'AMEND completion');
    assert.equal(amended.contract.max_files, 3);
    const closed = await bounded(runClose(fixture.root, ['--actor', 'after-amend']), 'CLOSE after AMEND');
    assert.equal(closed.state.lifecycle_state, 'closed');
    assert.equal(closed.contract.status, 'closed');
    assert.deepEqual((await readLifecycleState(fixture.root))?.audit_history?.map((entry) => [
      entry.operation,
      entry.outcome.status,
    ]), [
      ['init', 'committed'],
      ['start', 'committed'],
      ['amend', 'committed'],
      ['close', 'committed'],
    ]);
  } finally {
    releaseAmend();
    restore();
    await removeTestRepository(fixture.root);
  }
});

test('runAmend supports legacy contracts without audit history and preserves null reasons', async () => {
  const fixture = await createActiveContract();
  try {
    // Given an active legacy contract with no budget_amendments member
    const path = getContractFilePath(fixture.root, fixture.contractId);
    const contract = await readContract(fixture.root, fixture.contractId);
    const { budget_amendments: _legacyHistory, ...legacy } = contract;
    await writeFile(path, JSON.stringify(legacy), 'utf8');

    // When one numeric limit is amended without a reason
    const result = await runAmend(fixture.root, ['--max-files', '3']);

    // Then legacy absence is treated as an empty history
    const amendments = result.contract.budget_amendments ?? [];
    assert.equal(amendments.length, 1);
    assert.equal(amendments[0]?.reason, null);
    assert.deepEqual(amendments[0]?.changes, {
      max_files: { before: 2, after: 3 },
    });
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('runAmend audit-write failure leaves contract, state, and baseline uncommitted', async () => {
  const fixture = await createActiveContract();
  try {
    const contractPath = getContractFilePath(fixture.root, fixture.contractId);
    const statePath = getStateFilePath(fixture.root);
    const baselinePath = getBaselineEvidencePath(fixture.root, fixture.contractId);
    const contractBefore = await readFile(contractPath, 'utf8');
    const stateBefore = await readFile(statePath, 'utf8');
    const baselineBefore = await readFile(baselinePath, 'utf8');
    const restore = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'amend') {
          throw new Error('injected AMEND audit failure');
        }
      },
    });
    try {
      await assert.rejects(
        () => runAmend(fixture.root, ['--max-files', '3']),
        /injected AMEND audit failure/,
      );
    } finally {
      restore();
    }

    assert.equal(await readFile(contractPath, 'utf8'), contractBefore);
    assert.equal(await readFile(statePath, 'utf8'), stateBefore);
    assert.equal(await readFile(baselinePath, 'utf8'), baselineBefore);
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('AMEND completion-write failure is uncertain and replay reconciles the committed amendment', async () => {
  const fixture = await createActiveContract();
  try {
    const args = ['--max-files', '3'];
    const restore = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'amend' && record.outcome.status === 'committed') {
          throw new Error('injected AMEND completion audit failure');
        }
      },
    });
    try {
      await assert.rejects(() => runAmend(fixture.root, args), /injected AMEND completion audit failure/);
    } finally {
      restore();
    }

    const pending = await readLifecycleState(fixture.root);
    assert.deepEqual(pending?.audit_history?.at(-1)?.outcome, {
      status: 'pending',
      confirmation: 'operation_outcome_uncertain',
    });
    assert.equal((await readContract(fixture.root, fixture.contractId)).max_files, 3);

    const replay = await runAmend(fixture.root, args);
    assert.equal(replay.contract.max_files, 3);
    assert.deepEqual((await readLifecycleState(fixture.root))?.audit_history?.map((entry) => [
      entry.operation,
      entry.outcome.status,
    ]), [
      ['init', 'committed'],
      ['start', 'committed'],
      ['amend', 'reconciled'],
    ]);
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('AMEND replay matches effective changes and verifies supplied unchanged options against the persisted contract', async () => {
  const fixture = await createActiveContract();
  try {
    const args = ['--max-files', '2', '--max-changed-lines', '30'];
    const restore = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'amend' && record.outcome.status === 'committed') {
          throw new Error('injected mixed AMEND completion audit failure');
        }
      },
    });
    try {
      await assert.rejects(
        () => runAmend(fixture.root, args),
        /injected mixed AMEND completion audit failure/,
      );
    } finally {
      restore();
    }

    const replay = await runAmend(fixture.root, args);
    assert.equal(replay.contract.max_files, 2);
    assert.equal(replay.contract.max_changed_lines, 30);
    assert.deepEqual((await readLifecycleState(fixture.root))?.audit_history?.map((entry) => [
      entry.operation,
      entry.outcome.status,
    ]), [
      ['init', 'committed'],
      ['start', 'committed'],
      ['amend', 'reconciled'],
    ]);
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('AMEND recovery does not treat a different changed value as a replay', async () => {
  const fixture = await createActiveContract();
  try {
    const restore = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'amend' && record.outcome.status === 'committed') {
          throw new Error('injected mismatched AMEND completion audit failure');
        }
      },
    });
    try {
      await assert.rejects(
        () => runAmend(fixture.root, ['--max-files', '2', '--max-changed-lines', '30']),
        /injected mismatched AMEND completion audit failure/,
      );
    } finally {
      restore();
    }

    const differentAmendment = await runAmend(
      fixture.root,
      ['--max-files', '2', '--max-changed-lines', '31'],
    );
    assert.equal(differentAmendment.contract.max_files, 2);
    assert.equal(differentAmendment.contract.max_changed_lines, 31);
    assert.deepEqual((await readLifecycleState(fixture.root))?.audit_history?.map((entry) => [
      entry.operation,
      entry.outcome.status,
    ]), [
      ['init', 'committed'],
      ['start', 'committed'],
      ['amend', 'reconciled'],
      ['amend', 'committed'],
    ]);
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('runAmend rejects malformed history, invalid requests, and non-active contracts without writing', async (context) => {
  await context.test('malformed audit history', async () => {
    const fixture = await createActiveContract();
    try {
      const path = getContractFilePath(fixture.root, fixture.contractId);
      const contract = await readContract(fixture.root, fixture.contractId);
      await writeFile(path, JSON.stringify({ ...contract, budget_amendments: [{ sequence: 2 }] }), 'utf8');

      await assert.rejects(
        () => runAmend(fixture.root, ['--max-files', '3']),
        (error: unknown) => error instanceof StateCorruptionError,
      );
    } finally {
      await removeTestRepository(fixture.root);
    }
  });

  await context.test('duplicate, unsupported, invalid, and no-op options', async () => {
    const fixture = await createActiveContract();
    try {
      const cases = [
        ['--max-files', '3', '--max-files', '4'],
        ['--allow-path', 'src/**'],
        ['--max-files', '-1'],
        ['--max-files', '2'],
        ['--max-files=3=garbage'],
      ];
      const contractPath = getContractFilePath(fixture.root, fixture.contractId);
      const contractBefore = await readFile(contractPath, 'utf8');
      const stateBefore = await readFile(getStateFilePath(fixture.root), 'utf8');
      const baselineBefore = await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8');
      for (const args of cases) {
        await assert.rejects(
          () => runAmend(fixture.root, args),
          (error: unknown) => error instanceof InputValidationError,
        );
      }
      assert.equal((await readContract(fixture.root, fixture.contractId)).budget_amendments?.length ?? 0, 0);
      assert.equal(await readFile(contractPath, 'utf8'), contractBefore);
      assert.equal(await readFile(getStateFilePath(fixture.root), 'utf8'), stateBefore);
      assert.equal(await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8'), baselineBefore);
    } finally {
      await removeTestRepository(fixture.root);
    }
  });

  await context.test('closed contract', async () => {
    const fixture = await createActiveContract();
    try {
      const path = getContractFilePath(fixture.root, fixture.contractId);
      const contract = await readContract(fixture.root, fixture.contractId);
      await writeFile(path, JSON.stringify({ ...contract, status: 'closed' }), 'utf8');

      await assert.rejects(
        () => runAmend(fixture.root, ['--max-files', '3']),
        (error: unknown) => error instanceof StateConflictError || error instanceof StateCorruptionError,
      );
    } finally {
      await removeTestRepository(fixture.root);
    }
  });

  await context.test('active contract identifier mismatch', async () => {
    const fixture = await createActiveContract();
    try {
      const contractPath = getContractFilePath(fixture.root, fixture.contractId);
      const contract = await readContract(fixture.root, fixture.contractId);
      await writeFile(contractPath, JSON.stringify({ ...contract, id: 'contract-other' }), 'utf8');
      const contractBefore = await readFile(contractPath, 'utf8');
      const stateBefore = await readFile(getStateFilePath(fixture.root), 'utf8');
      const baselineBefore = await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8');

      await assert.rejects(
        () => runAmend(fixture.root, ['--max-files', '3']),
        (error: unknown) => error instanceof StateCorruptionError,
      );

      assert.equal(await readFile(contractPath, 'utf8'), contractBefore);
      assert.equal(await readFile(getStateFilePath(fixture.root), 'utf8'), stateBefore);
      assert.equal(await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8'), baselineBefore);
    } finally {
      await removeTestRepository(fixture.root);
    }
  });

  await context.test('inline reason preserves text after equals', async () => {
    const fixture = await createActiveContract();
    try {
      const result = await runAmend(fixture.root, ['--max-files=3', '--reason=expected=actual']);
      assert.equal(result.contract.budget_amendments?.[0]?.reason, 'expected=actual');
    } finally {
      await removeTestRepository(fixture.root);
    }
  });
});
