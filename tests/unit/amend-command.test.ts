import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runAmend } from '../../src/cli/commands/amend.js';
import { readContract } from '../../src/core/state/contracts.js';
import {
  getBaselineEvidencePath,
  getContractFilePath,
  getStateFilePath,
  readLifecycleState,
} from '../../src/core/state/state.js';
import { InputValidationError, StateConflictError, StateCorruptionError } from '../../src/models/errors.js';

function runGit(root: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
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
    const stateBefore = await readFile(getStateFilePath(fixture.root), 'utf8');
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
    assert.equal(await readFile(getStateFilePath(fixture.root), 'utf8'), stateBefore);
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
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
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
    await rm(fixture.root, { recursive: true, force: true });
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
      await rm(fixture.root, { recursive: true, force: true });
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
      await rm(fixture.root, { recursive: true, force: true });
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
      await rm(fixture.root, { recursive: true, force: true });
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
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  await context.test('inline reason preserves text after equals', async () => {
    const fixture = await createActiveContract();
    try {
      const result = await runAmend(fixture.root, ['--max-files=3', '--reason=expected=actual']);
      assert.equal(result.contract.budget_amendments?.[0]?.reason, 'expected=actual');
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
