import { canonicalizeLiteralPath, isChangeBudgetPath } from '../core/check/literal-path.js';
import { compilePathPatterns, matchPathPattern } from '../core/check/patterns.js';
import { InputValidationError, StateCorruptionError } from './errors.js';
function corruptHistory(message, context) {
    return new StateCorruptionError(`Contract scope amendment history is invalid: ${message}`, context);
}
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function readField(value, field) {
    return Reflect.get(value, field);
}
function parseAddedPaths(value, context) {
    if (!Array.isArray(value) || value.length === 0) {
        throw corruptHistory('allow_paths_added must be a non-empty array', context);
    }
    const additions = [];
    const seen = new Set();
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
function parseAmendment(value, index, contractId) {
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
export function prepareScopeAmendment(contract, request) {
    const amendments = validateScopeAmendments(contract.scope_amendments, contract.id, contract.allow_paths);
    if (request.allowPaths.length > 0 && contract.allow_paths.length === 0) {
        throw new InputValidationError('Cannot expand an allow-all contract', '--allow-path');
    }
    const allowPatterns = compilePathPatterns(contract.allow_paths);
    const denyPatterns = compilePathPatterns(contract.deny_paths);
    const paths = [];
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
export function validateScopeAmendments(value, contractId, finalAllowPaths) {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw corruptHistory('scope_amendments must be an array', { contractId });
    }
    const amendments = value.map((entry, index) => parseAmendment(entry, index, contractId));
    const recordedPaths = new Set();
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
//# sourceMappingURL=scope-amendment.js.map