import type { BaselineEvidenceState, BaselineReasonCode } from '../core/baseline/types.js';

export type ErrorCategory =
  | 'INPUT_VALIDATION'
  | 'STATE_CONFLICT'
  | 'GIT_ENVIRONMENT'
  | 'STATE_CORRUPTION'
  | 'IO_STATE'
  | 'UNKNOWN';

export const BASELINE_ERROR_DECISIONS = {
  BASELINE_REQUIRED_MISSING: 'HUMAN_REVIEW',
  BASELINE_CORRUPT: 'HUMAN_REVIEW',
  BASELINE_MISMATCH: 'HUMAN_REVIEW',
  BASELINE_UNSUPPORTED: 'HUMAN_REVIEW',
  BASELINE_PATH_AMBIGUITY: 'HUMAN_REVIEW',
  BASELINE_HEAD_MOVED: 'HUMAN_REVIEW',
  BASELINE_UNSTABLE_CAPTURE: 'HUMAN_REVIEW',
  BASELINE_SUBMODULE_DIRTY: 'HUMAN_REVIEW',
} as const satisfies Record<BaselineReasonCode, 'HUMAN_REVIEW'>;

export const BASELINE_EVIDENCE_REASON_CODES = {
  missing: 'BASELINE_REQUIRED_MISSING',
  corrupt: 'BASELINE_CORRUPT',
  mismatched: 'BASELINE_MISMATCH',
  unsupported: 'BASELINE_UNSUPPORTED',
  ambiguous: 'BASELINE_PATH_AMBIGUITY',
  unstable: 'BASELINE_UNSTABLE_CAPTURE',
  unavailable: 'BASELINE_REQUIRED_MISSING',
  'dirty-submodule': 'BASELINE_SUBMODULE_DIRTY',
} as const satisfies Record<Exclude<BaselineEvidenceState, 'valid' | 'legacy'>, BaselineReasonCode>;

export function baselineErrorDecision(reasonCode: BaselineReasonCode): 'HUMAN_REVIEW' {
  return BASELINE_ERROR_DECISIONS[reasonCode];
}

export function baselineEvidenceReason(
  evidenceState: Exclude<BaselineEvidenceState, 'valid' | 'legacy'>,
): BaselineReasonCode {
  return BASELINE_EVIDENCE_REASON_CODES[evidenceState];
}

export interface ErrorContext {
  [key: string]: unknown;
}

export abstract class ChangeBudgetError extends Error {
  public readonly category: ErrorCategory;
  public readonly context: ErrorContext;

  protected constructor(message: string, category: ErrorCategory, context: ErrorContext = {}) {
    super(message);
    this.name = new.target.name;
    this.category = category;
    this.context = context;
  }
}

export class BaselineEvidenceError extends ChangeBudgetError {
  public readonly reasonCode: BaselineReasonCode;

  public constructor(reasonCode: BaselineReasonCode, message: string, context?: ErrorContext) {
    super(message, 'STATE_CORRUPTION', context);
    this.reasonCode = reasonCode;
  }
}

export class InputValidationError extends ChangeBudgetError {
  public readonly field: string | undefined;

  public constructor(message: string, field?: string, context?: ErrorContext) {
    super(message, 'INPUT_VALIDATION', context);
    this.field = field;
  }
}

export class StateConflictError extends ChangeBudgetError {
  public readonly field: string | undefined;

  public constructor(message: string, field?: string, context?: ErrorContext) {
    super(message, 'STATE_CONFLICT', context);
    this.field = field;
  }
}

export class GitEnvironmentError extends ChangeBudgetError {
  public constructor(message: string, context?: ErrorContext) {
    super(message, 'GIT_ENVIRONMENT', context);
  }
}

export class GitOutputError extends ChangeBudgetError {
  public constructor(message: string, context?: ErrorContext) {
    super(message, 'GIT_ENVIRONMENT', context);
  }
}

export class StateCorruptionError extends ChangeBudgetError {
  public constructor(message: string, context?: ErrorContext) {
    super(message, 'STATE_CORRUPTION', context);
  }
}

export class IOStateError extends ChangeBudgetError {
  public constructor(message: string, context?: ErrorContext) {
    super(message, 'IO_STATE', context);
  }
}

export function isChangeBudgetError(error: unknown): error is ChangeBudgetError {
  return error instanceof ChangeBudgetError;
}
