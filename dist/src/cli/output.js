import { stderr } from 'node:process';
import { GitEnvironmentError, GitOutputError, InputValidationError, IOStateError, isChangeBudgetError, StateConflictError, StateCorruptionError, } from '../models/errors.js';
export const EXIT_CODES = {
    OK: 0,
    INPUT_OR_USAGE: 2,
    STATE_CONFLICT: 3,
    ENVIRONMENT: 4,
    UNKNOWN: 10,
};
export const DECISION_EXIT_CODES = {
    PASS: EXIT_CODES.OK,
    REPAIR: 1,
    HUMAN_REVIEW: 2,
};
export function getExitCode(error) {
    if (!isChangeBudgetError(error)) {
        return EXIT_CODES.UNKNOWN;
    }
    if (error instanceof InputValidationError) {
        return EXIT_CODES.INPUT_OR_USAGE;
    }
    if (error instanceof StateConflictError) {
        return EXIT_CODES.STATE_CONFLICT;
    }
    if (error instanceof GitEnvironmentError || error instanceof GitOutputError || error instanceof IOStateError || error instanceof StateCorruptionError) {
        return EXIT_CODES.ENVIRONMENT;
    }
    return EXIT_CODES.UNKNOWN;
}
export function formatError(error) {
    if (!isChangeBudgetError(error)) {
        return `Unexpected error: ${String(error)}`;
    }
    const knownError = error;
    const context = Object.entries(knownError.context)
        .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
        .join('; ');
    return context.length
        ? `${knownError.name}: ${knownError.message} (${context})`
        : `${knownError.name}: ${knownError.message}`;
}
export function printError(error) {
    stderr.write(`${formatError(error)}\n`);
}
export function formatExitCode(error) {
    return getExitCode(error);
}
export function getDecisionExitCode(result) {
    if (!result) {
        return EXIT_CODES.UNKNOWN;
    }
    return DECISION_EXIT_CODES[result.decision];
}
//# sourceMappingURL=output.js.map