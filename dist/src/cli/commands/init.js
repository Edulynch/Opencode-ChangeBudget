import { createLifecycleAuditRecord, initializeLifecycleState, recoverPendingLifecycleAudits, } from '../../core/state/state.js';
import { ensureGitRepository } from '../../core/git/repo.js';
export async function runInit(repositoryRootHint = process.cwd()) {
    const repositoryRoot = await ensureGitRepository(repositoryRootHint);
    await recoverPendingLifecycleAudits(repositoryRoot);
    const auditRecord = createLifecycleAuditRecord({
        operation: 'init',
        repositoryRoot,
        lifecycleBefore: 'uninitialized',
        lifecycleAfter: 'initialized',
    });
    const result = await initializeLifecycleState(repositoryRoot, auditRecord);
    return {
        ...result,
        repositoryRoot,
    };
}
//# sourceMappingURL=init.js.map