import { resolve } from 'node:path';
import { getRepositoryRoot, runGit } from '../git/repo.js';
import { resolvePhysicalObjectIdentity, } from './physical-identity.js';
export const REPOSITORY_ANCHOR_KIND = 'git-common-directory-object-v1';
export async function resolveRepositoryBindingCandidate(repositoryRootHint) {
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
//# sourceMappingURL=repository-binding.js.map