import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCheck } from '../../../src/cli/commands/check.js';
import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { readContract } from '../../../src/core/state/contracts.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('T038: scenario 40 permits exact captured HEAD equality', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await runInit(fixture.root);
    await runStart(fixture.root, ['--task', 'head', '--base-revision', 'HEAD']);
    assert.equal((await runCheck(fixture.root)).decision, 'PASS');
  } finally { await fixture.cleanup(); }
});

for (const scenario of [41, 42, 44] as const) {
  test(`T038: scenario ${scenario} rejects any unequal retained activation HEAD`, async () => {
    const fixture = await createWorkingTreeBaselineFixture();
    try {
      await runInit(fixture.root);
      await runStart(fixture.root, ['--task', 'head', '--base-revision', 'HEAD']);
      await fixture.writeTracked(`advanced-${scenario}.txt`, 'advanced\n');
      const result = await runCheck(fixture.root);
      assert.equal(result.decision, 'HUMAN_REVIEW');
      assert.deepEqual(result.reasonCodes, ['BASELINE_HEAD_MOVED']);
    } finally { await fixture.cleanup(); }
  });
}

test('T038: scenario 43 resumes only after returning to the exact captured HEAD', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await runInit(fixture.root);
    const started = await runStart(fixture.root, ['--task', 'head', '--base-revision', 'HEAD']);
    assert.equal((await readContract(fixture.root, started.contractId)).activation_head, fixture.head());
    assert.equal((await runCheck(fixture.root)).decision, 'PASS');
  } finally { await fixture.cleanup(); }
});
