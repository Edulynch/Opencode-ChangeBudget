import { canonicalizeLiteralPath, isChangeBudgetPath } from '../core/check/literal-path.js';
import { compilePathPatterns, matchPathPattern } from '../core/check/patterns.js';
import type { ChangeContract } from './change-contract.js';
import { InputValidationError, StateCorruptionError } from './errors.js';

export interface ScopeAmendmentChanges {
  readonly allow_paths_added: readonly string[];
}

export interface ScopeAmendment {
  readonly sequence: number;
  readonly contract_id: string;
  readonly amended_at: string;
  readonly reason: string;
  readonly changes: ScopeAmendmentChanges;
}

export interface ScopeAmendmentRequest {
  readonly allowPaths: readonly string[];
  readonly reason: string | null;
  readonly amendedAt: string;
}

export interface PreparedScopeAmendment {
  readonly paths: string[];
  readonly history: ScopeAmendment[] | undefined;
}

function corruptHistory(message: string, context: Record<string, unknown>): StateCorruptionError {
  return new StateCorruptionError(`Contract scope amendment history is invalid: ${message}`, context);
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readField(value: object, field: string): unknown {
  return Reflect.get(value, field);
}

function parseAddedPaths(value: unknown, context: Record<string, unknown>): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw corruptHistory('allow_paths_added must be a non-empty array', context);
  }

  const additions: string[] = [];
  const seen = new Set<string>();
  for (const path of value) {
    if (typeof path !== 'string') {
      throw corruptHistory('allow_paths_added entries must be strings', context);
    }

    const canonical = path.startsWith('/') ? canonicalizeLiteralPath(path.slice(1)) : null;
    const literal = canonical === null ? null : `/${canonical}`;
    if (literal === null || path !== literal || (canonical !== null && isChangeBudgetPath(canonical)) || seen.has(literal)) {
      throw corruptHistory('allow_paths_added entries must be unique canonical root-anchored literals', context);
    }

    seen.add(literal);
    additions.push(literal);
  }

  return additions;
}

function parseAmendment(value: unknown, index: number, contractId: string): ScopeAmendment {
  const context = { index, contractId };
  if (!isObject(value)) {
    throw corruptHistory('entry must be an object', context);
  }

  const sequence = readField(value, 'sequence');
  if (!Number.isSafeInteger(sequence) || sequence !== index + 1) {
    throw corruptHistory('sequence must start at one and be contiguous', context);
  }
  if (readField(value, 'contract_id') !== contractId) {
    throw corruptHistory('contract_id must match the containing contract', context);
  }

  const amendedAt = readField(value, 'amended_at');
  if (typeof amendedAt !== 'string' || amendedAt.trim().length === 0 || Number.isNaN(Date.parse(amendedAt))) {
    throw corruptHistory('amended_at must be a valid timestamp', context);
  }

  const reason = readField(value, 'reason');
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw corruptHistory('reason must be a non-empty string', context);
  }

  const changes = readField(value, 'changes');
  if (!isObject(changes) || Object.keys(changes).length !== 1 || !Object.hasOwn(changes, 'allow_paths_added')) {
    throw corruptHistory('changes must contain only allow_paths_added', context);
  }

  return {
    sequence,
    contract_id: contractId,
    amended_at: amendedAt,
    reason,
    changes: { allow_paths_added: parseAddedPaths(readField(changes, 'allow_paths_added'), context) },
  };
}

export function prepareScopeAmendment(
  contract: ChangeContract,
  request: ScopeAmendmentRequest,
): PreparedScopeAmendment {
  const amendments = validateScopeAmendments(contract.scope_amendments, contract.id, contract.allow_paths);
  if (request.allowPaths.length > 0 && contract.allow_paths.length === 0) {
    throw new InputValidationError('Cannot expand an allow-all contract', '--allow-path');
  }

  const allowPatterns = compilePathPatterns(contract.allow_paths);
  const denyPatterns = compilePathPatterns(contract.deny_paths);
  const paths: string[] = [];
  for (const candidate of request.allowPaths) {
    const canonical = candidate.startsWith('/') ? canonicalizeLiteralPath(candidate.slice(1)) : null;
    if (canonical === null) {
      throw new InputValidationError('allow path must be a safe canonical root-anchored literal', '--allow-path', { value: candidate });
    }

    const literal = `/${canonical}`;
    if (candidate !== literal || isChangeBudgetPath(canonical)) {
      throw new InputValidationError('allow path must be a safe canonical root-anchored literal', '--allow-path', { value: candidate });
    }
    if (paths.includes(literal)) {
      throw new InputValidationError('Duplicate allow path after canonicalization', '--allow-path', { value: candidate });
    }
    if (matchPathPattern(canonical, allowPatterns)) {
      throw new InputValidationError('allow path is already authorized by the active contract', '--allow-path', { value: candidate });
    }
    if (matchPathPattern(canonical, denyPatterns)) {
      throw new InputValidationError('allow path is blocked by deny_paths', '--allow-path', { value: candidate });
    }
    paths.push(literal);
  }

  if (paths.length === 0) {
    return { paths, history: undefined };
  }

  if (request.reason === null || request.reason.trim().length === 0) {
    throw new InputValidationError('--reason is required when expanding allowed paths', '--reason');
  }

  return {
    paths,
    history: [
      ...amendments,
      {
        sequence: amendments.length + 1,
        contract_id: contract.id,
        amended_at: request.amendedAt,
        reason: request.reason,
        changes: { allow_paths_added: paths },
      },
    ],
  };
}

export function validateScopeAmendments(
  value: unknown,
  contractId: string,
  finalAllowPaths: readonly string[],
): readonly ScopeAmendment[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw corruptHistory('scope_amendments must be an array', { contractId });
  }

  const amendments = value.map((entry, index) => parseAmendment(entry, index, contractId));
  const recordedPaths = new Set<string>();
  const finalPaths = new Set(finalAllowPaths);
  for (const amendment of amendments) {
    for (const path of amendment.changes.allow_paths_added) {
      if (recordedPaths.has(path)) {
        throw corruptHistory('allow_paths_added entries must be unique across the history', { contractId, path });
      }
      if (!finalPaths.has(path)) {
        throw corruptHistory('allow_paths_added entries must remain in final allow_paths', { contractId, path });
      }
      recordedPaths.add(path);
    }
  }

  return amendments;
}
