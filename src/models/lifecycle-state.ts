export const CURRENT_SCHEMA_VERSION = '1.0.0';

export const LIFECYCLE_STATES = [
  'uninitialized',
  'initialized',
  'active',
  'closed',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export const LIFECYCLE_AUDIT_OPERATIONS = [
  'init',
  'start',
  'amend',
  'close',
  'native_grant_admin',
] as const;

export type LifecycleAuditOperation = (typeof LIFECYCLE_AUDIT_OPERATIONS)[number];

export type LifecycleAuditValue = string | number | boolean | null | readonly string[];

export interface LifecycleAuditChange {
  field: string;
  before: LifecycleAuditValue;
  after: LifecycleAuditValue;
}

export interface LifecycleAuditRecord {
  audit_schema_version: string;
  event_id: string;
  operation: LifecycleAuditOperation;
  contract_id: string | null;
  recorded_at: string;
  authority: {
    classification: 'UNRESOLVED';
    provenance: 'unavailable';
    human_premise: 'unavailable';
    canonical_grant: 'unavailable';
  };
  repository: {
    observed_root: string;
    verified_binding: 'unavailable';
  };
  work: {
    task_id: string | null;
    verified_binding: 'unavailable';
  };
  version: {
    state_schema_version: string;
    contract_schema_version: string | null;
    authority_schema_version: 'unavailable';
  };
  lifecycle: {
    before: LifecycleState;
    after: LifecycleState;
  };
  scope: {
    paths: {
      allow: readonly string[];
      deny: readonly string[];
    };
    capabilities: {
      new_files: boolean;
      dependencies: boolean;
      migrations: boolean;
      configuration: boolean;
      public_api: boolean;
    };
    ceilings: {
      max_files: { value: number | null; provenance: 'UNRESOLVED' | 'not_applicable' };
      max_changed_lines: { value: number | null; provenance: 'UNRESOLVED' | 'not_applicable' };
    };
  };
  minimum_delta: {
    classification: 'mechanical-delta-only';
    changes: readonly LifecycleAuditChange[];
  };
  boundary: {
    subset_check: 'not_evaluated';
    authority_comparison: 'not_evaluated_phase_b_d';
  };
  rationale: {
    source: 'cli_lifecycle_request';
    statement: 'no_verified_authority_provider; cli_metadata_is_not_approval';
    reason_provided: boolean;
    actor_provided: boolean;
    force_requested: boolean;
    metadata_is_authority: false;
  };
  outcome: {
    status: 'pending' | 'committed' | 'reconciled' | 'aborted';
    confirmation:
      | 'awaiting_operation_write'
      | 'operation_outcome_uncertain'
      | 'operation_write_returned'
      | 'postcondition_verified'
      | 'no_commit_postcondition_verified';
  };
}

export interface LifecycleStateRecord {
  schema_version: string;
  lifecycle_state: LifecycleState;
  active_contract_id: string | null;
  last_closed_contract_id: string | null;
  updated_at: string;
  /** Optional for backward compatibility with lifecycle state written before GV2-002. */
  audit_history?: LifecycleAuditRecord[];
}

export function isLifecycleState(value: string): value is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}
