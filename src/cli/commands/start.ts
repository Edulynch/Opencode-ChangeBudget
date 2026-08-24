import { randomUUID } from 'node:crypto';

import {
  createDraftContract,
  ValidatedContractInput,
} from '../../models/change-contract.js';
import { BaselineEvidenceError, InputValidationError, StateConflictError } from '../../models/errors.js';
import { parseContractInput } from '../parsers/contract-input.js';
import { resolveSpecKitTask } from '../../core/spec-kit/tasks.js';
import { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import {
  normalizeValidatedContractInput,
  validateContractInput,
} from '../../core/validation/contract-validator.js';
import { removeIncompleteBaselineActivation, removeOrphanedActiveContracts, writeContract } from '../../core/state/contracts.js';
import { activateBaseline, baselineContractForActivation } from '../../core/baseline/activate.js';
import { captureBaseline } from '../../core/baseline/capture.js';
import { reloadBaselineEvidence } from '../../core/baseline/persistence.js';
import { readLifecycleState, writeLifecycleState } from '../../core/state/state.js';
import { persistBaselineEvidence } from '../../core/state/state.js';
import { validateRevision, ensureGitRepository, runGit } from '../../core/git/repo.js';
import { resolveStackPolicy } from '../../core/check/stack-policy.js';

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

async function assertStackPolicyConfigurationIsValid(
  repositoryRoot: string,
  input: ValidatedContractInput,
): Promise<void> {
  if (!input.stack_profile) {
    if (input.disabled_stack_rules.length > 0) {
      throw new InputValidationError(
        'stack_profile must be set when disabled_stack_rules is provided',
        'stack_profile',
        {
          stack_profile: null,
          disabled_stack_rules: input.disabled_stack_rules,
        },
      );
    }

    return;
  }

  // Ensure override file and disabled rule IDs are validated before contract persistence.
  await resolveStackPolicy(repositoryRoot, input.stack_profile, input.disabled_stack_rules);
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

  const resolution = parsed.task_id
    ? await resolveSpecKitTask(repositoryRoot, parsed.task_id)
    : null;

  if (resolution !== null && parsed.task_description === null) {
    parsed.task_description = resolution.task_title;
  }

  if (
    resolution !== null
    && parsed.preset === null
    && resolution.budget_default !== null
  ) {
    const candidate = resolution.budget_default.toLowerCase();
    if (candidate !== 'tiny' && candidate !== 'normal' && candidate !== 'free') {
      throw new InputValidationError(
        'Invalid budget default value. Allowed values: tiny, normal, free',
        'budget_default',
        { value: resolution.budget_default },
      );
    }
    parsed.preset = candidate;
  }

  const normalized = assertInputIsValid(parsed);

  const taskAware: ValidatedContractInput = resolution !== null
    ? {
        ...normalized,
        task_id: resolution.task_id,
        task_title: resolution.task_title,
        task_source_feature: resolution.source_feature,
        task_source_path: resolution.source_path,
      }
    : normalized;

  await assertStackPolicyConfigurationIsValid(repositoryRoot, taskAware);

  if (!(await validateRevision(repositoryRoot, taskAware.base_revision))) {
    throw new InputValidationError('base_revision does not resolve to a local Git commit', 'base_revision', {
      value: taskAware.base_revision,
    });
  }

  const state = await readLifecycleState(repositoryRoot);
  const current = assertCanStart(state);
  await removeOrphanedActiveContracts(repositoryRoot);

  const contractId = toContractId();
  const timestamp = new Date().toISOString();
  const drafted = createDraftContract(taskAware, contractId, timestamp);
  const activationHead = await runGit(repositoryRoot, ['rev-parse', 'HEAD']);
  const captured = await captureBaseline({ repositoryRoot, contractId, activationHead });
  if (!captured.ok) {
    throw new BaselineEvidenceError(captured.reasonCode, 'Unable to capture a stable working-tree baseline.');
  }

  const contract = baselineContractForActivation({
    ...drafted,
    updated_at: timestamp,
  }, captured.evidence);

  try {
    await persistBaselineEvidence(repositoryRoot, captured.evidence);
    await writeContract(repositoryRoot, contract);
    const nextState = await activateBaseline({
      expectedState: current,
      contractId,
      evidence: captured.evidence,
      readState: () => readLifecycleState(repositoryRoot),
      writeState: (stateToWrite) => writeLifecycleState(repositoryRoot, stateToWrite),
      verify: async (evidence) => (await reloadBaselineEvidence(repositoryRoot, contract)).kind === 'ready'
        && evidence.contractId === contractId,
    });

    return {
      contractId,
      state: nextState,
      repositoryRoot,
    };
  } catch (error) {
    await removeIncompleteBaselineActivation(repositoryRoot, contractId);
    throw error;
  }
}
