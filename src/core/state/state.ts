import { rm, mkdir, open, readFile, writeFile, rename, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  CURRENT_SCHEMA_VERSION,
  LifecycleAuditChange,
  LifecycleAuditOperation,
  LifecycleAuditRecord,
  LifecycleAuditValue,
  LifecycleState,
  LifecycleStateRecord,
  isLifecycleState,
  LIFECYCLE_AUDIT_OPERATIONS,
} from '../../models/lifecycle-state.js';
import { IOStateError, StateConflictError, StateCorruptionError } from '../../models/errors.js';
import { verifyEvidenceDescriptor } from '../baseline/integrity.js';
import { validateBaselineEvidence } from '../baseline/validation.js';
import type { BaselineEvidence } from '../baseline/types.js';
import type { ChangeContract } from '../../models/change-contract.js';
import { acquireLifecycleStateLock } from './lifecycle-lock-recovery.js';

export const CHANGEBUDGET_DIR = '.changebudget';
export const STATE_FILE = 'state.json';
export const CONTRACTS_DIR = 'contracts';
export const HISTORY_FILE = 'history.json';
export const STACK_POLICY_OVERRIDES_FILE = 'stack-policy-overrides.json';
export const BASELINES_DIR = 'baselines';
const LIFECYCLE_AUDIT_SCHEMA_VERSION = '1.0.0';

export interface LifecycleStateResult {
  state: LifecycleStateRecord;
  changed: boolean;
}

export interface AtomicWriteOptions {
  renameImpl?: (from: string, to: string) => Promise<void>;
  retryDelayMs?: () => number;
  maxRenameAttempts?: number;
}

export const DEFAULT_MAX_RENAME_ATTEMPTS = 3;

export interface LifecycleAuditTestHooks {
  readonly beforeWrite?: (record: LifecycleAuditRecord) => Promise<void>;
}

/** @internal Deterministic failure seam for lifecycle-audit barrier tests. */
let lifecycleAuditTestHooks: LifecycleAuditTestHooks | undefined;

/** @internal Do not use as an operational authority or persistence switch. */
export function setLifecycleAuditTestHooks(hooks: LifecycleAuditTestHooks): () => void {
  const previousHooks = lifecycleAuditTestHooks;
  lifecycleAuditTestHooks = hooks;
  return () => {
    lifecycleAuditTestHooks = previousHooks;
  };
}

function defaultRenameDelayMs(): number {
  return 50 + Math.floor(Math.random() * 101);
}

async function renameWithRetry(
  renameImpl: (from: string, to: string) => Promise<void>,
  tempFilePath: string,
  path: string,
  maxRenameAttempts: number,
  retryDelayMs: () => number,
): Promise<void> {
  let lastCode: string | undefined;

  for (let attempt = 0; attempt < maxRenameAttempts; attempt += 1) {
    try {
      await renameImpl(tempFilePath, path);
      return;
    } catch (error) {
      const renameError = error as NodeJS.ErrnoException;
      lastCode = renameError.code;
      if (renameError.code !== 'EEXIST' && renameError.code !== 'EPERM') {
        throw error;
      }

      if (attempt < maxRenameAttempts - 1) {
        const delay = retryDelayMs();
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
  }

  const exhausted = new Error(
    `rename failed with code ${lastCode ?? 'unknown'} after ${maxRenameAttempts} attempts`,
  ) as NodeJS.ErrnoException;
  exhausted.code = lastCode;
  throw exhausted;
}

export function createInitializedState(): LifecycleStateRecord {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    lifecycle_state: 'initialized',
    active_contract_id: null,
    last_closed_contract_id: null,
    updated_at: new Date().toISOString(),
  };
}

function isLifecycleStateRecord(value: unknown): value is LifecycleStateRecord {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.schema_version !== 'string' || !candidate.schema_version.trim().length) {
    return false;
  }

  if (typeof candidate.lifecycle_state !== 'string' || !isLifecycleState(candidate.lifecycle_state as LifecycleState)) {
    return false;
  }

  const hasUpdatedAt = typeof candidate.updated_at === 'string' && candidate.updated_at.trim().length > 0;
  if (!hasUpdatedAt) {
    return false;
  }

  const hasActiveContractId =
    candidate.active_contract_id === undefined
    || candidate.active_contract_id === null
    || typeof candidate.active_contract_id === 'string';

  const hasLastClosedContractId =
    candidate.last_closed_contract_id === undefined
    || candidate.last_closed_contract_id === null
    || typeof candidate.last_closed_contract_id === 'string';

  const hasValidAuditHistory = candidate.audit_history === undefined
    || (Array.isArray(candidate.audit_history)
      && candidate.audit_history.every(isLifecycleAuditRecord)
      && new Set(candidate.audit_history.map((entry) => (entry as LifecycleAuditRecord).event_id)).size
        === candidate.audit_history.length);

  return hasActiveContractId && hasLastClosedContractId && hasValidAuditHistory;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => isNonEmptyString(entry));
}

function isAuditValue(value: unknown): value is LifecycleAuditValue {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isSafeInteger(value))
    || isStringArray(value);
}

function isLifecycleAuditChange(value: unknown): value is LifecycleAuditChange {
  if (!isObjectRecord(value) || !hasExactKeys(value, ['field', 'before', 'after'])) {
    return false;
  }
  return isNonEmptyString(value.field)
    && [
      'lifecycle_state', 'contract_id', 'status', 'allow_paths', 'deny_paths', 'max_files',
      'max_changed_lines', 'new_files', 'dependencies', 'migrations', 'configuration', 'public_api',
    ].includes(value.field)
    && isAuditValue(value.before)
    && isAuditValue(value.after);
}

function isLifecycleAuditRecord(value: unknown): value is LifecycleAuditRecord {
  if (!isObjectRecord(value)
    || !hasExactKeys(value, [
      'audit_schema_version', 'event_id', 'operation', 'contract_id', 'recorded_at', 'authority', 'repository',
      'work', 'version', 'lifecycle', 'scope', 'minimum_delta', 'boundary', 'rationale', 'outcome',
    ])) {
    return false;
  }

  const authority = value.authority;
  const repository = value.repository;
  const work = value.work;
  const version = value.version;
  const lifecycle = value.lifecycle;
  const scope = value.scope;
  const minimumDelta = value.minimum_delta;
  const boundary = value.boundary;
  const rationale = value.rationale;
  const outcome = value.outcome;
  if (!isObjectRecord(authority) || !hasExactKeys(authority, [
    'classification', 'provenance', 'human_premise', 'canonical_grant',
  ]) || authority.classification !== 'UNRESOLVED' || authority.provenance !== 'unavailable'
    || authority.human_premise !== 'unavailable' || authority.canonical_grant !== 'unavailable') {
    return false;
  }
  if (!isObjectRecord(repository) || !hasExactKeys(repository, ['observed_root', 'verified_binding'])
    || !isNonEmptyString(repository.observed_root) || repository.verified_binding !== 'unavailable') {
    return false;
  }
  if (!isObjectRecord(work) || !hasExactKeys(work, ['task_id', 'verified_binding'])
    || !(work.task_id === null || isNonEmptyString(work.task_id)) || work.verified_binding !== 'unavailable') {
    return false;
  }
  if (!isObjectRecord(version) || !hasExactKeys(version, [
    'state_schema_version', 'contract_schema_version', 'authority_schema_version',
  ]) || !isNonEmptyString(version.state_schema_version)
    || !(version.contract_schema_version === null || isNonEmptyString(version.contract_schema_version))
    || version.authority_schema_version !== 'unavailable') {
    return false;
  }
  if (!isObjectRecord(lifecycle) || !hasExactKeys(lifecycle, ['before', 'after'])
    || typeof lifecycle.before !== 'string' || !isLifecycleState(lifecycle.before)
    || typeof lifecycle.after !== 'string' || !isLifecycleState(lifecycle.after)) {
    return false;
  }
  if (!isObjectRecord(scope) || !hasExactKeys(scope, ['paths', 'capabilities', 'ceilings'])
    || !isObjectRecord(scope.paths) || !hasExactKeys(scope.paths, ['allow', 'deny'])
    || !isStringArray(scope.paths.allow) || !isStringArray(scope.paths.deny)) {
    return false;
  }
  const capabilities = scope.capabilities;
  const ceilings = scope.ceilings;
  if (!isObjectRecord(capabilities) || !hasExactKeys(capabilities, [
    'new_files', 'dependencies', 'migrations', 'configuration', 'public_api',
  ]) || !['new_files', 'dependencies', 'migrations', 'configuration', 'public_api']
    .every((key) => typeof capabilities[key] === 'boolean')) {
    return false;
  }
  if (!isObjectRecord(ceilings) || !hasExactKeys(ceilings, ['max_files', 'max_changed_lines'])) {
    return false;
  }
  for (const key of ['max_files', 'max_changed_lines'] as const) {
    const ceiling = ceilings[key];
    if (!isObjectRecord(ceiling) || !hasExactKeys(ceiling, ['value', 'provenance'])
      || !(ceiling.value === null || (typeof ceiling.value === 'number' && Number.isSafeInteger(ceiling.value)))
      || (ceiling.provenance !== 'UNRESOLVED' && ceiling.provenance !== 'not_applicable')) {
      return false;
    }
  }
  if (!isObjectRecord(minimumDelta) || !hasExactKeys(minimumDelta, ['classification', 'changes'])
    || minimumDelta.classification !== 'mechanical-delta-only'
    || !Array.isArray(minimumDelta.changes) || !minimumDelta.changes.every(isLifecycleAuditChange)) {
    return false;
  }
  if (!isObjectRecord(boundary) || !hasExactKeys(boundary, ['subset_check', 'authority_comparison'])
    || boundary.subset_check !== 'not_evaluated'
    || boundary.authority_comparison !== 'not_evaluated_phase_b_d') {
    return false;
  }
  if (!isObjectRecord(rationale) || !hasExactKeys(rationale, [
    'source', 'statement', 'reason_provided', 'actor_provided', 'force_requested', 'metadata_is_authority',
  ]) || rationale.source !== 'cli_lifecycle_request'
    || rationale.statement !== 'no_verified_authority_provider; cli_metadata_is_not_approval'
    || typeof rationale.reason_provided !== 'boolean' || typeof rationale.actor_provided !== 'boolean'
    || typeof rationale.force_requested !== 'boolean'
    || rationale.metadata_is_authority !== false) {
    return false;
  }
  if (!isObjectRecord(outcome) || !hasExactKeys(outcome, ['status', 'confirmation'])
    || !((outcome.status === 'pending'
      && (outcome.confirmation === 'awaiting_operation_write'
        || outcome.confirmation === 'operation_outcome_uncertain'))
      || (outcome.status === 'committed' && outcome.confirmation === 'operation_write_returned')
      || (outcome.status === 'reconciled' && outcome.confirmation === 'postcondition_verified')
      || (outcome.status === 'aborted' && outcome.confirmation === 'no_commit_postcondition_verified'))) {
    return false;
  }

  return value.audit_schema_version === LIFECYCLE_AUDIT_SCHEMA_VERSION
    && isNonEmptyString(value.event_id)
    && typeof value.operation === 'string'
    && (LIFECYCLE_AUDIT_OPERATIONS as readonly string[]).includes(value.operation)
    && (value.contract_id === null || isNonEmptyString(value.contract_id))
    && isNonEmptyString(value.recorded_at)
    && !Number.isNaN(Date.parse(value.recorded_at));
}

function normalizeLifecycleStateRecord(value: Record<string, unknown>): LifecycleStateRecord {
  return {
    schema_version: String(value.schema_version),
    lifecycle_state: value.lifecycle_state as LifecycleState,
    active_contract_id: typeof value.active_contract_id === 'string' ? value.active_contract_id : null,
    last_closed_contract_id:
      typeof value.last_closed_contract_id === 'string' ? value.last_closed_contract_id : null,
    updated_at: String(value.updated_at),
    ...(Array.isArray(value.audit_history)
      ? { audit_history: value.audit_history as LifecycleAuditRecord[] }
      : {}),
  };
}

async function readLifecycleStateUnlocked(repositoryRoot: string): Promise<LifecycleStateRecord | null> {
  const loaded = await readJsonFileOptional<unknown>(getStateFilePath(repositoryRoot));
  if (loaded === null) {
    return null;
  }

  if (!isLifecycleStateRecord(loaded)) {
    throw new StateCorruptionError('Lifecycle state file has invalid structure', {
      path: getStateFilePath(repositoryRoot),
      valueType: typeof loaded,
    });
  }

  return normalizeLifecycleStateRecord(loaded as unknown as Record<string, unknown>);
}

export async function readLifecycleState(repositoryRoot: string): Promise<LifecycleStateRecord | null> {
  return readLifecycleStateUnlocked(repositoryRoot);
}

function mergeAuditHistory(
  current: readonly LifecycleAuditRecord[] | undefined,
  incoming: readonly LifecycleAuditRecord[] | undefined,
): LifecycleAuditRecord[] | undefined {
  if (!current?.length && !incoming?.length) {
    return undefined;
  }
  const merged = new Map<string, LifecycleAuditRecord>();
  for (const record of [...(current ?? []), ...(incoming ?? [])]) {
    const existing = merged.get(record.event_id);
    if (existing !== undefined && existing.outcome.status !== 'pending') {
      continue;
    }
    merged.set(record.event_id, record);
  }
  return [...merged.values()];
}

async function writeLifecycleStateUnlocked(repositoryRoot: string, state: LifecycleStateRecord): Promise<void> {
  const current = await readLifecycleStateUnlocked(repositoryRoot);
  const auditHistory = mergeAuditHistory(current?.audit_history, state.audit_history);
  const next = {
    ...state,
    ...(auditHistory === undefined ? {} : { audit_history: auditHistory }),
  };
  if (auditHistory === undefined) {
    delete (next as { audit_history?: LifecycleAuditRecord[] }).audit_history;
  }
  await writeJsonFileAtomic(getStateFilePath(repositoryRoot), next);
}

/**
 * A single lifecycle transaction. The state lock is always acquired first;
 * callers may acquire at most one contract lock inside the callback. Methods
 * on this object are lock-held operations and must not call a locking wrapper.
 */
export interface LifecycleStateTransaction {
  readState(): Promise<LifecycleStateRecord | null>;
  writeState(state: LifecycleStateRecord): Promise<void>;
  persistAudit(record: LifecycleAuditRecord): Promise<void>;
  completeAudit(eventId: string): Promise<void>;
  /** Resolve only after a caller has established that the operation did not commit. */
  abortAudit(eventId: string): Promise<void>;
  assertNoPendingAudits(): Promise<void>;
}

export async function withLifecycleStateLock<T>(
  repositoryRoot: string,
  operation: (transaction: LifecycleStateTransaction) => Promise<T>,
): Promise<T> {
  const statePath = getStateFilePath(repositoryRoot);
  const lockPath = `${statePath}.lock`;
  const release = await acquireLifecycleStateLock(repositoryRoot);

  try {
    const transaction: LifecycleStateTransaction = {
      readState: () => readLifecycleStateUnlocked(repositoryRoot),
      writeState: (state) => writeLifecycleStateUnlocked(repositoryRoot, state),
      persistAudit: (record) => persistLifecycleAuditUnlocked(repositoryRoot, record),
      completeAudit: (eventId) => completeLifecycleAuditUnlocked(repositoryRoot, eventId),
      abortAudit: (eventId) => abortLifecycleAuditUnlocked(repositoryRoot, eventId),
      assertNoPendingAudits: async () => {
        const state = await readLifecycleStateUnlocked(repositoryRoot);
        const pending = state?.audit_history?.find((record) => record.outcome.status === 'pending');
        if (pending !== undefined) {
          throw new StateConflictError(
            `Lifecycle audit event ${pending.event_id} has an uncertain outcome; refusing another lifecycle operation.`,
            'lifecycle_audit',
            { eventId: pending.event_id, operation: pending.operation },
          );
        }
      },
    };
    return await operation(transaction);
  } finally {
    try {
      await release();
    } catch (error) {
      throw new IOStateError(`Unable to release lifecycle state lock at ${lockPath}`, {
        path: lockPath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export async function writeLifecycleState(repositoryRoot: string, state: LifecycleStateRecord): Promise<void> {
  await withLifecycleStateLock(repositoryRoot, (transaction) => transaction.writeState(state));
}

async function runLifecycleAuditWriteHook(record: LifecycleAuditRecord): Promise<void> {
  await lifecycleAuditTestHooks?.beforeWrite?.(record);
}

export interface CreateLifecycleAuditRecordInput {
  readonly operation: LifecycleAuditOperation;
  readonly repositoryRoot: string;
  readonly lifecycleBefore: LifecycleState;
  readonly lifecycleAfter: LifecycleState;
  readonly beforeContract?: ChangeContract | null;
  readonly afterContract?: ChangeContract | null;
  readonly reasonProvided?: boolean;
  readonly actorProvided?: boolean;
  readonly forceRequested?: boolean;
}

function contractScope(contract: ChangeContract | null | undefined): LifecycleAuditRecord['scope'] {
  if (contract == null) {
    return {
      paths: { allow: [], deny: [] },
      capabilities: {
        new_files: false,
        dependencies: false,
        migrations: false,
        configuration: false,
        public_api: false,
      },
      ceilings: {
        max_files: { value: null, provenance: 'not_applicable' },
        max_changed_lines: { value: null, provenance: 'not_applicable' },
      },
    };
  }

  return {
    paths: {
      allow: [...contract.allow_paths],
      deny: [...contract.deny_paths],
    },
    capabilities: {
      new_files: contract.allow_new_files,
      dependencies: contract.allow_new_dependencies,
      migrations: contract.allow_migrations,
      configuration: contract.allow_config_changes,
      public_api: contract.allow_public_api_changes,
    },
    ceilings: {
      max_files: { value: contract.max_files, provenance: 'UNRESOLVED' },
      max_changed_lines: { value: contract.max_changed_lines, provenance: 'UNRESOLVED' },
    },
  };
}

function sameAuditValue(left: LifecycleAuditValue, right: LifecycleAuditValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function contractChanges(
  before: ChangeContract | null | undefined,
  after: ChangeContract | null | undefined,
): LifecycleAuditChange[] {
  const changes: LifecycleAuditChange[] = [];
  const beforeFields: Record<string, LifecycleAuditValue> = before == null
    ? { contract_id: null }
    : {
      contract_id: before.id,
      status: before.status,
      allow_paths: [...before.allow_paths],
      deny_paths: [...before.deny_paths],
      max_files: before.max_files,
      max_changed_lines: before.max_changed_lines,
      new_files: before.allow_new_files,
      dependencies: before.allow_new_dependencies,
      migrations: before.allow_migrations,
      configuration: before.allow_config_changes,
      public_api: before.allow_public_api_changes,
    };
  const afterFields: Record<string, LifecycleAuditValue> = after == null
    ? { contract_id: null }
    : {
      contract_id: after.id,
      status: after.status,
      allow_paths: [...after.allow_paths],
      deny_paths: [...after.deny_paths],
      max_files: after.max_files,
      max_changed_lines: after.max_changed_lines,
      new_files: after.allow_new_files,
      dependencies: after.allow_new_dependencies,
      migrations: after.allow_migrations,
      configuration: after.allow_config_changes,
      public_api: after.allow_public_api_changes,
    };
  for (const field of Object.keys(afterFields)) {
    const beforeValue = beforeFields[field] ?? null;
    const afterValue = afterFields[field] ?? null;
    if (!sameAuditValue(beforeValue, afterValue)) {
      changes.push({ field, before: beforeValue, after: afterValue });
    }
  }
  return changes;
}

export function createLifecycleAuditRecord(input: CreateLifecycleAuditRecordInput): LifecycleAuditRecord {
  const beforeContract = input.beforeContract ?? null;
  const afterContract = input.afterContract ?? null;
  const contract = afterContract ?? beforeContract;
  const changes: LifecycleAuditChange[] = [];
  if (input.lifecycleBefore !== input.lifecycleAfter) {
    changes.push({ field: 'lifecycle_state', before: input.lifecycleBefore, after: input.lifecycleAfter });
  }
  changes.push(...contractChanges(beforeContract, afterContract));

  return {
    audit_schema_version: LIFECYCLE_AUDIT_SCHEMA_VERSION,
    event_id: randomUUID(),
    operation: input.operation,
    contract_id: contract?.id ?? null,
    recorded_at: new Date().toISOString(),
    authority: {
      classification: 'UNRESOLVED',
      provenance: 'unavailable',
      human_premise: 'unavailable',
      canonical_grant: 'unavailable',
    },
    repository: {
      observed_root: resolve(input.repositoryRoot),
      verified_binding: 'unavailable',
    },
    work: {
      task_id: contract?.task_id ?? null,
      verified_binding: 'unavailable',
    },
    version: {
      state_schema_version: CURRENT_SCHEMA_VERSION,
      contract_schema_version: contract?.schema_version ?? null,
      authority_schema_version: 'unavailable',
    },
    lifecycle: {
      before: input.lifecycleBefore,
      after: input.lifecycleAfter,
    },
    scope: contractScope(contract),
    minimum_delta: {
      classification: 'mechanical-delta-only',
      changes,
    },
    boundary: {
      subset_check: 'not_evaluated',
      authority_comparison: 'not_evaluated_phase_b_d',
    },
    rationale: {
      source: 'cli_lifecycle_request',
      statement: 'no_verified_authority_provider; cli_metadata_is_not_approval',
      reason_provided: input.reasonProvided ?? false,
      actor_provided: input.actorProvided ?? false,
      force_requested: input.forceRequested ?? false,
      metadata_is_authority: false,
    },
    outcome: {
      status: 'pending',
      confirmation: 'operation_outcome_uncertain',
    },
  };
}

async function persistLifecycleAuditUnlocked(repositoryRoot: string, record: LifecycleAuditRecord): Promise<void> {
  if (!isLifecycleAuditRecord(record) || record.outcome.status !== 'pending') {
    throw new StateCorruptionError('Cannot persist malformed or non-pending lifecycle audit evidence', {
      eventId: record?.event_id,
    });
  }
  const state = await readLifecycleStateUnlocked(repositoryRoot);
  if (state === null) {
    throw new StateConflictError('Cannot persist lifecycle audit evidence without initialized lifecycle state.', 'lifecycle_state');
  }
  const history = state.audit_history ?? [];
  if (history.some((entry) => entry.event_id === record.event_id)) {
    throw new StateCorruptionError(`Lifecycle audit event ${record.event_id} already exists`, { eventId: record.event_id });
  }
  await runLifecycleAuditWriteHook(record);
  await writeJsonFileAtomic(getStateFilePath(repositoryRoot), {
    ...state,
    audit_history: [...history, record],
  });
}

export async function persistLifecycleAudit(repositoryRoot: string, record: LifecycleAuditRecord): Promise<void> {
  await withLifecycleStateLock(repositoryRoot, (transaction) => transaction.persistAudit(record));
}

type AuditPostcondition = 'applied' | 'not_applied' | 'uncertain';
type AuditResolution = 'reconciled' | 'aborted';

function contractValueForAuditField(
  contract: ChangeContract,
  field: string,
): LifecycleAuditValue | undefined {
  switch (field) {
    case 'contract_id': return contract.id;
    case 'status': return contract.status;
    case 'allow_paths': return [...contract.allow_paths];
    case 'deny_paths': return [...contract.deny_paths];
    case 'max_files': return contract.max_files;
    case 'max_changed_lines': return contract.max_changed_lines;
    case 'new_files': return contract.allow_new_files;
    case 'dependencies': return contract.allow_new_dependencies;
    case 'migrations': return contract.allow_migrations;
    case 'configuration': return contract.allow_config_changes;
    case 'public_api': return contract.allow_public_api_changes;
    default: return undefined;
  }
}

function auditChangesMatchContract(
  record: LifecycleAuditRecord,
  contract: ChangeContract,
  side: 'before' | 'after',
): boolean {
  return record.minimum_delta.changes.every((change) => {
    if (change.field === 'lifecycle_state') {
      return true;
    }
    const observed = contractValueForAuditField(contract, change.field);
    return observed !== undefined && sameAuditValue(observed, change[side]);
  });
}

function auditScopeMatchesContract(recordScope: LifecycleAuditRecord['scope'], contract: ChangeContract): boolean {
  const observed = contractScope(contract);
  return JSON.stringify(recordScope.paths.allow) === JSON.stringify(observed.paths.allow)
    && JSON.stringify(recordScope.paths.deny) === JSON.stringify(observed.paths.deny)
    && Object.keys(observed.capabilities).every((key) =>
      recordScope.capabilities[key as keyof typeof recordScope.capabilities]
        === observed.capabilities[key as keyof typeof observed.capabilities])
    && (['max_files', 'max_changed_lines'] as const).every((key) =>
      recordScope.ceilings[key].value === observed.ceilings[key].value
        && recordScope.ceilings[key].provenance === observed.ceilings[key].provenance);
}

async function readAuditContract(
  repositoryRoot: string,
  contractId: string,
): Promise<ChangeContract | null | undefined> {
  try {
    return await readJsonFileOptional<ChangeContract>(getContractFilePath(repositoryRoot, contractId));
  } catch {
    return undefined;
  }
}

async function readAuditBaseline(
  repositoryRoot: string,
  contract: ChangeContract,
): Promise<BaselineEvidence | null | undefined> {
  try {
    return await readBaselineEvidence(repositoryRoot, contract.id);
  } catch {
    return undefined;
  }
}

async function auditPathExists(path: string): Promise<boolean | undefined> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? false : undefined;
  }
}

async function verifyStartedContractPostcondition(
  repositoryRoot: string,
  contract: ChangeContract,
): Promise<boolean> {
  if ((contract.status !== 'active' && contract.status !== 'closed')
    || contract.comparison_mode !== 'baseline'
    || contract.baseline_ref !== `baselines/${contract.id}.json`
    || !contract.activation_head) {
    return false;
  }
  const evidence = await readAuditBaseline(repositoryRoot, contract);
  if (evidence == null) {
    return false;
  }
  return validateBaselineEvidence(contract, evidence, {
    repositoryCase: process.platform === 'win32' ? 'insensitive' : 'sensitive',
    platformCase: process.platform === 'win32' ? 'insensitive' : 'sensitive',
  }).decision === 'PASS';
}

async function auditPostcondition(
  repositoryRoot: string,
  state: LifecycleStateRecord,
  record: LifecycleAuditRecord,
): Promise<AuditPostcondition> {
  if (record.operation === 'init') {
    return state.lifecycle_state === 'uninitialized' ? 'uncertain' : 'applied';
  }
  if (record.contract_id === null) {
    return 'uncertain';
  }

  const contract = await readAuditContract(repositoryRoot, record.contract_id);
  if (contract === undefined) {
    return 'uncertain';
  }

  if (record.operation === 'start') {
    const evidence = contract === null ? null : await readAuditBaseline(repositoryRoot, contract);
    if (evidence === undefined) {
      return 'uncertain';
    }
    const baselineArtifactExists = await auditPathExists(getBaselineEvidencePath(repositoryRoot, record.contract_id));
    if (baselineArtifactExists === undefined) {
      return 'uncertain';
    }
    const activePointer = state.lifecycle_state === 'active'
      && state.active_contract_id === record.contract_id;
    const closedPointer = state.lifecycle_state === 'closed'
      && state.active_contract_id === null
      && state.last_closed_contract_id === record.contract_id;
    if (activePointer || closedPointer) {
      // The pointer and artifact status must agree. A closed contract under an
      // active pointer (or vice versa) is contradictory evidence, not progress.
      if (contract === null || contract.id !== record.contract_id
        || (activePointer && contract.status !== 'active')
        || (closedPointer && contract.status !== 'closed')) {
        return 'uncertain';
      }
      return await verifyStartedContractPostcondition(repositoryRoot, contract) ? 'applied' : 'uncertain';
    }
    if (state.lifecycle_state === record.lifecycle.before
      && contract === null
      && evidence === null
      && !baselineArtifactExists
      && !activePointer
      && !closedPointer) {
      return 'not_applied';
    }
    return 'uncertain';
  }

  if (record.operation === 'amend') {
    if (state.lifecycle_state !== 'active' || state.active_contract_id !== record.contract_id
      || contract === null || contract.id !== record.contract_id || contract.status !== 'active') {
      return 'uncertain';
    }
    if (auditScopeMatchesContract(record.scope, contract)) {
      return 'applied';
    }
    return auditChangesMatchContract(record, contract, 'before') ? 'not_applied' : 'uncertain';
  }

  if (record.operation === 'close') {
    const closedContract = contract !== null && contract.id === record.contract_id && contract.status === 'closed';
    const activeContract = contract !== null && contract.id === record.contract_id && contract.status === 'active';
    if (record.lifecycle.before === 'closed' && record.lifecycle.after === 'closed') {
      // A rejected CLOSE recorded while already closed is a no-commit attempt,
      // even though the lifecycle postcondition was already closed.
      return state.lifecycle_state === 'closed'
        && state.active_contract_id === null
        && state.last_closed_contract_id === record.contract_id
        && closedContract
        ? 'not_applied'
        : 'uncertain';
    }
    if (record.lifecycle.before === 'active' && record.lifecycle.after === 'closed') {
      if (state.lifecycle_state === 'closed' && state.active_contract_id === null
        && state.last_closed_contract_id === record.contract_id && closedContract) {
        return 'applied';
      }
      if (state.lifecycle_state === 'active' && state.active_contract_id === record.contract_id && activeContract) {
        return 'not_applied';
      }
    }
    return 'uncertain';
  }

  return 'uncertain';
}

async function resolveLifecycleAuditUnlocked(
  repositoryRoot: string,
  eventId: string,
  resolution: AuditResolution,
): Promise<LifecycleAuditRecord> {
  const state = await readLifecycleStateUnlocked(repositoryRoot);
  const history = state?.audit_history;
  const index = history?.findIndex((entry) => entry.event_id === eventId) ?? -1;
  if (state === null || history === undefined || index < 0) {
    throw new StateCorruptionError(`Lifecycle audit event ${eventId} is missing during recovery`, { eventId });
  }
  const current = history[index]!;
  if (current.outcome.status !== 'pending') {
    return current;
  }
  const resolved: LifecycleAuditRecord = {
    ...current,
    outcome: resolution === 'reconciled'
      ? { status: 'reconciled', confirmation: 'postcondition_verified' }
      : { status: 'aborted', confirmation: 'no_commit_postcondition_verified' },
  };
  await runLifecycleAuditWriteHook(resolved);
  if (resolution === 'aborted') {
    const latestState = await readLifecycleStateUnlocked(repositoryRoot);
    const latestRecord = latestState?.audit_history?.find((entry) => entry.event_id === eventId);
    if (latestState === null || latestRecord === undefined || latestRecord.outcome.status !== 'pending'
      || await auditPostcondition(repositoryRoot, latestState, latestRecord) !== 'not_applied') {
      throw new StateConflictError(
        `Lifecycle audit event ${eventId} no longer has a verified no-commit postcondition; preserving pending evidence.`,
        'lifecycle_audit',
        { eventId, operation: current.operation },
      );
    }
  }
  const nextHistory = [...history];
  nextHistory[index] = resolved;
  await writeJsonFileAtomic(getStateFilePath(repositoryRoot), { ...state, audit_history: nextHistory });
  return resolved;
}

async function abortLifecycleAuditUnlocked(repositoryRoot: string, eventId: string): Promise<void> {
  const state = await readLifecycleStateUnlocked(repositoryRoot);
  const record = state?.audit_history?.find((entry) => entry.event_id === eventId);
  if (state === null || record === undefined) {
    throw new StateCorruptionError(`Lifecycle audit event ${eventId} is missing before abort`, { eventId });
  }
  if (record.outcome.status !== 'pending') {
    throw new StateConflictError(`Lifecycle audit event ${eventId} is no longer pending.`, 'lifecycle_audit', { eventId });
  }
  if (await auditPostcondition(repositoryRoot, state, record) !== 'not_applied') {
    throw new StateConflictError(
      `Lifecycle audit event ${eventId} has no proven no-commit postcondition; preserving pending evidence.`,
      'lifecycle_audit',
      { eventId, operation: record.operation },
    );
  }
  await resolveLifecycleAuditUnlocked(repositoryRoot, eventId, 'aborted');
}

/**
 * Reconciles uncertain audit completions only from persisted lifecycle postconditions.
 * An unprovable partial write blocks every lifecycle operation until safe evidence exists.
 */
export async function recoverPendingLifecycleAudits(repositoryRoot: string): Promise<LifecycleAuditRecord[]> {
  const initial = await readLifecycleState(repositoryRoot);
  const pending = initial?.audit_history?.filter((record) => record.outcome.status === 'pending') ?? [];
  const recovered: LifecycleAuditRecord[] = [];

  if (pending.length === 0) return recovered;

  // Lock hierarchy: state lock first, then at most one contract lock. Recovery
  // postconditions and terminal audit writes stay inside this same boundary.
  await withLifecycleStateLock(repositoryRoot, async () => {
    for (const record of pending) {
      const reconcile = async (): Promise<LifecycleAuditRecord> => {
        const currentState = await readLifecycleStateUnlocked(repositoryRoot);
        const currentRecord = currentState?.audit_history?.find((entry) => entry.event_id === record.event_id);
        if (currentState === null || currentRecord === undefined) {
          throw new StateConflictError('Lifecycle state or audit evidence disappeared while recovering.', 'lifecycle_audit', {
            eventId: record.event_id,
          });
        }
        if (currentRecord.outcome.status !== 'pending') return currentRecord;

        const postcondition = await auditPostcondition(repositoryRoot, currentState, currentRecord);
        if (postcondition === 'uncertain') {
          throw new StateConflictError(
            `Lifecycle audit event ${record.event_id} has an uncertain outcome; refusing another lifecycle operation.`,
            'lifecycle_audit',
            { eventId: record.event_id, operation: record.operation },
          );
        }
        return resolveLifecycleAuditUnlocked(
          repositoryRoot,
          record.event_id,
          postcondition === 'applied' ? 'reconciled' : 'aborted',
        );
      };

      const resolved = record.contract_id !== null
        && (record.operation === 'start' || record.operation === 'amend' || record.operation === 'close')
        ? await withContractFileLock(repositoryRoot, record.contract_id, reconcile)
        : await reconcile();
      recovered.push(resolved);
    }
  });

  return recovered;
}

async function completeLifecycleAuditUnlocked(repositoryRoot: string, eventId: string): Promise<void> {
  const state = await readLifecycleStateUnlocked(repositoryRoot);
  const history = state?.audit_history;
  const index = history?.findIndex((entry) => entry.event_id === eventId) ?? -1;
  if (state === null || history === undefined || index < 0) {
    throw new StateCorruptionError(`Lifecycle audit event ${eventId} is missing before completion`, { eventId });
  }
  const current = history[index]!;
  if (current.outcome.status === 'committed' || current.outcome.status === 'reconciled') {
    return;
  }
  if (current.outcome.status !== 'pending') {
    throw new StateConflictError(`Lifecycle audit event ${eventId} was already resolved as not committed.`, 'lifecycle_audit', {
      eventId,
    });
  }
  const committed: LifecycleAuditRecord = {
    ...current,
    outcome: { status: 'committed', confirmation: 'operation_write_returned' },
  };
  await runLifecycleAuditWriteHook(committed);
  const nextHistory = [...history];
  nextHistory[index] = committed;
  await writeJsonFileAtomic(getStateFilePath(repositoryRoot), { ...state, audit_history: nextHistory });
}

export async function completeLifecycleAudit(repositoryRoot: string, eventId: string): Promise<void> {
  await withLifecycleStateLock(repositoryRoot, (transaction) => transaction.completeAudit(eventId));
}

export async function initializeLifecycleState(
  repositoryRoot: string,
  auditRecord?: LifecycleAuditRecord,
): Promise<LifecycleStateResult> {
  let result: LifecycleStateResult;
  await withLifecycleStateLock(repositoryRoot, async (transaction) => {
    const existing = await readLifecycleStateUnlocked(repositoryRoot);
    if (existing) {
      await transaction.assertNoPendingAudits();
      result = { state: existing, changed: false };
      return;
    }

    if (auditRecord !== undefined
      && (!isLifecycleAuditRecord(auditRecord) || auditRecord.operation !== 'init'
        || auditRecord.outcome.status !== 'pending')) {
      throw new StateCorruptionError('INIT requires valid pending lifecycle audit evidence', {
        eventId: auditRecord.event_id,
      });
    }
    await ensureDirectory(getContractsDirectoryPath(repositoryRoot));
    const initialized = createInitializedState();
    const state: LifecycleStateRecord = auditRecord === undefined
      ? initialized
      : { ...initialized, audit_history: [auditRecord] };
    if (auditRecord !== undefined) {
      await runLifecycleAuditWriteHook(auditRecord);
    }
    await writeLifecycleStateUnlocked(repositoryRoot, state);
    if (auditRecord !== undefined) {
      await transaction.completeAudit(auditRecord.event_id);
      const completed = await transaction.readState();
      result = { state: completed ?? state, changed: true };
    } else {
      result = { state, changed: true };
    }
  });
  return result!;
}

export function getChangeBudgetDirectory(repositoryRoot: string): string {
  return join(repositoryRoot, CHANGEBUDGET_DIR);
}

export function getStateFilePath(repositoryRoot: string): string {
  return join(getChangeBudgetDirectory(repositoryRoot), STATE_FILE);
}

export function getContractsDirectoryPath(repositoryRoot: string): string {
  return join(getChangeBudgetDirectory(repositoryRoot), CONTRACTS_DIR);
}

export function getStackPolicyOverridesFilePath(repositoryRoot: string): string {
  return join(getChangeBudgetDirectory(repositoryRoot), STACK_POLICY_OVERRIDES_FILE);
}

export function getContractFilePath(repositoryRoot: string, contractId: string): string {
  return join(getContractsDirectoryPath(repositoryRoot), `${contractId}.json`);
}

export async function withContractFileLock<T>(
  repositoryRoot: string,
  contractId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lockPath = `${getContractFilePath(repositoryRoot, contractId)}.lock`;
  await ensureDirectory(dirname(lockPath));

  let lockHandle;
  try {
    lockHandle = await open(lockPath, 'wx');
  } catch (error) {
    throw new IOStateError(`Unable to acquire contract lock at ${lockPath}`, {
      path: lockPath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    return await operation();
  } finally {
    try {
      await lockHandle.close();
      await rm(lockPath);
    } catch (error) {
      throw new IOStateError(`Unable to release contract lock at ${lockPath}`, {
        path: lockPath,
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

export function getHistoryFilePath(repositoryRoot: string): string {
  return join(getContractsDirectoryPath(repositoryRoot), HISTORY_FILE);
}

export function getBaselineEvidencePath(repositoryRoot: string, contractId: string): string {
  return join(getChangeBudgetDirectory(repositoryRoot), BASELINES_DIR, `${contractId}.json`);
}

export async function persistBaselineEvidence(repositoryRoot: string, evidence: BaselineEvidence): Promise<void> {
  if (verifyEvidenceDescriptor(evidence).evidenceState !== 'valid') {
    throw new StateCorruptionError('Cannot persist baseline evidence with invalid integrity', { contractId: evidence.contractId });
  }
  await writeJsonFileAtomic(getBaselineEvidencePath(repositoryRoot, evidence.contractId), evidence);
}

export async function readBaselineEvidence(repositoryRoot: string, contractId: string): Promise<BaselineEvidence | null> {
  const evidence = await readJsonFileOptional<BaselineEvidence>(getBaselineEvidencePath(repositoryRoot, contractId));
  if (evidence !== null && verifyEvidenceDescriptor(evidence).evidenceState !== 'valid') {
    throw new StateCorruptionError('Baseline evidence integrity verification failed', { contractId });
  }
  return evidence;
}

export async function removeBaselineEvidence(repositoryRoot: string, contractId: string): Promise<void> {
  await rm(getBaselineEvidencePath(repositoryRoot, contractId), { force: true });
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sortObjectRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectRecursively);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const prioritized = entries.filter(([key]) => key === 'schema_version');
  const sorted = entries
    .filter(([key]) => key !== 'schema_version')
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(
    [...prioritized, ...sorted].map(([key, val]) => [key, sortObjectRecursively(val)]),
  );
}

function buildStableJson(value: unknown): string {
  return `${JSON.stringify(sortObjectRecursively(value), null, 2)}\n`;
}

export async function readJsonFile<T>(path: string): Promise<T> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    const osError = error as NodeJS.ErrnoException;
    throw new IOStateError(`Unable to read JSON file at ${path}`, {
      path,
      code: typeof osError.code === 'string' ? osError.code : undefined,
      cause: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new StateCorruptionError(`Invalid JSON in file ${path}`,
      {
        path,
        cause: error instanceof Error ? error.message : JSON.stringify(error),
      },
    );
  }
}

export async function readJsonFileOptional<T>(path: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(path);
  } catch (error) {
    if (error instanceof IOStateError && error.context.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function writeJsonFileAtomic<T>(
  path: string,
  value: T,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await ensureDirectory(dirname(path));

  const payload = buildStableJson(value);
  const tempFilePath = `${path}.${Date.now()}.${randomUUID()}.tmp`;
  const renameImpl = options.renameImpl ?? rename;
  const maxRenameAttempts = options.maxRenameAttempts ?? DEFAULT_MAX_RENAME_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? defaultRenameDelayMs;

  try {
    await writeFile(tempFilePath, payload, 'utf8');
    await renameWithRetry(renameImpl, tempFilePath, path, maxRenameAttempts, retryDelayMs);
  } catch (error) {
    await rm(tempFilePath, { force: true });
    throw new IOStateError(`Failed writing JSON atomically to ${path}`, {
      path,
      cause: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
}
