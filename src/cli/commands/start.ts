import { randomUUID } from 'node:crypto';

import {
  createDraftContract,
  ChangeContract,
  ValidatedContractInput,
} from '../../models/change-contract.js';
import { InputValidationError, StateConflictError } from '../../models/errors.js';
import { parseContractInput } from '../parsers/contract-input.js';
import { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import {
  normalizeValidatedContractInput,
  validateContractInput,
} from '../../core/validation/contract-validator.js';
import { writeContract } from '../../core/state/contracts.js';
import { readLifecycleState, writeLifecycleState } from '../../core/state/state.js';
import { transitionToActive } from '../../core/state/transitions.js';
import { validateRevision, ensureGitRepository } from '../../core/git/repo.js';

export interface StartResult {
  contractId: string;
  state: LifecycleStateRecord;
  repositoryRoot: string;
}

export interface StartInput {
  args: string[];
}

function toContractId(): string {
  const value = randomUUID();
  return `contract-${value}`;
}

function assertInputIsValid(input: ReturnType<typeof parseContractInput>): ValidatedContractInput {
  const validation = validateContractInput(input);
  if (!validation.valid) {
    throw new InputValidationError(
      `Contract input validation failed: ${validation.errors.map((error) => error.field).join(', ')}`,
      'input',
      {
        errors: validation.errors,
      },
    );
  }

  return normalizeValidatedContractInput(input);
}

function assertCanStart(state: LifecycleStateRecord | null): LifecycleStateRecord {
  if (!state) {
    throw new StateConflictError(
      'Cannot start contract because lifecycle state is uninitialized. Run `changebudget init` first.',
      'lifecycle_state',
      { current: 'uninitialized' },
    );
  }

  if (state.lifecycle_state === 'active') {
    throw new StateConflictError(
      'Cannot start a new contract while another contract is active.',
      'lifecycle_state',
      {
        current: state.lifecycle_state,
        activeContractId: state.active_contract_id,
      },
    );
  }

  if (state.lifecycle_state !== 'initialized' && state.lifecycle_state !== 'closed') {
    throw new StateConflictError(
      `Cannot start contract from lifecycle state ${state.lifecycle_state}.`,
      'lifecycle_state',
      {
        current: state.lifecycle_state,
      },
    );
  }

  return state;
}

export async function runStart(repositoryRootHint = process.cwd(), args: StartInput['args']): Promise<StartResult> {
  const repositoryRoot = await ensureGitRepository(repositoryRootHint);
  const parsed = parseContractInput(args);
  const normalized = assertInputIsValid(parsed);

  if (!(await validateRevision(repositoryRoot, normalized.base_revision))) {
    throw new InputValidationError('base_revision does not resolve to a local Git commit', 'base_revision', {
      value: normalized.base_revision,
    });
  }

  const state = await readLifecycleState(repositoryRoot);
  const current = assertCanStart(state);

  const contractId = toContractId();
  const timestamp = new Date().toISOString();
  const drafted = createDraftContract(normalized, contractId, timestamp);
  const contract: ChangeContract = {
    ...drafted,
    status: 'active',
    updated_at: timestamp,
  };

  await writeContract(repositoryRoot, contract);

  const nextState = transitionToActive(current, contractId);
  await writeLifecycleState(repositoryRoot, nextState);

  return {
    contractId,
    state: nextState,
    repositoryRoot,
  };
}
