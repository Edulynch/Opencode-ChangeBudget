import { HIGH_RISK_CATEGORIES, NORMAL_MAX_DECLARED_PATHS, NORMAL_MAX_TRACKED_FILES, TINY_MAX_DECLARED_PATHS, TINY_MAX_TRACKED_FILES, } from '../../models/diagnose.js';
export function buildReasons(signals) {
    const reasons = [{ signal: 'declared_paths', value: signals.declared_path_count }];
    if (signals.tracked_file_count !== null) {
        reasons.push({ signal: 'tracked_files', value: signals.tracked_file_count });
    }
    if (signals.task_id !== null) {
        reasons.push({ signal: 'task_id', value: signals.task_id });
    }
    if (signals.task_budget_default !== null) {
        reasons.push({ signal: 'task_budget_default', value: signals.task_budget_default });
    }
    for (const category of [...signals.sensitive_categories].sort()) {
        reasons.push({ signal: 'sensitive_category', value: category });
    }
    return reasons;
}
export function evaluateRecommendation(signals, inputs) {
    const reasons = buildReasons(signals);
    const tracked = signals.tracked_file_count ?? 0;
    if (signals.task_budget_default !== null) {
        return {
            recommendation: signals.task_budget_default,
            source: 'explicit',
            reasons,
            inputs,
        };
    }
    if (signals.declared_path_count === 0) {
        return {
            recommendation: 'manual_review',
            source: 'inferred',
            reasons,
            inputs,
        };
    }
    const hasHighRiskCategory = signals.sensitive_categories.some((category) => HIGH_RISK_CATEGORIES.includes(category));
    if (hasHighRiskCategory) {
        return {
            recommendation: 'manual_review',
            source: 'inferred',
            reasons,
            inputs,
        };
    }
    if (tracked <= TINY_MAX_TRACKED_FILES &&
        signals.declared_path_count <= TINY_MAX_DECLARED_PATHS &&
        signals.sensitive_categories.length === 0) {
        return {
            recommendation: 'tiny',
            source: 'inferred',
            reasons,
            inputs,
        };
    }
    if (tracked <= NORMAL_MAX_TRACKED_FILES && signals.declared_path_count <= NORMAL_MAX_DECLARED_PATHS) {
        return {
            recommendation: 'normal',
            source: 'inferred',
            reasons,
            inputs,
        };
    }
    return {
        recommendation: 'free',
        source: 'inferred',
        reasons,
        inputs,
    };
}
//# sourceMappingURL=advisor.js.map