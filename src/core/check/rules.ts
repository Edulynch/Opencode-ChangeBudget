import {
  BudgetCheckResult,
  BudgetViolation,
  LimitResult,
  PathRuleResult,
  DecisionResult,
  ReasonCode,
  StackPolicySummary,
} from '../../models/check-result.js';
import { BudgetChangeItem } from './diff.js';
import { compilePathPatterns, matchPathPattern } from './patterns.js';
import { buildStackReasonCode, StackPolicyRule } from './stack-policy.js';

interface ResolvedStackRule {
  rule: StackPolicyRule;
  patterns: ReturnType<typeof compilePathPatterns>;
}

export interface CheckEvaluationInput {
  source: 'active' | 'draft';
  contractId: string | null;
  baseRevision: string;
  allow_paths: string[];
  deny_paths: string[];
  max_files: number | null;
  max_changed_lines: number | null;
  stackPolicyRules?: StackPolicyRule[];
  stackPolicySummary?: StackPolicySummary | null;
}

function buildLimitResult(limitName: 'max_files' | 'max_changed_lines', observed: number, expected: number | null): LimitResult {
  if (expected === null) {
    return {
      limitName,
      expected: null,
      observed,
      status: 'skip',
    };
  }

  return {
    limitName,
    expected,
    observed,
    status: observed > expected ? 'fail' : 'pass',
  };
}

function buildLimitViolation(
  rule: 'max_files' | 'max_changed_lines',
  expected: number,
  observed: number,
): BudgetViolation {
  const reasonCode: ReasonCode =
    rule === 'max_files' ? 'CBV-LIMIT-FILES-EXCEEDED' : 'CBV-LIMIT-LINES-EXCEEDED';

  if (rule === 'max_files') {
    return {
      rule,
      path: undefined,
      message: 'File budget exceeded',
      expected,
      observed,
      reasonCode,
      action: 'repair',
    };
  }

  return {
    rule,
    path: undefined,
    message: 'Changed lines budget exceeded',
    expected,
    observed,
    reasonCode,
    action: 'repair',
  };
}

function buildPathViolation(rule: 'allow_paths' | 'deny_paths', path: string): BudgetViolation {
  const reasonCode: ReasonCode = rule === 'deny_paths' ? 'CBV-PATH-DENIED' : 'CBV-PATH-NOT-ALLOWED';

  if (rule === 'deny_paths') {
    return {
      rule,
      path,
      message: 'Path is blocked by deny_paths',
      reasonCode,
      action: 'review',
    };
  }

  return {
    rule,
    path,
    message: 'Path is not in allow_paths',
    reasonCode,
    action: 'repair',
  };
}

function buildStackPolicyViolation(rule: StackPolicyRule, path: string): BudgetViolation {
  const reasonCode = buildStackReasonCode(rule.id);

  return {
    rule: 'stack_profile_rule',
    path,
    message: `Stack profile '${rule.profile_id}' rule ${rule.id} matched: ${rule.message}`,
    reasonCode,
    action: 'review',
  };
}

function compileStackPolicyRules(rules: StackPolicyRule[]): ResolvedStackRule[] {
  return rules.map((rule) => ({
    rule,
    patterns: compilePathPatterns(rule.target_patterns),
  }));
}

function calculateStatus(violations: BudgetViolation[]): 'PASS' | 'FAIL' {
  return violations.length > 0 ? 'FAIL' : 'PASS';
}

function buildDecision(violations: BudgetViolation[]): DecisionResult {
  return violations.length > 0 ? 'REPAIR' : 'PASS';
}

function buildReasonCodes(violations: BudgetViolation[]): ReasonCode[] {
  const reasons = violations
    .map((entry) => entry.reasonCode)
    .filter((code): code is ReasonCode => typeof code === 'string');

  return [...new Set(reasons)].sort();
}

function compareLimitResults(
  left: LimitResult,
  right: LimitResult,
): number {
  if (left.limitName === right.limitName) {
    return 0;
  }

  if (left.limitName === 'max_files') {
    return -1;
  }

  if (right.limitName === 'max_files') {
    return 1;
  }

  return left.limitName.localeCompare(right.limitName);
}

export function evaluateBudgetCheck(
  contract: CheckEvaluationInput,
  changedItems: BudgetChangeItem[],
): BudgetCheckResult {
  // Ensure deterministic matching behavior and fast fail for bad patterns before partial evaluation.
  const allowPatterns = compilePathPatterns(contract.allow_paths);
  const denyPatterns = compilePathPatterns(contract.deny_paths);
  const resolvedStackPolicy = compileStackPolicyRules(contract.stackPolicyRules ?? []);

  const pathRuleResults: PathRuleResult[] = changedItems.map((entry) => {
    const matchedAllow = allowPatterns.length === 0 || matchPathPattern(entry.path, allowPatterns);
    const matchedDeny = matchPathPattern(entry.path, denyPatterns);

    return {
      path: entry.path,
      status: matchedDeny || !matchedAllow ? 'deny' : 'allow',
      matchedAllow,
      matchedDeny,
    };
  });

  pathRuleResults.sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path);
    if (pathComparison !== 0) {
      return pathComparison;
    }

    return left.status.localeCompare(right.status);
  });

  const changedFileCount = changedItems.length;
  const changedLinesCount = changedItems.reduce((total, item) => {
    if (item.isBinary) {
      return total;
    }

    return total + item.addedLines + item.removedLines;
  }, 0);

  const binaryChangeCount = changedItems.reduce((count, item) => count + (item.isBinary ? 1 : 0), 0);
  const newFileCount = changedItems.filter((item) => item.type === 'added').length;
  const deletedFileCount = changedItems.filter((item) => item.type === 'deleted').length;
  const renamedFileCount = changedItems.filter((item) => item.type === 'renamed').length;

  const limitResults: LimitResult[] = [
    buildLimitResult('max_files', changedFileCount, contract.max_files),
    buildLimitResult('max_changed_lines', changedLinesCount, contract.max_changed_lines),
  ].sort(compareLimitResults);

  const violations: BudgetViolation[] = [];

  for (const result of pathRuleResults) {
    if (result.status === 'allow') {
      continue;
    }

    if (result.matchedDeny) {
      violations.push(buildPathViolation('deny_paths', result.path));
      continue;
    }

    violations.push(buildPathViolation('allow_paths', result.path));
  }

  for (const limit of limitResults) {
    if (limit.status !== 'fail') {
      continue;
    }

    if (limit.expected === null) {
      continue;
    }

    violations.push(buildLimitViolation(limit.limitName, limit.expected, limit.observed));
  }

  for (const item of pathRuleResults) {
    for (const stackRule of resolvedStackPolicy) {
      if (!matchPathPattern(item.path, stackRule.patterns)) {
        continue;
      }

      violations.push(buildStackPolicyViolation(stackRule.rule, item.path));
    }
  }

  violations.sort((left, right) => {
    const ruleComparison = left.rule.localeCompare(right.rule);
    if (ruleComparison !== 0) {
      return ruleComparison;
    }

    const reasonCodeComparison = ((left.reasonCode ?? '').localeCompare(right.reasonCode ?? ''));
    if (reasonCodeComparison !== 0) {
      return reasonCodeComparison;
    }

    const pathComparison = (left.path ?? '').localeCompare(right.path ?? '');
    if (pathComparison !== 0) {
      return pathComparison;
    }

    return left.message.localeCompare(right.message);
  });

  const status = calculateStatus(violations);
  const decision = buildDecision(violations);
  const reasonCodes = buildReasonCodes(violations);

  return {
    contractSource: contract.source,
    contractId: contract.contractId,
    baseRevision: contract.baseRevision,
    changedFileCount,
    changedLinesCount,
    binaryChangeCount,
    newFileCount,
    deletedFileCount,
    renamedFileCount,
    pathRuleResults,
    limitResults,
    violations,
    status,
    decision,
    reasonCodes,
    stackPolicySummary: contract.stackPolicySummary ?? null,
    asOf: new Date().toISOString(),
  };
}
