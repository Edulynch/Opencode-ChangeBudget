import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  determineUpdateCheckResult,
  fetchAllTags,
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
  it('fetches pages until the first empty page', async (t) => {
    const pages = [
      [{ name: 'v1.0.0' }, { name: 'v1.2.0' }],
      [{ name: 'v2.0.0' }],
      [],
    ];
    const requested: string[] = [];
    t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
      requested.push(String(input));
      return new Response(JSON.stringify(pages[requested.length - 1]));
    });

    assert.deepEqual(
      await fetchAllTags('Edulynch', 'Opencode-ChangeBudget'),
      ['v1.0.0', 'v1.2.0', 'v2.0.0'],
    );
    assert.equal(requested.length, 3);
    assert.match(requested[2], /page=3/);
  });

  it('surfaces API and network failures without network dependency', async (t) => {
    t.mock.method(globalThis, 'fetch', async () =>
      new Response(JSON.stringify({ message: 'Forbidden' }), {
        status: 403,
        statusText: 'Forbidden',
      }),
    );
    await assert.rejects(
      fetchAllTags('owner', 'repo'),
      /GitHub tag discovery error: GitHub API request failed: 403 Forbidden — Forbidden/,
    );

    t.mock.method(globalThis, 'fetch', async () => {
      throw new Error('offline');
    });
    await assert.rejects(fetchAllTags('owner', 'repo'), /offline/);
  });

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
