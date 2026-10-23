import { createHash, randomUUID } from 'node:crypto';
import { lstat } from 'node:fs/promises';

import type { ChangeContract } from '../../models/change-contract.js';
import type { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import { getRepositoryRoot } from '../git/repo.js';
import { assertActiveContractCoherent, resolveActiveContract } from '../state/contracts.js';
import {
  getContractFilePath,
  getStateFilePath,
  openPinnedReadOnlyFileObservation,
  parseLifecycleStateForAuthorityObservation,
  withContractFileLock,
  withLifecycleStateLock,
  type PinnedReadOnlyFileObservation,
} from '../state/state.js';
import {
  AuthorityRegistryError,
  parseAuthorityRegistryObservation,
  type AuthorityRegistrySnapshot,
} from './registry.js';
import {
  getRepositoryReferencePath,
  parseRepositoryPublicReferenceObservation,
  type RepositoryPublicReference,
} from './repository-reference.js';
import { samePhysicalIdentity } from './physical-identity.js';
import { resolveRepositoryBindingCandidate, type RepositoryBindingCandidate } from './repository-binding.js';

const MAX_SUBJECT_LABEL_LENGTH = 256;

export interface WorkContextCandidate {
  readonly binding_status: 'candidate-not-persisted';
  readonly source: 'active-contract' | 'pre-contract';
  readonly repository: RepositoryBindingCandidate;
  readonly contract: ChangeContract | null;
  readonly work: {
    readonly work_id: string;
    readonly authority_id: string;
    readonly contract_id: string | null;
    readonly task_id: string | null;
    readonly work_activation_id: string;
    readonly work_activation_epoch: 1;
    readonly scope_digest: string;
    readonly contract_revision_digest: string;
  };
  readonly subject: {
    readonly subject_id: string;
    readonly subject_label: string | null;
  };
}

export interface WorkContextCandidateInput {
  readonly subjectLabel?: string;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value)), 'utf8').digest('hex');
}

function contractScope(contract: ChangeContract | null): unknown {
  if (contract === null) {
    return {
      allow_paths: [],
      deny_paths: [],
      max_files: null,
      max_changed_lines: null,
      allow_new_files: false,
      allow_new_dependencies: false,
      allow_migrations: false,
      allow_config_changes: false,
      allow_public_api_changes: false,
    };
  }
  return {
    allow_paths: [...contract.allow_paths].sort(),
    deny_paths: [...contract.deny_paths].sort(),
    max_files: contract.max_files,
    max_changed_lines: contract.max_changed_lines,
    allow_new_files: contract.allow_new_files,
    allow_new_dependencies: contract.allow_new_dependencies,
    allow_migrations: contract.allow_migrations,
    allow_config_changes: contract.allow_config_changes,
    allow_public_api_changes: contract.allow_public_api_changes,
    preset: contract.preset,
    stack_profile: contract.stack_profile,
    disabled_stack_rules: [...contract.disabled_stack_rules].sort(),
    execution_envelope: contract.execution_envelope ?? null,
    budget_amendments: contract.budget_amendments ?? [],
    scope_amendments: contract.scope_amendments ?? [],
  };
}

function contractRevision(contract: ChangeContract | null): unknown {
  if (contract === null) return { source: 'pre-contract', version: 1 };
  return {
    source: 'active-contract',
    schema_version: contract.schema_version,
    contract_id: contract.id,
    base_revision: contract.base_revision,
    scope: contractScope(contract),
  };
}

function requirePreContractSubjectLabel(
  lifecycleState: LifecycleStateRecord,
  subjectLabel: string | undefined,
): string {
  if (typeof subjectLabel !== 'string') {
    throw new Error('A pre-contract work context requires a directly selected descriptive subject label.');
  }
  const label = subjectLabel.trim();
  if (
    label.length === 0
    || label.length > MAX_SUBJECT_LABEL_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(label)
  ) {
    throw new Error('The descriptive subject label is empty, too long, or contains control characters.');
  }
  if (lifecycleState.lifecycle_state === 'active') {
    throw new Error('An active contract cannot be represented as pre-contract work.');
  }
  return label;
}

function resolveContractFromState(contract: ChangeContract | null, state: LifecycleStateRecord): ChangeContract | null {
  if (state.lifecycle_state === 'active') {
    if (state.active_contract_id === null || contract === null) {
      throw new Error('The active lifecycle state has no coherent active contract.');
    }
    return contract;
  }
  if (state.active_contract_id !== null || contract !== null) {
    throw new Error('A non-active lifecycle state contains an active contract pointer.');
  }
  return null;
}

function candidateFromContext(
  state: LifecycleStateRecord,
  contract: ChangeContract | null,
  repository: RepositoryBindingCandidate,
  input: WorkContextCandidateInput,
): WorkContextCandidate {
  const activeContract = resolveContractFromState(contract, state);
  const subjectLabel = activeContract === null
    ? requirePreContractSubjectLabel(state, input.subjectLabel)
    : (input.subjectLabel === undefined ? null : normalizeActiveSubjectLabel(input.subjectLabel));
  const scope = contractScope(activeContract);
  return {
    binding_status: 'candidate-not-persisted',
    source: activeContract === null ? 'pre-contract' : 'active-contract',
    repository,
    contract: activeContract,
    work: {
      work_id: randomUUID(),
      authority_id: randomUUID(),
      contract_id: activeContract?.id ?? null,
      task_id: activeContract?.task_id ?? null,
      work_activation_id: randomUUID(),
      work_activation_epoch: 1,
      scope_digest: digest(scope),
      contract_revision_digest: digest(contractRevision(activeContract)),
    },
    subject: {
      subject_id: randomUUID(),
      subject_label: subjectLabel,
    },
  };
}

export interface AuthorityReadObservation {
  readonly root: string;
  readonly state: LifecycleStateRecord;
  readonly contract: ChangeContract | null;
  readonly reference: RepositoryPublicReference;
  readonly registry: AuthorityRegistrySnapshot;
  readonly repository: RepositoryBindingCandidate;
  candidateForSubjectLabel(subjectLabel: string | null): WorkContextCandidate;
}

export interface AuthorityReadObservationPaths {
  readonly statePath: string;
  readonly contractPath: string | null;
  readonly referencePath: string;
  readonly registryPath: string;
}

let authorityReadObservationTestHook:
  | ((paths: AuthorityReadObservationPaths) => Promise<void> | void)
  | undefined;

/** @internal Deterministic replacement seam for bounded authority-inspection tests. */
export function setAuthorityReadObservationTestHook(
  hook: (paths: AuthorityReadObservationPaths) => Promise<void> | void,
): () => void {
  const previous = authorityReadObservationTestHook;
  authorityReadObservationTestHook = hook;
  return () => { authorityReadObservationTestHook = previous; };
}

async function requireAbsentAuthorityLock(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new AuthorityRegistryError('LOCK_OWNERSHIP_UNCERTAIN', `${label} lock path is uninspectable.`, { cause: error });
  }
  throw new AuthorityRegistryError('LOCK_BUSY', `${label} lock is present; bounded read-only authority inspection refuses it.`);
}

async function requireNoAuthorityLocks(paths: readonly (readonly [string, string])[]): Promise<void> {
  for (const [path, label] of paths) await requireAbsentAuthorityLock(path, label);
}

function parseObservedContract(bytes: Buffer, state: LifecycleStateRecord): ChangeContract {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error('The active contract is malformed during authority inspection.', { cause: error });
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('The active contract is not an object during authority inspection.');
  }
  return assertActiveContractCoherent(state, value as ChangeContract);
}

/**
 * Observe the existing authority inputs without acquiring lifecycle, contract,
 * or registry locks and without creating, recovering, or repairing any path.
 * All pinned handles remain open until the callback and final checks complete.
 */
export async function withAuthorityReadObservation<T>(
  repositoryRootHint: string,
  registryPath: string,
  operation: (observation: AuthorityReadObservation) => Promise<T>,
): Promise<T> {
  const root = await getRepositoryRoot(repositoryRootHint);
  const statePath = getStateFilePath(root);
  const referencePath = getRepositoryReferencePath(root);
  const stateLockPath = `${statePath}.lock`;
  const registryLockPath = `${registryPath}.lock`;
  const files: PinnedReadOnlyFileObservation[] = [];
  let contractPath: string | null = null;
  let contractLockPath: string | null = null;

  try {
    await requireNoAuthorityLocks([
      [stateLockPath, 'Lifecycle state'],
      [registryLockPath, 'Authority registry'],
    ]);
    const stateFile = await openPinnedReadOnlyFileObservation(statePath, 4 * 1024 * 1024, 'Lifecycle state');
    files.push(stateFile);
    const state = parseLifecycleStateForAuthorityObservation(stateFile.bytes);
    if ((state.lifecycle_state === 'active') !== (state.active_contract_id !== null)) {
      throw new Error('Lifecycle state and active-contract pointer are incoherent during authority inspection.');
    }

    let contract: ChangeContract | null = null;
    if (state.active_contract_id !== null) {
      const activeContractPath = getContractFilePath(root, state.active_contract_id);
      const activeContractLockPath = `${activeContractPath}.lock`;
      contractPath = activeContractPath;
      contractLockPath = activeContractLockPath;
      await requireAbsentAuthorityLock(activeContractLockPath, 'Active contract');
      const contractFile = await openPinnedReadOnlyFileObservation(activeContractPath, 4 * 1024 * 1024, 'Active contract');
      files.push(contractFile);
      contract = parseObservedContract(contractFile.bytes, state);
    }

    await requireAbsentAuthorityLock(registryLockPath, 'Authority registry');
    const referenceFile = await openPinnedReadOnlyFileObservation(referencePath, 4096, 'Repository authority reference');
    files.push(referenceFile);
    const reference = parseRepositoryPublicReferenceObservation(referenceFile.bytes);
    const registryFile = await openPinnedReadOnlyFileObservation(registryPath, 4 * 1024 * 1024, 'Authority registry');
    files.push(registryFile);
    const registry = parseAuthorityRegistryObservation(registryFile.bytes);
    const repository = await resolveRepositoryBindingCandidate(root);

    const observation: AuthorityReadObservation = {
      root,
      state,
      contract,
      reference,
      registry,
      repository,
      candidateForSubjectLabel(subjectLabel) {
        return candidateFromContext(
          state,
          contract,
          repository,
          subjectLabel === null ? {} : { subjectLabel },
        );
      },
    };

    await authorityReadObservationTestHook?.({
      statePath,
      contractPath,
      referencePath,
      registryPath,
    });
    const result = await operation(observation);
    const locks: Array<readonly [string, string]> = [
      [stateLockPath, 'Lifecycle state'],
      [registryLockPath, 'Authority registry'],
    ];
    if (contractLockPath !== null) locks.push([contractLockPath, 'Active contract']);
    await requireNoAuthorityLocks(locks);
    for (const file of files) await file.validate();
    const repositoryAgain = await resolveRepositoryBindingCandidate(root);
    if (!samePhysicalIdentity(repository.physical_identity, repositoryAgain.physical_identity)) {
      throw new Error('Repository physical identity changed during authority inspection.');
    }
    await requireNoAuthorityLocks(locks);
    for (const file of files) await file.validate();
    await requireNoAuthorityLocks(locks);
    return result;
  } finally {
    await Promise.all(files.map((file) => file.close()));
  }
}

export async function resolveWorkContextCandidate(
  repositoryRootHint: string,
  input: WorkContextCandidateInput = {},
): Promise<WorkContextCandidate> {
  return withWorkContextCandidate(repositoryRootHint, input, async (candidate) => candidate);
}

/**
 * Execute under the existing lifecycle-state -> active-contract lock order.
 * `refresh` rereads coherent state/context while those same locks remain held;
 * callers may keep this lease through the canonical registry transaction.
 */
export async function withWorkContextCandidate<T>(
  repositoryRootHint: string,
  input: WorkContextCandidateInput,
  operation: (
    candidate: WorkContextCandidate,
    refresh: () => Promise<WorkContextCandidate>,
  ) => Promise<T>,
): Promise<T> {
  const repositoryRoot = await getRepositoryRoot(repositoryRootHint);
  return withLifecycleStateLock(repositoryRoot, async (transaction) => {
    const state = await transaction.readState();
    if (state === null) throw new Error('ChangeBudget lifecycle state is unavailable.');
    await transaction.assertNoPendingAudits();

    const lockedContractId = state.active_contract_id;
    const resolveCurrent = async (): Promise<WorkContextCandidate> => {
      const currentState = await transaction.readState();
      if (currentState === null) throw new Error('ChangeBudget lifecycle state is unavailable.');
      await transaction.assertNoPendingAudits();
      if (currentState.active_contract_id !== lockedContractId) {
        throw new Error('Active work context changed while its contract lock was held.');
      }

      const contract = currentState.active_contract_id === null
        ? null
        : await resolveActiveContract(repositoryRoot, currentState);
      const repository = await resolveRepositoryBindingCandidate(repositoryRoot);
      return candidateFromContext(currentState, contract, repository, input);
    };

    if (lockedContractId === null) {
      const candidate = await resolveCurrent();
      return operation(candidate, resolveCurrent);
    }
    return withContractFileLock(repositoryRoot, lockedContractId, async () => {
      const candidate = await resolveCurrent();
      return operation(candidate, resolveCurrent);
    });
  });
}

function normalizeActiveSubjectLabel(subjectLabel: string): string {
  const label = subjectLabel.trim();
  if (
    label.length === 0
    || label.length > MAX_SUBJECT_LABEL_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(label)
  ) {
    throw new Error('The descriptive subject label is empty, too long, or contains control characters.');
  }
  return label;
}
