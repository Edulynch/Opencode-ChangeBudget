import { stderr } from 'node:process';

import {
  ChangeBudgetError,
  GitEnvironmentError,
  InputValidationError,
  IOStateError,
  isChangeBudgetError,
  StateConflictError,
  StateCorruptionError,
} from '../models/errors.js';
import { DecisionResult } from '../models/check-result.js';

export const EXIT_CODES = {
  OK: 0,
  INPUT_OR_USAGE: 2,
  STATE_CONFLICT: 3,
  ENVIRONMENT: 4,
  UNKNOWN: 10,
} as const;

export const DECISION_EXIT_CODES = {
  PASS: EXIT_CODES.OK,
  REPAIR: 1,
  HUMAN_REVIEW: 2,
} as const;

export function getExitCode(error: unknown): number {
  if (!isChangeBudgetError(error)) {
    return EXIT_CODES.UNKNOWN;
  }

  if (error instanceof InputValidationError) {
    return EXIT_CODES.INPUT_OR_USAGE;
  }

  if (error instanceof StateConflictError) {
    return EXIT_CODES.STATE_CONFLICT;
  }

  if (error instanceof GitEnvironmentError || error instanceof IOStateError || error instanceof StateCorruptionError) {
    return EXIT_CODES.ENVIRONMENT;
  }

  return EXIT_CODES.UNKNOWN;
}

export function formatError(error: unknown): string {
  if (!isChangeBudgetError(error)) {
    return `Unexpected error: ${String(error)}`;
  }

  const knownError = error as ChangeBudgetError;
  const context = Object.entries(knownError.context)
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join('; ');

  return context.length
    ? `${knownError.name}: ${knownError.message} (${context})`
    : `${knownError.name}: ${knownError.message}`;
}

export function printError(error: unknown): void {
  stderr.write(`${formatError(error)}\n`);
}

export function formatExitCode(error: unknown): number {
  return getExitCode(error);
}

export function getDecisionExitCode(result: { decision: DecisionResult } | null | undefined): number {
  if (!result) {
    return EXIT_CODES.UNKNOWN;
  }

  return DECISION_EXIT_CODES[result.decision];
}
