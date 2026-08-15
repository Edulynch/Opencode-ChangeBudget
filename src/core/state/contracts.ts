import { ChangeContract } from '../../models/change-contract.js';
import { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import {
  getContractFilePath,
  readJsonFile,
  writeJsonFileAtomic,
} from './state.js';

export interface ContractCloseMetadata {
  closedBy?: string | null;
  closeReason?: string | null;
}

export async function readContract(
  repositoryRoot: string,
  contractId: string,
): Promise<ChangeContract> {
  return readJsonFile<ChangeContract>(
    getContractFilePath(repositoryRoot, contractId),
  );
}

export async function writeContract(
  repositoryRoot: string,
  contract: ChangeContract,
): Promise<void> {
  await writeJsonFileAtomic(getContractFilePath(repositoryRoot, contract.id), contract);
}

export async function resolveActiveContract(
  repositoryRoot: string,
  state: LifecycleStateRecord,
): Promise<ChangeContract | null> {
  if (!state.active_contract_id) {
    return null;
  }

  return readContract(repositoryRoot, state.active_contract_id);
}

export async function closeContractInPlace(
  repositoryRoot: string,
  contractId: string,
  closedAt: string,
  metadata: ContractCloseMetadata = {},
): Promise<ChangeContract> {
  const contract = await readContract(repositoryRoot, contractId);

  const closed: ChangeContract = {
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
