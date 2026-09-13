import { isDeepStrictEqual } from 'node:util';
import { evaluateExecutionGate } from '../execution-gate.js';
import { StateCorruptionError } from '../../models/errors.js';
import { getContractFilePath, readJsonFile, withContractFileLock, writeJsonFileAtomic, } from './state.js';
let materialDecisionEvaluationTestHooks;
export function setMaterialDecisionEvaluationTestHooks(hooks) {
    const previousHooks = materialDecisionEvaluationTestHooks;
    materialDecisionEvaluationTestHooks = hooks;
    return () => {
        materialDecisionEvaluationTestHooks = previousHooks;
    };
}
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
export async function evaluateAndRecordMaterialDecisionInPlace(repositoryRoot, input) {
    await materialDecisionEvaluationTestHooks?.beforeLock?.();
    return withContractFileLock(repositoryRoot, input.contractId, async () => {
        const current = await readJsonFile(getContractFilePath(repositoryRoot, input.contractId));
        const envelope = current.execution_envelope;
        if (envelope === undefined) {
            throw new StateCorruptionError(`Cannot evaluate material decision for contract ${input.contractId} without an execution envelope`, { contractId: input.contractId });
        }
        const existingEntry = envelope.ledger.find((entry) => entry.proposal_id === input.proposal.id);
        if (existingEntry !== undefined && !isDeepStrictEqual(existingEntry.proposal, input.proposal)) {
            return {
                contract: current,
                executionGateResult: {
                    kind: 'INVALID_PROPOSAL',
                    reason: 'Material decision proposal ID conflicts with its existing ledger entry',
                },
            };
        }
        const executionGateResult = evaluateExecutionGate({
            envelope,
            operation: { kind: 'MATERIAL_DECISION', proposal: input.proposal },
        });
        if (existingEntry !== undefined || executionGateResult.kind !== 'GOVERNANCE') {
            return { contract: current, executionGateResult };
        }
        const contract = {
            ...current,
            execution_envelope: {
                ...envelope,
                ledger: [
                    ...envelope.ledger,
                    {
                        proposal_id: input.proposal.id,
                        proposal: input.proposal,
                        outcome: executionGateResult.outcome,
                    },
                ],
            },
            updated_at: input.evaluatedAt,
        };
        await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
        await materialDecisionEvaluationTestHooks?.afterPersist?.();
        return { contract, executionGateResult };
    });
}
//# sourceMappingURL=execution-envelope.js.map