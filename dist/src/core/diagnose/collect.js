import { runGit } from '../git/repo.js';
import { getBuiltInStackProfileRules } from '../check/stack-policy.js';
import { compilePathPatterns, matchPathPattern } from '../check/patterns.js';
import { SENSITIVE_CATEGORIES, } from '../../models/diagnose.js';
const VALID_BUDGET_VALUES = ['tiny', 'normal', 'free'];
export async function collectObservableSignals(repositoryRoot, input, taskResolution) {
    const distinctPrefixes = [...new Set([...input.allow_paths, ...input.deny_paths])];
    const declared_path_count = distinctPrefixes.length;
    let tracked_file_count = null;
    if (declared_path_count > 0) {
        const compiledPrefixes = compilePathPatterns(distinctPrefixes);
        const listing = await runGit(repositoryRoot, ['ls-files']);
        tracked_file_count = listing
            .split(/\r?\n/)
            .filter((line) => line.length > 0 && matchPathPattern(line, compiledPrefixes)).length;
    }
    let sensitive_categories = [];
    if (input.stack_profile !== null && declared_path_count > 0) {
        const rules = getBuiltInStackProfileRules(input.stack_profile);
        const matched = new Set();
        for (const rule of rules) {
            if (!SENSITIVE_CATEGORIES.includes(rule.category)) {
                continue;
            }
            const compiledTargets = compilePathPatterns(rule.target_patterns);
            const triggered = distinctPrefixes.some((prefix) => matchPathPattern(prefix, compiledTargets));
            if (triggered) {
                matched.add(rule.category);
            }
        }
        sensitive_categories = [...matched].sort();
    }
    const budgetDefault = taskResolution?.budget_default ?? null;
    const task_budget_default = budgetDefault !== null && VALID_BUDGET_VALUES.includes(budgetDefault)
        ? budgetDefault
        : null;
    return {
        declared_path_count,
        tracked_file_count,
        sensitive_categories,
        task_id: taskResolution?.task_id ?? null,
        task_budget_default,
    };
}
//# sourceMappingURL=collect.js.map