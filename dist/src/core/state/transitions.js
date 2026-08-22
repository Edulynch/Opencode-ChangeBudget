import { StateConflictError } from '../../models/errors.js';
const VALID_TRANSITIONS = {
    uninitialized: ['initialized'],
    initialized: ['active'],
    active: ['closed'],
    closed: ['initialized', 'active'],
};
function nowIsoString() {
    return new Date().toISOString();
}
export function isAllowedTransition(from, to) {
    return VALID_TRANSITIONS[from].includes(to);
}
export function assertAllowedTransition(from, to) {
    if (!isAllowedTransition(from, to)) {
        throw new StateConflictError(`Lifecycle transition from ${from} to ${to} is not allowed.`, 'lifecycle_state', {
            from,
            to,
        });
    }
}
export function transitionLifecycleState(state, target) {
    assertAllowedTransition(state.lifecycle_state, target);
    return {
        ...state,
        lifecycle_state: target,
        updated_at: nowIsoString(),
    };
}
export function transitionToActive(state, activeContractId) {
    const next = transitionLifecycleState(state, 'active');
    return {
        ...next,
        active_contract_id: activeContractId,
        last_closed_contract_id: next.last_closed_contract_id,
    };
}
export function transitionToClosed(state) {
    if (state.lifecycle_state !== 'active') {
        throw new StateConflictError(`Cannot close contract because lifecycle state is ${state.lifecycle_state}.`, 'lifecycle_state', { current: state.lifecycle_state });
    }
    const next = transitionLifecycleState(state, 'closed');
    return {
        ...next,
        last_closed_contract_id: state.active_contract_id,
        active_contract_id: null,
    };
}
export function transitionToInitialized(state) {
    const next = transitionLifecycleState(state, 'initialized');
    return {
        ...next,
        active_contract_id: null,
    };
}
//# sourceMappingURL=transitions.js.map