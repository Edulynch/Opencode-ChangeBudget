const RELEASE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?(?![\s\S])/;

function invalidVersion(value) {
  throw new Error(`Unsupported ChangeBudget release version: ${String(value)}`);
}

/**
 * Parse the deliberately narrow stable/prerelease grammar used for releases.
 * Numeric components are retained as strings so parsing does not overflow.
 *
 * @param {unknown} version
 * @returns {{ version: string, major: string, minor: string, patch: string, isPrerelease: boolean, prereleaseIdentifier: 'alpha' | 'beta' | 'rc' | null, prereleaseNumber: string | null } | null}
 */
export function parseReleaseVersion(version) {
  if (typeof version !== 'string') return null;
  const match = RELEASE_VERSION_PATTERN.exec(version);
  if (!match) return null;
  const prereleaseIdentifier = match[4] ?? null;
  return {
    version,
    major: match[1],
    minor: match[2],
    patch: match[3],
    isPrerelease: prereleaseIdentifier !== null,
    prereleaseIdentifier,
    prereleaseNumber: match[5] ?? null,
  };
}

/**
 * Parse exactly `v` followed by a supported release version.
 *
 * @param {unknown} tag
 * @returns {(ReturnType<typeof parseReleaseVersion> & { tag: string }) | null}
 */
export function parseReleaseTag(tag) {
  if (typeof tag !== 'string' || !tag.startsWith('v')) return null;
  const parsed = parseReleaseVersion(tag.slice(1));
  if (!parsed || tag !== `v${parsed.version}`) return null;
  return { ...parsed, tag };
}

/** @param {unknown} version */
export function releaseTagForVersion(version) {
  const parsed = parseReleaseVersion(version);
  if (!parsed) return invalidVersion(version);
  return `v${parsed.version}`;
}

/**
 * Assert exact version/tag identity without normalizing either value.
 *
 * @param {unknown} version
 * @param {unknown} tag
 */
export function assertReleaseVersionTag(version, tag) {
  const parsedVersion = parseReleaseVersion(version);
  const parsedTag = parseReleaseTag(tag);
  if (!parsedVersion || !parsedTag || parsedVersion.version !== parsedTag.version) {
    throw new Error(`Release version and tag do not match exactly: ${String(version)} / ${String(tag)}`);
  }
  return parsedVersion;
}

/** @param {unknown} version */
export function isPrereleaseVersion(version) {
  const parsed = parseReleaseVersion(version);
  if (!parsed) return invalidVersion(version);
  return parsed.isPrerelease;
}

/** @param {unknown} version */
export function getPrereleaseIdentifier(version) {
  const parsed = parseReleaseVersion(version);
  if (!parsed) return invalidVersion(version);
  return parsed.prereleaseIdentifier;
}

/** @param {unknown} version */
export function getNpmDistTag(version) {
  const parsed = parseReleaseVersion(version);
  if (!parsed) return invalidVersion(version);
  return parsed.prereleaseIdentifier ?? 'latest';
}

/**
 * Validate the GitHub Release flag against the version; the flag never chooses
 * the npm channel.
 *
 * @param {unknown} version
 * @param {unknown} tag
 * @param {unknown} githubPrerelease
 */
export function assertGitHubReleaseConsistency(version, tag, githubPrerelease) {
  const parsed = assertReleaseVersionTag(version, tag);
  if (typeof githubPrerelease !== 'boolean' || parsed.isPrerelease !== githubPrerelease) {
    throw new Error('GitHub Release prerelease flag does not match the validated package version');
  }
  return { ...parsed, npmDistTag: getNpmDistTag(parsed.version) };
}

/** @param {unknown} version */
export function assertStableLatestVersion(version) {
  const parsed = parseReleaseVersion(version);
  if (!parsed || parsed.isPrerelease) {
    throw new Error(`The existing npm latest dist-tag is not a stable supported version: ${String(version)}`);
  }
  return parsed.version;
}

/**
 * Assert the dist-tag postconditions after npm publish. This never mutates tags.
 *
 * @param {{ version: unknown, previousLatest?: unknown, distTags: unknown }} input
 */
export function assertPublishedDistTags({ version, previousLatest, distTags }) {
  const parsed = parseReleaseVersion(version);
  if (!parsed) return invalidVersion(version);
  if (distTags === null || typeof distTags !== 'object' || Array.isArray(distTags)) {
    throw new Error('npm registry returned invalid dist-tags');
  }

  const npmDistTag = getNpmDistTag(parsed.version);
  const currentTags = /** @type {Record<string, unknown>} */ (distTags);
  if (currentTags[npmDistTag] !== parsed.version) {
    throw new Error(`npm dist-tag '${npmDistTag}' does not point to ${parsed.version}`);
  }

  if (parsed.isPrerelease) {
    const expectedLatest = assertStableLatestVersion(previousLatest);
    if (currentTags.latest !== expectedLatest) {
      throw new Error(`npm latest changed during prerelease publication: expected ${expectedLatest}, found ${String(currentTags.latest)}`);
    }
  } else if (currentTags.latest !== parsed.version) {
    throw new Error(`npm latest does not point to stable release ${parsed.version}`);
  }

  return { npmDistTag, latest: currentTags.latest };
}
