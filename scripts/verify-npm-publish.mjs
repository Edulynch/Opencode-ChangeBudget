import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  assertGitHubReleaseConsistency,
  assertPublishedDistTags,
  assertStableLatestVersion,
} from './release-version.mjs';

const REGISTRY = 'https://registry.npmjs.org/';

function readJson(root, filename) {
  try {
    return JSON.parse(readFileSync(join(root, filename), 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${filename}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Validate package/lock/tag/GitHub Release identity using the release-version
 * module as the only source of version and channel semantics.
 *
 * @param {{ packageJson: any, packageLock: any, releaseTag: unknown, githubPrerelease: unknown, githubDraft: unknown }} input
 */
export function validatePublishMetadata({
  packageJson,
  packageLock,
  releaseTag,
  githubPrerelease,
  githubDraft,
}) {
  if (packageJson?.name !== 'changebudget') {
    throw new Error('Release package name must be changebudget');
  }
  const version = packageJson.version;
  if (typeof version !== 'string') throw new Error('Release package version must be a string');
  if (packageLock?.version !== version || packageLock?.packages?.['']?.version !== version) {
    throw new Error('package.json and package-lock.json versions do not match');
  }
  if (githubDraft !== false) throw new Error('GitHub Release must be published, not a draft');
  return assertGitHubReleaseConsistency(version, releaseTag, githubPrerelease);
}

function readCurrentDistTags() {
  const output = execFileSync('npm', [
    'view',
    'changebudget',
    'dist-tags',
    '--json',
    `--registry=${REGISTRY}`,
  ], { encoding: 'utf8', shell: false });
  const distTags = JSON.parse(output);
  if (distTags === null || typeof distTags !== 'object' || Array.isArray(distTags)) {
    throw new Error('npm registry returned invalid dist-tags');
  }
  return distTags;
}

function writeOutputs(outputPath, values) {
  if (typeof outputPath !== 'string' || outputPath.length === 0) {
    throw new Error('GITHUB_OUTPUT is required to prepare the npm publication');
  }
  for (const [name, value] of Object.entries(values)) {
    if (/[\r\n]/.test(value)) throw new Error(`Invalid GitHub Actions output: ${name}`);
  }
  appendFileSync(outputPath, Object.entries(values).map(([name, value]) => `${name}=${value}\n`).join(''), 'utf8');
}

/**
 * Verify release identity and, for prereleases, snapshot npm latest immediately
 * before publication. No registry dist-tag is changed by this script.
 *
 * @param {{ root?: string, env?: NodeJS.ProcessEnv, getDistTags?: () => Record<string, unknown>, setOutputs?: (values: Record<string, string>) => void }} [options]
 */
export function prepareNpmPublish(options = {}) {
  const root = options.root ?? process.cwd();
  const env = options.env ?? process.env;
  const metadata = validatePublishMetadata({
    packageJson: readJson(root, 'package.json'),
    packageLock: readJson(root, 'package-lock.json'),
    releaseTag: env.RELEASE_TAG,
    githubPrerelease: env.GITHUB_RELEASE_PRERELEASE === 'true'
      ? true
      : env.GITHUB_RELEASE_PRERELEASE === 'false'
        ? false
        : undefined,
    githubDraft: env.GITHUB_RELEASE_DRAFT === 'false' ? false : true,
  });

  let previousLatest = '';
  if (metadata.isPrerelease) {
    const distTags = (options.getDistTags ?? readCurrentDistTags)();
    previousLatest = assertStableLatestVersion(distTags.latest);
  }

  const outputs = {
    npm_dist_tag: metadata.npmDistTag,
    previous_latest: previousLatest,
  };
  if (options.setOutputs) options.setOutputs(outputs);
  else writeOutputs(env.GITHUB_OUTPUT, outputs);
  return { ...metadata, previousLatest };
}

/**
 * Verify npm registry dist-tags after publish. This function only reads the
 * registry; it never attempts to repair a changed tag.
 *
 * @param {{ version: unknown, npmDistTag: unknown, previousLatest?: unknown, distTags?: Record<string, unknown> }} input
 */
export function verifyPublishedNpmTags({ version, npmDistTag, previousLatest, distTags }) {
  const currentTags = distTags ?? readCurrentDistTags();
  const expected = assertPublishedDistTags({ version, previousLatest, distTags: currentTags });
  if (npmDistTag !== expected.npmDistTag) {
    throw new Error(`Published npm dist-tag does not match the validated release channel: ${String(npmDistTag)}`);
  }
  return expected;
}

function main(argv) {
  const [mode] = argv;
  if (mode === 'before-publish') {
    const result = prepareNpmPublish();
    console.log(`Validated ${result.version} for npm dist-tag ${result.npmDistTag}`);
    return;
  }
  if (mode === 'after-publish') {
    const packageJson = readJson(process.cwd(), 'package.json');
    const result = verifyPublishedNpmTags({
      version: packageJson.version,
      npmDistTag: process.env.NPM_DIST_TAG,
      previousLatest: process.env.PREVIOUS_NPM_LATEST,
    });
    console.log(`Verified npm dist-tags: ${result.npmDistTag}=${packageJson.version}, latest=${result.latest}`);
    return;
  }
  throw new Error('Usage: node scripts/verify-npm-publish.mjs <before-publish|after-publish>');
}

if (process.argv[1]?.endsWith('verify-npm-publish.mjs')) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`npm publication verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
