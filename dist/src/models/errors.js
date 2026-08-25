export const BASELINE_ERROR_DECISIONS = {
    BASELINE_REQUIRED_MISSING: 'HUMAN_REVIEW',
    BASELINE_CORRUPT: 'HUMAN_REVIEW',
    BASELINE_MISMATCH: 'HUMAN_REVIEW',
    BASELINE_UNSUPPORTED: 'HUMAN_REVIEW',
    BASELINE_PATH_AMBIGUITY: 'HUMAN_REVIEW',
    BASELINE_HEAD_MOVED: 'HUMAN_REVIEW',
    BASELINE_UNSTABLE_CAPTURE: 'HUMAN_REVIEW',
    BASELINE_SUBMODULE_DIRTY: 'HUMAN_REVIEW',
};
export const BASELINE_EVIDENCE_REASON_CODES = {
    missing: 'BASELINE_REQUIRED_MISSING',
    corrupt: 'BASELINE_CORRUPT',
    mismatched: 'BASELINE_MISMATCH',
    unsupported: 'BASELINE_UNSUPPORTED',
    ambiguous: 'BASELINE_PATH_AMBIGUITY',
    unstable: 'BASELINE_UNSTABLE_CAPTURE',
    unavailable: 'BASELINE_REQUIRED_MISSING',
    'dirty-submodule': 'BASELINE_SUBMODULE_DIRTY',
};
export function baselineErrorDecision(reasonCode) {
    return BASELINE_ERROR_DECISIONS[reasonCode];
}
export function baselineEvidenceReason(evidenceState) {
    return BASELINE_EVIDENCE_REASON_CODES[evidenceState];
}
export class ChangeBudgetError extends Error {
    category;
    context;
    constructor(message, category, context = {}) {
        super(message);
        this.name = new.target.name;
        this.category = category;
        this.context = context;
    }
}
export class BaselineEvidenceError extends ChangeBudgetError {
    reasonCode;
    constructor(reasonCode, message, context) {
        super(message, 'STATE_CORRUPTION', context);
        this.reasonCode = reasonCode;
    }
}
export class InputValidationError extends ChangeBudgetError {
    field;
    constructor(message, field, context) {
        super(message, 'INPUT_VALIDATION', context);
        this.field = field;
    }
}
export class StateConflictError extends ChangeBudgetError {
    field;
    constructor(message, field, context) {
        super(message, 'STATE_CONFLICT', context);
        this.field = field;
    }
}
export class GitEnvironmentError extends ChangeBudgetError {
    constructor(message, context) {
        super(message, 'GIT_ENVIRONMENT', context);
    }
}
export class GitOutputError extends ChangeBudgetError {
    constructor(message, context) {
        super(message, 'GIT_ENVIRONMENT', context);
    }
}
export class StateCorruptionError extends ChangeBudgetError {
    constructor(message, context) {
        super(message, 'STATE_CORRUPTION', context);
    }
}
export class IOStateError extends ChangeBudgetError {
    constructor(message, context) {
        super(message, 'IO_STATE', context);
    }
}
export function isChangeBudgetError(error) {
    return error instanceof ChangeBudgetError;
}
//# sourceMappingURL=errors.js.map