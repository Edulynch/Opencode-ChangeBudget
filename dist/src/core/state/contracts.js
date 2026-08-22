import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { StateCorruptionError } from '../../models/errors.js';
import { getContractFilePath, getContractsDirectoryPath, readJsonFile, writeJsonFileAtomic, } from './state.js';
export async function readContract(repositoryRoot, contractId) {
    return readJsonFile(getContractFilePath(repositoryRoot, contractId));
}
export async function writeContract(repositoryRoot, contract) {
    await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
}
export function assertActiveContractCoherent(state, contract) {
    if (contract.status !== 'active') {
        throw new StateCorruptionError(`Active contract ${state.active_contract_id} has status ${contract.status}; re-run \`changebudget close\` to reconcile`, {
            contractId: state.active_contract_id,
            contractStatus: contract.status,
            lifecycleState: state.lifecycle_state,
        });
    }
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