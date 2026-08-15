import { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import { ChangeContract } from '../../models/change-contract.js';
import { resolveActiveContract, readContract } from '../../core/state/contracts.js';
import { readLifecycleState } from '../../core/state/state.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { InputValidationError } from '../../models/errors.js';

export interface StatusResult {
  repositoryRoot: string;
  lifecycleState: LifecycleStateRecord | null;
  activeContract: ChangeContract | null;
  lastClosedContract: ChangeContract | null;
}

function getContractForState(
  repositoryRoot: string,
  lifecycleState: LifecycleStateRecord,
): Promise<ChangeContract | null> {
  return resolveActiveContract(repositoryRoot, lifecycleState);
}

async function getLastClosedContract(
  repositoryRoot: string,
  lifecycleState: LifecycleStateRecord,
): Promise<ChangeContract | null> {
  if (!lifecycleState.last_closed_contract_id) {
    return null;
  }

  try {
    return await readContract(repositoryRoot, lifecycleState.last_closed_contract_id);
  } catch {
    return null;
  }
}

function parseStatusArgs(args: string[]): void {
  if (args.length > 0) {
    throw new InputValidationError('status does not accept arguments', 'argument', {
      args,
    });
  }
}

export async function runStatus(repositoryRootHint = process.cwd(), args: string[] = []): Promise<StatusResult> {
  parseStatusArgs(args);
  const repositoryRoot = await ensureGitRepository(repositoryRootHint);
  const lifecycleState = await readLifecycleState(repositoryRoot);

  if (!lifecycleState) {
    return {
      repositoryRoot,
      lifecycleState: null,
      activeContract: null,
      lastClosedContract: null,
    };
  }

  const activeContract = await getContractForState(repositoryRoot, lifecycleState);

  const lastClosedContract =
    lifecycleState.lifecycle_state !== 'active' || !activeContract
      ? await getLastClosedContract(repositoryRoot, lifecycleState)
      : null;

  return {
    repositoryRoot,
    lifecycleState,
    activeContract,
    lastClosedContract,
  };
}
