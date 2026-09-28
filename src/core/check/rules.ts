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
import { TaskOutputObject } from '../../models/spec-kit-task.js';
import { compareCodeUnits } from '../ordering.js';

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
  allow_new_files: boolean;
  stackPolicyRules?: StackPolicyRule[];
  stackPolicySummary?: StackPolicySummary | null;
  task?: TaskOutputObject | null;
}

type NumericProvenanceClassification = 'HARD' | 'SOFT' | 'UNRESOLVED' | 'NOT_APPLICABLE';

type InternalEvaluationNote =
  | {
    readonly kind: 'advisory';
    readonly rule: 'max_files' | 'max_changed_lines';
    readonly expected: number;
    readonly observed: number;
    readonly message: string;
  }
  | {
    readonly kind: 'unresolved';
    readonly rule: 'max_files' | 'max_changed_lines';
    readonly expected: number;
    readonly observed: number;
    readonly message: string;
    readonly recommendation: string;
  };

const humanEvaluationNotesByLimitResults = new WeakMap<LimitResult[], readonly InternalEvaluationNote[]>();

export interface NumericLimitEvidenceContext {
  readonly limitName: 'max_files' | 'max_changed_lines';
  readonly exactValue: number;
  readonly contractId: string | null;
  readonly baseRevision: string;
}

/**
 * Internal evidence returned by a ChangeBudget-owned provenance verifier.
 * There is currently no production verifier wired into check evaluation, so
 * persisted contract fields and ordinary CLI input never produce this evidence.
 */
type NumericLimitEvidence =
  | {
    readonly classification: 'HARD';
    readonly limitName: 'max_files' | 'max_changed_lines';
    readonly exactValue: number;
    readonly contractId: string;
    readonly baseRevision: string;
    readonly issuer: 'human' | 'trusted-policy';
    readonly intent: 'exact-ceiling';
    readonly evidenceRef: string;
  }
  | {
    readonly classification: 'SOFT';
    readonly limitName: 'max_files' | 'max_changed_lines';
    readonly exactValue: number;
    readonly contractId: string;
    readonly baseRevision: string;
    readonly issuer: 'planner' | 'agent' | 'preset' | 'advisor';
    readonly intent: 'recommendation';
    readonly adoption: 'unadopted';
    readonly evidenceRef: string;
  };

/**
 * Optional internal verifier hook for deterministic rules tests. Runtime/CLI
 * evaluation deliberately omits it until trusted ChangeBudget-owned evidence
 * is available. Unknown and malformed callback output fails closed.
 */
export type NumericLimitEvidenceResolver = (context: NumericLimitEvidenceContext) => unknown;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function classifyNumericProvenance(
  expected: number | null,
  context: NumericLimitEvidenceContext,
  evidenceResolver?: NumericLimitEvidenceResolver,
): NumericProvenanceClassification {
  if (expected === null) {
    return 'NOT_APPLICABLE';
  }
  if (!evidenceResolver) {
    return 'UNRESOLVED';
  }

  try {
    const evidence = evidenceResolver(context);
    if (!isRecord(evidence)) {
      return 'UNRESOLVED';
    }

    const commonKeys = ['classification', 'limitName', 'exactValue', 'contractId', 'baseRevision', 'evidenceRef'];
    const commonMatches = evidence.limitName === context.limitName
      && evidence.exactValue === expected
      && evidence.exactValue === context.exactValue
      && evidence.contractId === context.contractId
      && evidence.baseRevision === context.baseRevision
      && typeof evidence.evidenceRef === 'string'
      && evidence.evidenceRef.trim().length > 0;
    if (!commonMatches) {
      return 'UNRESOLVED';
    }

    if (
      evidence.classification === 'HARD'
      && hasExactKeys(evidence, [...commonKeys, 'issuer', 'intent'])
      && (evidence.issuer === 'human' || evidence.issuer === 'trusted-policy')
      && evidence.intent === 'exact-ceiling'
    ) {
      return 'HARD';
    }

    if (
      evidence.classification === 'SOFT'
      && hasExactKeys(evidence, [...commonKeys, 'issuer', 'intent', 'adoption'])
      && (evidence.issuer === 'planner' || evidence.issuer === 'agent' || evidence.issuer === 'preset' || evidence.issuer === 'advisor')
      && evidence.intent === 'recommendation'
      && evidence.adoption === 'unadopted'
    ) {
      return 'SOFT';
    }
  } catch {
    // A broken verifier or malformed evidence is never authority.
  }

  return 'UNRESOLVED';
}

function buildLimitResult(
  limitName: 'max_files' | 'max_changed_lines',
  observed: number,
  expected: number | null,
  provenance: NumericProvenanceClassification,
): LimitResult {
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
    status: observed > expected && provenance === 'HARD' ? 'fail' : 'pass',
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

function buildNewFileViolation(path: string): BudgetViolation {
  return {
    rule: 'allow_new_files',
    path,
    message: 'New file creation is not allowed by the active contract',
    reasonCode: 'CBV-NEW-FILE-NOT-ALLOWED',
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

function calculateStatus(violations: BudgetViolation[], hasMaterialUnresolvedLimit: boolean): 'PASS' | 'FAIL' {
  return violations.length > 0 || hasMaterialUnresolvedLimit ? 'FAIL' : 'PASS';
}

function buildDecision(violations: BudgetViolation[], hasMaterialUnresolvedLimit: boolean): DecisionResult {
  if (hasMaterialUnresolvedLimit) {
    return 'HUMAN_REVIEW';
  }
  return violations.length > 0 ? 'REPAIR' : 'PASS';
}

/**
 * Returns human-only explanations attached to the existing limit result array.
 * This internal side channel keeps provenance and note schemas out of public
 * check/status results and therefore out of their JSON contracts.
 */
export function getHumanEvaluationNotes(
  result: Pick<BudgetCheckResult, 'limitResults'>,
): string[] {
  const notes = humanEvaluationNotesByLimitResults.get(result.limitResults) ?? [];
  const unresolved = notes.filter((note) => note.kind === 'unresolved');
  const advisories = notes.filter((note) => note.kind === 'advisory');
  const lines: string[] = [];

  if (unresolved.length > 0) {
    lines.push('Evaluation preconditions:');
    for (const note of unresolved) {
      lines.push(`  - ${note.rule}: ${note.message}`);
      lines.push(`    Recommendation: ${note.recommendation}`);
    }
  }

  if (advisories.length > 0) {
    lines.push('Advisories:');
    for (const note of advisories) {
      lines.push(`  - ${note.rule}: ${note.message} (expected=${note.expected}, observed=${note.observed})`);
    }
  }

  return lines;
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

  return compareCodeUnits(left.limitName, right.limitName);
}

export function evaluateBudgetCheck(
  contract: CheckEvaluationInput,
  changedItems: BudgetChangeItem[],
  evidenceResolver?: NumericLimitEvidenceResolver,
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
    const pathComparison = compareCodeUnits(left.path, right.path);
    if (pathComparison !== 0) {
      return pathComparison;
    }

    return compareCodeUnits(left.status, right.status);
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

  const numericLimits = [
    { limitName: 'max_files' as const, observed: changedFileCount, expected: contract.max_files },
    { limitName: 'max_changed_lines' as const, observed: changedLinesCount, expected: contract.max_changed_lines },
  ];
  const limitEvaluations = numericLimits.map(({ limitName, observed, expected }) => {
    const provenance = classifyNumericProvenance(expected, {
      limitName,
      exactValue: expected ?? 0,
      contractId: contract.contractId,
      baseRevision: contract.baseRevision,
    }, evidenceResolver);
    return {
      result: buildLimitResult(limitName, observed, expected, provenance),
      provenance,
    };
  }).sort((left, right) => compareLimitResults(left.result, right.result));
  const limitResults = limitEvaluations.map(({ result }) => result);

  const violations: BudgetViolation[] = [];
  const evaluationNotes: InternalEvaluationNote[] = [];
  let hasMaterialUnresolvedLimit = false;

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

  if (!contract.allow_new_files) {
    for (const item of changedItems) {
      if (item.type === 'added') {
        violations.push(buildNewFileViolation(item.path));
      }
    }
  }

  for (const { result: limit, provenance } of limitEvaluations) {
    if (limit.expected === null) {
      continue;
    }

    if (limit.status === 'fail') {
      violations.push(buildLimitViolation(limit.limitName, limit.expected, limit.observed));
      continue;
    }

    if (limit.observed <= limit.expected) {
      continue;
    }

    if (provenance === 'SOFT') {
      evaluationNotes.push({
        kind: 'advisory',
        rule: limit.limitName,
        expected: limit.expected,
        observed: limit.observed,
        message: `Soft ${limit.limitName} recommendation exceeded; this is advisory drift, not a hard limit violation.`,
      });
    } else if (provenance === 'UNRESOLVED') {
      hasMaterialUnresolvedLimit = true;
      evaluationNotes.push({
        kind: 'unresolved',
        rule: limit.limitName,
        expected: limit.expected,
        observed: limit.observed,
        message: `Cannot determine whether ${limit.limitName}=${limit.expected} is an authorized hard ceiling or a soft estimate; the observed value is ${limit.observed}.`,
        recommendation: 'Obtain fresh human authorization for this exact ceiling or verify trusted policy provenance through a supported ChangeBudget workflow.',
      });
    }
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
    const ruleComparison = compareCodeUnits(left.rule, right.rule);
    if (ruleComparison !== 0) {
      return ruleComparison;
    }

    const reasonCodeComparison = compareCodeUnits((left.reasonCode ?? ''), (right.reasonCode ?? ''));
    if (reasonCodeComparison !== 0) {
      return reasonCodeComparison;
    }

    const pathComparison = compareCodeUnits((left.path ?? ''), (right.path ?? ''));
    if (pathComparison !== 0) {
      return pathComparison;
    }

    return compareCodeUnits(left.message, right.message);
  });

  const status = calculateStatus(violations, hasMaterialUnresolvedLimit);
  const decision = buildDecision(violations, hasMaterialUnresolvedLimit);
  const reasonCodes = buildReasonCodes(violations);

  const result: BudgetCheckResult = {
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
    task: contract.task ?? null,
    asOf: new Date().toISOString(),
  };

  if (evaluationNotes.length > 0) {
    humanEvaluationNotesByLimitResults.set(limitResults, evaluationNotes);
  }

  return result;
}
