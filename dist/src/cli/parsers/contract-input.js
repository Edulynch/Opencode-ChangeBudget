import { InputValidationError } from '../../models/errors.js';
import { canonicalizeTaskId, isTaskIdInput, } from '../../models/spec-kit-task.js';
import { CONTRACT_PRESETS, isContractPreset, STACK_PROFILES, isStackProfile, } from '../../models/change-contract.js';
const BOOLEAN_OPTIONS = [
    'allow-new-files',
    'allow-new-dependencies',
    'allow-migrations',
    'allow-config-changes',
    'allow-public-api-changes',
];
function normalizeFlagName(raw) {
    return raw.toLowerCase().replace(/_/g, '-');
}
function parseBoolean(value) {
    const lowered = value.toLowerCase();
    if (lowered === 'true') {
        return true;
    }
    if (lowered === 'false') {
        return false;
    }
    throw new InputValidationError(`Expected boolean value "${value}"`, 'boolean-flag');
}
function parseIntOption(value, fieldName) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new InputValidationError(`${fieldName} must be a non-negative integer`, fieldName, { value });
    }
    return parsed;
}
function parsePathValues(value) {
    const values = value.split(',').map((entry) => entry.trim());
    for (const entry of values) {
        if (!entry.length) {
            throw new InputValidationError('Path values must be non-empty strings', 'path');
        }
    }
    return values;
}
function parseCommaSeparatedValues(value, field) {
    const values = value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    if (!values.length && value.trim().length > 0) {
        throw new InputValidationError(`${field} must be a non-empty identifier list`, field);
    }
    return values;
}
function nextOptionValue(args, index) {
    if (index + 1 >= args.length) {
        throw new InputValidationError(`Missing value for option ${args[index]}`, args[index]);
    }
    const value = args[index + 1];
    if (value.startsWith('--')) {
        throw new InputValidationError(`Missing value for option ${args[index]}`, args[index]);
    }
    return { value, nextIndex: index + 1 };
}
export function parseContractInput(args) {
    const parsed = {
        task_description: null,
        task_id: null,
        base_revision: null,
        allow_paths: [],
        deny_paths: [],
        max_files: null,
        max_changed_lines: null,
        allow_new_files: false,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: false,
        allow_public_api_changes: false,
        preset: null,
        stack_profile: null,
        disabled_stack_rules: [],
    };
    let seenPositional = false;
    let shorthandPresetUsed = false;
    let presetFlagPresent = false;
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!token.startsWith('--')) {
            if (seenPositional || !isTaskIdInput(token)) {
                throw new InputValidationError(`Unexpected positional argument: ${token}`, 'argument');
            }
            seenPositional = true;
            parsed.task_id = canonicalizeTaskId(token);
            continue;
        }
        const pair = token.slice(2).split('=', 2);
        const key = normalizeFlagName(pair[0]);
        const inlineValue = pair.length === 2 ? pair[1] : null;
        if (inlineValue !== null && inlineValue.length === 0) {
            throw new InputValidationError(`Empty value for option --${key}`, key);
        }
        switch (key) {
            case 'task':
            case 'task-description':
                {
                    const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
                    if (inlineValue === null) {
                        index += 1;
                    }
                    parsed.task_description = value.trim();
                }
                break;
            case 'base-revision':
                {
                    const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
                    if (inlineValue === null) {
                        index += 1;
                    }
                    parsed.base_revision = value.trim();
                }
                break;
            case 'allow-path':
            case 'allow-paths':
                {
                    const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
                    if (inlineValue === null) {
                        index += 1;
                    }
                    parsed.allow_paths.push(...parsePathValues(value));
                }
                break;
            case 'deny-path':
            case 'deny-paths':
                {
                    const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
                    if (inlineValue === null) {
                        index += 1;
                    }
                    parsed.deny_paths.push(...parsePathValues(value));
                }
                break;
            case 'max-files':
                {
                    const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
                    if (inlineValue === null) {
                        index += 1;
                    }
                    parsed.max_files = parseIntOption(value, 'max-files');
                }
                break;
            case 'max-changed-lines':
                {
                    const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
                    if (inlineValue === null) {
                        index += 1;
                    }
                    parsed.max_changed_lines = parseIntOption(value, 'max-changed-lines');
                }
                break;
            case 'allow-new-files':
                if (inlineValue !== null) {
                    parsed.allow_new_files = parseBoolean(inlineValue);
                }
                else if (key.startsWith('no-')) {
                    parsed.allow_new_files = false;
                }
                else {
                    parsed.allow_new_files = true;
                }
                break;
            case 'no-allow-new-files':
                parsed.allow_new_files = false;
                break;
            case 'allow-new-dependencies':
                if (inlineValue !== null) {
                    parsed.allow_new_dependencies = parseBoolean(inlineValue);
                }
                else if (key.startsWith('no-')) {
                    parsed.allow_new_dependencies = false;
                }
                else {
                    parsed.allow_new_dependencies = true;
                }
                break;
            case 'no-allow-new-dependencies':
                parsed.allow_new_dependencies = false;
                break;
            case 'allow-migrations':
                if (inlineValue !== null) {
                    parsed.allow_migrations = parseBoolean(inlineValue);
                }
                else if (key.startsWith('no-')) {
                    parsed.allow_migrations = false;
                }
                else {
                    parsed.allow_migrations = true;
                }
                break;
            case 'no-allow-migrations':
                parsed.allow_migrations = false;
                break;
            case 'allow-config-changes':
                if (inlineValue !== null) {
                    parsed.allow_config_changes = parseBoolean(inlineValue);
                }
                else if (key.startsWith('no-')) {
                    parsed.allow_config_changes = false;
                }
                else {
                    parsed.allow_config_changes = true;
                }
                break;
            case 'no-allow-config-changes':
                parsed.allow_config_changes = false;
                break;
            case 'allow-public-api-changes':
                if (inlineValue !== null) {
                    parsed.allow_public_api_changes = parseBoolean(inlineValue);
                }
                else if (key.startsWith('no-')) {
                    parsed.allow_public_api_changes = false;
                }
                else {
                    parsed.allow_public_api_changes = true;
                }
                break;
            case 'no-allow-public-api-changes':
                parsed.allow_public_api_changes = false;
                break;
            case 'tiny':
            case 'normal':
            case 'free':
                if (inlineValue !== null) {
                    throw new InputValidationError(`Option --${key} does not accept a value`, key);
                }
                if (presetFlagPresent) {
                    throw new InputValidationError('Budget preset was specified more than once. Use --preset or one of --tiny/--normal/--free, not both.', 'preset');
                }
                shorthandPresetUsed = true;
                parsed.preset = key;
                break;
            case 'preset': {
                if (shorthandPresetUsed) {
                    throw new InputValidationError('Budget preset was specified more than once. Use --preset or one of --tiny/--normal/--free, not both.', 'preset');
                }
                presetFlagPresent = true;
                if (inlineValue === null) {
                    const valueFromNext = nextOptionValue(args, index);
                    index = valueFromNext.nextIndex;
                    if (!isContractPreset(valueFromNext.value.toLowerCase())) {
                        const allowed = CONTRACT_PRESETS.join(', ');
                        throw new InputValidationError(`Invalid preset value. Allowed values: ${allowed}`, 'preset', {
                            value: valueFromNext.value,
                        });
                    }
                    parsed.preset = valueFromNext.value.toLowerCase();
                }
                else {
                    if (!isContractPreset(inlineValue.toLowerCase())) {
                        const allowed = CONTRACT_PRESETS.join(', ');
                        throw new InputValidationError(`Invalid preset value. Allowed values: ${allowed}`, 'preset', {
                            value: inlineValue,
                        });
                    }
                    parsed.preset = inlineValue.toLowerCase();
                }
                break;
            }
            case 'stack-profile': {
                const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
                if (inlineValue === null) {
                    index += 1;
                }
                const candidate = value.toLowerCase();
                if (!isStackProfile(candidate)) {
                    const allowed = STACK_PROFILES.join(', ');
                    throw new InputValidationError(`Invalid stack profile. Allowed values: ${allowed}`, 'stack-profile', {
                        value: candidate,
                    });
                }
                parsed.stack_profile = candidate;
                break;
            }
            case 'disable-stack-rule':
            case 'disable-stack-rules': {
                const value = inlineValue === null ? nextOptionValue(args, index).value : inlineValue;
                if (inlineValue === null) {
                    index += 1;
                }
                parsed.disabled_stack_rules.push(...parseCommaSeparatedValues(value, 'disable-stack-rule'));
                break;
            }
            default:
                if (key.startsWith('no-')) {
                    const invertedKey = key.slice(3);
                    if (BOOLEAN_OPTIONS.includes(invertedKey)) {
                        throw new InputValidationError(`Unexpected boolean option ${key}`, `--${key}`);
                    }
                }
                throw new InputValidationError(`Unknown option --${key}`, `--${key}`);
        }
    }
    return parsed;
}
export function parseContractInputBooleanDefaults(input) {
    return {
        task_description: input.task_description,
        task_id: input.task_id ?? null,
        base_revision: input.base_revision,
        allow_paths: [...input.allow_paths],
        deny_paths: [...input.deny_paths],
        max_files: input.max_files,
        max_changed_lines: input.max_changed_lines,
        allow_new_files: !!input.allow_new_files,
        allow_new_dependencies: !!input.allow_new_dependencies,
        allow_migrations: !!input.allow_migrations,
        allow_config_changes: !!input.allow_config_changes,
        allow_public_api_changes: !!input.allow_public_api_changes,
        preset: input.preset,
        stack_profile: input.stack_profile,
        disabled_stack_rules: [...input.disabled_stack_rules],
    };
}
//# sourceMappingURL=contract-input.js.map