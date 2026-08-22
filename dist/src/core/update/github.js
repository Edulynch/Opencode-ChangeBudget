/**
 * GitHub tag discovery for SPEC-010.
 *
 * Uses Node.js built-in fetch (no external dependencies).
 * Paginates until the end condition is met.
 * Tags are filtered to stable semver format.
 * Package.json integrity validation is separate (see githubIntegrity.ts).
 */
import { parseSemVer, compareSemVer, formatSemVer } from './version.js';
const DEFAULT_TIMEOUT_MS = 5_000;
/**
 * Fetches all tags from the GitHub Tags API with pagination.
 *
 * Endpoint: GET /repos/:owner/:repo/tags?per_page=100&page=N
 *
 * @returns Array of tag names (raw strings) or empty array on failure.
 */
export async function fetchAllTags(owner, repo, perPage = 100, fetchFunction = fetch) {
    const tags = [];
    let page = 1;
    while (true) {
        const url = new URL(`/repos/${owner}/${repo}/tags`, 'https://api.github.com');
        url.searchParams.set('per_page', perPage.toString());
        url.searchParams.set('page', page.toString());
        try {
            let response;
            try {
                response = await fetchFunction(url.href, {
                    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
                });
            }
            catch (error) {
                if (error instanceof Error && error.name === 'TimeoutError') {
                    throw new Error('Network timeout during GitHub API request');
                }
                throw error;
            }
            if (!response.ok) {
                const errorData = (await response.clone().json());
                throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}${errorData?.message ? ` — ${errorData.message}` : ''}`);
            }
            let pageTags;
            try {
                pageTags = (await response.json());
            }
            catch {
                throw new Error('Invalid GitHub API response');
            }
            if (!Array.isArray(pageTags) ||
                pageTags.some((tag) => tag === null ||
                    typeof tag !== 'object' ||
                    typeof tag.name !== 'string')) {
                throw new Error('Invalid GitHub API response');
            }
            if (pageTags.length === 0) {
                // Empty page — end of pagination
                break;
            }
            for (const tag of pageTags) {
                tags.push(tag.name);
            }
            page += 1;
        }
        catch (error) {
            // Network or API error — re-throw as descriptive error
            throw new Error(`GitHub tag discovery error: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return tags;
}
/**
 * Validate that a stable tag contains the matching package version.
 * A false result rejects only that candidate so discovery can continue.
 */
export async function validateTagIntegrity(owner, repo, tag, fetchFunction = fetch) {
    const url = new URL(`/repos/${owner}/${repo}/contents/package.json`, 'https://api.github.com');
    url.searchParams.set('ref', tag);
    try {
        const response = await fetchFunction(url.href, {
            signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
        });
        if (!response.ok) {
            return false;
        }
        const payload = (await response.json());
        if (payload === null ||
            typeof payload !== 'object' ||
            typeof payload.content !== 'string') {
            return false;
        }
        const decoded = Buffer.from(payload.content, 'base64').toString('utf8');
        const packageJson = JSON.parse(decoded);
        const parsedTag = parseSemVer(tag);
        return (parsedTag !== null &&
            packageJson.version === formatSemVer(parsedTag));
    }
    catch {
        return false;
    }
}
/**
 * Filters a list of raw GitHub tag names, keeping only those matching
 * the stable `^v\d+\.\d+\.\d+$` pattern.
 *
 * @param rawTags Raw tag names from GitHub API
 * @returns Only stable version tags that pass the regex filter.
 */
export function filterStableTags(rawTags) {
    return rawTags.filter((tag) => STABLE_TAG_REGEX.test(tag));
}
const STABLE_TAG_REGEX = /^v\d+\.\d+\.\d+$/;
/**
 * Deterministic sort of stable tags in descending numeric order.
 *
 * Sorts by major, then minor, then patch descending, so the highest
 * compatible version appears first.
 */
export function sortTagsDescending(tags) {
    return tags.sort((a, b) => {
        const aSem = parseSemVer(a);
        const bSem = parseSemVer(b);
        if (!aSem || !bSem) {
            // Fallback string sort for non-parseable tags (should not happen after filterStableTags)
            return a.localeCompare(b);
        }
        // Descending: higher version first
        if (aSem.major !== bSem.major)
            return bSem.major - aSem.major;
        if (aSem.minor !== bSem.minor)
            return bSem.minor - aSem.minor;
        return bSem.patch - aSem.patch;
    });
}
/**
 * Sorts stable tags in ascending numeric order (oldest to newest).
 */
export function sortTagsAscending(tags) {
    return tags.sort((a, b) => {
        const aSem = parseSemVer(a);
        const bSem = parseSemVer(b);
        if (!aSem || !bSem) {
            return a.localeCompare(b);
        }
        // Ascending: lower version first
        if (aSem.major !== bSem.major)
            return aSem.major - bSem.major;
        if (aSem.minor !== bSem.minor)
            return aSem.minor - bSem.minor;
        return aSem.patch - bSem.patch;
    });
}
/**
 * Determines the update check result from the current installed version
 * and a list of stable GitHub tags that have been integrity-validated.
 *
 * @param current The installed version as a SemVer
 * @param stableTags Sorted list of stable SemVer tags that passed integrity validation
 * @returns An UpdateCheckResult describing the update landscape.
 */
export function determineUpdateCheckResult(current, stableTags) {
    // Sort tags descending to easily find highest versions
    const sorted = sortTagsDescending(stableTags.map((t) => t.tag)).map((tag) => parseSemVer(tag));
    // latestCompatible: highest same-major tag that is strictly newer than current
    const sameMajorNewer = sorted
        .filter((t) => t.major === current.major && compareSemVer(t, current) > 0)
        .at(0) ?? null;
    // newerMajor: highest tag with strictly greater major than current
    const newerMajorCandidates = sorted.filter((t) => t.major > current.major);
    const newestMajor = newerMajorCandidates.at(0) ?? null;
    // Deduplicate: if the same version appears multiple times, use the first
    const seen = new Set();
    const uniqueLatestCompatible = sameMajorNewer !== null && !seen.has(sameMajorNewer.tag)
        ? (seen.add(sameMajorNewer.tag), sameMajorNewer)
        : null;
    const uniqueNewestMajor = newestMajor !== null && !seen.has(newestMajor.tag)
        ? (seen.add(newestMajor.tag), newestMajor)
        : null;
    return {
        current,
        latestCompatible: uniqueLatestCompatible ?? null,
        newerMajor: uniqueNewestMajor ?? null,
        updateAvailable: sameMajorNewer !== null,
        majorAvailable: newestMajor !== null,
        currentVersionString: formatSemVer(current),
        latestCompatibleString: uniqueLatestCompatible ? formatSemVer(uniqueLatestCompatible) : null,
        newerMajorString: newestMajor ? formatSemVer(newestMajor) : null,
    };
}
//# sourceMappingURL=github.js.map