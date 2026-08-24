import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRepositoryPathIdentity, findPathIdentityAmbiguities, normalizeRepositoryPath } from '../../../../src/core/baseline/path-identity.js';

test('path identity normalizes spaces Unicode and separators without global lowercasing', () => {
  assert.equal(normalizeRepositoryPath('docs\\cafe space.txt'), 'docs/cafe space.txt');
  assert.equal(normalizeRepositoryPath('src/naive-unicode.txt'), 'src/naive-unicode.txt');
  assert.equal(createRepositoryPathIdentity('Readme.md', { repositoryCase: 'sensitive', platformCase: 'insensitive' }).repositoryIdentity, 'Readme.md');
});

test('path identity rejects traversal and reports deterministic case ambiguity', () => {
  assert.throws(() => normalizeRepositoryPath('../outside.txt'));
  const ambiguities = findPathIdentityAmbiguities(['z.txt', 'Readme.md', 'README.md'], { repositoryCase: 'sensitive', platformCase: 'insensitive' });
  assert.deepEqual(ambiguities, [{ identity: 'readme.md', kind: 'platform', paths: ['README.md', 'Readme.md'] }]);
});
