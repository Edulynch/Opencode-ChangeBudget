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

## Stability Requirements

- Arrays must be deterministic sorted.
- `pathRuleResults` is sorted by `path` then `status`.
- `limitResults` is sorted by `limitName`.
- `violations` is sorted by `rule`, then `path`, then `message`.
- Values are plain UTF-8 serializable primitives.

## Status Semantics

- `PASS`: no violations.
- `FAIL`: one or more violations exist.

## Invalid Input Handling

- Missing `baseRevision`: result is not produced.
- Unresolvable base revision: command fails before result creation and returns a deterministic git error.
- Malformed path pattern: command fails before limit evaluation with invalid pattern detail.
