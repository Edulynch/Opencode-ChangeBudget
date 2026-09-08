import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { ChangeContract } from '../../models/change-contract.js';
import { validateBudgetAmendments } from '../../models/budget-amendment.js';
import { prepareScopeAmendment, validateScopeAmendments } from '../../models/scope-amendment.js';
import type { BudgetAmendmentChanges } from '../../models/budget-amendment.js';
import { InputValidationError } from '../../models/errors.js';
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

export interface ContractAmendmentInput {
  readonly maxFiles?: number;
  readonly maxChangedLines?: number;
  readonly allowPaths: readonly string[];
  readonly reason: string | null;
  readonly amendedAt: string;
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

export async function amendContractInPlace(
  repositoryRoot: string,
  contract: ChangeContract,
  input: ContractAmendmentInput,
): Promise<ChangeContract> {
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
  const scope = prepareScopeAmendment(contract, input);
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
  const changes: BudgetAmendmentChanges = {
    ...maxFilesChange,
    ...maxChangedLinesChange,
  };
  const hasNumericChanges = changes.max_files !== undefined || changes.max_changed_lines !== undefined;
  if (!hasNumericChanges && scope.paths.length === 0) {
    throw new InputValidationError('Requested values do not change the active contract', 'amend');
  }

  const amended: ChangeContract = {
    ...contract,
    ...(maxFilesChange === undefined ? {} : { max_files: input.maxFiles }),
    ...(maxChangedLinesChange === undefined ? {} : { max_changed_lines: input.maxChangedLines }),
    ...(scope.paths.length === 0 ? {} : { allow_paths: [...contract.allow_paths, ...scope.paths] }),
    updated_at: input.amendedAt,
    ...(hasNumericChanges ? {
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
    } : {}),
    ...(scope.history === undefined ? {} : { scope_amendments: scope.history }),
  };
  await writeContract(repositoryRoot, amended);
  return amended;
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
  if (contract.id !== state.active_contract_id) {
    throw new StateCorruptionError(
      `Active contract file id ${contract.id} does not match state id ${state.active_contract_id}`,
      {
        contractId: contract.id,
        activeContractId: state.active_contract_id,
        lifecycleState: state.lifecycle_state,
      },
    );
  }

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

  validateBudgetAmendments(contract.budget_amendments, contract.id, {
    max_files: contract.max_files,
    max_changed_lines: contract.max_changed_lines,
  });
  validateScopeAmendments(contract.scope_amendments, contract.id, contract.allow_paths);

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
