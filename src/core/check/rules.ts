import { BudgetCheckResult, BudgetViolation, LimitResult, PathRuleResult } from '../../models/check-result.js';
import { BudgetChangeItem } from './diff.js';
import { compilePathPatterns, matchPathPattern } from './patterns.js';

export interface CheckEvaluationInput {
  source: 'active' | 'draft';
  contractId: string | null;
  baseRevision: string;
  allow_paths: string[];
  deny_paths: string[];
  max_files: number | null;
  max_changed_lines: number | null;
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

function buildLimitViolation(rule: 'max_files' | 'max_changed_lines', expected: number, observed: number): BudgetViolation {
  if (rule === 'max_files') {
    return {
      rule,
      path: undefined,
      message: 'File budget exceeded',
      expected,
      observed,
    };
  }

  return {
    rule,
    path: undefined,
    message: 'Changed lines budget exceeded',
    expected,
    observed,
  };
}

function buildPathViolation(rule: 'allow_paths' | 'deny_paths', path: string): BudgetViolation {
  if (rule === 'deny_paths') {
    return {
      rule,
      path,
      message: 'Path is blocked by deny_paths',
    };
  }

  return {
    rule,
    path,
    message: 'Path is not in allow_paths',
  };
}

function calculateStatus(violations: BudgetViolation[]): 'PASS' | 'FAIL' {
  return violations.length > 0 ? 'FAIL' : 'PASS';
}

export function evaluateBudgetCheck(
  contract: CheckEvaluationInput,
  changedItems: BudgetChangeItem[],
): BudgetCheckResult {
  // Ensure deterministic matching behavior and fast fail for bad patterns before partial evaluation.
  const allowPatterns = compilePathPatterns(contract.allow_paths);
  const denyPatterns = compilePathPatterns(contract.deny_paths);

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
  ].sort((left, right) => left.limitName.localeCompare(right.limitName));

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

  violations.sort((left, right) => {
    const ruleComparison = left.rule.localeCompare(right.rule);
    if (ruleComparison !== 0) {
      return ruleComparison;
    }

    const pathComparison = (left.path ?? '').localeCompare(right.path ?? '');
    if (pathComparison !== 0) {
      return pathComparison;
    }

    return left.message.localeCompare(right.message);
  });

  const status = calculateStatus(violations);

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
    asOf: new Date().toISOString(),
  };
}
