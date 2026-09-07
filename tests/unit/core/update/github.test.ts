import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  deriveUpdateCandidateLanes,
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

  it('reports no update when the installed version is absent and newer than remote tags', () => {
    const result = determineUpdateCheckResult(version('v1.10.0'), [
      version('v1.2.0'),
      version('v1.1.0'),
    ]);

    assert.equal(result.currentVersionString, '1.10.0');
    assert.equal(result.latestCompatibleString, null);
    assert.equal(result.newerMajorString, null);
    assert.equal(result.updateAvailable, false);
    assert.equal(result.majorAvailable, false);
  });

  it('selects compatible update candidates newest first without older tags or duplicates', () => {
    const lanes = deriveUpdateCandidateLanes(version('v1.2.0'), [
      version('v1.1.0'),
      version('v1.5.0'),
      version('v1.4.0'),
      version('v1.5.0'),
    ]);

    assert.deepEqual(lanes.compatible.map((candidate) => candidate.tag), [
      'v1.5.0',
      'v1.4.0',
    ]);
  });

  it('preserves independent compatible and newer-major candidate lanes', () => {
    const lanes = deriveUpdateCandidateLanes(version('v1.2.0'), [
      version('v2.0.0'),
      version('v1.4.0'),
      version('v3.0.0'),
      version('v1.5.0'),
    ]);

    assert.deepEqual(lanes.compatible.map((candidate) => candidate.tag), [
      'v1.5.0',
      'v1.4.0',
    ]);
    assert.deepEqual(lanes.newerMajor.map((candidate) => candidate.tag), [
      'v3.0.0',
      'v2.0.0',
    ]);
  });

  it('orders each update lane for deterministic invalid-candidate fallback', () => {
    const lanes = deriveUpdateCandidateLanes(version('v1.2.0'), [
      version('v3.0.0'),
      version('v1.4.0'),
      version('v2.0.0'),
      version('v1.5.0'),
    ]);

    assert.equal(lanes.compatible[0]?.tag, 'v1.5.0');
    assert.equal(lanes.compatible[1]?.tag, 'v1.4.0');
    assert.equal(lanes.newerMajor[0]?.tag, 'v3.0.0');
    assert.equal(lanes.newerMajor[1]?.tag, 'v2.0.0');
  });

  it('retains deterministic fallback history when the installed tag is absent remotely', () => {
    const lanes = deriveUpdateCandidateLanes(version('v1.10.0'), [
      version('v1.1.0'),
      version('v0.9.0'),
      version('v1.2.0'),
    ]);

    assert.deepEqual(lanes.compatible, []);
    assert.deepEqual(lanes.newerMajor, []);
    assert.deepEqual(lanes.fallback.map((candidate) => candidate.tag), [
      'v1.2.0',
      'v1.1.0',
      'v0.9.0',
    ]);
  });

  it('exposes every unique candidate once for deterministic all-invalid exhaustion', () => {
    const lanes = deriveUpdateCandidateLanes(version('v1.2.0'), [
      version('v1.5.0'),
      version('v2.0.0'),
      version('v1.2.0'),
      version('v1.1.0'),
      version('v1.5.0'),
    ]);

    assert.deepEqual(
      [...lanes.compatible, ...lanes.newerMajor, ...lanes.fallback]
        .map((candidate) => candidate.tag),
      ['v1.5.0', 'v2.0.0', 'v1.2.0', 'v1.1.0'],
    );
  });
});
