import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { validateBudgetAmendments } from '../../models/budget-amendment.js';
import { InputValidationError } from '../../models/errors.js';
import { StateCorruptionError } from '../../models/errors.js';
import { getContractFilePath, getContractsDirectoryPath, removeBaselineEvidence, readJsonFile, writeJsonFileAtomic, } from './state.js';
export async function readContract(repositoryRoot, contractId) {
    return readJsonFile(getContractFilePath(repositoryRoot, contractId));
}
export async function writeContract(repositoryRoot, contract) {
    await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
}
export async function amendContractInPlace(repositoryRoot, contract, input) {
    if (contract.status !== 'active') {
        throw new StateCorruptionError(`Cannot amend non-active contract ${contract.id}`, {
            contractId: contract.id,
            contractStatus: contract.status,
        });
    }
    const amendments = validateBudgetAmendments(contract.budget_amendments, contract.id, {
        max_files: contract.max_files,
        max_changed_lines: contract.max_changed_lines,
    });
    const maxFilesChange = input.maxFiles === undefined || input.maxFiles === contract.max_files
        ? undefined
        : {
            max_files: { before: contract.max_files, after: input.maxFiles },
        };
    const maxChangedLinesChange = input.maxChangedLines === undefined || input.maxChangedLines === contract.max_changed_lines
        ? undefined
        : {
            max_changed_lines: { before: contract.max_changed_lines, after: input.maxChangedLines },
        };
    const changes = {
        ...maxFilesChange,
        ...maxChangedLinesChange,
    };
    if (changes.max_files === undefined && changes.max_changed_lines === undefined) {
        throw new InputValidationError('Requested budget values do not change the active contract', 'amend');
    }
    const amended = {
        ...contract,
        ...(maxFilesChange === undefined ? {} : { max_files: input.maxFiles }),
        ...(maxChangedLinesChange === undefined ? {} : { max_changed_lines: input.maxChangedLines }),
        updated_at: input.amendedAt,
        budget_amendments: [
            ...amendments,
            {
                sequence: amendments.length + 1,
                contract_id: contract.id,
                amended_at: input.amendedAt,
                reason: input.reason,
                changes,
            },
        ],
    };
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
    return contract;
}
export async function resolveActiveContract(repositoryRoot, state) {
    if (!state.active_contract_id) {
        return null;
    }
    const contract = await readContract(repositoryRoot, state.active_contract_id);
    return assertActiveContractCoherent(state, contract);
}
export async function removeOrphanedActiveContracts(repositoryRoot) {
    const contractsPath = getContractsDirectoryPath(repositoryRoot);
    let entries;
    try {
        entries = await readdir(contractsPath);
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return 0;
        }
        throw error;
    }
    let removed = 0;
    for (const entry of entries) {
        if (!entry.endsWith('.json')) {
            continue;
        }
        const contractPath = join(contractsPath, entry);
        let contract;
        try {
            contract = await readJsonFile(contractPath);
        }
        catch {
            continue;
        }
        if (contract.status === 'active') {
            await rm(contractPath, { force: true });
            removed += 1;
        }
    }
    return removed;
}
export async function closeContractInPlace(repositoryRoot, contractId, closedAt, metadata = {}) {
    const contract = await readContract(repositoryRoot, contractId);
    const closed = {
        ...contract,
        status: 'closed',
        closed_by: metadata.closedBy ?? null,
        close_reason: metadata.closeReason ?? null,
        closed_at: closedAt,
        updated_at: closedAt,
    };
    await writeContract(repositoryRoot, closed);
    return closed;
}
//# sourceMappingURL=contracts.js.map