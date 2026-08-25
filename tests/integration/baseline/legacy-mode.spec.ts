import * as assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { test } from 'node:test';

import { runCheck } from '../../../src/cli/commands/check.js';
import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { getContractFilePath } from '../../../src/core/state/state.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('T035: an older contract without baseline metadata remains disclosed legacy', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await runInit(fixture.root);
    const started = await runStart(fixture.root, ['--task', 'legacy', '--base-revision', 'HEAD']);
    const contractPath = getContractFilePath(fixture.root, started.contractId);
    const contract = JSON.parse(await readFile(contractPath, 'utf8')) as Record<string, unknown>;
    delete contract.comparison_mode;
    delete contract.baseline_ref;
    delete contract.activation_head;
    await writeFile(contractPath, JSON.stringify(contract), 'utf8');

    const result = await runCheck(fixture.root);
    assert.equal(result.comparisonMode, 'legacy');
    assert.equal(result.baselineState, 'legacy');
  } finally {
    await fixture.cleanup();
  }
});
