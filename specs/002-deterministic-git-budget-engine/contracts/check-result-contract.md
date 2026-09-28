# Contract: Budget Check Result

This contract defines the runtime result object produced by SPEC-002 evaluation.

## Result Object

```ts
interface BudgetCheckResult {
  contractSource: 'active' | 'draft';
  contractId: string | null;
  baseRevision: string;
  changedFileCount: number;
  changedLinesCount: number;
  binaryChangeCount: number;
  newFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  pathRuleResults: PathRuleResult[];
  limitResults: LimitResult[];
  violations: BudgetViolation[];
  status: 'PASS' | 'FAIL';
  asOf: string;
}

interface PathRuleResult {
  path: string;
  status: 'allow' | 'deny';
  matchedAllow: boolean;
  matchedDeny: boolean;
}

interface LimitResult {
  limitName: 'max_files' | 'max_changed_lines';
  expected: number | null;
  observed: number;
  status: 'pass' | 'fail' | 'skip';
}

interface BudgetViolation {
  rule: 'max_files' | 'max_changed_lines' | 'allow_paths' | 'deny_paths';
  path?: string;
  message: string;
  expected?: number | string | null;
  observed?: number | string | null;
}
```

The interfaces above are the existing SPEC-002 result snapshot. They do not encode numeric-value provenance or the SPEC-003 decision/reason layer; they are not a proposal to add a field or final schema. Numeric values are classified under SPEC-002 `spec.md` FR-021. A legacy value with unknown provenance remains readable, but cannot be assumed to be a human hard ceiling or a soft estimate.

## Stability Requirements

- Arrays must be deterministic sorted.
- `pathRuleResults` is sorted by `path` then `status`.
- `limitResults` is sorted by `limitName`.
- `violations` is sorted by `rule`, then `path`, then `message`.
- Values are plain UTF-8 serializable primitives.

## Status Semantics

- `PASS`: no concrete violations and no failed evaluation precondition; an estimate overrun alone does not prevent PASS.
- `FAIL`: one or more concrete rule violations exist, or a decision-level evaluation precondition failed after hard command prerequisites succeeded. Numeric-limit violations require an exceeded provenance-qualified hard ceiling; an unresolved numeric value alone is not a violation. Fatal command prerequisites prevent result creation.

After hard repository, contract, and base prerequisites succeeded, if unresolved numeric provenance is necessary to evaluate a check or an authority-dependent operation, use the existing `FAIL` status without fabricating a hard-limit violation; SPEC-003 reports the evaluation-precondition outcome as `decision: HUMAN_REVIEW` with an explicit review reason and recovery guidance. If concrete violations are also known, report them all and retain deny/protected-path outcomes; the final decision is `HUMAN_REVIEW` under SPEC-003. The reason-code mapping is a planning item; no field, schema, or new reason code is defined here. Fatal command prerequisites prevent a result and retain their existing CLI error/exit behavior. Guardian BLOCKS an operation that relies on unresolved authority rather than using `ASK` as a substitute for valid provenance.

## Invalid Input Handling

- Missing `baseRevision`: result is not produced.
- Unresolvable base revision: command fails before result creation and returns a deterministic git error (existing hard CLI error/exit `4`, not a `HUMAN_REVIEW` result).
- Malformed path pattern: command fails before limit evaluation with invalid pattern detail.
- Unknown/ambiguous numeric-limit provenance after required repository, contract, and base prerequisites have succeeded: do not infer a hard violation; when classification is necessary for safe evaluation, do not return `PASS` and use the SPEC-003 `HUMAN_REVIEW` decision with explicit reason/recovery guidance. Use existing reason taxonomy only where accurate; no new code or result field is defined here. This is distinct from fatal errors that prevent result creation.
