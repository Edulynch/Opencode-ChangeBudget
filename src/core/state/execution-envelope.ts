import { isDeepStrictEqual } from 'node:util';

import { evaluateExecutionGate } from '../execution-gate.js';
import type { ChangeContract } from '../../models/change-contract.js';
import type {
  ExecutionEnvelope,
  ExecutionGateResult,
  MaterialDecision,
  SatisfactionRecord,
} from '../../models/execution-gate.js';
import { StateCorruptionError } from '../../models/errors.js';
import {
  getContractFilePath,
  readJsonFile,
  withContractFileLock,
  writeJsonFileAtomic,
} from './state.js';

export interface ExecutionEnvelopeWriteInput {
  readonly contract: ChangeContract;
  readonly envelope: ExecutionEnvelope;
  readonly updatedAt: string;
}

export interface SatisfactionRecordWriteInput {
  readonly contract: ChangeContract;
  readonly satisfaction: SatisfactionRecord;
  readonly updatedAt: string;
}

export interface MaterialDecisionEvaluationInput {
  readonly contractId: string;
  readonly proposal: MaterialDecision;
  readonly evaluatedAt: string;
}

export interface MaterialDecisionEvaluation {
  readonly contract: ChangeContract;
  readonly executionGateResult: ExecutionGateResult;
}

export interface MaterialDecisionEvaluationTestHooks {
  readonly beforeLock?: () => Promise<void>;
  readonly afterPersist?: () => Promise<void>;
}

let materialDecisionEvaluationTestHooks: MaterialDecisionEvaluationTestHooks | undefined;

export function setMaterialDecisionEvaluationTestHooks(
  hooks: MaterialDecisionEvaluationTestHooks,
): () => void {
  const previousHooks = materialDecisionEvaluationTestHooks;
  materialDecisionEvaluationTestHooks = hooks;
  return () => {
    materialDecisionEvaluationTestHooks = previousHooks;
  };
}

export async function writeExecutionEnvelopeInPlace(
  repositoryRoot: string,
  input: ExecutionEnvelopeWriteInput,
): Promise<ChangeContract> {
  if (input.contract.execution_envelope !== undefined) {
    throw new StateCorruptionError(
      `Cannot replace execution envelope for contract ${input.contract.id}`,
      { contractId: input.contract.id },
    );
  }

  return withContractFileLock(repositoryRoot, input.contract.id, async () => {
    const current = await readJsonFile<ChangeContract>(
      getContractFilePath(repositoryRoot, input.contract.id),
    );
    if (current.execution_envelope !== undefined) {
      throw new StateCorruptionError(
        `Cannot replace execution envelope for contract ${input.contract.id}`,
        { contractId: input.contract.id },
      );
    }

    const contract: ChangeContract = {
      ...current,
      execution_envelope: input.envelope,
      updated_at: input.updatedAt,
    };
    await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
    return contract;
  });
}

export async function writeSatisfactionRecordInPlace(
  repositoryRoot: string,
  input: SatisfactionRecordWriteInput,
): Promise<ChangeContract> {
  const callerEnvelope = input.contract.execution_envelope;
  if (callerEnvelope === undefined) {
    throw new StateCorruptionError(
      `Cannot persist satisfaction for contract ${input.contract.id} without an execution envelope`,
      { contractId: input.contract.id },
    );
  }
  if (callerEnvelope.satisfaction.state === 'CONTRACT_SATISFIED' && input.satisfaction.state === 'OPEN') {
    throw new StateCorruptionError(
      `Cannot reopen satisfied contract ${input.contract.id}`,
      { contractId: input.contract.id },
    );
  }
  for (const [criterionId, evidence] of Object.entries(callerEnvelope.satisfaction.evidence_by_criterion)) {
    const replacementEvidence = input.satisfaction.evidence_by_criterion[criterionId] ?? [];
    if (!evidence.every((item) => replacementEvidence.includes(item))) {
      throw new StateCorruptionError(
        `Cannot remove satisfaction evidence for criterion ${criterionId} in contract ${input.contract.id}`,
        { contractId: input.contract.id, criterionId },
      );
    }
  }

  return withContractFileLock(repositoryRoot, input.contract.id, async () => {
    const current = await readJsonFile<ChangeContract>(
      getContractFilePath(repositoryRoot, input.contract.id),
    );
    const currentEnvelope = current.execution_envelope;
    if (currentEnvelope === undefined) {
      throw new StateCorruptionError(
        `Cannot persist satisfaction for contract ${input.contract.id} without an execution envelope`,
        { contractId: input.contract.id },
      );
    }
    if (currentEnvelope.satisfaction.state === 'CONTRACT_SATISFIED' && input.satisfaction.state === 'OPEN') {
      throw new StateCorruptionError(
        `Cannot reopen satisfied contract ${input.contract.id}`,
        { contractId: input.contract.id },
      );
    }

    const evidenceByCriterion: Record<string, readonly string[]> = {
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
    const isComplete = currentEnvelope.acceptance_criteria.every((criterion) =>
      criterion.required_evidence.every((requiredEvidence) =>
        (evidenceByCriterion[criterion.id] ?? []).includes(requiredEvidence),
      ),
    );
    const satisfaction: SatisfactionRecord = {
      state: currentEnvelope.satisfaction.state === 'CONTRACT_SATISFIED' || isComplete
        ? 'CONTRACT_SATISFIED'
        : 'OPEN',
      evidence_by_criterion: evidenceByCriterion,
    };
    const contract: ChangeContract = {
      ...current,
      execution_envelope: { ...currentEnvelope, satisfaction },
      updated_at: input.updatedAt,
    };
    await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
    return contract;
  });
}

export async function evaluateAndRecordMaterialDecisionInPlace(
  repositoryRoot: string,
  input: MaterialDecisionEvaluationInput,
): Promise<MaterialDecisionEvaluation> {
  await materialDecisionEvaluationTestHooks?.beforeLock?.();
  return withContractFileLock(repositoryRoot, input.contractId, async () => {
    const current = await readJsonFile<ChangeContract>(
      getContractFilePath(repositoryRoot, input.contractId),
    );
    const envelope = current.execution_envelope;
    if (envelope === undefined) {
      throw new StateCorruptionError(
        `Cannot evaluate material decision for contract ${input.contractId} without an execution envelope`,
        { contractId: input.contractId },
      );
    }

    const existingEntry = envelope.ledger.find(
      (entry) => entry.proposal_id === input.proposal.id,
    );
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

    const contract: ChangeContract = {
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
