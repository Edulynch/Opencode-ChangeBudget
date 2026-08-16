import { LifecycleStateResult } from '../../core/state/state.js';
import { initializeLifecycleState } from '../../core/state/state.js';
import { ensureGitRepository } from '../../core/git/repo.js';

export interface InitResult extends LifecycleStateResult {
  repositoryRoot: string;
}

export async function runInit(repositoryRootHint = process.cwd()): Promise<InitResult> {
  const repositoryRoot = await ensureGitRepository(repositoryRootHint);
  const result = await initializeLifecycleState(repositoryRoot);

  return {
    ...result,
    repositoryRoot,
  };
}
