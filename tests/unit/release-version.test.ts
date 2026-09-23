import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, it, test } from 'node:test';

type ReleaseVersionModule = {
  parseReleaseVersion: (version: unknown) => {
    version: string;
    isPrerelease: boolean;
    prereleaseIdentifier: 'alpha' | 'beta' | 'rc' | null;
    prereleaseNumber: string | null;
  } | null;
  parseReleaseTag: (tag: unknown) => { version: string; tag: string } | null;
  releaseTagForVersion: (version: unknown) => string;
  assertReleaseVersionTag: (version: unknown, tag: unknown) => { version: string };
  isPrereleaseVersion: (version: unknown) => boolean;
  getPrereleaseIdentifier: (version: unknown) => 'alpha' | 'beta' | 'rc' | null;
  getNpmDistTag: (version: unknown) => string;
  assertGitHubReleaseConsistency: (version: unknown, tag: unknown, prerelease: unknown) => {
    version: string;
    isPrerelease: boolean;
    npmDistTag: string;
  };
  assertStableLatestVersion: (version: unknown) => string;
  assertPublishedDistTags: (input: { version: unknown; previousLatest?: unknown; distTags: unknown }) => {
    npmDistTag: string;
    latest: unknown;
  };
};

type PublishVerifierModule = {
  validatePublishMetadata: (input: {
    packageJson: unknown;
    packageLock: unknown;
    releaseTag: unknown;
    githubPrerelease: unknown;
    githubDraft: unknown;
  }) => { version: string; npmDistTag: string };
  prepareNpmPublish: (options: {
    root: string;
    env: NodeJS.ProcessEnv;
    getDistTags: () => Record<string, unknown>;
    setOutputs: (values: Record<string, string>) => void;
  }) => { version: string; npmDistTag: string; previousLatest: string };
  verifyPublishedNpmTags: (input: {
    version: unknown;
    npmDistTag: unknown;
    previousLatest?: unknown;
    distTags: Record<string, unknown>;
  }) => { npmDistTag: string; latest: unknown };
};

async function releaseVersion(): Promise<ReleaseVersionModule> {
  return import(pathToFileURL(join(process.cwd(), 'scripts', 'release-version.mjs')).href) as Promise<ReleaseVersionModule>;
}

async function publishVerifier(): Promise<PublishVerifierModule> {
  return import(pathToFileURL(join(process.cwd(), 'scripts', 'verify-npm-publish.mjs')).href) as Promise<PublishVerifierModule>;
}

describe('shared release version grammar', () => {
  it('accepts only stable and supported numeric prerelease forms', async () => {
    const { parseReleaseVersion } = await releaseVersion();
    for (const version of [
      '0.0.0',
      '1.4.1',
      '2.0.0',
      '2.0.0-alpha.1',
      '2.0.0-beta.1',
      '2.0.0-beta.20',
      '2.0.0-rc.1',
      '0.0.0-alpha.0',
      '999999999999999999999999999999.0.0-rc.20',
    ]) {
      assert.equal(parseReleaseVersion(version)?.version, version, version);
    }
  });

  it('rejects malformed, padded, unsupported, decorated, and whitespace versions', async () => {
    const { parseReleaseVersion } = await releaseVersion();
    for (const version of [
      '2.0',
      'v2.0',
      '2.0.0-beta',
      '2.0.0-beta.x',
      '2.0.0-beta.01',
      '2.0.0-preview.1',
      '2.0.0-beta.1.2',
      '2.0.0+build',
      '2.0.0-beta.1+build',
      ' 2.0.0',
      '2.0.0 ',
      '2.0.0\n',
      '2.0.0\t',
      '2.0.0-beta.1-unknown',
      '02.0.0',
      '2.00.0',
      '2.0.00',
      '2.0.0-alpha.00',
      '2.0.0-RC.1',
      '2.0.0-rc.1.0',
      '',
      2,
      null,
    ]) {
      assert.equal(parseReleaseVersion(version), null, String(version));
    }
  });

  it('parses tags and requires exact version/tag identity without normalization', async () => {
    const { parseReleaseTag, releaseTagForVersion, assertReleaseVersionTag } = await releaseVersion();
    for (const [version, tag] of [
      ['1.4.1', 'v1.4.1'],
      ['2.0.0-beta.1', 'v2.0.0-beta.1'],
    ]) {
      assert.equal(releaseTagForVersion(version), tag);
      assert.equal(parseReleaseTag(tag)?.version, version);
      assert.equal(assertReleaseVersionTag(version, tag).version, version);
    }
    assert.equal(parseReleaseTag('v2.0.0')?.version, '2.0.0');
    assert.throws(() => assertReleaseVersionTag('2.0.0-beta.1', 'v2.0.0'));
    for (const [version, tag] of [
      ['1.4.1', 'v1.4.1\n'],
      ['1.4.1', 'vv1.4.1'],
      ['1.4.1', 'v01.4.1'],
      ['1.4.1', 'release-v1.4.1'],
      ['1.4.1', 'v1.4.1-extra'],
    ]) {
      assert.equal(parseReleaseTag(tag), null, tag);
      assert.throws(() => assertReleaseVersionTag(version, tag));
    }
    assert.throws(() => releaseTagForVersion('2.0.0-preview.1'));
  });

  it('maps only supported classifications to explicit npm dist-tags', async () => {
    const { getNpmDistTag, isPrereleaseVersion, getPrereleaseIdentifier } = await releaseVersion();
    for (const [version, channel] of [
      ['1.4.1', 'latest'],
      ['2.0.0-alpha.1', 'alpha'],
      ['2.0.0-beta.1', 'beta'],
      ['2.0.0-rc.1', 'rc'],
    ]) {
      assert.equal(getNpmDistTag(version), channel);
    }
    assert.equal(isPrereleaseVersion('1.4.1'), false);
    assert.equal(isPrereleaseVersion('2.0.0-beta.1'), true);
    assert.equal(getPrereleaseIdentifier('2.0.0-beta.1'), 'beta');
    assert.equal(getPrereleaseIdentifier('1.4.1'), null);
    assert.throws(() => getNpmDistTag('2.0.0-preview.1'));
  });
});

test('GitHub Release classification must match package version and exact tag', async () => {
  const { assertGitHubReleaseConsistency } = await releaseVersion();
  assert.equal(assertGitHubReleaseConsistency('1.4.2', 'v1.4.2', false).npmDistTag, 'latest');
  assert.throws(() => assertGitHubReleaseConsistency('1.4.2', 'v1.4.2', true));
  for (const [version, channel] of [
    ['2.0.0-alpha.1', 'alpha'],
    ['2.0.0-beta.1', 'beta'],
    ['2.0.0-rc.1', 'rc'],
  ]) {
    assert.equal(assertGitHubReleaseConsistency(version, `v${version}`, true).npmDistTag, channel);
    assert.throws(() => assertGitHubReleaseConsistency(version, `v${version}`, false));
  }
  assert.throws(() => assertGitHubReleaseConsistency('2.0.0-beta.1', 'v2.0.0', true));
  assert.throws(() => assertGitHubReleaseConsistency('1.4.2', 'v1.4.2', 'false'));
});

test('prepublish snapshots a stable latest and derives the channel only from validated version', async () => {
  const { prepareNpmPublish, validatePublishMetadata } = await publishVerifier();
  const root = await mkdtemp(join(tmpdir(), 'changebudget-publish-preflight-'));
  try {
    const version = '2.0.0-beta.1';
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'changebudget', version }));
    await writeFile(join(root, 'package-lock.json'), JSON.stringify({
      version,
      packages: { '': { version } },
    }));
    const outputs: Record<string, string> = {};
    let latestRead = 0;
    const result = prepareNpmPublish({
      root,
      env: {
        RELEASE_TAG: `v${version}`,
        GITHUB_RELEASE_PRERELEASE: 'true',
        GITHUB_RELEASE_DRAFT: 'false',
      },
      getDistTags: () => {
        latestRead += 1;
        return { latest: '1.4.1', beta: '2.0.0-beta.0' };
      },
      setOutputs: (values) => Object.assign(outputs, values),
    });
    assert.equal(latestRead, 1);
    assert.deepEqual(outputs, { npm_dist_tag: 'beta', previous_latest: '1.4.1' });
    assert.deepEqual(result, {
      version,
      major: '2',
      minor: '0',
      patch: '0',
      isPrerelease: true,
      prereleaseIdentifier: 'beta',
      prereleaseNumber: '1',
      npmDistTag: 'beta',
      previousLatest: '1.4.1',
    });
    assert.throws(() => validatePublishMetadata({
      packageJson: { name: 'changebudget', version },
      packageLock: { version, packages: { '': { version } } },
      releaseTag: `v${version}`,
      githubPrerelease: false,
      githubDraft: false,
    }));
    assert.throws(() => validatePublishMetadata({
      packageJson: { name: 'changebudget', version },
      packageLock: { version: '1.4.1', packages: { '': { version: '1.4.1' } } },
      releaseTag: `v${version}`,
      githubPrerelease: true,
      githubDraft: false,
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

describe('npm post-publish dist-tag protection', () => {
  it('requires a prerelease channel to point to the release and latest to remain unchanged', async () => {
    const { assertPublishedDistTags } = await releaseVersion();
    assert.deepEqual(assertPublishedDistTags({
      version: '2.0.0-beta.1',
      previousLatest: '1.4.1',
      distTags: { latest: '1.4.1', beta: '2.0.0-beta.1' },
    }), { npmDistTag: 'beta', latest: '1.4.1' });
    assert.throws(() => assertPublishedDistTags({
      version: '2.0.0-beta.1',
      previousLatest: '1.4.1',
      distTags: { latest: '2.0.0-beta.1', beta: '2.0.0-beta.1' },
    }), /latest changed/);
    assert.throws(() => assertPublishedDistTags({
      version: '2.0.0-beta.1',
      previousLatest: '1.4.1',
      distTags: { latest: '1.4.1', beta: '2.0.0-beta.0' },
    }), /does not point/);
  });

  it('requires a stable release to publish latest and verifies it afterward', async () => {
    const { assertPublishedDistTags } = await releaseVersion();
    assert.deepEqual(assertPublishedDistTags({
      version: '1.4.2',
      distTags: { latest: '1.4.2', beta: '2.0.0-beta.1' },
    }), { npmDistTag: 'latest', latest: '1.4.2' });
    assert.throws(() => assertPublishedDistTags({
      version: '1.4.2',
      distTags: { latest: '1.4.1' },
    }), /dist-tag 'latest' does not point to/);
  });

  it('uses the verifier to check the exact requested channel without repairing tags', async () => {
    const { verifyPublishedNpmTags } = await publishVerifier();
    assert.deepEqual(verifyPublishedNpmTags({
      version: '2.0.0-beta.1',
      npmDistTag: 'beta',
      previousLatest: '1.4.1',
      distTags: { beta: '2.0.0-beta.1', latest: '1.4.1' },
    }), { npmDistTag: 'beta', latest: '1.4.1' });
    assert.throws(() => verifyPublishedNpmTags({
      version: '2.0.0-beta.1',
      npmDistTag: 'latest',
      previousLatest: '1.4.1',
      distTags: { beta: '2.0.0-beta.1', latest: '1.4.1' },
    }), /does not match/);
  });
});
