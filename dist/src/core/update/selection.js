import { compareSemVer, formatSemVer } from './version.js';
export function determineUpdateCheckResult(current, versions) {
    const sorted = [...new Map(versions.map((version) => [version.tag, version])).values()]
        .sort((left, right) => compareSemVer(right, left));
    const latestCompatible = sorted.find((version) => version.major === current.major && compareSemVer(version, current) > 0) ?? null;
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
//# sourceMappingURL=selection.js.map