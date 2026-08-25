import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { projectBaselineChanges } from '../../../../src/core/baseline/compare.js';
import { createEvidenceDescriptor } from '../../../../src/core/baseline/integrity.js';

test('identical staging transition is budget-silent while a content change remains projected', () => {
  const evidence = createEvidenceDescriptor({
    schemaVersion: 1,
    contractId: 'contract',
    activationHead: '0123456789012345678901234567890123456789',
    entries: [{
      path: 'staged.txt', objectType: 'file', mode: null, size: 5,
      contentDigest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', payload: 'aGVsbG8=',
      observation: { tracked: true, staged: false, unstaged: true, untracked: false, deleted: false, renamed: false, copied: false, isBinary: false },
    }],
  });
  const stagedItem = { path: 'staged.txt', type: 'modified' as const, addedLines: 0, removedLines: 0, isBinary: false, staged: true };
  const silent = projectBaselineChanges(evidence, [stagedItem], new Map([
    ['staged.txt', { bytes: Buffer.from('hello'), objectType: 'file' as const, mode: null }],
  ]));
  assert.equal(silent.ok, true);
  if (silent.ok) {
    assert.equal(silent.items.length, 0);
    assert.equal(silent.stagingTransitionCount, 1);
  }

  const changed = projectBaselineChanges(evidence, [stagedItem], new Map([
    ['staged.txt', { bytes: Buffer.from('later'), objectType: 'file' as const, mode: null }],
  ]));
  assert.equal(changed.ok, true);
  if (changed.ok) assert.equal(changed.items.length, 1);
});
