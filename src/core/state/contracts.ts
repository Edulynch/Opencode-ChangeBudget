import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import { ChangeContract } from '../../models/change-contract.js';
import { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import { StateCorruptionError } from '../../models/errors.js';
import {
  getContractFilePath,
  getContractsDirectoryPath,
  removeBaselineEvidence,
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

export async function removeIncompleteBaselineActivation(
  repositoryRoot: string,
  contractId: string,
): Promise<void> {
  await Promise.all([
    rm(getContractFilePath(repositoryRoot, contractId), { force: true }),
    removeBaselineEvidence(repositoryRoot, contractId),
  ]);
}

export function assertActiveContractCoherent(
  state: LifecycleStateRecord,
  contract: ChangeContract,
): ChangeContract {
  if (contract.status !== 'active') {
    throw new StateCorruptionError(
      `Active contract ${state.active_contract_id} has status ${contract.status}; re-run \`changebudget close\` to reconcile`,
      {
        contractId: state.active_contract_id,
        contractStatus: contract.status,
        lifecycleState: state.lifecycle_state,
      },
    );
  }

  return contract;
}

export async function resolveActiveContract(
  repositoryRoot: string,
  state: LifecycleStateRecord,
): Promise<ChangeContract | null> {
  if (!state.active_contract_id) {
    return null;
  }

  const contract = await readContract(repositoryRoot, state.active_contract_id);
  return assertActiveContractCoherent(state, contract);
}

export async function removeOrphanedActiveContracts(repositoryRoot: string): Promise<number> {
  const contractsPath = getContractsDirectoryPath(repositoryRoot);

  let entries: string[];
  try {
    entries = await readdir(contractsPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
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
    let contract: Partial<ChangeContract>;
    try {
      contract = await readJsonFile<Partial<ChangeContract>>(contractPath);
    } catch {
      continue;
    }

    if (contract.status === 'active') {
      await rm(contractPath, { force: true });
      removed += 1;
    }
  }

  return removed;
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
