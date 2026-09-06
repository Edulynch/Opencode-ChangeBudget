import { StateCorruptionError } from './errors.js';

export const BUDGET_AMENDMENT_FIELDS = ['max_files', 'max_changed_lines'] as const;

export type BudgetAmendmentField = (typeof BUDGET_AMENDMENT_FIELDS)[number];

export interface BudgetLimitChange {
  readonly before: number | null;
  readonly after: number | null;
}

export interface BudgetAmendmentChanges {
  readonly max_files?: BudgetLimitChange;
  readonly max_changed_lines?: BudgetLimitChange;
}

export interface BudgetAmendment {
  readonly sequence: number;
  readonly contract_id: string;
  readonly amended_at: string;
  readonly reason: string | null;
  readonly changes: BudgetAmendmentChanges;
}

export interface BudgetLimits {
  readonly max_files: number | null;
  readonly max_changed_lines: number | null;
}

function corruptHistory(message: string, context: Record<string, unknown>): StateCorruptionError {
  return new StateCorruptionError(`Contract budget amendment history is invalid: ${message}`, context);
}

function readField(value: object, field: string): unknown {
  return Reflect.get(value, field);
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseBudgetLimit(value: unknown, field: string, context: Record<string, unknown>): number | null {
  if (value === null) {
    return null;
  }

  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw corruptHistory(`${field} must be a non-negative safe integer or null`, context);
  }

  return value;
}

function parseLimitChange(
  value: unknown,
  field: BudgetAmendmentField,
  context: Record<string, unknown>,
): BudgetLimitChange {
  if (!isObject(value)) {
    throw corruptHistory(`${field} change must be an object`, context);
  }

  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes('before') || !keys.includes('after')) {
    throw corruptHistory(`${field} change must contain only before and after`, context);
  }

  const before = parseBudgetLimit(readField(value, 'before'), `${field}.before`, context);
  const after = parseBudgetLimit(readField(value, 'after'), `${field}.after`, context);
  if (before === after) {
    throw corruptHistory(`${field} change must alter the budget`, context);
  }

  return { before, after };
}

function parseChanges(value: unknown, context: Record<string, unknown>): BudgetAmendmentChanges {
  if (!isObject(value)) {
    throw corruptHistory('changes must be an object', context);
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    throw corruptHistory('changes must contain at least one numeric budget field', context);
  }

  let maxFiles: BudgetLimitChange | undefined;
  let maxChangedLines: BudgetLimitChange | undefined;
  for (const key of keys) {
    switch (key) {
      case 'max_files':
        maxFiles = parseLimitChange(readField(value, key), key, context);
        break;
      case 'max_changed_lines':
        maxChangedLines = parseLimitChange(readField(value, key), key, context);
        break;
      default:
        throw corruptHistory(`changes contains unsupported field ${key}`, context);
    }
  }

  return {
    ...(maxFiles === undefined ? {} : { max_files: maxFiles }),
    ...(maxChangedLines === undefined ? {} : { max_changed_lines: maxChangedLines }),
  };
}

function parseAmendment(value: unknown, index: number, contractId: string): BudgetAmendment {
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
  if (reason !== null && (typeof reason !== 'string' || reason.trim().length === 0)) {
    throw corruptHistory('reason must be a non-empty string or null', context);
  }

  return {
    sequence,
    contract_id: contractId,
    amended_at: amendedAt,
    reason,
    changes: parseChanges(readField(value, 'changes'), context),
  };
}

function assertCurrentLimit(value: number | null, field: BudgetAmendmentField, contractId: string): void {
  parseBudgetLimit(value, field, { contractId });
}

export function validateBudgetAmendments(
  value: unknown,
  contractId: string,
  limits: BudgetLimits,
): readonly BudgetAmendment[] {
  assertCurrentLimit(limits.max_files, 'max_files', contractId);
  assertCurrentLimit(limits.max_changed_lines, 'max_changed_lines', contractId);
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw corruptHistory('budget_amendments must be an array', { contractId });
  }

  const amendments = value.map((entry, index) => parseAmendment(entry, index, contractId));
  let latestMaxFiles: number | null | undefined;
  let latestMaxChangedLines: number | null | undefined;
  for (const amendment of amendments) {
    if (amendment.changes.max_files !== undefined) {
      if (latestMaxFiles !== undefined && amendment.changes.max_files.before !== latestMaxFiles) {
        throw corruptHistory('max_files history is not contiguous', { contractId, sequence: amendment.sequence });
      }
      latestMaxFiles = amendment.changes.max_files.after;
    }
    if (amendment.changes.max_changed_lines !== undefined) {
      if (latestMaxChangedLines !== undefined && amendment.changes.max_changed_lines.before !== latestMaxChangedLines) {
        throw corruptHistory('max_changed_lines history is not contiguous', { contractId, sequence: amendment.sequence });
      }
      latestMaxChangedLines = amendment.changes.max_changed_lines.after;
    }
  }

  if (latestMaxFiles !== undefined && latestMaxFiles !== limits.max_files) {
    throw corruptHistory('max_files final audit value does not match the contract', { contractId });
  }
  if (latestMaxChangedLines !== undefined && latestMaxChangedLines !== limits.max_changed_lines) {
    throw corruptHistory('max_changed_lines final audit value does not match the contract', { contractId });
  }

  return amendments;
}
