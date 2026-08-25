import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectBaselineChanges } from '../../../../src/core/baseline/compare.js';
import { createEvidenceDescriptor } from '../../../../src/core/baseline/integrity.js';

const evidence = createEvidenceDescriptor({
  schemaVersion: 1,
  contractId: 'contract',
  activationHead: '0123456789012345678901234567890123456789',
  entries: [{
    path: 'inherited.txt', objectType: 'file', mode: null, size: 5,
    contentDigest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    payload: 'aGVsbG8=',
    observation: { tracked: false, staged: false, unstaged: true, untracked: false, deleted: false, renamed: false, copied: false, isBinary: false },
  }],
});

test('B-to-C comparison excludes only identical inherited entries and emits each remaining item once', () => {
  const currentItems = [
    { path: 'inherited.txt', type: 'modified' as const, addedLines: 1, removedLines: 1, isBinary: false, staged: false },
    { path: 'new.txt', type: 'added' as const, addedLines: 1, removedLines: 0, isBinary: false, staged: false },
  ];
  const unchanged = projectBaselineChanges(evidence, currentItems, new Map([
    ['inherited.txt', { bytes: Buffer.from('hello'), objectType: 'file' as const, mode: null }],
  ]));
  assert.equal(unchanged.ok, true);
  if (unchanged.ok) {
    assert.equal(unchanged.excludedUnchangedCount, 1);
    assert.deepEqual(unchanged.items.map((item) => item.path), ['new.txt']);
  }

  const changed = projectBaselineChanges(evidence, currentItems, new Map([
    ['inherited.txt', { bytes: Buffer.from('after'), objectType: 'file' as const, mode: null }],
  ]));
  assert.equal(changed.ok, true);
  if (changed.ok) assert.deepEqual(changed.items.map((item) => item.path), ['inherited.txt', 'new.txt']);
});

test('B-to-C comparison fails closed when a required current value is unavailable', () => {
  assert.deepEqual(projectBaselineChanges(evidence, [], new Map()), {
    ok: false,
    reasonCode: 'BASELINE_REQUIRED_MISSING',
  });
});
