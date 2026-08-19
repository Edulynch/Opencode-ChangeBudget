export type ErrorCategory =
  | 'INPUT_VALIDATION'
  | 'STATE_CONFLICT'
  | 'GIT_ENVIRONMENT'
  | 'STATE_CORRUPTION'
  | 'IO_STATE'
  | 'UNKNOWN';

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
