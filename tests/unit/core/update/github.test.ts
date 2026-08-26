import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  determineUpdateCheckResult,
  filterStableTags,
  sortTagsAscending,
  sortTagsDescending,
} from '../../../../src/core/update/github.js';
import { parseSemVer, type SemVer } from '../../../../src/core/update/version.js';

const version = (tag: string): SemVer => {
  const parsed = parseSemVer(tag);
  if (parsed === null) throw new Error(`Invalid test version: ${tag}`);
  return parsed;
};

describe('core/update/github', () => {
  it('filters invalid, prerelease, alias, and injection-like tags', () => {
    assert.deepEqual(
      filterStableTags([
        'v1.0.0',
        'v1.10.0',
        'master',
        'main',
        'latest',
        'v1.2.3-beta.1',
        'v1.2',
        'v1.2.3; echo hacked',
      ]),
      ['v1.0.0', 'v1.10.0'],
    );
  });

  it('sorts stable tags numerically in both directions', () => {
    const tags = ['v1.2.0', 'v1.10.0', 'v2.0.0', 'v1.0.0'];
    assert.deepEqual(sortTagsDescending([...tags]), [
      'v2.0.0',
      'v1.10.0',
      'v1.2.0',
      'v1.0.0',
    ]);
    assert.deepEqual(sortTagsAscending([...tags]), [
      'v1.0.0',
      'v1.2.0',
      'v1.10.0',
      'v2.0.0',
    ]);
  });

  it('calculates compatible and major update results', () => {
    const result = determineUpdateCheckResult(version('v1.2.0'), [
      version('v1.2.0'),
      version('v1.10.0'),
      version('v2.0.0'),
    ]);
    assert.equal(result.latestCompatibleString, '1.10.0');
    assert.equal(result.newerMajorString, '2.0.0');
    assert.equal(result.updateAvailable, true);
    assert.equal(result.majorAvailable, true);
  });
});
