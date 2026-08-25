import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { findPathIdentityAmbiguities, normalizeRepositoryPath } from '../../../src/core/baseline/path-identity.js';

test('T040: slash, Unicode ordering, and case ambiguity use deterministic repository identities', () => {
  assert.equal(normalizeRepositoryPath('src\\space name\\\u00e4.ts'), 'src/space name/\u00e4.ts');
  assert.deepEqual(findPathIdentityAmbiguities(['README.md', 'Readme.md'], { repositoryCase: 'sensitive', platformCase: 'insensitive' }), [{ identity: 'readme.md', kind: 'platform', paths: ['README.md', 'Readme.md'] }]);
});
