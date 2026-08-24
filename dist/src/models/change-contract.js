import { CURRENT_SCHEMA_VERSION } from './lifecycle-state.js';
export const CONTRACT_STATUSES = ['draft', 'active', 'closed'];
export const CONTRACT_PRESETS = ['tiny', 'normal', 'free', 'custom'];
export const STACK_PROFILES = ['android', 'flutter', 'spring-boot', 'node-ts'];
export function comparisonModeForContract(contract) {
    return contract.comparison_mode === undefined && contract.baseline_ref === undefined
        ? 'legacy'
        : 'baseline';
}
export function createDraftContract(input, id, createdAt) {
    return {
        schema_version: CURRENT_SCHEMA_VERSION,
        id,
        task_description: input.task_description,
        task_id: input.task_id,
        task_title: input.task_title,
        task_source_feature: input.task_source_feature,
        task_source_path: input.task_source_path,
        base_revision: input.base_revision,
        allow_paths: [...input.allow_paths],
        deny_paths: [...input.deny_paths],
        max_files: input.max_files,
        max_changed_lines: input.max_changed_lines,
        allow_new_files: input.allow_new_files,
        allow_new_dependencies: input.allow_new_dependencies,
        allow_migrations: input.allow_migrations,
        allow_config_changes: input.allow_config_changes,
        allow_public_api_changes: input.allow_public_api_changes,
        preset: input.preset,
        stack_profile: input.stack_profile,
        disabled_stack_rules: [...input.disabled_stack_rules],
        status: 'draft',
        created_at: createdAt,
        updated_at: createdAt,
        closed_at: null,
    };
}
export function isContractPreset(value) {
    return CONTRACT_PRESETS.includes(value);
}
export function isStackProfile(value) {
    return STACK_PROFILES.includes(value);
}
//# sourceMappingURL=change-contract.js.map