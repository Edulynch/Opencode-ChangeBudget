import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  compareSemVer,
  detectNewerMajor,
  formatSemVer,
  parseSemVer,
  selectCompatibleUpdate,
  semVerEqual,
  type SemVer,
} from '../../../../src/core/update/version.js';

const version = (tag: string): SemVer => {
  const parsed = parseSemVer(tag);
  if (parsed === null) throw new Error(`Invalid test version: ${tag}`);
  return parsed;
};

describe('core/update/version', () => {
  it('accepts only strict stable vMAJOR.MINOR.PATCH tags', () => {
    assert.deepEqual(parseSemVer('v1.2.3'), {
      major: 1,
      minor: 2,
      patch: 3,
      tag: 'v1.2.3',
    });

    for (const tag of [
      '1.2.3',
      'latest',
      'main',
      'master',
      'v1.2',
      'v1.2.3-beta.1',
      'release-1.2.3',
      'v01.2.3',
      'v1.02.3',
      'v1.2.03',
      'v1.2.3; echo hacked',
    ]) {
      assert.equal(parseSemVer(tag), null, tag);
    }
  });

  it('compares numeric components, not strings', () => {
    assert.ok(compareSemVer(version('v1.10.0'), version('v1.2.0')) > 0);
    assert.ok(compareSemVer(version('v1.2.0'), version('v1.2.1')) < 0);
    assert.equal(compareSemVer(version('v1.2.0'), version('v1.2.0')), 0);
    assert.equal(formatSemVer(version('v1.2.3')), '1.2.3');
    assert.equal(semVerEqual(version('v1.2.3'), version('v1.2.3')), true);
  });

  it('selects the highest newer same-major version', () => {
    const current = version('v1.2.0');
    const available = ['v1.5.0', 'v1.10.0', 'v2.0.0'].map(version);
    assert.equal(selectCompatibleUpdate(current, available)?.tag, 'v1.10.0');
    assert.equal(selectCompatibleUpdate(version('v1.10.0'), available), null);
  });

  it('detects the highest newer major version', () => {
    const current = version('v1.2.0');
    const available = ['v1.9.0', 'v2.0.0', 'v3.0.0'].map(version);
    assert.equal(detectNewerMajor(current, available)?.tag, 'v3.0.0');
    assert.equal(detectNewerMajor(version('v3.0.0'), available), null);
  });
});
