import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { BASELINE_OBJECT_TYPES, BASELINE_REASON_CODES, BASELINE_STATES } from '../../../../src/core/baseline/types.js';

test('baseline model constants distinguish supported objects, states, and fail-closed reasons', () => {
  assert.deepEqual(BASELINE_OBJECT_TYPES, ['file', 'directory', 'symlink', 'gitlink', 'other']);
  assert.equal(BASELINE_STATES.includes('legacy'), true);
  assert.equal(BASELINE_REASON_CODES.includes('BASELINE_UNSTABLE_CAPTURE'), true);
});
