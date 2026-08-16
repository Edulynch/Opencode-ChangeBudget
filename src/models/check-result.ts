export type CheckRule = 'max_files' | 'max_changed_lines' | 'allow_paths' | 'deny_paths';

export type DecisionResult = 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';

export type DecisionAction = 'repair' | 'review';

export type ReasonCode =
  | 'CBV-BASE-REVISION-UNKNOWN'
  | 'CBV-LIMIT-FILES-EXCEEDED'
  | 'CBV-LIMIT-LINES-EXCEEDED'
  | 'CBV-PATH-DENIED'
  | 'CBV-PATH-NOT-ALLOWED'
  | 'CBV-INPUT-INVALID'
  | 'CBV-ENV-NOT-READY'
  | 'CBV-RULE-CONFIG-INVALID';

export type CheckStatus = 'PASS' | 'FAIL';

export type PathStatus = 'allow' | 'deny';

export type LimitStatus = 'pass' | 'fail' | 'skip';

export interface PathRuleResult {
  path: string;
  status: PathStatus;
  matchedAllow: boolean;
  matchedDeny: boolean;
}

export interface LimitResult {
  limitName: 'max_files' | 'max_changed_lines';
  expected: number | null;
  observed: number;
  status: LimitStatus;
}

export interface BudgetViolation {
  rule: CheckRule;
  path?: string;
  message: string;
  expected?: number | string | null;
  observed?: number | string | null;
  reasonCode?: ReasonCode;
  action?: DecisionAction;
}

export interface BudgetCheckResult {
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
  status: CheckStatus;
  decision: DecisionResult;
  reasonCodes: ReasonCode[];
  asOf: string;
}
