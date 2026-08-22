import { CONTRACT_PRESETS, isContractPreset, } from '../../models/change-contract.js';
import { readJsonFile } from '../../core/state/state.js';
import { readContract, assertActiveContractCoherent } from '../../core/state/contracts.js';
import { join, isAbsolute, win32 } from 'node:path';
import { readLifecycleState, } from '../../core/state/state.js';
import { InputValidationError, GitEnvironmentError, IOStateError, StateCorruptionError, } from '../../models/errors.js';
import { ensureGitRepository, validateRevision } from '../../core/git/repo.js';
import { normalizeValidatedContractInput, validateContractInput } from '../../core/validation/contract-validator.js';
import { collectChangedItems } from '../../core/check/diff.js';
import { evaluateBudgetCheck } from '../../core/check/rules.js';
import { resolveStackPolicy } from '../../core/check/stack-policy.js';
function parseNextValue(args, index) {
    if (index + 1 >= args.length) {
        throw new InputValidationError('Missing value for --draft', 'draft');
    }
    const value = args[index + 1];
    if (value.startsWith('--')) {
        throw new InputValidationError('Missing value for --draft', 'draft');
    }
    return { value, nextIndex: index + 1 };
}
function parseCheckArgs(args) {
    let draftPath;
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!token.startsWith('--')) {
            throw new InputValidationError(`Unexpected positional argument: ${token}`, 'argument');
        }
        const pair = token.slice(2).split('=', 2);
        const key = pair[0].toLowerCase();
        const inlineValue = pair.length === 2 ? pair[1] : null;
        if (key === 'draft') {
            if (inlineValue === null) {
                const next = parseNextValue(args, index);
                draftPath = next.value;
                index = next.nextIndex;
            }
            else {
                draftPath = inlineValue;
            }
            continue;
        }
        throw new InputValidationError(`Unknown option --${key}`, `--${key}`);
    }
    if (draftPath && !draftPath.trim().length) {
        throw new InputValidationError('Draft path cannot be empty', 'draft', { value: draftPath });
    }
    return { draftPath };
}
function parseStringArray(failures, field, value) {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        failures.push({
            field,
            message: `${field} must be a list of strings`,
        });
        return [];
    }
    const values = [];
    value.forEach((entry, index) => {
        if (typeof entry !== 'string') {
            failures.push({
                field,
                message: `${field}[${index}] must be a non-empty path string`,
            });
            return;
        }
        const trimmed = entry.trim();
        if (!trimmed.length) {
            failures.push({
                field,
                message: `${field}[${index}] must be a non-empty path string`,
            });
            return;
        }
        values.push(trimmed);
    });
    return values;
}
function parseContractPayloadForValidation(payload) {
    const failures = [];
    const candidate = typeof payload === 'object' && payload !== null ? payload : null;
    const booleanField = (field) => {
        const value = candidate === null ? undefined : candidate[field];
        if (typeof value !== 'boolean') {
            failures.push({
                field,
                message: `${field} must be a boolean`,
            });
            return false;
        }
        return value;
    };
    const numericField = (field) => {
        const value = candidate === null ? undefined : candidate[field];
        if (value === undefined || value === null) {
            return null;
        }
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
            failures.push({
                field,
                message: `${field} must be a non-negative integer`,
            });
            return null;
        }
        return value;
    };
    const stringField = (field) => {
        const value = candidate === null ? undefined : candidate[field];
        if (typeof value !== 'string') {
            failures.push({
                field,
                message: `${field} must be a string`,
            });
            return null;
        }
        return value;
    };
    const presetField = () => {
        const value = candidate === null ? undefined : candidate.preset;
        if (value === undefined || value === null) {
            return null;
        }
        if (typeof value !== 'string' || !isContractPreset(value.toLowerCase())) {
            failures.push({
                field: 'preset',
                message: `preset must be one of ${CONTRACT_PRESETS.join(', ')}`,
            });
            return null;
        }
        return value.toLowerCase();
    };
    const parsed = {
        task_description: stringField('task_description'),
        base_revision: stringField('base_revision'),
        allow_paths: parseStringArray(failures, 'allow_paths', candidate?.allow_paths),
        deny_paths: parseStringArray(failures, 'deny_paths', candidate?.deny_paths),
        max_files: numericField('max_files'),
        max_changed_lines: numericField('max_changed_lines'),
        allow_new_files: booleanField('allow_new_files'),
        allow_new_dependencies: booleanField('allow_new_dependencies'),
        allow_migrations: booleanField('allow_migrations'),
        allow_config_changes: booleanField('allow_config_changes'),
        allow_public_api_changes: booleanField('allow_public_api_changes'),
        preset: presetField(),
        stack_profile: parseStackProfileField(failures, candidate?.stack_profile),
        disabled_stack_rules: parseDisabledStackRules(failures, candidate?.disabled_stack_rules),
    };
    const result = validateContractInput(parsed);
    const combinedFailures = [...failures, ...result.errors];
    if (combinedFailures.length > 0) {
        throw new InputValidationError(`Contract validation failed: ${combinedFailures.map((failure) => failure.field).join(', ')}`, 'input', { errors: combinedFailures });
    }
    return {
        contract: {
            ...candidate,
            ...parsed,
        },
        normalizedContract: normalizeValidatedContractInput(parsed),
    };
}
function parseStackProfileField(failures, rawValue) {
    if (rawValue === undefined || rawValue === null) {
        return null;
    }
    if (typeof rawValue !== 'string') {
        failures.push({
            field: 'stack_profile',
            message: 'stack_profile must be one of: android, flutter, spring-boot, node-ts, or null',
        });
        return null;
    }
    return rawValue.trim().toLowerCase();
}
function parseDisabledStackRules(failures, rawValue) {
    if (rawValue === undefined || rawValue === null) {
        return [];
    }
    if (!Array.isArray(rawValue)) {
        failures.push({
            field: 'disabled_stack_rules',
            message: 'disabled_stack_rules must be an array',
        });
        return [];
    }
    const parsed = [];
    for (let index = 0; index < rawValue.length; index += 1) {
        const entry = rawValue[index];
        if (typeof entry !== 'string') {
            failures.push({
                field: 'disabled_stack_rules',
                message: `disabled_stack_rules[${index}] must be a string`,
            });
            continue;
        }
        parsed.push(entry);
    }
    return parsed;
}
function getDraftContractPath(repositoryRoot, draftPath) {
    if (isAbsolute(draftPath) || win32.isAbsolute(draftPath)) {
        return draftPath;
    }
    return join(repositoryRoot, draftPath);
}
function getContractIdFromPayload(payload) {
    const candidate = typeof payload === 'object' && payload !== null ? payload : null;
    const rawId = candidate?.id;
    return typeof rawId === 'string' && rawId.trim() ? rawId.trim() : null;
}
function getContractBaseRevisionFromPayload(payload) {
    const candidate = typeof payload === 'object' && payload !== null ? payload : null;
    const rawBaseRevision = candidate?.base_revision;
    return typeof rawBaseRevision === 'string' && rawBaseRevision.trim().length
        ? rawBaseRevision.trim()
        : 'unknown';
}
function deriveTaskOutputObject(payload) {
    const candidate = typeof payload === 'object' && payload !== null ? payload : null;
    const taskId = candidate?.task_id;
    const taskTitle = candidate?.task_title;
    const sourceFeature = candidate?.task_source_feature;
    const sourcePath = candidate?.task_source_path;
    if (typeof taskId !== 'string' ||
        taskId.length === 0 ||
        typeof taskTitle !== 'string' ||
        typeof sourceFeature !== 'string' ||
        typeof sourcePath !== 'string') {
        return null;
    }
    return {
        id: taskId,
        title: taskTitle,
        source_feature: sourceFeature,
        source_path: sourcePath,
    };
}
function mapCheckFailureReasonCode(error) {
    if (error instanceof InputValidationError) {
        return error.field === 'path-pattern'
            ? 'CBV-RULE-CONFIG-INVALID'
            : 'CBV-INPUT-INVALID';
    }
    if (error instanceof GitEnvironmentError) {
        const context = error.context;
        if (context?.reason === 'unresolved') {
            return 'CBV-BASE-REVISION-UNKNOWN';
        }
        return 'CBV-ENV-NOT-READY';
    }
    if (error instanceof IOStateError || error instanceof StateCorruptionError) {
        return 'CBV-RULE-CONFIG-INVALID';
    }
    return 'CBV-ENV-NOT-READY';
}
function buildFailureResult(source, contractId, baseRevision, reasonCode, message) {
    return {
        contractSource: source,
        contractId,
        baseRevision,
        changedFileCount: 0,
        changedLinesCount: 0,
        binaryChangeCount: 0,
        newFileCount: 0,
        deletedFileCount: 0,
        renamedFileCount: 0,
        pathRuleResults: [],
        limitResults: [],
        violations: [
            {
                rule: 'max_files',
                message,
                reasonCode,
                action: 'review',
            },
        ],
        status: 'FAIL',
        decision: 'HUMAN_REVIEW',
        reasonCodes: [reasonCode],
        asOf: new Date().toISOString(),
    };
}
function describeFailureMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unable to evaluate budget check.';
}
function safeReasonCodeResult(source, contractId, baseRevision, reasonCode, error) {
    return buildFailureResult(source, contractId, baseRevision, reasonCode, describeFailureMessage(error));
}
function buildContractEvaluationInput(source, contractId, normalized, stackPolicyResolution, task) {
    return {
        source,
        contractId,
        baseRevision: normalized.base_revision,
        allow_paths: normalized.allow_paths,
        deny_paths: normalized.deny_paths,
        max_files: normalized.max_files,
        max_changed_lines: normalized.max_changed_lines,
        stackPolicyRules: stackPolicyResolution?.effectiveRules,
        stackPolicySummary: stackPolicyResolution
            ? {
                ...stackPolicyResolution.summary,
            }
            : null,
        task,
    };
}
async function getStackPolicyResolution(repositoryRoot, parsedContract) {
    if (!parsedContract.stack_profile) {
        return null;
    }
    return resolveStackPolicy(repositoryRoot, parsedContract.stack_profile, parsedContract.disabled_stack_rules);
}
export async function runCheck(repositoryRootHint = process.cwd(), args = []) {
    const repositoryRoot = await ensureGitRepository(repositoryRootHint);
    const { draftPath } = parseCheckArgs(args);
    if (draftPath) {
        const resolvedPath = getDraftContractPath(repositoryRoot, draftPath);
        let payload;
        try {
            payload = await readJsonFile(resolvedPath);
            const parsed = parseContractPayloadForValidation(payload);
            const contractId = getContractIdFromPayload(parsed.contract);
            const baseRevision = parsed.normalizedContract.base_revision;
            if (!(await validateRevision(repositoryRoot, baseRevision))) {
                return buildFailureResult('draft', contractId, baseRevision, 'CBV-BASE-REVISION-UNKNOWN', 'base_revision does not resolve to a local Git commit');
            }
            const stackPolicy = await getStackPolicyResolution(repositoryRoot, parsed.normalizedContract);
            const changedItems = await collectChangedItems(repositoryRoot, baseRevision);
            return evaluateBudgetCheck(buildContractEvaluationInput('draft', contractId, parsed.normalizedContract, stackPolicy, deriveTaskOutputObject(payload)), changedItems);
        }
        catch (error) {
            const parsedBaseRevision = getContractBaseRevisionFromPayload(payload ?? null);
            return safeReasonCodeResult('draft', getContractIdFromPayload(payload ?? null), parsedBaseRevision, mapCheckFailureReasonCode(error), error);
        }
    }
    const state = await readLifecycleState(repositoryRoot);
    if (!state || !state.active_contract_id) {
        throw new InputValidationError('No active contract to check and no draft path provided', 'state', {
            lifecycleState: state?.lifecycle_state ?? 'uninitialized',
        });
    }
    let activeContractPayload = null;
    try {
        const payload = await readContract(repositoryRoot, state.active_contract_id);
        assertActiveContractCoherent(state, payload);
        activeContractPayload = payload;
        const parsed = parseContractPayloadForValidation(payload);
        const contractId = getContractIdFromPayload(payload);
        if (!(await validateRevision(repositoryRoot, parsed.normalizedContract.base_revision))) {
            return buildFailureResult('active', contractId, parsed.normalizedContract.base_revision, 'CBV-BASE-REVISION-UNKNOWN', 'base_revision does not resolve to a local Git commit');
        }
        const stackPolicy = await getStackPolicyResolution(repositoryRoot, parsed.normalizedContract);
        const changedItems = await collectChangedItems(repositoryRoot, parsed.normalizedContract.base_revision);
        return evaluateBudgetCheck(buildContractEvaluationInput('active', contractId, parsed.normalizedContract, stackPolicy, deriveTaskOutputObject(payload)), changedItems);
    }
    catch (error) {
        if (error instanceof IOStateError || error instanceof StateCorruptionError) {
            throw error;
        }
        const contractId = state.active_contract_id;
        const baseRevision = getContractBaseRevisionFromPayload(activeContractPayload);
        return safeReasonCodeResult('active', contractId, baseRevision, mapCheckFailureReasonCode(error), error);
    }
}
//# sourceMappingURL=check.js.map