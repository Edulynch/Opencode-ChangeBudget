import type { ChangeContract } from '../../models/change-contract.js';
import type {
  ExecutionEnvelope,
  MaterialDecisionLedgerEntry,
  SatisfactionRecord,
} from '../../models/execution-gate.js';
import { StateCorruptionError, writeContract } from './contracts.js';

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

export interface MaterialDecisionLedgerEntryWriteInput {
  readonly contract: ChangeContract;
  readonly entry: MaterialDecisionLedgerEntry;
  readonly updatedAt: string;
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
  const contract: ChangeContract = {
    ...input.contract,
    execution_envelope: input.envelope,
    updated_at: input.updatedAt,
  };
  await writeContract(repositoryRoot, contract);
  return contract;
}

export async function writeSatisfactionRecordInPlace(
  repositoryRoot: string,
  input: SatisfactionRecordWriteInput,
): Promise<ChangeContract> {
  const envelope = input.contract.execution_envelope;
  if (envelope === undefined) {
    throw new StateCorruptionError(
      `Cannot persist satisfaction for contract ${input.contract.id} without an execution envelope`,
      { contractId: input.contract.id },
    );
  }
  if (envelope.satisfaction.state === 'CONTRACT_SATISFIED' && input.satisfaction.state === 'OPEN') {
    throw new StateCorruptionError(
      `Cannot reopen satisfied contract ${input.contract.id}`,
      { contractId: input.contract.id },
    );
  }
  for (const [criterionId, evidence] of Object.entries(envelope.satisfaction.evidence_by_criterion)) {
    const replacementEvidence = input.satisfaction.evidence_by_criterion[criterionId] ?? [];
    if (!evidence.every((item) => replacementEvidence.includes(item))) {
      throw new StateCorruptionError(
        `Cannot remove satisfaction evidence for criterion ${criterionId} in contract ${input.contract.id}`,
        { contractId: input.contract.id, criterionId },
      );
    }
  }

  const contract: ChangeContract = {
    ...input.contract,
    execution_envelope: { ...envelope, satisfaction: input.satisfaction },
    updated_at: input.updatedAt,
  };
  await writeContract(repositoryRoot, contract);
  return contract;
}

export async function appendMaterialDecisionLedgerEntryInPlace(
  repositoryRoot: string,
  input: MaterialDecisionLedgerEntryWriteInput,
): Promise<ChangeContract> {
  const envelope = input.contract.execution_envelope;
  if (envelope === undefined) {
    throw new StateCorruptionError(
      `Cannot persist material decision for contract ${input.contract.id} without an execution envelope`,
      { contractId: input.contract.id },
    );
  }

  const existingEntry = envelope.ledger.find(
    (entry) => entry.proposal_id === input.entry.proposal_id,
  );
  if (existingEntry !== undefined) {
    if (JSON.stringify(existingEntry) !== JSON.stringify(input.entry)) {
      throw new StateCorruptionError(
        `Material decision proposal ${input.entry.proposal_id} conflicts with its existing ledger entry`,
        { contractId: input.contract.id, proposalId: input.entry.proposal_id },
      );
    }
    return input.contract;
  }

  const contract: ChangeContract = {
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
