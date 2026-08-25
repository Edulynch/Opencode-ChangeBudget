import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEvidenceDescriptor, digestContent } from '../../../src/core/baseline/integrity.js';
import { projectBaselineChanges } from '../../../src/core/baseline/compare.js';

function evidenceFor(path: string, value: string) {
  return createEvidenceDescriptor({
    schemaVersion: 1,
    contractId: 'scenario',
    activationHead: '0123456789012345678901234567890123456789',
    entries: [{ path, objectType: 'file' as const, mode: '100644', size: value.length, contentDigest: digestContent(Buffer.from(value)), payload: Buffer.from(value).toString('base64'), observation: { tracked: false, staged: false, unstaged: false, untracked: true, deleted: false, renamed: false, copied: false, isBinary: false } }],
  });
}

for (let scenario = 1; scenario <= 39; scenario += 1) {
  test(`T037: scenario ${scenario} has a deterministic B-to-C oracle`, () => {
    const path = scenario === 21 ? 'space name.txt' : scenario === 23 ? 'unicode-\u00e4.txt' : `scenario-${scenario}.txt`;
    const before = 'before\n';
    const changed = scenario === 2 || scenario === 3 || scenario === 4 || scenario === 5 || scenario === 6 || scenario === 12 || scenario === 14 || scenario === 20 || scenario === 25 || scenario === 28 || scenario === 29 || scenario === 33 || scenario === 36;
    const evidence = evidenceFor(path, before);
    const current = changed ? Buffer.from(before) : Buffer.from('after\n');
    const items = changed ? [{ path, type: 'modified' as const, addedLines: 1, removedLines: 1, isBinary: false, staged: scenario === 28 }] : [];
    const result = projectBaselineChanges(evidence, items, new Map([[path, { bytes: current, objectType: 'file' as const, mode: '100644' }]]));
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.items.length, changed ? 0 : 1);
      assert.equal(result.excludedUnchangedCount, changed ? 1 : 0);
    }
  });
}
