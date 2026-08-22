export const TINY_MAX_TRACKED_FILES = 5;
export const TINY_MAX_DECLARED_PATHS = 2;
export const NORMAL_MAX_TRACKED_FILES = 50;
export const NORMAL_MAX_DECLARED_PATHS = 3;
export const HIGH_RISK_CATEGORIES = ['migrations', 'release_artifacts'];
export const SENSITIVE_CATEGORIES = [
    'dependencies',
    'migrations',
    'configuration',
    'public_api',
    'release_artifacts',
];
export const DIAGNOSIS_OUTCOMES = ['tiny', 'normal', 'free', 'manual_review'];
export const DIAGNOSIS_SOURCES = ['explicit', 'inferred'];
export const DIAGNOSIS_SIGNALS = [
    'declared_paths',
    'tracked_files',
    'task_id',
    'task_budget_default',
    'sensitive_category',
];
export function isDiagnosisOutcome(value) {
    return DIAGNOSIS_OUTCOMES.includes(value);
}
//# sourceMappingURL=diagnose.js.map