import { initializeLifecycleState } from '../../core/state/state.js';
import { ensureGitRepository } from '../../core/git/repo.js';
export async function runInit(repositoryRootHint = process.cwd()) {
    const repositoryRoot = await ensureGitRepository(repositoryRootHint);
    const result = await initializeLifecycleState(repositoryRoot);
    return {
        ...result,
        repositoryRoot,
    };
}
//# sourceMappingURL=init.js.map