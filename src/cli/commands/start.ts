import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { rm } from 'node:fs/promises';

import {
  createDraftContract,
  ValidatedContractInput,
} from '../../models/change-contract.js';
import type { ChangeContract } from '../../models/change-contract.js';
import { BaselineEvidenceError, InputValidationError, StateConflictError, StateCorruptionError } from '../../models/errors.js';
import { parseContractInput } from '../parsers/contract-input.js';
import { resolveSpecKitTask } from '../../core/spec-kit/tasks.js';
import { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import {
  normalizeValidatedContractInput,
  validateContractInput,
} from '../../core/validation/contract-validator.js';
import { readContract, writeContract } from '../../core/state/contracts.js';
import { activateBaseline, baselineContractForActivation } from '../../core/baseline/activate.js';
import { captureBaseline } from '../../core/baseline/capture.js';
import type { BaselineEvidence } from '../../core/baseline/types.js';
import { reloadBaselineEvidence } from '../../core/baseline/persistence.js';
import {
  createLifecycleAuditRecord,
  getBaselineEvidencePath,
  getContractFilePath,
  pathExists,
  readBaselineEvidence,
  readJsonFileOptional,
  recoverPendingLifecycleAudits,
  removeBaselineEvidence,
  withLifecycleStateLock,
  withContractFileLock,
  type LifecycleStateTransaction,
} from '../../core/state/state.js';
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

/** Validate the lifecycle pointer against its artifact while holding the state lock. */
async function assertLifecyclePointerCoherent(
  repositoryRoot: string,
  state: LifecycleStateRecord,
): Promise<Awaited<ReturnType<typeof readContract>> | null> {
  if (state.lifecycle_state === 'active') {
    if (typeof state.active_contract_id !== 'string' || state.active_contract_id.length === 0) {
      throw new StateCorruptionError('Active lifecycle state has no active contract pointer', {
        lifecycleState: state.lifecycle_state,
      });
    }
    return withContractFileLock(repositoryRoot, state.active_contract_id, async () => {
      const contract = await readContract(repositoryRoot, state.active_contract_id!);
      if (contract.id !== state.active_contract_id || contract.status !== 'active') {
        throw new StateCorruptionError(
          `Active lifecycle pointer ${state.active_contract_id} does not reference an active contract`,
          { activeContractId: state.active_contract_id, contractId: contract.id, contractStatus: contract.status },
        );
      }
      return contract;
    });
  }

  if (state.lifecycle_state === 'closed') {
    if (state.active_contract_id !== null || typeof state.last_closed_contract_id !== 'string'
      || state.last_closed_contract_id.length === 0) {
      throw new StateCorruptionError('Closed lifecycle state has contradictory contract pointers', {
        activeContractId: state.active_contract_id,
        lastClosedContractId: state.last_closed_contract_id,
      });
    }
    return withContractFileLock(repositoryRoot, state.last_closed_contract_id, async () => {
      const contract = await readContract(repositoryRoot, state.last_closed_contract_id!);
      if (contract.id !== state.last_closed_contract_id || contract.status !== 'closed') {
        throw new StateCorruptionError(
          `Closed lifecycle pointer ${state.last_closed_contract_id} does not reference a closed contract`,
          { lastClosedContractId: state.last_closed_contract_id, contractId: contract.id, contractStatus: contract.status },
        );
      }
      return contract;
    });
  }

  if (state.active_contract_id !== null) {
    throw new StateCorruptionError(`Lifecycle state ${state.lifecycle_state} cannot retain an active contract pointer`, {
      lifecycleState: state.lifecycle_state,
      activeContractId: state.active_contract_id,
    });
  }
  return null;
}

async function assertCandidateArtifactsAbsent(repositoryRoot: string, contractId: string): Promise<void> {
  const contractExists = await pathExists(getContractFilePath(repositoryRoot, contractId));
  const baselineExists = await pathExists(getBaselineEvidencePath(repositoryRoot, contractId));
  if (contractExists || baselineExists) {
    throw new StateConflictError(
      `START candidate ${contractId} already has lifecycle artifacts; preserving them rather than overwriting.`,
      'lifecycle_state',
      { contractId, contractExists, baselineExists },
    );
  }
}

/** Remove only artifacts written by this candidate, and only while no state pointer refers to it. */
async function removeOwnCandidateArtifacts(
  repositoryRoot: string,
  transaction: LifecycleStateTransaction,
  contract: ChangeContract,
  evidence: BaselineEvidence,
): Promise<boolean> {
  const state = await transaction.readState();
  if (state === null || state.active_contract_id === contract.id || state.last_closed_contract_id === contract.id) {
    return false;
  }

  try {
    const persistedContract = await readJsonFileOptional<typeof contract>(getContractFilePath(repositoryRoot, contract.id));
    const persistedEvidence = await readBaselineEvidence(repositoryRoot, contract.id);
    if ((persistedContract !== null && !isDeepStrictEqual(persistedContract, contract))
      || (persistedEvidence !== null && !isDeepStrictEqual(persistedEvidence, evidence))) {
      return false;
    }
    if (persistedContract !== null) {
      await rm(getContractFilePath(repositoryRoot, contract.id), { force: true });
    }
    if (persistedEvidence !== null) {
      await removeBaselineEvidence(repositoryRoot, contract.id);
    }
    return true;
  } catch {
    // Malformed or unreadable artifacts are ambiguous and must be retained.
    return false;
  }
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

  const recoveredAudits = await recoverPendingLifecycleAudits(repositoryRoot);
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
  let resultContractId: string | undefined;
  let resultState: LifecycleStateRecord | undefined;

  // Evidence capture is intentionally outside the lifecycle lock. Everything
  // authoritative is re-read and validated again inside the state→contract
  // lock order before any candidate artifact is written.
  await withLifecycleStateLock(repositoryRoot, async (transaction) => {
    await transaction.assertNoPendingAudits();
    const latest = await transaction.readState();
    const pointedContract = latest === null
      ? null
      : await assertLifecyclePointerCoherent(repositoryRoot, latest);

    const recoveredStart = recoveredAudits.find((record) => record.operation === 'start'
      && record.outcome.status === 'reconciled'
      && record.contract_id !== null
      && latest?.lifecycle_state === 'active'
      && latest.active_contract_id === record.contract_id);
    if (recoveredStart !== undefined && pointedContract !== null) {
      const contractRequest = {
        task_description: pointedContract.task_description,
        task_id: pointedContract.task_id,
        task_title: pointedContract.task_title,
        task_source_feature: pointedContract.task_source_feature,
        task_source_path: pointedContract.task_source_path,
        base_revision: pointedContract.base_revision,
        allow_paths: pointedContract.allow_paths,
        deny_paths: pointedContract.deny_paths,
        max_files: pointedContract.max_files,
        max_changed_lines: pointedContract.max_changed_lines,
        allow_new_files: pointedContract.allow_new_files,
        allow_new_dependencies: pointedContract.allow_new_dependencies,
        allow_migrations: pointedContract.allow_migrations,
        allow_config_changes: pointedContract.allow_config_changes,
        allow_public_api_changes: pointedContract.allow_public_api_changes,
        preset: pointedContract.preset,
        stack_profile: pointedContract.stack_profile,
        disabled_stack_rules: pointedContract.disabled_stack_rules,
        execution_envelope: pointedContract.execution_envelope,
      };
      const requestedContract = {
        task_description: taskAware.task_description,
        task_id: taskAware.task_id,
        task_title: taskAware.task_title,
        task_source_feature: taskAware.task_source_feature,
        task_source_path: taskAware.task_source_path,
        base_revision: taskAware.base_revision,
        allow_paths: taskAware.allow_paths,
        deny_paths: taskAware.deny_paths,
        max_files: taskAware.max_files,
        max_changed_lines: taskAware.max_changed_lines,
        allow_new_files: taskAware.allow_new_files,
        allow_new_dependencies: taskAware.allow_new_dependencies,
        allow_migrations: taskAware.allow_migrations,
        allow_config_changes: taskAware.allow_config_changes,
        allow_public_api_changes: taskAware.allow_public_api_changes,
        preset: taskAware.preset,
        stack_profile: taskAware.stack_profile,
        disabled_stack_rules: taskAware.disabled_stack_rules,
        execution_envelope: taskAware.execution_envelope,
      };
      if (isDeepStrictEqual(contractRequest, requestedContract)) {
        resultContractId = pointedContract.id;
        resultState = latest!;
        return;
      }
    }

    let current: LifecycleStateRecord;
    try {
      current = assertCanStart(latest);
    } catch (error) {
      // A coherent existing active contract is an adjudicated START loser. Its
      // evidence is terminally aborted under the same lock; a BUSY lock failure
      // happens before this point and deliberately creates no synthetic audit.
      if (latest?.lifecycle_state === 'active') {
        await withContractFileLock(repositoryRoot, contractId, async () => {
          await assertCandidateArtifactsAbsent(repositoryRoot, contractId);
          const rejected = createLifecycleAuditRecord({
            operation: 'start',
            repositoryRoot,
            lifecycleBefore: latest.lifecycle_state,
            lifecycleAfter: latest.lifecycle_state,
            afterContract: contract,
          });
          await transaction.persistAudit(rejected);
          await transaction.abortAudit(rejected.event_id);
        });
      }
      throw error;
    }

    await withContractFileLock(repositoryRoot, contractId, async () => {
      await assertCandidateArtifactsAbsent(repositoryRoot, contractId);
      const auditRecord = createLifecycleAuditRecord({
        operation: 'start',
        repositoryRoot,
        lifecycleBefore: current.lifecycle_state,
        lifecycleAfter: 'active',
        afterContract: contract,
      });
      await transaction.persistAudit(auditRecord);

      try {
        await persistBaselineEvidence(repositoryRoot, captured.evidence);
        await writeContract(repositoryRoot, contract);
        await activateBaseline({
          expectedState: current,
          contractId,
          evidence: captured.evidence,
          transaction,
          verify: async (evidence) => (await reloadBaselineEvidence(repositoryRoot, contract)).kind === 'ready'
            && evidence.contractId === contractId,
        });
        await transaction.completeAudit(auditRecord.event_id);
      } catch (error) {
        const observed = await transaction.readState();
        const pointerCommitted = observed?.lifecycle_state === 'active'
          && observed.active_contract_id === contractId;
        if (!pointerCommitted) {
          try {
            if (await removeOwnCandidateArtifacts(repositoryRoot, transaction, contract, captured.evidence)) {
              await transaction.abortAudit(auditRecord.event_id);
            }
          } catch {
            // Keep uncertain evidence and any ambiguous artifact for explicit recovery.
          }
        }
        throw error;
      }

      const committed = await transaction.readState();
      if (committed === null || committed.lifecycle_state !== 'active'
        || committed.active_contract_id !== contractId) {
        throw new StateConflictError('START returned without an active pointer to its contract.', 'lifecycle_state');
      }
      resultContractId = contractId;
      resultState = committed;
    });
  });

  if (resultContractId === undefined || resultState === undefined) {
    throw new StateConflictError('START completed without a verifiable lifecycle result.', 'lifecycle_state');
  }
  return { contractId: resultContractId, state: resultState, repositoryRoot };
}
