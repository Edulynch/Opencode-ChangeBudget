import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { captureBaseline } from '../../../../src/core/baseline/capture.js';

test('TOCTOU capture never accepts a path whose observed identity changes', async () => {
  const before = { path: 'before.txt', tracked: false, staged: false, unstaged: false, untracked: true, deleted: false, renamed: false, copied: false, isBinary: false, mode: null, objectType: 'file' as const };
  const after = { ...before, path: 'after.txt' };
  const result = await captureBaseline({ repositoryRoot: '.', contractId: 'contract', activationHead: '0123456789012345678901234567890123456789', maxAttempts: 1, observe: async () => [before], afterCapture: async () => [after], readValue: async () => ({ type: 'file', bytes: Buffer.from('value'), mode: null }) });
  assert.deepEqual(result, { ok: false, reasonCode: 'BASELINE_UNSTABLE_CAPTURE' });
});
