import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { captureBaseline } from '../../../../src/core/baseline/capture.js';

test('capture stores a symlink object value without reading its target', async () => {
  const observation = { path: 'link', tracked: false, staged: false, unstaged: false, untracked: true, deleted: false, renamed: false, copied: false, isBinary: false, mode: '120000', objectType: 'symlink' as const };
  const result = await captureBaseline({ repositoryRoot: '.', contractId: 'contract', activationHead: '0123456789012345678901234567890123456789', observe: async () => [observation], afterCapture: async () => [observation], readValue: async () => ({ type: 'symlink', bytes: Buffer.from('outside-target'), mode: '120000' }) });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.evidence.entries[0]?.objectType, 'symlink');
});
