export const CURRENT_SCHEMA_VERSION = '1.0.0';

export const LIFECYCLE_STATES = [
  'uninitialized',
  'initialized',
  'active',
  'closed',
] as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

export interface LifecycleStateRecord {
  schema_version: string;
  lifecycle_state: LifecycleState;
  active_contract_id: string | null;
  last_closed_contract_id: string | null;
  updated_at: string;
}

export function isLifecycleState(value: string): value is LifecycleState {
  return (LIFECYCLE_STATES as readonly string[]).includes(value);
}
