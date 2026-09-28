import { recoverPendingLifecycleAudits } from '../../core/state/state.js';
import {
  lifecycleLockReconciliationFailure,
  lifecycleLockRecoveryRefusal,
  recoverLifecycleLock,
  type LifecycleLockRecoveryResult,
} from '../../core/state/lifecycle-lock-recovery.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { InputValidationError } from '../../models/errors.js';

export interface LifecycleLockRecoveryOptions {
  readonly reason: string;
  readonly force: boolean;
}

function parseLifecycleLockRecoveryArgs(args: readonly string[]): LifecycleLockRecoveryOptions {
  const usage = 'Usage: changebudget recover lifecycle-lock --reason "<non-empty reason>" OR --force --reason "<non-empty reason>"';
  if (args[0] !== 'lifecycle-lock') {
    throw new InputValidationError(usage, 'recover');
  }

  let reason: string | undefined;
  let force = false;
  if (args.length === 3 && args[1] === '--reason') {
    reason = args[2];
  } else if (args.length === 4 && args[1] === '--force' && args[2] === '--reason') {
    force = true;
    reason = args[3];
  } else {
    throw new InputValidationError(usage, 'recover');
  }

  if (reason === undefined || reason.trim().length === 0 || reason.startsWith('--')) {
    throw new InputValidationError('--reason requires a non-empty value', '--reason');
  }
  return { reason, force };
}

export async function runRecover(
  repositoryRootHint = process.cwd(),
  args: readonly string[] = [],
): Promise<LifecycleLockRecoveryResult> {
  const options = parseLifecycleLockRecoveryArgs(args);
  const repositoryRoot = await ensureGitRepository(repositoryRootHint);
  const result = await recoverLifecycleLock(repositoryRoot, options, () => recoverPendingLifecycleAudits(repositoryRoot));
  if (result.outcome === 'REFUSED') throw lifecycleLockRecoveryRefusal(result);
  if (result.pendingAuditReconciliation === 'failed') {
    throw lifecycleLockReconciliationFailure(result);
  }
  return result;
}
