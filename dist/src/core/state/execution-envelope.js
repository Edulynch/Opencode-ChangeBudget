import { isDeepStrictEqual } from 'node:util';
import { StateCorruptionError } from '../../models/errors.js';
import { getContractFilePath, readJsonFile, withContractFileLock, writeJsonFileAtomic, } from './state.js';
export async function writeExecutionEnvelopeInPlace(repositoryRoot, input) {
    if (input.contract.execution_envelope !== undefined) {
        throw new StateCorruptionError(`Cannot replace execution envelope for contract ${input.contract.id}`, { contractId: input.contract.id });
    }
    return withContractFileLock(repositoryRoot, input.contract.id, async () => {
        const current = await readJsonFile(getContractFilePath(repositoryRoot, input.contract.id));
        if (current.execution_envelope !== undefined) {
            throw new StateCorruptionError(`Cannot replace execution envelope for contract ${input.contract.id}`, { contractId: input.contract.id });
        }
        const contract = {
            ...current,
            execution_envelope: input.envelope,
            updated_at: input.updatedAt,
        };
        await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
        return contract;
    });
}
export async function writeSatisfactionRecordInPlace(repositoryRoot, input) {
    const callerEnvelope = input.contract.execution_envelope;
    if (callerEnvelope === undefined) {
        throw new StateCorruptionError(`Cannot persist satisfaction for contract ${input.contract.id} without an execution envelope`, { contractId: input.contract.id });
    }
    if (callerEnvelope.satisfaction.state === 'CONTRACT_SATISFIED' && input.satisfaction.state === 'OPEN') {
        throw new StateCorruptionError(`Cannot reopen satisfied contract ${input.contract.id}`, { contractId: input.contract.id });
    }
    for (const [criterionId, evidence] of Object.entries(callerEnvelope.satisfaction.evidence_by_criterion)) {
        const replacementEvidence = input.satisfaction.evidence_by_criterion[criterionId] ?? [];
        if (!evidence.every((item) => replacementEvidence.includes(item))) {
            throw new StateCorruptionError(`Cannot remove satisfaction evidence for criterion ${criterionId} in contract ${input.contract.id}`, { contractId: input.contract.id, criterionId });
        }
    }
    return withContractFileLock(repositoryRoot, input.contract.id, async () => {
        const current = await readJsonFile(getContractFilePath(repositoryRoot, input.contract.id));
        const currentEnvelope = current.execution_envelope;
        if (currentEnvelope === undefined) {
            throw new StateCorruptionError(`Cannot persist satisfaction for contract ${input.contract.id} without an execution envelope`, { contractId: input.contract.id });
        }
        if (currentEnvelope.satisfaction.state === 'CONTRACT_SATISFIED' && input.satisfaction.state === 'OPEN') {
            throw new StateCorruptionError(`Cannot reopen satisfied contract ${input.contract.id}`, { contractId: input.contract.id });
        }
        const evidenceByCriterion = {
            ...currentEnvelope.satisfaction.evidence_by_criterion,
        };
        for (const [criterionId, evidence] of Object.entries(input.satisfaction.evidence_by_criterion)) {
            evidenceByCriterion[criterionId] = [
                ...new Set([
                    ...(currentEnvelope.satisfaction.evidence_by_criterion[criterionId] ?? []),
                    ...evidence,
                ]),
            ];
        }
        const isComplete = currentEnvelope.acceptance_criteria.every((criterion) => criterion.required_evidence.every((requiredEvidence) => (evidenceByCriterion[criterion.id] ?? []).includes(requiredEvidence)));
        const satisfaction = {
            state: currentEnvelope.satisfaction.state === 'CONTRACT_SATISFIED' || isComplete
                ? 'CONTRACT_SATISFIED'
                : 'OPEN',
            evidence_by_criterion: evidenceByCriterion,
        };
        const contract = {
            ...current,
            execution_envelope: { ...currentEnvelope, satisfaction },
            updated_at: input.updatedAt,
        };
        await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
        return contract;
    });
}
export async function appendMaterialDecisionLedgerEntryInPlace(repositoryRoot, input) {
    if (input.contract.execution_envelope === undefined) {
        throw new StateCorruptionError(`Cannot persist material decision for contract ${input.contract.id} without an execution envelope`, { contractId: input.contract.id });
    }
    return withContractFileLock(repositoryRoot, input.contract.id, async () => {
        const current = await readJsonFile(getContractFilePath(repositoryRoot, input.contract.id));
        const currentEnvelope = current.execution_envelope;
        if (currentEnvelope === undefined) {
            throw new StateCorruptionError(`Cannot persist material decision for contract ${input.contract.id} without an execution envelope`, { contractId: input.contract.id });
        }
        const existingEntry = currentEnvelope.ledger.find((entry) => entry.proposal_id === input.entry.proposal_id);
        if (existingEntry !== undefined) {
            if (!isDeepStrictEqual(existingEntry, input.entry)) {
                throw new StateCorruptionError(`Material decision proposal ${input.entry.proposal_id} conflicts with its existing ledger entry`, { contractId: input.contract.id, proposalId: input.entry.proposal_id });
            }
            return current;
        }
        const contract = {
            ...current,
            execution_envelope: {
                ...currentEnvelope,
                ledger: [...currentEnvelope.ledger, input.entry],
            },
            updated_at: input.updatedAt,
        };
        await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
        return contract;
    });
}
//# sourceMappingURL=execution-envelope.js.map