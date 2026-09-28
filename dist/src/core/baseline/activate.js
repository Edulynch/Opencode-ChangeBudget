import { StateConflictError } from '../../models/errors.js';
import { transitionToActive } from '../state/transitions.js';
function samePointer(left, right) {
    return left !== null
        && left.lifecycle_state === right.lifecycle_state
        && left.active_contract_id === right.active_contract_id
        && left.last_closed_contract_id === right.last_closed_contract_id
        && left.updated_at === right.updated_at;
}
export async function activateBaseline(options) {
    // This function runs inside the outer lifecycle state transaction. It must
    // use the lock-held methods rather than state-locking wrappers.
    const readState = options.transaction?.readState ?? options.readState;
    const writeState = options.transaction?.writeState ?? options.writeState;
    if (readState === undefined || writeState === undefined) {
        throw new StateConflictError('Baseline activation requires lifecycle state access.', 'lifecycle_state');
    }
    const current = await readState();
    if (!samePointer(current, options.expectedState)) {
        throw new StateConflictError('Baseline activation token is stale or a competing contract became active.', 'lifecycle_state');
    }
    if (!(await options.verify(options.evidence))) {
        throw new StateConflictError('Baseline activation requires complete, verifiable evidence and contract artifacts.', 'baseline');
    }
    const beforeWrite = await readState();
    if (!samePointer(beforeWrite, options.expectedState)) {
        throw new StateConflictError('Baseline activation pointer changed before activation.', 'lifecycle_state');
    }
    const next = transitionToActive(options.expectedState, options.contractId);
    await writeState(next);
    return next;
}
export function baselineContractForActivation(contract, evidence) {
    return {
        ...contract,
        status: 'active',
        comparison_mode: 'baseline',
        baseline_ref: `baselines/${evidence.contractId}.json`,
        activation_head: evidence.activationHead,
    };
}
//# sourceMappingURL=activate.js.map