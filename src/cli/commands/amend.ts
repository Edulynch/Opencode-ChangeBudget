import type { ChangeContract } from '../../models/change-contract.js';
import type { LifecycleStateRecord } from '../../models/lifecycle-state.js';
import { InputValidationError, StateConflictError } from '../../models/errors.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { amendContractInPlace, assertActiveContractCoherent, readContract } from '../../core/state/contracts.js';
import { readLifecycleState } from '../../core/state/state.js';

interface AmendOptions {
  readonly maxFiles?: number;
  readonly maxChangedLines?: number;
  readonly reason: string | null;
}

export interface AmendResult {
  readonly repositoryRoot: string;
  readonly contract: ChangeContract;
}

function parseLimit(value: string, field: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new InputValidationError(`${field} must be a non-negative integer`, field, { value });
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new InputValidationError(`${field} must be a safe integer`, field, { value });
  }

  return parsed;
}

function nextValue(args: readonly string[], index: number, field: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new InputValidationError(`Missing value for ${field}`, field);
  }
  return value;
}

function parseAmendArgs(args: readonly string[]): AmendOptions {
  let maxFiles: number | undefined;
  let maxChangedLines: number | undefined;
  let reason: string | null = null;
  const seen = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new InputValidationError(`Unexpected positional argument: ${token}`, 'argument');
    }
    const option = token.slice(2);
    const separator = option.indexOf('=');
    const key = separator === -1 ? option : option.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : option.slice(separator + 1);
    if (seen.has(key)) {
      throw new InputValidationError(`Duplicate option --${key}`, `--${key}`);
    }
    seen.add(key);
    const value = inlineValue === undefined ? nextValue(args, index, `--${key}`) : inlineValue;
    if (inlineValue === undefined) {
      index += 1;
    }

    switch (key) {
      case 'max-files':
        maxFiles = parseLimit(value, '--max-files');
        break;
      case 'max-changed-lines':
        maxChangedLines = parseLimit(value, '--max-changed-lines');
        break;
      case 'reason': {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
          throw new InputValidationError('--reason cannot be empty', '--reason');
        }
        reason = trimmed;
        break;
      }
      default:
        throw new InputValidationError(`Unsupported amendment field --${key}`, `--${key}`);
    }
  }

  if (maxFiles === undefined && maxChangedLines === undefined) {
    throw new InputValidationError('Provide at least one numeric budget to amend', 'amend');
  }

  return { maxFiles, maxChangedLines, reason };
}

function activeContractContext(state: Awaited<ReturnType<typeof readLifecycleState>>): {
  readonly state: LifecycleStateRecord;
  readonly contractId: string;
} {
  if (state === null || state.lifecycle_state !== 'active' || typeof state.active_contract_id !== 'string') {
    throw new StateConflictError('Cannot amend budget because there is no active contract.', 'lifecycle_state');
  }
  return { state, contractId: state.active_contract_id };
}

export async function runAmend(repositoryRootHint = process.cwd(), args: readonly string[] = []): Promise<AmendResult> {
  const repositoryRoot = await ensureGitRepository(repositoryRootHint);
  const options = parseAmendArgs(args);
  const active = activeContractContext(await readLifecycleState(repositoryRoot));
  const activeContract = assertActiveContractCoherent(
    active.state,
    await readContract(repositoryRoot, active.contractId),
  );
  const contract = await amendContractInPlace(repositoryRoot, activeContract, {
    maxFiles: options.maxFiles,
    maxChangedLines: options.maxChangedLines,
    reason: options.reason,
    amendedAt: new Date().toISOString(),
  });

  return { repositoryRoot, contract };
}
