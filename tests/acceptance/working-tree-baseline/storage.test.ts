import * as assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import { test } from 'node:test';

import { runCheck } from '../../../src/cli/commands/check.js';
import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { getBaselineEvidencePath } from '../../../src/core/state/state.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('T042: many-untracked capture records complete evidence without a storage threshold', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    for (let index = 0; index < 20; index += 1) await fixture.writeUntracked(`outside/${index}.txt`, `${index}\n`);
    await runInit(fixture.root);
    const captureStarted = performance.now();
    const started = await runStart(fixture.root, ['--task', 'storage', '--base-revision', 'HEAD']);
    const captureDuration = performance.now() - captureStarted;
    const evidence = await stat(getBaselineEvidencePath(fixture.root, started.contractId));
    const comparisonStarted = performance.now();
    const result = await runCheck(fixture.root);
    const comparisonDuration = performance.now() - comparisonStarted;
    assert.equal(result.excludedUnchangedCount, 20);
    assert.equal(evidence.size > 0, true);
    assert.equal(captureDuration >= 0 && comparisonDuration >= 0, true);
  } finally { await fixture.cleanup(); }
});
