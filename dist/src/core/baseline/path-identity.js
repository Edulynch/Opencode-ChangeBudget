import { compareCodeUnits } from '../ordering.js';
import { InputValidationError } from '../../models/errors.js';
const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
export function normalizeRepositoryPath(path) {
    const normalized = path.replace(/\\/g, '/');
    if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || WINDOWS_ABSOLUTE_PATH.test(path)) {
        throw new InputValidationError('Baseline path must be a non-empty repository-relative path', 'path', { path });
    }
    const segments = normalized.split('/');
    if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        throw new InputValidationError('Baseline path must not contain empty, current-directory, or traversal segments', 'path', { path });
    }
    return normalized;
}
function identityForCase(path, semantics) {
    return semantics === 'sensitive' ? path : path.toLowerCase();
}
export function createRepositoryPathIdentity(path, options) {
    const normalizedPath = normalizeRepositoryPath(path);
    return {
        path: normalizedPath,
        repositoryIdentity: identityForCase(normalizedPath, options.repositoryCase),
        platformIdentity: identityForCase(normalizedPath, options.platformCase),
    };
}
function collectAmbiguities(identities, kind) {
    const byIdentity = new Map();
    for (const identity of identities) {
        const key = kind === 'repository' ? identity.repositoryIdentity : identity.platformIdentity;
        const paths = byIdentity.get(key) ?? [];
        paths.push(identity.path);
        byIdentity.set(key, paths);
    }
    return Array.from(byIdentity.entries())
        .filter(([, paths]) => paths.length > 1)
        .map(([identity, paths]) => ({
        identity,
        kind,
        paths: [...paths].sort(compareCodeUnits),
    }))
        .sort((left, right) => compareCodeUnits(left.identity, right.identity));
}
export function findPathIdentityAmbiguities(paths, options) {
    const identities = paths.map((path) => createRepositoryPathIdentity(path, options));
    return [
        ...collectAmbiguities(identities, 'repository'),
        ...collectAmbiguities(identities, 'platform'),
    ];
}
//# sourceMappingURL=path-identity.js.map