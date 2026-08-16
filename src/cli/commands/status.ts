import { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import { ChangeContract } from '../../models/change-contract.js';
import { resolveActiveContract, readContract } from '../../core/state/contracts.js';
import { readLifecycleState } from '../../core/state/state.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import {
  GitEnvironmentError,
  IOStateError,
  InputValidationError,
  StateCorruptionError,
} from '../../models/errors.js';
import { BudgetCheckResult, ReasonCode } from '../../models/check-result.js';
import { runCheck } from './check.js';

interface ParsedStatusArgs {
  budget: boolean;
  json: boolean;
}

export interface StatusResult {
  repositoryRoot: string;
  lifecycleState: LifecycleStateRecord | null;
  activeContract: ChangeContract | null;
  lastClosedContract: ChangeContract | null;
  budgetRequested: boolean;
  budgetJson: boolean;
  budgetResult: BudgetCheckResult | null;
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

function parseStatusArgs(args: string[]): ParsedStatusArgs {
  let budget = false;
  let json = false;

  for (const token of args) {
    if (token === '--budget') {
      budget = true;
      continue;
    }

    if (token === '--json') {
      json = true;
      continue;
    }

    if (token.startsWith('--json=')) {
      const value = token.slice('--json='.length).toLowerCase();
      if (value.length === 0) {
        throw new InputValidationError('Invalid value for --json', 'json');
      }

      if (value !== 'true' && value !== 'false') {
        throw new InputValidationError('Invalid value for --json', 'json', { value: token.slice('--json='.length) });
      }

      json = value === 'true';
      continue;
    }

    throw new InputValidationError('status does not accept arguments', 'argument', {
      args,
    });
  }

  if (json && !budget) {
    throw new InputValidationError('status --json requires --budget', 'json', {
      args,
    });
  }

  return { budget, json };
}

function mapBudgetFailureReasonCode(error: unknown): ReasonCode {
  if (error instanceof InputValidationError) {
    return 'CBV-INPUT-INVALID';
  }

  if (error instanceof GitEnvironmentError) {
    const context = error.context;
    if (context?.reason === 'unresolved') {
      return 'CBV-BASE-REVISION-UNKNOWN';
    }

    return 'CBV-ENV-NOT-READY';
  }

  if (error instanceof StateCorruptionError || error instanceof IOStateError) {
    return 'CBV-RULE-CONFIG-INVALID';
  }

  return 'CBV-ENV-NOT-READY';
}

function buildFailureBudgetResult(
  contractId: string | null,
  baseRevision: string,
  reasonCode: ReasonCode,
  message: string,
): BudgetCheckResult {
  return {
    contractSource: 'active',
    contractId,
    baseRevision,
    changedFileCount: 0,
    changedLinesCount: 0,
    binaryChangeCount: 0,
    newFileCount: 0,
    deletedFileCount: 0,
    renamedFileCount: 0,
    pathRuleResults: [],
    limitResults: [],
    violations: [
      {
        rule: 'max_files',
        message,
        reasonCode,
        action: 'review',
      },
    ],
    status: 'FAIL',
    decision: 'HUMAN_REVIEW',
    reasonCodes: [reasonCode],
    asOf: new Date().toISOString(),
  };
}

function buildStatusResultErrorBase(
  lifecycleState: LifecycleStateRecord | null,
  budgetRequested: boolean,
  budgetJson: boolean,
  repositoryRoot: string,
): Pick<StatusResult,
  'repositoryRoot' |
  'lifecycleState' |
  'activeContract' |
  'lastClosedContract' |
  'budgetRequested' |
  'budgetJson' |
  'budgetResult'
> {
  return {
    repositoryRoot,
    lifecycleState,
    activeContract: null,
    lastClosedContract: null,
    budgetRequested,
    budgetJson,
    budgetResult: null,
  };
}

function describeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to evaluate budget status.';
}

function toBaseRevision(activeContract: ChangeContract | null): string {
  return activeContract?.base_revision ?? 'unknown';
}

function getLastClosedContractForStatus(
  repositoryRoot: string,
  lifecycleState: LifecycleStateRecord,
  activeContract: ChangeContract | null,
): Promise<ChangeContract | null> {
  return lifecycleState.lifecycle_state !== 'active' || !activeContract
    ? getLastClosedContract(repositoryRoot, lifecycleState)
    : Promise.resolve(null);
}

function parseStatusBaseErrorContractMessage(activeContractId: string | null): string {
  if (activeContractId) {
    return `Unable to evaluate budget for active contract ${activeContractId}.`;
  }

  return 'Unable to evaluate budget without an active contract.';
}

export async function runStatus(repositoryRootHint = process.cwd(), args: string[] = []): Promise<StatusResult> {
  const parsed = parseStatusArgs(args);
  const repositoryRoot = await ensureGitRepository(repositoryRootHint);
  const lifecycleState = await readLifecycleState(repositoryRoot);

  if (!lifecycleState) {
    const baseResult = buildStatusResultErrorBase(
      null,
      parsed.budget,
      parsed.json,
      repositoryRoot,
    );

    if (!parsed.budget) {
      return baseResult;
    }

    return {
      ...baseResult,
      budgetResult: buildFailureBudgetResult(
        null,
        'unknown',
        'CBV-INPUT-INVALID',
        'No lifecycle state exists in this repository.',
      ),
    };
  }

  let activeContract: ChangeContract | null = null;

  if (lifecycleState.active_contract_id) {
    try {
      activeContract = await getContractForState(repositoryRoot, lifecycleState);
    } catch (error) {
      if (!parsed.budget) {
        throw error;
      }

      return {
        repositoryRoot,
        lifecycleState,
        activeContract: null,
        lastClosedContract: await getLastClosedContract(repositoryRoot, lifecycleState),
        budgetRequested: true,
        budgetJson: parsed.json,
        budgetResult: buildFailureBudgetResult(
          lifecycleState.active_contract_id,
          'unknown',
          mapBudgetFailureReasonCode(error),
          parseStatusBaseErrorContractMessage(lifecycleState.active_contract_id),
        ),
      };
    }
  }

  const lastClosedContract = await getLastClosedContractForStatus(repositoryRoot, lifecycleState, activeContract);

  if (!parsed.budget) {
    return {
      repositoryRoot,
      lifecycleState,
      activeContract,
      lastClosedContract,
      budgetRequested: false,
      budgetJson: parsed.json,
      budgetResult: null,
    };
  }

  if (!activeContract) {
    return {
      repositoryRoot,
      lifecycleState,
      activeContract,
      lastClosedContract,
      budgetRequested: true,
      budgetJson: parsed.json,
      budgetResult: buildFailureBudgetResult(
        lifecycleState.active_contract_id,
        'unknown',
        'CBV-INPUT-INVALID',
        parseStatusBaseErrorContractMessage(lifecycleState.active_contract_id),
      ),
    };
  }

  try {
    const budgetResult = await runCheck(repositoryRoot, []);
    return {
      repositoryRoot,
      lifecycleState,
      activeContract,
      lastClosedContract,
      budgetRequested: true,
      budgetJson: parsed.json,
      budgetResult,
    };
  } catch (error) {
    return {
      repositoryRoot,
      lifecycleState,
      activeContract,
      lastClosedContract,
      budgetRequested: true,
      budgetJson: parsed.json,
      budgetResult: buildFailureBudgetResult(
        activeContract.id,
        toBaseRevision(activeContract),
        mapBudgetFailureReasonCode(error),
        `${parseStatusBaseErrorContractMessage(activeContract.id)} ${describeErrorMessage(error)}`,
      ),
    };
  }
}
