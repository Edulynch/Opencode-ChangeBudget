import { runGit } from '../git/repo.js';
import { getBuiltInStackProfileRules } from '../check/stack-policy.js';
import { compilePathPatterns, matchPathPattern } from '../check/patterns.js';
import {
  DiagnoseInput,
  ObservableSignals,
  SENSITIVE_CATEGORIES,
} from '../../models/diagnose.js';
import { StackProfile } from '../../models/change-contract.js';
import { SpecKitTaskResolution } from '../../models/spec-kit-task.js';

const VALID_BUDGET_VALUES = ['tiny', 'normal', 'free'] as const;

export async function collectObservableSignals(
  repositoryRoot: string,
  input: DiagnoseInput,
  taskResolution: SpecKitTaskResolution | null,
): Promise<ObservableSignals> {
  const distinctPrefixes = [...new Set([...input.allow_paths, ...input.deny_paths])];
  const declared_path_count = distinctPrefixes.length;

  let tracked_file_count: number | null = null;

  if (declared_path_count > 0) {
    const compiledPrefixes = compilePathPatterns(distinctPrefixes);
    const listing = await runGit(repositoryRoot, ['ls-files']);
    tracked_file_count = listing
      .split(/\r?\n/)
      .filter((line) => line.length > 0 && matchPathPattern(line, compiledPrefixes)).length;
  }

  let sensitive_categories: string[] = [];

  if (input.stack_profile !== null && declared_path_count > 0) {
    const rules = getBuiltInStackProfileRules(input.stack_profile as StackProfile);
    const matched = new Set<string>();

    for (const rule of rules) {
      if (!(SENSITIVE_CATEGORIES as readonly string[]).includes(rule.category)) {
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
  const task_budget_default =
    budgetDefault !== null && (VALID_BUDGET_VALUES as readonly string[]).includes(budgetDefault)
      ? (budgetDefault as 'tiny' | 'normal' | 'free')
      : null;

  return {
    declared_path_count,
    tracked_file_count,
    sensitive_categories,
    task_id: taskResolution?.task_id ?? null,
    task_budget_default,
  };
}
