export const COMPARISON_MODES = ['baseline', 'legacy'] as const;
export const BASELINE_STATES = ['captured', 'legacy', 'unavailable', 'invalid', 'incompatible'] as const;
export const BASELINE_EVIDENCE_STATES = [
  'valid',
  'legacy',
  'missing',
  'corrupt',
  'mismatched',
  'unsupported',
  'ambiguous',
  'unstable',
  'unavailable',
  'dirty-submodule',
] as const;
export const BASELINE_REASON_CODES = [
  'BASELINE_REQUIRED_MISSING',
  'BASELINE_CORRUPT',
  'BASELINE_MISMATCH',
  'BASELINE_UNSUPPORTED',
  'BASELINE_PATH_AMBIGUITY',
  'BASELINE_HEAD_MOVED',
  'BASELINE_UNSTABLE_CAPTURE',
  'BASELINE_SUBMODULE_DIRTY',
] as const;
export const BASELINE_OBJECT_TYPES = ['file', 'directory', 'symlink', 'gitlink', 'other'] as const;

export type ComparisonMode = (typeof COMPARISON_MODES)[number];
export type BaselineState = (typeof BASELINE_STATES)[number];
export type BaselineEvidenceState = (typeof BASELINE_EVIDENCE_STATES)[number];
export type BaselineReasonCode = (typeof BASELINE_REASON_CODES)[number];
export type BaselineObjectType = (typeof BASELINE_OBJECT_TYPES)[number];

export interface BaselineHeadBinding {
  readonly activationHead: string;
}

export interface BaselineObservation {
  readonly path: string;
  readonly sourcePath?: string;
  readonly tracked: boolean;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly deleted: boolean;
  readonly renamed: boolean;
  readonly copied: boolean;
  readonly isBinary: boolean;
  readonly mode: string | null;
  readonly objectType: BaselineObjectType;
}

export interface BaselineEntry {
  readonly path: string;
  readonly objectType: BaselineObjectType;
  readonly mode: string | null;
  readonly size: number;
  readonly contentDigest: string | null;
  readonly payload: string | null;
  readonly observation: Omit<BaselineObservation, 'path' | 'sourcePath' | 'objectType' | 'mode'>;
}

export interface BaselineEvidence {
  readonly schemaVersion: number;
  readonly contractId: string;
  readonly activationHead: string;
  readonly entries: readonly BaselineEntry[];
  readonly integrity: string;
}

export interface BaselineLifecycleResult {
  readonly comparisonMode: ComparisonMode;
  readonly baselineState: BaselineState;
  readonly evidenceState: BaselineEvidenceState;
  readonly decision: 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';
  readonly reasonCodes: readonly BaselineReasonCode[];
}
