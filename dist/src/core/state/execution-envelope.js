import { StateCorruptionError, writeContract } from './contracts.js';
export async function writeExecutionEnvelopeInPlace(repositoryRoot, input) {
    const contract = {
        ...input.contract,
        execution_envelope: input.envelope,
        updated_at: input.updatedAt,
    };
    await writeContract(repositoryRoot, contract);
    return contract;
}
export async function writeSatisfactionRecordInPlace(repositoryRoot, input) {
    const envelope = input.contract.execution_envelope;
    if (envelope === undefined) {
        throw new StateCorruptionError(`Cannot persist satisfaction for contract ${input.contract.id} without an execution envelope`, { contractId: input.contract.id });
    }
    if (envelope.satisfaction.state === 'CONTRACT_SATISFIED' && input.satisfaction.state === 'OPEN') {
        throw new StateCorruptionError(`Cannot reopen satisfied contract ${input.contract.id}`, { contractId: input.contract.id });
    }
    const contract = {
        ...input.contract,
        execution_envelope: { ...envelope, satisfaction: input.satisfaction },
        updated_at: input.updatedAt,
    };
    await writeContract(repositoryRoot, contract);
    return contract;
}
export async function appendMaterialDecisionLedgerEntryInPlace(repositoryRoot, input) {
    const envelope = input.contract.execution_envelope;
    if (envelope === undefined) {
        throw new StateCorruptionError(`Cannot persist material decision for contract ${input.contract.id} without an execution envelope`, { contractId: input.contract.id });
    }
    const existingEntry = envelope.ledger.find((entry) => entry.proposal_id === input.entry.proposal_id);
    if (existingEntry !== undefined) {
        if (JSON.stringify(existingEntry) !== JSON.stringify(input.entry)) {
            throw new StateCorruptionError(`Material decision proposal ${input.entry.proposal_id} conflicts with its existing ledger entry`, { contractId: input.contract.id, proposalId: input.entry.proposal_id });
        }
        return input.contract;
    }
    const contract = {
        ...input.contract,
        execution_envelope: {
            ...envelope,
            ledger: [...envelope.ledger, input.entry],
        },
        updated_at: input.updatedAt,
    };
    await writeContract(repositoryRoot, contract);
    return contract;
}
//# sourceMappingURL=execution-envelope.js.map