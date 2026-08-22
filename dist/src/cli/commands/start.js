import { randomUUID } from 'node:crypto';
import { createDraftContract, } from '../../models/change-contract.js';
import { InputValidationError, StateConflictError } from '../../models/errors.js';
import { parseContractInput } from '../parsers/contract-input.js';
import { resolveSpecKitTask } from '../../core/spec-kit/tasks.js';
import { normalizeValidatedContractInput, validateContractInput, } from '../../core/validation/contract-validator.js';
import { writeContract, removeOrphanedActiveContracts } from '../../core/state/contracts.js';
import { readLifecycleState, writeLifecycleState } from '../../core/state/state.js';
import { transitionToActive } from '../../core/state/transitions.js';
import { validateRevision, ensureGitRepository } from '../../core/git/repo.js';
import { resolveStackPolicy } from '../../core/check/stack-policy.js';
function toContractId() {
    const value = randomUUID();
    return `contract-${value}`;
}
function assertInputIsValid(input) {
    const validation = validateContractInput(input);
    if (!validation.valid) {
        throw new InputValidationError(`Contract input validation failed: ${validation.errors.map((error) => error.field).join(', ')}`, 'input', {
            errors: validation.errors,
        });
    }
    return normalizeValidatedContractInput(input);
}
async function assertStackPolicyConfigurationIsValid(repositoryRoot, input) {
    if (!input.stack_profile) {
        if (input.disabled_stack_rules.length > 0) {
            throw new InputValidationError('stack_profile must be set when disabled_stack_rules is provided', 'stack_profile', {
                stack_profile: null,
                disabled_stack_rules: input.disabled_stack_rules,
            });
        }
        return;
    }
    // Ensure override file and disabled rule IDs are validated before contract persistence.
    await resolveStackPolicy(repositoryRoot, input.stack_profile, input.disabled_stack_rules);
}
function assertCanStart(state) {
    if (!state) {
        throw new StateConflictError('Cannot start contract because lifecycle state is uninitialized. Run `changebudget init` first.', 'lifecycle_state', { current: 'uninitialized' });
    }
    if (state.lifecycle_state === 'active') {
        throw new StateConflictError('Cannot start a new contract while another contract is active.', 'lifecycle_state', {
            current: state.lifecycle_state,
            activeContractId: state.active_contract_id,
        });
    }
    if (state.lifecycle_state !== 'initialized' && state.lifecycle_state !== 'closed') {
        throw new StateConflictError(`Cannot start contract from lifecycle state ${state.lifecycle_state}.`, 'lifecycle_state', {
            current: state.lifecycle_state,
        });
    }
    return state;
}
export async function runStart(repositoryRootHint = process.cwd(), args) {
    const repositoryRoot = await ensureGitRepository(repositoryRootHint);
    const parsed = parseContractInput(args);
    const resolution = parsed.task_id
        ? await resolveSpecKitTask(repositoryRoot, parsed.task_id)
        : null;
    if (resolution !== null && parsed.task_description === null) {
        parsed.task_description = resolution.task_title;
    }
    if (resolution !== null
        && parsed.preset === null
        && resolution.budget_default !== null) {
        const candidate = resolution.budget_default.toLowerCase();
        if (candidate !== 'tiny' && candidate !== 'normal' && candidate !== 'free') {
            throw new InputValidationError('Invalid budget default value. Allowed values: tiny, normal, free', 'budget_default', { value: resolution.budget_default });
        }
        parsed.preset = candidate;
    }
    const normalized = assertInputIsValid(parsed);
    const taskAware = resolution !== null
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
    const contractId = toContractId();
    const timestamp = new Date().toISOString();
    const drafted = createDraftContract(taskAware, contractId, timestamp);
    const contract = {
        ...drafted,
        status: 'active',
        updated_at: timestamp,
    };
    await removeOrphanedActiveContracts(repositoryRoot);
    await writeContract(repositoryRoot, contract);
    const nextState = transitionToActive(current, contractId);
    await writeLifecycleState(repositoryRoot, nextState);
    return {
        contractId,
        state: nextState,
        repositoryRoot,
    };
}
//# sourceMappingURL=start.js.map