import { compilePathPatterns, matchPathPattern } from './patterns.js';
import { buildStackReasonCode } from './stack-policy.js';
import { compareCodeUnits } from '../ordering.js';
function buildLimitResult(limitName, observed, expected) {
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
function buildLimitViolation(rule, expected, observed) {
    const reasonCode = rule === 'max_files' ? 'CBV-LIMIT-FILES-EXCEEDED' : 'CBV-LIMIT-LINES-EXCEEDED';
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
function buildPathViolation(rule, path) {
    const reasonCode = rule === 'deny_paths' ? 'CBV-PATH-DENIED' : 'CBV-PATH-NOT-ALLOWED';
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
function buildNewFileViolation(path) {
    return {
        rule: 'allow_new_files',
        path,
        message: 'New file creation is not allowed by the active contract',
        reasonCode: 'CBV-NEW-FILE-NOT-ALLOWED',
        action: 'repair',
    };
}
function buildStackPolicyViolation(rule, path) {
    const reasonCode = buildStackReasonCode(rule.id);
    return {
        rule: 'stack_profile_rule',
        path,
        message: `Stack profile '${rule.profile_id}' rule ${rule.id} matched: ${rule.message}`,
        reasonCode,
        action: 'review',
    };
}
function compileStackPolicyRules(rules) {
    return rules.map((rule) => ({
        rule,
        patterns: compilePathPatterns(rule.target_patterns),
    }));
}
function calculateStatus(violations) {
    return violations.length > 0 ? 'FAIL' : 'PASS';
}
function buildDecision(violations) {
    return violations.length > 0 ? 'REPAIR' : 'PASS';
}
function buildReasonCodes(violations) {
    const reasons = violations
        .map((entry) => entry.reasonCode)
        .filter((code) => typeof code === 'string');
    return [...new Set(reasons)].sort();
}
function compareLimitResults(left, right) {
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
export function evaluateBudgetCheck(contract, changedItems) {
    // Ensure deterministic matching behavior and fast fail for bad patterns before partial evaluation.
    const allowPatterns = compilePathPatterns(contract.allow_paths);
    const denyPatterns = compilePathPatterns(contract.deny_paths);
    const resolvedStackPolicy = compileStackPolicyRules(contract.stackPolicyRules ?? []);
    const pathRuleResults = changedItems.map((entry) => {
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
    const limitResults = [
        buildLimitResult('max_files', changedFileCount, contract.max_files),
        buildLimitResult('max_changed_lines', changedLinesCount, contract.max_changed_lines),
    ].sort(compareLimitResults);
    const violations = [];
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
        task: contract.task ?? null,
        asOf: new Date().toISOString(),
    };
}
//# sourceMappingURL=rules.js.map