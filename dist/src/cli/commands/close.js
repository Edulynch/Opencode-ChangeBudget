import { StateConflictError } from '../../models/errors.js';
import { readLifecycleState, writeLifecycleState } from '../../core/state/state.js';
import { closeContractInPlace } from '../../core/state/contracts.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { transitionToClosed } from '../../core/state/transitions.js';
import { InputValidationError } from '../../models/errors.js';
function parseNextValue(args, index) {
    if (index + 1 >= args.length) {
        throw new InputValidationError('Missing value for option', 'option');
    }
    const value = args[index + 1];
    if (value.startsWith('--')) {
        throw new InputValidationError('Missing value for option', 'option');
    }
    return { value, nextIndex: index + 1 };
}
function parseCloseArgs(args) {
    let actor;
    let reason;
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!token.startsWith('--')) {
            throw new InputValidationError(`Unexpected positional argument: ${token}`, 'argument');
        }
        const pair = token.slice(2).split('=', 2);
        const key = pair[0].toLowerCase();
        const inlineValue = pair.length === 2 ? pair[1] : null;
        if (key === 'actor' || key === 'reason') {
            const value = inlineValue === null ? parseNextValue(args, index).value : inlineValue;
            if (inlineValue === null) {
                index += 1;
            }
            if (key === 'actor') {
                actor = value;
            }
            else {
                reason = value;
            }
            continue;
        }
        throw new InputValidationError(`Unknown option --${key}`, `--${key}`);
    }
    return { actor, reason };
}
function assertStateCanClose(state) {
    if (!state) {
        throw new StateConflictError('Cannot close contract because lifecycle state is uninitialized.', 'lifecycle_state', {
            current: 'uninitialized',
        });
    }
    if (state.lifecycle_state !== 'active') {
        throw new StateConflictError(`Cannot close contract because lifecycle state is ${state.lifecycle_state}.`, 'lifecycle_state', {
            current: state.lifecycle_state,
        });
    }
    if (!state.active_contract_id) {
        throw new StateConflictError('No active contract id is stored in state.', 'active_contract_id', {
            state,
        });
    }
    return state;
}
export async function runClose(repositoryRootHint = process.cwd(), args = []) {
    const repositoryRoot = await ensureGitRepository(repositoryRootHint);
    const options = parseCloseArgs(args);
    const state = await readLifecycleState(repositoryRoot);
    const current = assertStateCanClose(state);
    const contractId = current.active_contract_id;
    const closedAt = new Date().toISOString();
    const contract = await closeContractInPlace(repositoryRoot, contractId, closedAt, {
        closedBy: options.actor,
        closeReason: options.reason,
    });
    const nextState = transitionToClosed(current);
    await writeLifecycleState(repositoryRoot, nextState);
    return {
        repositoryRoot,
        contractId,
        state: nextState,
        contract,
    };
}
//# sourceMappingURL=close.js.map