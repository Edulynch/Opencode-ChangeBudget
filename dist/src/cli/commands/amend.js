import { InputValidationError, StateConflictError } from '../../models/errors.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { amendContractInPlace, assertActiveContractCoherent, readContract } from '../../core/state/contracts.js';
import { readLifecycleState } from '../../core/state/state.js';
import { canonicalizeLiteralPath, isChangeBudgetPath } from '../../core/check/literal-path.js';
function parseLimit(value, field) {
    if (!/^(0|[1-9]\d*)$/.test(value)) {
        throw new InputValidationError(`${field} must be a non-negative integer`, field, { value });
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new InputValidationError(`${field} must be a safe integer`, field, { value });
    }
    return parsed;
}
function nextValue(args, index, field) {
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
        throw new InputValidationError(`Missing value for ${field}`, field);
    }
    return value;
}
function parseAmendArgs(args) {
    let maxFiles;
    let maxChangedLines;
    let reason = null;
    const allowPaths = [];
    const seen = new Set();
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!token.startsWith('--')) {
            throw new InputValidationError(`Unexpected positional argument: ${token}`, 'argument');
        }
        const option = token.slice(2);
        const separator = option.indexOf('=');
        const key = separator === -1 ? option : option.slice(0, separator);
        const inlineValue = separator === -1 ? undefined : option.slice(separator + 1);
        const isScopeOption = key === 'allow-path' || key === 'allow-paths';
        if (!isScopeOption && seen.has(key)) {
            throw new InputValidationError(`Duplicate option --${key}`, `--${key}`);
        }
        if (!isScopeOption) {
            seen.add(key);
        }
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
            case 'allow-path':
            case 'allow-paths':
                for (const entry of value.split(',')) {
                    const canonical = canonicalizeLiteralPath(entry);
                    if (canonical === null || isChangeBudgetPath(canonical)) {
                        throw new InputValidationError('allow path must be a safe non-empty relative literal path', `--${key}`, { value: entry });
                    }
                    const literal = `/${canonical}`;
                    if (allowPaths.includes(literal)) {
                        throw new InputValidationError('Duplicate allow path after canonicalization', `--${key}`, { value: entry });
                    }
                    allowPaths.push(literal);
                }
                break;
            default:
                throw new InputValidationError(`Unsupported amendment field --${key}`, `--${key}`);
        }
    }
    if (maxFiles === undefined && maxChangedLines === undefined && allowPaths.length === 0) {
        throw new InputValidationError('Provide at least one budget or allow path to amend', 'amend');
    }
    if (allowPaths.length > 0 && reason === null) {
        throw new InputValidationError('--reason is required when expanding allowed paths', '--reason');
    }
    return { maxFiles, maxChangedLines, allowPaths, reason };
}
function activeContractContext(state) {
    if (state === null || state.lifecycle_state !== 'active' || typeof state.active_contract_id !== 'string') {
        throw new StateConflictError('Cannot amend budget because there is no active contract.', 'lifecycle_state');
    }
    return { state, contractId: state.active_contract_id };
}
export async function runAmend(repositoryRootHint = process.cwd(), args = []) {
    const repositoryRoot = await ensureGitRepository(repositoryRootHint);
    const options = parseAmendArgs(args);
    const active = activeContractContext(await readLifecycleState(repositoryRoot));
    const activeContract = assertActiveContractCoherent(active.state, await readContract(repositoryRoot, active.contractId));
    const contract = await amendContractInPlace(repositoryRoot, activeContract, {
        maxFiles: options.maxFiles,
        maxChangedLines: options.maxChangedLines,
        allowPaths: options.allowPaths,
        reason: options.reason,
        amendedAt: new Date().toISOString(),
    });
    return { repositoryRoot, contract };
}
//# sourceMappingURL=amend.js.map