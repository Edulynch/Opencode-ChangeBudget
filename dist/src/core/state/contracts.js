import { rm } from 'node:fs/promises';
import { validateBudgetAmendments } from '../../models/budget-amendment.js';
import { prepareScopeAmendment, validateScopeAmendments } from '../../models/scope-amendment.js';
import { InputValidationError, StateCorruptionError } from '../../models/errors.js';
import { getContractFilePath, removeBaselineEvidence, readJsonFile, withContractFileLock, writeJsonFileAtomic, } from './state.js';
export { StateCorruptionError };
export { evaluateAndRecordMaterialDecisionInPlace, setMaterialDecisionEvaluationTestHooks, writeExecutionEnvelopeInPlace, writeSatisfactionRecordInPlace, } from './execution-envelope.js';
export async function readContract(repositoryRoot, contractId) {
    return readJsonFile(getContractFilePath(repositoryRoot, contractId));
}
export async function writeContract(repositoryRoot, contract) {
    await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
}
export async function amendContractInPlace(repositoryRoot, contract, input, beforeCommit) {
    return withContractFileLock(repositoryRoot, contract.id, async () => {
        const current = await readContract(repositoryRoot, contract.id);
        if (current.id !== contract.id) {
            throw new StateCorruptionError(`Contract file id ${current.id} does not match requested id ${contract.id}`, {
                contractId: contract.id,
                fileContractId: current.id,
            });
        }
        return amendContractUnderLock(repositoryRoot, current, input, beforeCommit);
    });
}
/** Amend a previously read contract while its contract lock is already held. */
export async function amendContractUnderLock(repositoryRoot, current, input, beforeCommit) {
    if (current.status !== 'active') {
        throw new StateCorruptionError(`Cannot amend non-active contract ${current.id}`, {
            contractId: current.id,
            contractStatus: current.status,
        });
    }
    const amendments = validateBudgetAmendments(current.budget_amendments, current.id, {
        max_files: current.max_files,
        max_changed_lines: current.max_changed_lines,
    });
    const scope = prepareScopeAmendment(current, input);
    const maxFilesChange = input.maxFiles === undefined || input.maxFiles === current.max_files
        ? undefined
        : {
            max_files: { before: current.max_files, after: input.maxFiles },
        };
    const maxChangedLinesChange = input.maxChangedLines === undefined || input.maxChangedLines === current.max_changed_lines
        ? undefined
        : {
            max_changed_lines: { before: current.max_changed_lines, after: input.maxChangedLines },
        };
    const changes = {
        ...maxFilesChange,
        ...maxChangedLinesChange,
    };
    const hasNumericChanges = changes.max_files !== undefined || changes.max_changed_lines !== undefined;
    if (!hasNumericChanges && scope.paths.length === 0) {
        throw new InputValidationError('Requested values do not change the active contract', 'amend');
    }
    const amended = {
        ...current,
        ...(maxFilesChange === undefined ? {} : { max_files: input.maxFiles }),
        ...(maxChangedLinesChange === undefined ? {} : { max_changed_lines: input.maxChangedLines }),
        ...(scope.paths.length === 0 ? {} : { allow_paths: [...current.allow_paths, ...scope.paths] }),
        updated_at: input.amendedAt,
        ...(hasNumericChanges ? {
            budget_amendments: [
                ...amendments,
                {
                    sequence: amendments.length + 1,
                    contract_id: current.id,
                    amended_at: input.amendedAt,
                    reason: input.reason,
                    changes,
                },
            ],
        } : {}),
        ...(scope.history === undefined ? {} : { scope_amendments: scope.history }),
    };
    await beforeCommit?.(current, amended);
    await writeContract(repositoryRoot, amended);
    return amended;
}
export async function removeIncompleteBaselineActivation(repositoryRoot, contractId) {
    await Promise.all([
        rm(getContractFilePath(repositoryRoot, contractId), { force: true }),
        removeBaselineEvidence(repositoryRoot, contractId),
    ]);
}
export function assertActiveContractCoherent(state, contract) {
    if (contract.id !== state.active_contract_id) {
        throw new StateCorruptionError(`Active contract file id ${contract.id} does not match state id ${state.active_contract_id}`, {
            contractId: contract.id,
            activeContractId: state.active_contract_id,
            lifecycleState: state.lifecycle_state,
        });
    }
    if (contract.status !== 'active') {
        throw new StateCorruptionError(`Active contract ${state.active_contract_id} has status ${contract.status}; re-run \`changebudget close\` to reconcile`, {
            contractId: state.active_contract_id,
            contractStatus: contract.status,
            lifecycleState: state.lifecycle_state,
        });
    }
    validateBudgetAmendments(contract.budget_amendments, contract.id, {
        max_files: contract.max_files,
        max_changed_lines: contract.max_changed_lines,
    });
    validateScopeAmendments(contract.scope_amendments, contract.id, contract.allow_paths);
    return contract;
}
export async function resolveActiveContract(repositoryRoot, state) {
    if (!state.active_contract_id) {
        return null;
    }
    const contract = await readContract(repositoryRoot, state.active_contract_id);
    return assertActiveContractCoherent(state, contract);
}
export async function closeContractInPlace(repositoryRoot, contractId, closedAt, metadata = {}, beforeCommit) {
    return withContractFileLock(repositoryRoot, contractId, async () => {
        const contract = await readContract(repositoryRoot, contractId);
        if (contract.id !== contractId || contract.status !== 'active') {
            throw new StateCorruptionError(`Cannot close non-active contract ${contractId}`, {
                contractId,
                fileContractId: contract.id,
                contractStatus: contract.status,
            });
        }
        const closed = {
            ...contract,
            status: 'closed',
            closed_by: metadata.closedBy ?? null,
            close_reason: metadata.closeReason ?? null,
            forced_close: metadata.forced ?? false,
            closed_at: closedAt,
            updated_at: closedAt,
        };
        await beforeCommit?.(contract, closed);
        await writeContract(repositoryRoot, closed);
        return closed;
    });
}
//# sourceMappingURL=contracts.js.map