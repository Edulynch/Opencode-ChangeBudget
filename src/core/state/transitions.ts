import { LifecycleState, LifecycleStateRecord } from '../../models/lifecycle-state.js';
import { StateConflictError } from '../../models/errors.js';

const VALID_TRANSITIONS: Record<LifecycleState, ReadonlyArray<LifecycleState>> = {
  uninitialized: ['initialized'],
  initialized: ['active'],
  active: ['closed'],
  closed: ['initialized', 'active'],
};

function nowIsoString(): string {
  return new Date().toISOString();
}

export function isAllowedTransition(from: LifecycleState, to: LifecycleState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function assertAllowedTransition(
  from: LifecycleState,
  to: LifecycleState,
): void {
  if (!isAllowedTransition(from, to)) {
    throw new StateConflictError(
      `Lifecycle transition from ${from} to ${to} is not allowed.`,
      'lifecycle_state',
      {
        from,
        to,
      },
    );
  }
}

export function transitionLifecycleState(
  state: LifecycleStateRecord,
  target: LifecycleState,
): LifecycleStateRecord {
  assertAllowedTransition(state.lifecycle_state, target);

  return {
    ...state,
    lifecycle_state: target,
    updated_at: nowIsoString(),
  };
}

export function transitionToActive(state: LifecycleStateRecord, activeContractId: string): LifecycleStateRecord {
  const next = transitionLifecycleState(state, 'active');
  return {
    ...next,
    active_contract_id: activeContractId,
    last_closed_contract_id: next.last_closed_contract_id,
  };
}

export function transitionToClosed(state: LifecycleStateRecord): LifecycleStateRecord {
  if (state.lifecycle_state !== 'active') {
    throw new StateConflictError(
      `Cannot close contract because lifecycle state is ${state.lifecycle_state}.`,
      'lifecycle_state',
      { current: state.lifecycle_state },
    );
  }

  const next = transitionLifecycleState(state, 'closed');
  return {
    ...next,
    last_closed_contract_id: state.active_contract_id,
    active_contract_id: null,
  };
}

export function transitionToInitialized(state: LifecycleStateRecord): LifecycleStateRecord {
  const next = transitionLifecycleState(state, 'initialized');
  return {
    ...next,
    active_contract_id: null,
  };
}
