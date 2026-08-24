import { compareCodeUnits } from '../ordering.js';
import { InputValidationError } from '../../models/errors.js';

export type CaseSemantics = 'sensitive' | 'insensitive';

export interface PathIdentityOptions {
  readonly repositoryCase: CaseSemantics;
  readonly platformCase: CaseSemantics;
}

export interface RepositoryPathIdentity {
  readonly path: string;
  readonly repositoryIdentity: string;
  readonly platformIdentity: string;
}

export interface PathIdentityAmbiguity {
  readonly identity: string;
  readonly kind: 'repository' | 'platform';
  readonly paths: readonly string[];
}

const WINDOWS_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;

export function normalizeRepositoryPath(path: string): string {
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

function identityForCase(path: string, semantics: CaseSemantics): string {
  return semantics === 'sensitive' ? path : path.toLowerCase();
}

export function createRepositoryPathIdentity(
  path: string,
  options: PathIdentityOptions,
): RepositoryPathIdentity {
  const normalizedPath = normalizeRepositoryPath(path);
  return {
    path: normalizedPath,
    repositoryIdentity: identityForCase(normalizedPath, options.repositoryCase),
    platformIdentity: identityForCase(normalizedPath, options.platformCase),
  };
}

function collectAmbiguities(
  identities: readonly RepositoryPathIdentity[],
  kind: 'repository' | 'platform',
): PathIdentityAmbiguity[] {
  const byIdentity = new Map<string, string[]>();
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

export function findPathIdentityAmbiguities(
  paths: readonly string[],
  options: PathIdentityOptions,
): readonly PathIdentityAmbiguity[] {
  const identities = paths.map((path) => createRepositoryPathIdentity(path, options));
  return [
    ...collectAmbiguities(identities, 'repository'),
    ...collectAmbiguities(identities, 'platform'),
  ];
}
