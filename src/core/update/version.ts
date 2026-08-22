/**
 * Deterministic semantic version domain for ChangeBudget SPEC-010.
 *
 * Only accepts tags matching exactly: ^v\d+\.\d+\.\d+$
 *
 * No semver runtime dependency — strict parsing with numeric comparison.
 */

/**
 * A parsed strict semantic version.
 *
 * Only valid stable tags matching `^v\d+\.\d+\.\d+$` produce a `SemVer`.
 * Prerelease, malformed, and non-semver tags are rejected at parse time.
 */
export interface SemVer {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** The original tag string including the `v` prefix, e.g. `v1.2.0`. */
  readonly tag: string;
}

/**
 * A discovered GitHub tag that passed stable-tag filtering.
 */
export interface AvailableTag {
  readonly name: string;
}

const STABLE_TAG_REGEX = /^v(\d+)\.(\d+)\.(\d+)$/;

/**
 * Parse a tag string into a strict {@link SemVer}.
 *
 * Only accepts tags matching exactly `vMAJOR.MINOR.PATCH` where each
 * component is a non-negative integer with no leading zeros (except `0` itself).
 *
 * Rejects:
 * - Tags without the `v` prefix (`1.2.0`)
 * - Tags missing components (`v1.2`)
 * - Prerelease tags (`v1.2.0-beta.1`, `v1.2.0-rc.1`)
 * - Non-semver prefixes (`release-1.2.0`)
 * - Branch aliases (`latest`, `main`, `master`)
 * - Malformed values
 *
 * @returns A valid `SemVer` or `null` if the tag is not a valid stable tag.
 */
export function parseSemVer(tag: string): SemVer | null {
  const match = STABLE_TAG_REGEX.exec(tag);
  if (!match) {
    return null;
  }

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  const patch = Number.parseInt(match[3], 10);

  // Reject leading zeros on multi-digit numbers (e.g. v01.2.0)
  if (match[1].length > 1 && match[1][0] === '0') return null;
  if (match[2].length > 1 && match[2][0] === '0') return null;
  if (match[3].length > 1 && match[3][0] === '0') return null;

  return { major, minor, patch, tag };
}

/**
 * Compare two semantic versions using numeric ordering.
 *
 * @returns Positive if `a > b`, negative if `a < b`, zero if equal.
 */
export function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * Check if two semantic versions are equal.
 */
export function semVerEqual(a: SemVer, b: SemVer): boolean {
  return compareSemVer(a, b) === 0;
}

/**
 * Format a {@link SemVer} as a plain version string without the `v` prefix.
 *
 * @returns `MAJOR.MINOR.PATCH` string, e.g. `1.2.0`.
 */
export function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * Select the highest same-major (compatible) version from a list of available tags.
 *
 * The selected tag must have the same major as the current version and be
 * strictly higher than the current version.
 *
 * If no compatible update exists (current is already the highest, or no
 * same-major tags exist), returns `null`.
 *
 * Deduplication: if the same tag appears multiple times in the discovery
 * results, duplicates are ignored during selection.
 */
export function selectCompatibleUpdate(
  current: SemVer,
  availableTags: SemVer[],
): SemVer | null {
  const sameMajor = availableTags
    .filter((t) => t.major === current.major)
    .filter((t) => compareSemVer(t, current) > 0)
    .sort(compareSemVer);

  if (sameMajor.length === 0) {
    return null;
  }

  // Deduplicate by tag string
  const seen = new Set<string>();
  for (const tag of sameMajor.reverse()) {
    if (!seen.has(tag.tag)) {
      seen.add(tag.tag);
      return tag;
    }
  }

  return sameMajor[0] ?? null;
}

/**
 * Detect a newer major version from a list of available tags.
 *
 * Returns the highest tag whose major version is strictly greater than
 * the current version's major version.
 *
 * If no newer major exists, returns `null`.
 *
 * Deduplication: if the same tag appears multiple times, duplicates are ignored.
 */
export function detectNewerMajor(
  current: SemVer,
  availableTags: SemVer[],
): SemVer | null {
  const newerMajor = availableTags
    .filter((t) => t.major > current.major)
    .sort(compareSemVer);

  if (newerMajor.length === 0) {
    return null;
  }

  // Deduplicate and return the highest
  const seen = new Set<string>();
  for (const tag of newerMajor.reverse()) {
    if (!seen.has(tag.tag)) {
      seen.add(tag.tag);
      return tag;
    }
  }

  return newerMajor[0] ?? null;
}
