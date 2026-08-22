import { CONTRACT_PRESETS, isContractPreset, isStackProfile, STACK_PROFILES, } from '../../models/change-contract.js';
function addFailure(failures, field, message) {
    failures.push({ field, message });
}
function isValidRevision(value) {
    return value.trim().length > 0;
}
function validatePathList(failures, field, values) {
    values.forEach((value, index) => {
        const trimmed = value.trim();
        if (!trimmed.length) {
            addFailure(failures, field, `${field}[${index}] must be a non-empty path string`);
        }
    });
}
export function validateContractInput(input) {
    const failures = [];
    if (!input.task_description || !input.task_description.trim().length) {
        addFailure(failures, 'task_description', 'task_description is required and must be non-empty');
    }
    if (!input.base_revision || !isValidRevision(input.base_revision)) {
        addFailure(failures, 'base_revision', 'base_revision is required and must be a non-empty git reference');
    }
    if (input.max_files !== null) {
        if (!Number.isInteger(input.max_files) || input.max_files < 0) {
            addFailure(failures, 'max_files', 'max_files must be a non-negative integer');
        }
    }
    if (input.max_changed_lines !== null) {
        if (!Number.isInteger(input.max_changed_lines) || input.max_changed_lines < 0) {
            addFailure(failures, 'max_changed_lines', 'max_changed_lines must be a non-negative integer');
        }
    }
    if (typeof input.allow_new_files !== 'boolean') {
        addFailure(failures, 'allow_new_files', 'allow_new_files must be boolean');
    }
    if (typeof input.allow_new_dependencies !== 'boolean') {
        addFailure(failures, 'allow_new_dependencies', 'allow_new_dependencies must be boolean');
    }
    if (typeof input.allow_migrations !== 'boolean') {
        addFailure(failures, 'allow_migrations', 'allow_migrations must be boolean');
    }
    if (typeof input.allow_config_changes !== 'boolean') {
        addFailure(failures, 'allow_config_changes', 'allow_config_changes must be boolean');
    }
    if (typeof input.allow_public_api_changes !== 'boolean') {
        addFailure(failures, 'allow_public_api_changes', 'allow_public_api_changes must be boolean');
    }
    validatePathList(failures, 'allow_paths', input.allow_paths);
    validatePathList(failures, 'deny_paths', input.deny_paths);
    if (input.preset !== null) {
        if (!isContractPreset(input.preset.toLowerCase())) {
            addFailure(failures, 'preset', `preset must be one of ${CONTRACT_PRESETS.join(', ')}`);
        }
    }
    if (input.stack_profile !== null && !isStackProfile(input.stack_profile)) {
        addFailure(failures, 'stack_profile', `stack_profile must be one of ${STACK_PROFILES.join(', ')}`);
    }
    const disabledStackRules = [...input.disabled_stack_rules];
    const seenDisabled = new Set();
    disabledStackRules.forEach((ruleId, index) => {
        const normalized = ruleId.trim();
        if (!normalized.length) {
            addFailure(failures, 'disabled_stack_rules', `disabled_stack_rules[${index}] must be a non-empty string`);
            return;
        }
        if (seenDisabled.has(normalized)) {
            addFailure(failures, 'disabled_stack_rules', `disabled_stack_rules[${index}] duplicate rule id '${normalized}'`);
        }
        seenDisabled.add(normalized);
    });
    return {
        valid: failures.length === 0,
        errors: failures,
    };
}
export function normalizeValidatedContractInput(input) {
    return {
        task_description: input.task_description === null ? '' : input.task_description.trim(),
        task_id: input.task_id ?? null,
        task_title: null,
        task_source_feature: null,
        task_source_path: null,
        base_revision: input.base_revision === null ? '' : input.base_revision.trim(),
        allow_paths: input.allow_paths.map((entry) => entry.trim()),
        deny_paths: input.deny_paths.map((entry) => entry.trim()),
        max_files: input.max_files,
        max_changed_lines: input.max_changed_lines,
        allow_new_files: input.allow_new_files,
        allow_new_dependencies: input.allow_new_dependencies,
        allow_migrations: input.allow_migrations,
        allow_config_changes: input.allow_config_changes,
        allow_public_api_changes: input.allow_public_api_changes,
        preset: input.preset ? input.preset.toLowerCase() : null,
        stack_profile: input.stack_profile
            ? input.stack_profile.toLowerCase()
            : null,
        disabled_stack_rules: input.disabled_stack_rules.map((entry) => entry.trim()),
    };
}
//# sourceMappingURL=contract-validator.js.map