import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { readBaselineEvidence, readLifecycleState } from '../../../src/core/state/state.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('start activates only after complete baseline evidence is retained', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeUntracked('inherited.txt', 'before\n');
    await runInit(fixture.root);
    const result = await runStart(fixture.root, ['--task', 'activation', '--base-revision', 'HEAD']);
    const state = await readLifecycleState(fixture.root);
    assert.equal(state?.active_contract_id, result.contractId);
    assert.notEqual(await readBaselineEvidence(fixture.root, result.contractId), null);
  } finally {
    await fixture.cleanup();
  }
});
