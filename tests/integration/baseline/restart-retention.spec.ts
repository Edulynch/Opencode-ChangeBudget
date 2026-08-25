import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCheck } from '../../../src/cli/commands/check.js';
import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('T031: a fresh check invocation reloads the same retained baseline projection', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeUntracked('inherited.txt', 'before\n');
    await runInit(fixture.root);
    await runStart(fixture.root, ['--task', 'restart', '--base-revision', 'HEAD']);

    const first = await runCheck(fixture.root);
    const restarted = await runCheck(fixture.root);
    assert.deepEqual(
      { decision: restarted.decision, reasons: restarted.reasonCodes, excluded: restarted.excludedUnchangedCount, detected: restarted.detectedDeltaCount },
      { decision: first.decision, reasons: first.reasonCodes, excluded: first.excludedUnchangedCount, detected: first.detectedDeltaCount },
    );
  } finally {
    await fixture.cleanup();
  }
});
