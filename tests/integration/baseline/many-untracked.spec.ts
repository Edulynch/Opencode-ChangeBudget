import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { captureBaseline } from '../../../src/core/baseline/capture.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('capture records every pre-existing untracked value individually', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await Promise.all(Array.from({ length: 20 }, (_, index) => fixture.writeUntracked(`noise/${index}.txt`, `${index}\n`)));
    const evidence = await captureBaseline({ repositoryRoot: fixture.root, contractId: 'contract-many', activationHead: fixture.head() });
    assert.equal(evidence.ok, true);
    if (evidence.ok) assert.equal(evidence.evidence.entries.length, 20);
  } finally {
    await fixture.cleanup();
  }
});
