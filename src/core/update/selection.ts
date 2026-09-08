import { compareSemVer, formatSemVer, type SemVer } from './version.js';

export interface UpdateCheckResult {
  readonly current: SemVer;
  readonly latestCompatible: SemVer | null;
  readonly newerMajor: SemVer | null;
  readonly updateAvailable: boolean;
  readonly currentVersionString: string;
  readonly latestCompatibleString: string | null;
  readonly newerMajorString: string | null;
}

export function determineUpdateCheckResult(
  current: SemVer,
  versions: readonly SemVer[],
): UpdateCheckResult {
  const sorted = [...new Map(versions.map((version) => [version.tag, version])).values()]
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
    currentVersionString: formatSemVer(current),
    latestCompatibleString: latestCompatible === null ? null : formatSemVer(latestCompatible),
    newerMajorString: newerMajor === null ? null : formatSemVer(newerMajor),
  };
}
