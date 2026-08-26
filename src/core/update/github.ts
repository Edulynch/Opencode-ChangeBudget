import {
  compareSemVer,
  formatSemVer,
  parseSemVer,
  type SemVer,
} from './version.js';

const STABLE_TAG_REGEX = /^v\d+\.\d+\.\d+$/;

export function filterStableTags(rawTags: readonly string[]): string[] {
  return rawTags.filter((tag) => STABLE_TAG_REGEX.test(tag));
}

export function sortTagsDescending(tags: readonly string[]): string[] {
  return [...tags].sort((left, right) => {
    const leftVersion = parseSemVer(left);
    const rightVersion = parseSemVer(right);
    if (leftVersion === null || rightVersion === null) {
      return left.localeCompare(right);
    }
    return compareSemVer(rightVersion, leftVersion);
  });
}

export function sortTagsAscending(tags: readonly string[]): string[] {
  return [...tags].sort((left, right) => {
    const leftVersion = parseSemVer(left);
    const rightVersion = parseSemVer(right);
    if (leftVersion === null || rightVersion === null) {
      return left.localeCompare(right);
    }
    return compareSemVer(leftVersion, rightVersion);
  });
}

export interface UpdateCheckResult {
  readonly current: SemVer;
  readonly latestCompatible: SemVer | null;
  readonly newerMajor: SemVer | null;
  readonly updateAvailable: boolean;
  readonly majorAvailable: boolean;
  readonly currentVersionString: string;
  readonly latestCompatibleString: string | null;
  readonly newerMajorString: string | null;
}

export function determineUpdateCheckResult(
  current: SemVer,
  stableTags: readonly SemVer[],
): UpdateCheckResult {
  const sorted = [...new Map(stableTags.map((version) => [version.tag, version])).values()]
    .sort((left, right) => compareSemVer(right, left));
  const latestCompatible = sorted.find(
    (version) => version.major === current.major && compareSemVer(version, current) > 0,
  ) ?? null;
  const newerMajor = sorted.find((version) => version.major > current.major) ?? null;

  return {
    current,
    latestCompatible,
    newerMajor,
    updateAvailable: latestCompatible !== null,
    majorAvailable: newerMajor !== null,
    currentVersionString: formatSemVer(current),
    latestCompatibleString:
      latestCompatible === null ? null : formatSemVer(latestCompatible),
    newerMajorString: newerMajor === null ? null : formatSemVer(newerMajor),
  };
}
