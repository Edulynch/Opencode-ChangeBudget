import { resolve } from 'node:path';

import { getRepositoryRoot, runGit } from '../git/repo.js';
import {
  resolvePhysicalObjectIdentity,
  type PhysicalObjectIdentity,
} from './physical-identity.js';

export const REPOSITORY_ANCHOR_KIND = 'git-common-directory-object-v1' as const;

export interface RepositoryBindingCandidate {
  readonly binding_status: 'candidate-not-persisted';
  readonly anchor_kind: typeof REPOSITORY_ANCHOR_KIND;
  readonly physical_identity: PhysicalObjectIdentity;
  /** Discovery-only path. It is never used as an identity key or persisted binding. */
  readonly observed_common_directory: string;
}

export async function resolveRepositoryBindingCandidate(
  repositoryRootHint: string,
): Promise<RepositoryBindingCandidate> {
  const repositoryRoot = await getRepositoryRoot(repositoryRootHint);
  const insideWorkTree = await runGit(repositoryRoot, ['rev-parse', '--is-inside-work-tree']);
  if (insideWorkTree !== 'true') {
    throw new Error('A non-bare Git worktree is required for repository binding.');
  }

  const commonDirectoryOutput = await runGit(repositoryRoot, ['rev-parse', '--git-common-dir']);
  if (!commonDirectoryOutput || commonDirectoryOutput.includes('\0')) {
    throw new Error('Git did not provide an unambiguous common-directory locator.');
  }
  const observedCommonDirectory = resolve(repositoryRoot, commonDirectoryOutput);
  const physicalIdentity = await resolvePhysicalObjectIdentity(observedCommonDirectory);

  return {
    binding_status: 'candidate-not-persisted',
    anchor_kind: REPOSITORY_ANCHOR_KIND,
    physical_identity: physicalIdentity,
    observed_common_directory: observedCommonDirectory,
  };
}
