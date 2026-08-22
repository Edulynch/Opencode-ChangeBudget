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