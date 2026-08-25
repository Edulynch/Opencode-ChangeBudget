import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseGitObservationZOutput } from '../../../../src/core/baseline/observe.js';

test('observation parser preserves object metadata and rejects malformed records', () => {
  const [symlink] = parseGitObservationZOutput({ statusOutput: '1 .M N... 100644 100644 120000 hash hash linked\0' });
  assert.equal(symlink?.path, 'linked');
  assert.equal(symlink?.objectType, 'symlink');
  assert.throws(() => parseGitObservationZOutput({ statusOutput: '? \0' }));
});
