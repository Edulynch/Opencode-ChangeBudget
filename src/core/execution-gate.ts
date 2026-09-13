import type {
  AllowlistAuthority,
  AllowlistMaterialDecision,
  ExecutionEnvelope,
  ExecutionGateResult,
  MaterialDecision,
  NumericAuthority,
  NumericMaterialDecision,
} from '../models/execution-gate.js';
export const FAST_PATH_OPERATIONS = [
  'read_only',
  'introspection',
  'authorized_validation',
  'changebudget_check',
  'incidental_cleanup',
  'normal_close',
  'local_search',
  'git_status',
  'inspection',
  'authorized_directory_creation',
  'necessary_implementation',
] as const;
export type FastPathOperation = (typeof FAST_PATH_OPERATIONS)[number];
export interface FastPathExecutionGateOperation {
  readonly kind: 'FAST_PATH';
  readonly operation: FastPathOperation;
}
export interface MaterialExecutionGateOperation {
  readonly kind: 'MATERIAL_DECISION';
  readonly proposal: MaterialDecision;
}
export interface UnknownAuthorityChangeOperation {
  readonly kind: 'UNKNOWN_AUTHORITY_CHANGE';
}
export type ExecutionGateOperation = FastPathExecutionGateOperation | MaterialExecutionGateOperation | UnknownAuthorityChangeOperation;
export interface ExecutionGateInput {
  readonly envelope?: ExecutionEnvelope;
  readonly operation: ExecutionGateOperation;
}
const ZERO_SOFT_NUMERIC_AUTHORITY: NumericAuthority = { max: 0, constraint: 'SOFT' };
const ZERO_SOFT_ALLOWLIST_AUTHORITY: AllowlistAuthority = { allowed: [], constraint: 'SOFT' };
export function evaluateExecutionGate(input: ExecutionGateInput): ExecutionGateResult {
  if (input.envelope === undefined) return { kind: 'NON_MATERIAL' };
  switch (input.operation.kind) {
    case 'UNKNOWN_AUTHORITY_CHANGE':
      return invalidProposal('Authority-changing operations must use a declared material decision kind');
    case 'FAST_PATH':
      return evaluateFastPath(input.envelope, input.operation.operation);
    case 'MATERIAL_DECISION':
      return evaluateMaterialDecision(input.envelope, input.operation.proposal);
    default:
      return assertNever(input.operation);
  }
}
function evaluateFastPath(envelope: ExecutionEnvelope, operation: FastPathOperation): ExecutionGateResult {
  if (envelope.satisfaction.state === 'OPEN') return { kind: 'NON_MATERIAL' };
  switch (operation) {
    case 'read_only':
    case 'introspection':
    case 'authorized_validation':
    case 'changebudget_check':
    case 'incidental_cleanup':
    case 'normal_close':
      return { kind: 'NON_MATERIAL' };
    case 'local_search':
    case 'git_status':
    case 'inspection':
    case 'authorized_directory_creation':
    case 'necessary_implementation':
      return governance('BLOCK', 'The contract is satisfied; additional operations require new authority');
    default:
      return assertNever(operation);
  }
}
function evaluateMaterialDecision(envelope: ExecutionEnvelope, proposal: MaterialDecision): ExecutionGateResult {
  const structuralFailure = validateProposal(envelope, proposal);
  if (structuralFailure !== undefined) return invalidProposal(structuralFailure);
  if (envelope.satisfaction.state === 'CONTRACT_SATISFIED') {
    return governance('BLOCK', 'The contract is satisfied; additional operations require new authority');
  }

  switch (proposal.kind) {
    case 'scope_expansion':
      return { kind: 'NON_MATERIAL' };
    case 'post_satisfaction_work':
      return invalidProposal('post_satisfaction_work is only valid after contract satisfaction');
    case 'delegated_agent':
      return evaluateNumericProposal(proposal, envelope.authority.delegated_agent ?? ZERO_SOFT_NUMERIC_AUTHORITY);
    case 'concurrent_worker':
      return evaluateNumericProposal(proposal, envelope.authority.concurrent_worker ?? ZERO_SOFT_NUMERIC_AUTHORITY);
    case 'reasoning_escalation':
      return evaluateAllowlistProposal(envelope, proposal, envelope.authority.reasoning_escalation ?? ZERO_SOFT_ALLOWLIST_AUTHORITY);
    case 'research_expansion':
      return evaluateAllowlistProposal(envelope, proposal, envelope.authority.research_expansion ?? ZERO_SOFT_ALLOWLIST_AUTHORITY);
    case 'architecture_review':
      return evaluateAllowlistProposal(envelope, proposal, envelope.authority.architecture_review ?? ZERO_SOFT_ALLOWLIST_AUTHORITY);
    case 'verification_expansion':
      return evaluateAllowlistProposal(envelope, proposal, envelope.authority.verification_expansion ?? ZERO_SOFT_ALLOWLIST_AUTHORITY);
    case 'documentation_expansion':
      return evaluateAllowlistProposal(envelope, proposal, envelope.authority.documentation_expansion ?? ZERO_SOFT_ALLOWLIST_AUTHORITY);
    case 'infrastructure_expansion':
      return evaluateAllowlistProposal(envelope, proposal, envelope.authority.infrastructure_expansion ?? ZERO_SOFT_ALLOWLIST_AUTHORITY);
    case 'external_service':
      return evaluateAllowlistProposal(envelope, proposal, envelope.authority.external_service ?? ZERO_SOFT_ALLOWLIST_AUTHORITY);
    default:
      return assertNever(proposal);
  }
}
function validateProposal(envelope: ExecutionEnvelope, proposal: MaterialDecision): string | undefined {
  if (proposal.id.length === 0 || proposal.criterion_refs.length === 0 || proposal.evidence.length === 0) {
    return 'Material decisions require an identity, criterion references, and necessity evidence';
  }
  const criterionIds = new Set(envelope.acceptance_criteria.map((criterion) => criterion.id));
  if (!proposal.criterion_refs.every((reference) => criterionIds.has(reference))) {
    return 'Material decision criterion references must be declared by the envelope';
  }

  switch (proposal.kind) {
    case 'scope_expansion':
      return undefined;
    case 'post_satisfaction_work':
      return undefined;
    case 'delegated_agent':
      return validateNumericProposal(proposal, envelope.authority.delegated_agent ?? ZERO_SOFT_NUMERIC_AUTHORITY);
    case 'concurrent_worker':
      return validateNumericProposal(proposal, envelope.authority.concurrent_worker ?? ZERO_SOFT_NUMERIC_AUTHORITY);
    case 'reasoning_escalation':
      return validateAllowlistAuthority(proposal, envelope.authority.reasoning_escalation ?? ZERO_SOFT_ALLOWLIST_AUTHORITY, criterionIds);
    case 'research_expansion':
      return validateAllowlistAuthority(proposal, envelope.authority.research_expansion ?? ZERO_SOFT_ALLOWLIST_AUTHORITY, criterionIds);
    case 'architecture_review':
      return validateAllowlistAuthority(proposal, envelope.authority.architecture_review ?? ZERO_SOFT_ALLOWLIST_AUTHORITY, criterionIds);
    case 'verification_expansion':
      return validateAllowlistAuthority(proposal, envelope.authority.verification_expansion ?? ZERO_SOFT_ALLOWLIST_AUTHORITY, criterionIds);
    case 'documentation_expansion':
      return validateAllowlistAuthority(proposal, envelope.authority.documentation_expansion ?? ZERO_SOFT_ALLOWLIST_AUTHORITY, criterionIds);
    case 'infrastructure_expansion':
      return validateAllowlistAuthority(proposal, envelope.authority.infrastructure_expansion ?? ZERO_SOFT_ALLOWLIST_AUTHORITY, criterionIds);
    case 'external_service':
      return validateAllowlistAuthority(proposal, envelope.authority.external_service ?? ZERO_SOFT_ALLOWLIST_AUTHORITY, criterionIds);
    default:
      return assertNeverReason(proposal);
  }
}
function validateNumericProposal(proposal: NumericMaterialDecision, authority: NumericAuthority): string | undefined {
  if (!Number.isInteger(proposal.requested.amount) || proposal.requested.amount <= 0 || !Number.isInteger(authority.max) || authority.max < 0 || !isConstraint(authority.constraint)) {
    return 'Numeric authority and requested amount must be normalized integers';
  }
  if (proposal.necessity === 'optional') return undefined;
  if (proposal.minimum_required === undefined || !Number.isInteger(proposal.minimum_required) || proposal.minimum_required <= 0 || proposal.minimum_required > proposal.requested.amount) {
    return 'Required numeric decisions need a minimum_required within the requested amount';
  }
  return undefined;
}
function validateAllowlistAuthority(proposal: AllowlistMaterialDecision, authority: AllowlistAuthority, criterionIds: ReadonlySet<string>): string | undefined {
  if (proposal.requested.value.length === 0 || !isConstraint(authority.constraint) || !authority.allowed.every((value) => value.length > 0)) {
    return 'Allowlist authority and requested value must be normalized';
  }
  for (const [requestedValue, alternative] of Object.entries(authority.canonical_alternatives ?? {})) {
    if (requestedValue.length === 0 || !authority.allowed.includes(alternative.value) || alternative.required_for.length === 0 || !alternative.required_for.every((reference) => criterionIds.has(reference))) {
      return 'Canonical alternatives must target allowed values and declared criteria';
    }
  }
  return undefined;
}
function evaluateNumericProposal(proposal: NumericMaterialDecision, authority: NumericAuthority): ExecutionGateResult {
  if (proposal.requested.amount <= authority.max) return governance('APPROVE', 'Requested numeric authority is declared by the envelope');
  if (proposal.necessity === 'required') {
    const minimumRequired = proposal.minimum_required;
    if (minimumRequired !== undefined && minimumRequired <= authority.max) {
      return governance('REDUCE', 'Declared authority preserves the required minimum', minimumRequired);
    }
    return governance('ESCALATE', 'Required numeric authority exceeds the declared maximum');
  }
  if (authority.max > 0) return governance('REDUCE', 'Requested numeric authority exceeds the declared maximum', authority.max);
  return authority.constraint === 'HARD'
    ? governance('BLOCK', 'The HARD numeric limit prohibits optional expansion')
    : governance('DEFER', 'Optional numeric expansion is outside declared authority');
}

function evaluateAllowlistProposal(envelope: ExecutionEnvelope, proposal: AllowlistMaterialDecision, authority: AllowlistAuthority): ExecutionGateResult {
  if (authority.allowed.includes(proposal.requested.value)) return governance('APPROVE', 'Requested value is declared by the envelope');
  const alternative = authority.canonical_alternatives?.[proposal.requested.value];
  if (proposal.necessity === 'required' && alternative !== undefined && alternative.required_for.some((reference) => proposal.criterion_refs.includes(reference) && !isCriterionSatisfied(envelope, reference))) {
    return governance('REPLACE', 'A declared canonical alternative preserves an unsatisfied criterion', undefined, alternative.value);
  }
  if (proposal.necessity === 'required') return governance('ESCALATE', 'Required value is outside the declared allowlist');
  return authority.constraint === 'HARD'
    ? governance('BLOCK', 'The HARD allowlist prohibits optional expansion')
    : governance('DEFER', 'Optional value is outside the declared allowlist');
}
function isCriterionSatisfied(envelope: ExecutionEnvelope, criterionId: string): boolean {
  const criterion = envelope.acceptance_criteria.find((candidate) => candidate.id === criterionId);
  if (criterion === undefined) return false;
  const evidence = envelope.satisfaction.evidence_by_criterion[criterionId] ?? [];
  return criterion.required_evidence.every((required) => evidence.includes(required));
}

function isConstraint(value: string): value is 'HARD' | 'SOFT' {
  return value === 'HARD' || value === 'SOFT';
}

function governance(verdict: 'APPROVE' | 'REDUCE' | 'REPLACE' | 'DEFER' | 'BLOCK' | 'ESCALATE', reason: string, reducedAmount?: number, replacementValue?: string): ExecutionGateResult {
  return { kind: 'GOVERNANCE', outcome: { verdict, reason, ...(reducedAmount === undefined ? {} : { reduced_amount: reducedAmount }), ...(replacementValue === undefined ? {} : { replacement_value: replacementValue }) } };
}

function invalidProposal(reason: string): ExecutionGateResult {
  return { kind: 'INVALID_PROPOSAL', reason };
}

function assertNever(value: never): ExecutionGateResult {
  return invalidProposal(`Unsupported execution gate input: ${String(value)}`);
}

function assertNeverReason(value: never): string {
  return `Unsupported material decision: ${String(value)}`;
}
