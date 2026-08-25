import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { selectEvidence } from '../../../../src/core/baseline/evidence.js';

const tracked = { path: 'tracked.txt', tracked: true, staged: false, unstaged: false, untracked: false, deleted: false, renamed: false, copied: false, isBinary: false, mode: '100644', objectType: 'file' as const };

test('evidence selection prefers recoverable Git content and retains unrecoverable values privately', () => {
  assert.deepEqual(selectEvidence(tracked, 'HEAD:tracked.txt', 'ignored'), { kind: 'git', reference: 'HEAD:tracked.txt' });
  assert.deepEqual(selectEvidence({ ...tracked, unstaged: true }, 'HEAD:tracked.txt', 'dirty'), { kind: 'private', payload: 'dirty' });
  assert.deepEqual(selectEvidence({ ...tracked, untracked: true, tracked: false }, null, 'new'), { kind: 'private', payload: 'new' });
});
