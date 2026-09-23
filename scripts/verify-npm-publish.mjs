import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  assertGitHubReleaseConsistency,
  assertPublishedDistTags,
  assertStableLatestVersion,
  getNpmDistTag,
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

function readCurrentDistTags(timeout = 30_000) {
  const output = execFileSync('npm', [
    'view',
    'changebudget',
    'dist-tags',
    '--json',
    `--registry=${REGISTRY}`,
  ], { encoding: 'utf8', shell: false, timeout });
  const distTags = JSON.parse(output);
  if (distTags === null || typeof distTags !== 'object' || Array.isArray(distTags)) {
    throw new Error('npm registry returned invalid dist-tags');
  }
  return distTags;
}

function readPublishedVersion(version, timeout = 30_000) {
  return execFileSync('npm', [
    'view',
    `changebudget@${version}`,
    'version',
    `--registry=${REGISTRY}`,
  ], { encoding: 'utf8', shell: false, timeout }).trim();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

/**
 * Poll the npm registry after the single publish operation. Registry reads may
 * briefly return E404 or stale metadata while the package and dist-tags
 * propagate; no publish or dist-tag mutation is retried here.
 *
 * @param {{ version: string, npmDistTag: string, previousLatest?: string, getPublishedVersion?: (version: string, timeout: number) => string | Promise<string>, getDistTags?: (timeout: number) => Record<string, unknown> | Promise<Record<string, unknown>>, sleep?: (milliseconds: number) => Promise<void>, now?: () => number, intervalMs?: number, timeoutMs?: number }} options
 */
export async function waitForPublishedNpmTags({
  version,
  npmDistTag,
  previousLatest,
  getPublishedVersion = readPublishedVersion,
  getDistTags = readCurrentDistTags,
  sleep: wait = sleep,
  now = Date.now,
  intervalMs = 15_000,
  timeoutMs = 600_000,
}) {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('npm registry polling interval must be a positive number');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new Error('npm registry polling timeout must be a non-negative number');
  }

  const expectedDistTag = getNpmDistTag(version);
  if (npmDistTag !== expectedDistTag) {
    throw new Error(`Published npm dist-tag does not match the validated release channel: ${String(npmDistTag)}`);
  }
  if (expectedDistTag !== 'latest') assertStableLatestVersion(previousLatest);

  const deadline = now() + timeoutMs;
  let lastError = 'published version is not visible yet';

  while (true) {
    const remaining = deadline - now();
    if (remaining <= 0) break;

    try {
      const publishedVersion = await getPublishedVersion(version, Math.max(1, remaining));
      if (publishedVersion !== version) {
        throw new Error(`npm registry returned version ${String(publishedVersion)} instead of ${version}`);
      }

      const tagReadRemaining = deadline - now();
      if (tagReadRemaining <= 0) break;
      const distTags = await getDistTags(Math.max(1, tagReadRemaining));
      return verifyPublishedNpmTags({ version, npmDistTag, previousLatest, distTags });
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    const remainingAfterRead = deadline - now();
    if (remainingAfterRead <= 0) break;
    await wait(Math.min(intervalMs, remainingAfterRead));
  }

  throw new Error(`Timed out after ${timeoutMs}ms waiting for npm registry propagation of changebudget@${version}: ${lastError}`);
}

async function main(argv) {
  const [mode] = argv;
  if (mode === 'before-publish') {
    const result = prepareNpmPublish();
    console.log(`Validated ${result.version} for npm dist-tag ${result.npmDistTag}`);
    return;
  }
  if (mode === 'after-publish') {
    const packageJson = readJson(process.cwd(), 'package.json');
    const result = await waitForPublishedNpmTags({
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
  main(process.argv.slice(2)).catch((error) => {
    console.error(`npm publication verification failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
