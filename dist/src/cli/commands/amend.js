import { InputValidationError, StateConflictError } from '../../models/errors.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { amendContractUnderLock, assertActiveContractCoherent, readContract } from '../../core/state/contracts.js';
import { createLifecycleAuditRecord, recoverPendingLifecycleAudits, withContractFileLock, withLifecycleStateLock, } from '../../core/state/state.js';
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
function matchesRecoveredAmendment(record, contract, options) {
    if (record.contract_id !== contract.id || contract.status !== 'active') {
        return false;
    }
    const changes = record.minimum_delta.changes;
    const requestedFields = new Set([
        ...(options.maxFiles === undefined ? [] : ['max_files']),
        ...(options.maxChangedLines === undefined ? [] : ['max_changed_lines']),
        ...(options.allowPaths.length === 0 ? [] : ['allow_paths']),
    ]);
    const recordedFields = changes.map((entry) => entry.field);
    if (new Set(recordedFields).size !== recordedFields.length
        || recordedFields.some((field) => !requestedFields.has(field))) {
        return false;
    }
    if (options.maxFiles !== undefined) {
        const change = changes.find((entry) => entry.field === 'max_files');
        if (contract.max_files !== options.maxFiles
            || (change !== undefined && (change.after !== options.maxFiles || change.before === change.after))) {
            return false;
        }
    }
    if (options.maxChangedLines !== undefined) {
        const change = changes.find((entry) => entry.field === 'max_changed_lines');
        if (contract.max_changed_lines !== options.maxChangedLines
            || (change !== undefined && (change.after !== options.maxChangedLines || change.before === change.after))) {
            return false;
        }
    }
    if (options.allowPaths.length > 0) {
        const change = changes.find((entry) => entry.field === 'allow_paths');
        if (change === undefined) {
            if (!options.allowPaths.every((path) => contract.allow_paths.includes(path))) {
                return false;
            }
        }
        else {
            if (!Array.isArray(change.before) || !Array.isArray(change.after)) {
                return false;
            }
            const before = change.before;
            const after = change.after;
            const requestedAdditions = options.allowPaths.filter((path) => !before.includes(path));
            const alreadyAllowed = options.allowPaths.filter((path) => before.includes(path));
            const added = after.filter((path) => !before.includes(path));
            if (JSON.stringify(added) !== JSON.stringify(requestedAdditions)
                || !alreadyAllowed.every((path) => before.includes(path))
                || JSON.stringify(contract.allow_paths) !== JSON.stringify(after)) {
                return false;
            }
        }
        if (change !== undefined && change.before === change.after) {
            return false;
        }
    }
    return true;
}
export async function runAmend(repositoryRootHint = process.cwd(), args = []) {
    const repositoryRoot = await ensureGitRepository(repositoryRootHint);
    const recoveredAudits = await recoverPendingLifecycleAudits(repositoryRoot);
    const options = parseAmendArgs(args);
    let result;
    // Lock order is lifecycle state → one contract. The unlocked amendment and
    // audit persistence methods run within that shared boundary.
    await withLifecycleStateLock(repositoryRoot, async (transaction) => {
        await transaction.assertNoPendingAudits();
        const active = activeContractContext(await transaction.readState());
        await withContractFileLock(repositoryRoot, active.contractId, async () => {
            const activeContract = assertActiveContractCoherent(active.state, await readContract(repositoryRoot, active.contractId));
            const recoveredAmend = recoveredAudits.find((record) => record.operation === 'amend'
                && record.outcome.status === 'reconciled'
                && matchesRecoveredAmendment(record, activeContract, options));
            if (recoveredAmend !== undefined) {
                result = activeContract;
                return;
            }
            let auditRecord;
            const amended = await amendContractUnderLock(repositoryRoot, activeContract, {
                maxFiles: options.maxFiles,
                maxChangedLines: options.maxChangedLines,
                allowPaths: options.allowPaths,
                reason: options.reason,
                amendedAt: new Date().toISOString(),
            }, async (before, after) => {
                assertActiveContractCoherent(active.state, before);
                auditRecord = createLifecycleAuditRecord({
                    operation: 'amend',
                    repositoryRoot,
                    lifecycleBefore: active.state.lifecycle_state,
                    lifecycleAfter: active.state.lifecycle_state,
                    beforeContract: before,
                    afterContract: after,
                    reasonProvided: options.reason !== null,
                });
                await transaction.persistAudit(auditRecord);
            });
            if (auditRecord === undefined) {
                throw new StateConflictError('AMEND completed without lifecycle audit evidence.', 'lifecycle_state');
            }
            await transaction.completeAudit(auditRecord.event_id);
            result = amended;
        });
    });
    if (result === undefined) {
        throw new StateConflictError('AMEND completed without a verifiable contract result.', 'lifecycle_state');
    }
    return { repositoryRoot, contract: result };
}
//# sourceMappingURL=amend.js.map