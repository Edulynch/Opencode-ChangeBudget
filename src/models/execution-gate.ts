export const EXECUTION_CONSTRAINTS = ['HARD', 'SOFT'] as const;
export type ExecutionConstraint = (typeof EXECUTION_CONSTRAINTS)[number];

export const MATERIAL_DECISION_KINDS = [
  'scope_expansion',
  'delegated_agent',
  'concurrent_worker',
  'reasoning_escalation',
  'research_expansion',
  'architecture_review',
  'verification_expansion',
  'documentation_expansion',
  'infrastructure_expansion',
  'external_service',
  'post_satisfaction_work',
] as const;
export type MaterialDecisionKind = (typeof MATERIAL_DECISION_KINDS)[number];

export const NUMERIC_MATERIAL_DECISION_KINDS = [
  'delegated_agent',
  'concurrent_worker',
] as const;
export type NumericMaterialDecisionKind = (typeof NUMERIC_MATERIAL_DECISION_KINDS)[number];

export const ALLOWLIST_MATERIAL_DECISION_KINDS = [
  'reasoning_escalation',
  'research_expansion',
  'architecture_review',
  'verification_expansion',
  'documentation_expansion',
  'infrastructure_expansion',
  'external_service',
] as const;
export type AllowlistMaterialDecisionKind = (typeof ALLOWLIST_MATERIAL_DECISION_KINDS)[number];

export const SATISFACTION_STATES = ['OPEN', 'CONTRACT_SATISFIED'] as const;
export type SatisfactionState = (typeof SATISFACTION_STATES)[number];

export const GOVERNANCE_VERDICTS = [
  'APPROVE',
  'REDUCE',
  'REPLACE',
  'DEFER',
  'BLOCK',
  'ESCALATE',
] as const;
export type GovernanceVerdict = (typeof GOVERNANCE_VERDICTS)[number];

export const NECESSITY_LEVELS = ['optional', 'required'] as const;
export type NecessityLevel = (typeof NECESSITY_LEVELS)[number];

export const POST_SATISFACTION_OPERATIONS = [
  'read_only',
  'introspection',
  'authorized_validation',
  'changebudget_check',
  'incidental_cleanup',
  'normal_close',
] as const;
export type PostSatisfactionOperation = (typeof POST_SATISFACTION_OPERATIONS)[number];

export interface AcceptanceCriterion {
  readonly id: string;
  readonly outcome: string;
  readonly required_evidence: readonly string[];
}

export interface NumericAuthority {
  readonly max: number;
  readonly constraint: ExecutionConstraint;
}

export interface CanonicalAlternative {
  readonly value: string;
  readonly required_for: readonly string[];
}

export interface AllowlistAuthority {
  readonly allowed: readonly string[];
  readonly constraint: ExecutionConstraint;
  readonly canonical_alternatives?: Readonly<Record<string, CanonicalAlternative>>;
}

export interface ExecutionAuthority {
  readonly delegated_agent?: NumericAuthority;
  readonly concurrent_worker?: NumericAuthority;
  readonly reasoning_escalation?: AllowlistAuthority;
  readonly research_expansion?: AllowlistAuthority;
  readonly architecture_review?: AllowlistAuthority;
  readonly verification_expansion?: AllowlistAuthority;
  readonly documentation_expansion?: AllowlistAuthority;
  readonly infrastructure_expansion?: AllowlistAuthority;
  readonly external_service?: AllowlistAuthority;
}

export interface SatisfactionRecord {
  readonly state: SatisfactionState;
  readonly evidence_by_criterion: Readonly<Record<string, readonly string[]>>;
}

export interface ScopeAuthority {
  readonly allow_paths: readonly string[];
  readonly deny_paths: readonly string[];
  readonly allow_new_files: boolean;
}

export interface NumericMaterialDecision {
  readonly id: string;
  readonly kind: NumericMaterialDecisionKind;
  readonly requested: {
    readonly amount: number;
  };
  readonly necessity: NecessityLevel;
  readonly minimum_required?: number;
  readonly criterion_refs: readonly string[];
  readonly evidence: readonly string[];
}

export interface AllowlistMaterialDecision {
  readonly id: string;
  readonly kind: AllowlistMaterialDecisionKind;
  readonly requested: {
    readonly value: string;
  };
  readonly necessity: NecessityLevel;
  readonly criterion_refs: readonly string[];
  readonly evidence: readonly string[];
}

export interface ScopeExpansionDecision {
  readonly id: string;
  readonly kind: 'scope_expansion';
  readonly requested_paths: readonly string[];
  readonly requests_new_files: boolean;
  readonly necessity: NecessityLevel;
  readonly criterion_refs: readonly string[];
  readonly evidence: readonly string[];
}

export interface PostSatisfactionWorkDecision {
  readonly id: string;
  readonly kind: 'post_satisfaction_work';
  readonly operation: string;
  readonly necessity: NecessityLevel;
  readonly criterion_refs: readonly string[];
  readonly evidence: readonly string[];
}

export type MaterialDecision =
  | NumericMaterialDecision
  | AllowlistMaterialDecision
  | ScopeExpansionDecision
  | PostSatisfactionWorkDecision;

export interface GovernanceOutcome {
  readonly verdict: GovernanceVerdict;
  readonly reason: string;
  readonly reduced_amount?: number;
  readonly replacement_value?: string;
}

export interface InvalidProposalResult {
  readonly kind: 'INVALID_PROPOSAL';
  readonly reason: string;
}

export interface NonMaterialContinuation {
  readonly kind: 'NON_MATERIAL';
}

export interface GovernanceDecisionResult {
  readonly kind: 'GOVERNANCE';
  readonly outcome: GovernanceOutcome;
}

export type ExecutionGateResult =
  | InvalidProposalResult
  | NonMaterialContinuation
  | GovernanceDecisionResult;

export interface MaterialDecisionLedgerEntry {
  readonly proposal_id: string;
  readonly proposal: MaterialDecision;
  readonly outcome: GovernanceOutcome;
}

export interface ExecutionEnvelope {
  readonly goal: string;
  readonly acceptance_criteria: readonly AcceptanceCriterion[];
  readonly authority: ExecutionAuthority;
  readonly satisfaction: SatisfactionRecord;
  readonly ledger: readonly MaterialDecisionLedgerEntry[];
}
