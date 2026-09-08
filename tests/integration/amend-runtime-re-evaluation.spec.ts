import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { runAmend } from '../../src/cli/commands/amend.js';
import { runCheck } from '../../src/cli/commands/check.js';
import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { readContract } from '../../src/core/state/contracts.js';
import { getBaselineEvidencePath, getContractFilePath } from '../../src/core/state/state.js';

function runGit(root: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('runtime evaluation re-reads the persisted contract after a numeric amendment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-amend-runtime-'));
  try {
    // Given one evaluator module and an active contract exceeded by two changed files
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'amend runtime']);
    runGit(root, ['config', 'user.email', 'amend-runtime@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    await runInit(root);
    await runStart(root, ['--task', 'Runtime amendment', '--base-revision', 'HEAD', '--max-files', '1']);
    await writeFile(join(root, 'first.txt'), 'one\n');
    await writeFile(join(root, 'second.txt'), 'two\n');
    const evaluatorUrl = pathToFileURL(join(process.cwd(), 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'evaluator.js')).href;
    const evaluator = await import(evaluatorUrl);
    assert.equal((await evaluator.evaluateRuntimeDecision(root)).policyDecision, 'REPAIR');

    // When the persisted active contract is amended without recreating the evaluator module
    await runAmend(root, ['--max-files', '2']);

    // Then the next runtime evaluation uses the amended budget
    assert.equal((await evaluator.evaluateRuntimeDecision(root)).policyDecision, 'PASS');

    // When the persisted audit's final value no longer matches the active contract
    const contractPath = getContractFilePath(root, (await runAmend(root, ['--max-files', '3'])).contract.id);
    const contract = JSON.parse(await readFile(contractPath, 'utf8'));
    await writeFile(contractPath, JSON.stringify({ ...contract, max_files: 4 }), 'utf8');

    // Then runtime evaluation fails closed instead of using a stale PASS result
    assert.equal((await evaluator.evaluateRuntimeDecision(root)).policyDecision, 'HUMAN_REVIEW');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('baseline-aware check passes after exact scope amendment without recapturing evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-amend-baseline-'));
  try {
    // Given a baseline-aware contract with one permitted path and retained baseline evidence
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'amend baseline']);
    runGit(root, ['config', 'user.email', 'amend-baseline@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    await runInit(root);
    const started = await runStart(root, [
      '--task', 'Baseline scope amendment',
      '--base-revision', 'HEAD',
      '--allow-path', 'src/existing.ts',
      '--allow-new-files',
      '--max-files', '2',
      '--max-changed-lines', '20',
    ]);
    const before = await readContract(root, started.contractId);
    const evidencePath = getBaselineEvidencePath(root, started.contractId);
    const evidenceBefore = await readFile(evidencePath, 'utf8');
    await writeFile(join(root, 'outside-exact.txt'), 'changed after activation\n');

    // When a fresh check evaluates the out-of-scope working-tree delta
    const beforeAmendment = await runCheck(root);
    assert.equal(beforeAmendment.decision, 'REPAIR');
    assert.equal(beforeAmendment.reasonCodes.includes('CBV-PATH-NOT-ALLOWED'), true);
    await runAmend(root, [
      '--allow-path', 'outside-exact.txt',
      '--reason', 'Authorize the exact baseline delta',
    ]);
    const afterAmendment = await runCheck(root);

    // Then the same baseline and contract identity evaluate the exact amended path as passing
    const after = await readContract(root, started.contractId);
    assert.equal(afterAmendment.decision, 'PASS');
    assert.equal(after.id, before.id);
    assert.equal(after.baseline_ref, before.baseline_ref);
    assert.equal(after.activation_head, before.activation_head);
    assert.equal(await readFile(evidencePath, 'utf8'), evidenceBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
