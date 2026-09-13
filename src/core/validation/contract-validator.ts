import {
  CONTRACT_PRESETS,
  isContractPreset,
  ContractPreset,
  ParsedContractInput,
  ValidatedContractInput,
  isStackProfile,
  STACK_PROFILES,
} from '../../models/change-contract.js';
import type { AcceptanceCriterion, AllowlistAuthority, ExecutionAuthority, ExecutionEnvelope, NumericAuthority } from '../../models/execution-gate.js';

const AUTHORITY_KINDS = ['delegated_agent', 'concurrent_worker', 'reasoning_escalation', 'research_expansion', 'architecture_review', 'verification_expansion', 'documentation_expansion', 'infrastructure_expansion', 'external_service'];
const ZERO_SOFT_NUMERIC_AUTHORITY: NumericAuthority = { max: 0, constraint: 'SOFT' };
const ZERO_SOFT_ALLOWLIST_AUTHORITY: AllowlistAuthority = { allowed: [], constraint: 'SOFT' };

type RawRecord = Record<string, unknown>;

export interface ContractValidationFailure {
  field: string;
  message: string;
}

export interface ContractValidationResult {
  valid: boolean;
  errors: ContractValidationFailure[];
}

function addFailure(
  failures: ContractValidationFailure[],
  field: string,
  message: string,
): void {
  failures.push({ field, message });
}

function isValidRevision(value: string): boolean {
  return value.trim().length > 0;
}

function isRecord(value: unknown): value is RawRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeNonEmptyStrings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.length > 0) ? [...value] : undefined;
}

function normalizeCriteria(value: unknown): AcceptanceCriterion[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const ids = new Set<string>();
  const criteria: AcceptanceCriterion[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id.length === 0 || typeof entry.outcome !== 'string' || entry.outcome.length === 0 || ids.has(entry.id)) return undefined;
    const requiredEvidence = normalizeNonEmptyStrings(entry.required_evidence);
    if (requiredEvidence === undefined) return undefined;
    ids.add(entry.id);
    criteria.push({ id: entry.id, outcome: entry.outcome, required_evidence: requiredEvidence });
  }
  return criteria;
}

function normalizeNumericAuthority(value: unknown): NumericAuthority | undefined {
  if (value === undefined) return ZERO_SOFT_NUMERIC_AUTHORITY;
  if (!isRecord(value) || typeof value.max !== 'number' || !Number.isInteger(value.max) || value.max < 0 || (value.constraint !== 'HARD' && value.constraint !== 'SOFT')) return undefined;
  return { max: value.max, constraint: value.constraint };
}

function normalizeAllowlistAuthority(value: unknown, criterionIds: ReadonlySet<string>): AllowlistAuthority | undefined {
  if (value === undefined) return ZERO_SOFT_ALLOWLIST_AUTHORITY;
  if (!isRecord(value) || !Array.isArray(value.allowed) || !value.allowed.every((entry) => typeof entry === 'string' && entry.length > 0) || (value.constraint !== 'HARD' && value.constraint !== 'SOFT')) return undefined;
  const allowed = [...value.allowed];
  if (value.canonical_alternatives === undefined) return { allowed, constraint: value.constraint };
  if (!isRecord(value.canonical_alternatives)) return undefined;
  const canonicalAlternatives: Record<string, { value: string; required_for: readonly string[] }> = {};
  for (const [requestedValue, alternative] of Object.entries(value.canonical_alternatives)) {
    if (!requestedValue.length || !isRecord(alternative) || typeof alternative.value !== 'string' || !allowed.includes(alternative.value)) return undefined;
    const requiredFor = normalizeNonEmptyStrings(alternative.required_for);
    if (requiredFor === undefined || !requiredFor.every((reference) => criterionIds.has(reference))) return undefined;
    canonicalAlternatives[requestedValue] = { value: alternative.value, required_for: requiredFor };
  }

  return { allowed, constraint: value.constraint, canonical_alternatives: canonicalAlternatives };
}

function normalizeExecutionEnvelope(value: unknown, failures: ContractValidationFailure[]): ExecutionEnvelope | undefined {
  if (!isRecord(value) || typeof value.goal !== 'string' || value.goal.length === 0) {
    addFailure(failures, 'execution_envelope', 'execution_envelope must include a non-empty goal');
    return undefined;
  }

  const criteria = normalizeCriteria(value.acceptance_criteria);
  if (criteria === undefined || !isRecord(value.authority)) {
    addFailure(failures, 'execution_envelope', 'execution_envelope criteria and authority must be structurally valid');
    return undefined;
  }

  const authorityKeys = Object.keys(value.authority);
  if (authorityKeys.some((key) => !AUTHORITY_KINDS.includes(key))) {
    addFailure(failures, 'execution_envelope.authority', 'execution_envelope authority contains an unknown kind');
    return undefined;
  }

  const criterionIds = new Set(criteria.map((criterion) => criterion.id));
  const delegatedAgent = normalizeNumericAuthority(value.authority.delegated_agent);
  const concurrentWorker = normalizeNumericAuthority(value.authority.concurrent_worker);
  const reasoningEscalation = normalizeAllowlistAuthority(value.authority.reasoning_escalation, criterionIds);
  const researchExpansion = normalizeAllowlistAuthority(value.authority.research_expansion, criterionIds);
  const architectureReview = normalizeAllowlistAuthority(value.authority.architecture_review, criterionIds);
  const verificationExpansion = normalizeAllowlistAuthority(value.authority.verification_expansion, criterionIds);
  const documentationExpansion = normalizeAllowlistAuthority(value.authority.documentation_expansion, criterionIds);
  const infrastructureExpansion = normalizeAllowlistAuthority(value.authority.infrastructure_expansion, criterionIds);
  const externalService = normalizeAllowlistAuthority(value.authority.external_service, criterionIds);
  if ([delegatedAgent, concurrentWorker, reasoningEscalation, researchExpansion, architectureReview, verificationExpansion, documentationExpansion, infrastructureExpansion, externalService].some((entry) => entry === undefined)) {
    addFailure(failures, 'execution_envelope.authority', 'execution_envelope authority must use normalized structural forms');
    return undefined;
  }

  const authority: ExecutionAuthority = { delegated_agent: delegatedAgent, concurrent_worker: concurrentWorker, reasoning_escalation: reasoningEscalation, research_expansion: researchExpansion, architecture_review: architectureReview, verification_expansion: verificationExpansion, documentation_expansion: documentationExpansion, infrastructure_expansion: infrastructureExpansion, external_service: externalService };
  return { goal: value.goal, acceptance_criteria: criteria, authority, satisfaction: { state: 'OPEN', evidence_by_criterion: {} }, ledger: [] };
}

function validatePathList(
  failures: ContractValidationFailure[],
  field: 'allow_paths' | 'deny_paths',
  values: string[],
): void {
  values.forEach((value, index) => {
    const trimmed = value.trim();
    if (!trimmed.length) {
      addFailure(failures, field, `${field}[${index}] must be a non-empty path string`);
    }
  });
}

export function validateContractInput(input: ParsedContractInput): ContractValidationResult {
  const failures: ContractValidationFailure[] = [];

  if (!input.task_description || !input.task_description.trim().length) {
    addFailure(failures, 'task_description', 'task_description is required and must be non-empty');
  }

  if (!input.base_revision || !isValidRevision(input.base_revision)) {
    addFailure(failures, 'base_revision', 'base_revision is required and must be a non-empty git reference');
  }

  if (input.max_files !== null) {
    if (!Number.isInteger(input.max_files) || input.max_files < 0) {
      addFailure(failures, 'max_files', 'max_files must be a non-negative integer');
    }
  }

  if (input.max_changed_lines !== null) {
    if (!Number.isInteger(input.max_changed_lines) || input.max_changed_lines < 0) {
      addFailure(failures, 'max_changed_lines', 'max_changed_lines must be a non-negative integer');
    }
  }

  if (typeof input.allow_new_files !== 'boolean') {
    addFailure(failures, 'allow_new_files', 'allow_new_files must be boolean');
  }
  if (typeof input.allow_new_dependencies !== 'boolean') {
    addFailure(failures, 'allow_new_dependencies', 'allow_new_dependencies must be boolean');
  }
  if (typeof input.allow_migrations !== 'boolean') {
    addFailure(failures, 'allow_migrations', 'allow_migrations must be boolean');
  }
  if (typeof input.allow_config_changes !== 'boolean') {
    addFailure(failures, 'allow_config_changes', 'allow_config_changes must be boolean');
  }
  if (typeof input.allow_public_api_changes !== 'boolean') {
    addFailure(
      failures,
      'allow_public_api_changes',
      'allow_public_api_changes must be boolean',
    );
  }

  validatePathList(failures, 'allow_paths', input.allow_paths);
  validatePathList(failures, 'deny_paths', input.deny_paths);

  if (input.execution_envelope !== undefined) {
    normalizeExecutionEnvelope(input.execution_envelope, failures);
  }

  if (input.preset !== null) {
    if (!isContractPreset(input.preset.toLowerCase())) {
      addFailure(failures, 'preset', `preset must be one of ${CONTRACT_PRESETS.join(', ')}`);
    }
  }

  if (input.stack_profile !== null && !isStackProfile(input.stack_profile)) {
    addFailure(
      failures,
      'stack_profile',
      `stack_profile must be one of ${STACK_PROFILES.join(', ')}`,
    );
  }

  const disabledStackRules = [...input.disabled_stack_rules];
  const seenDisabled = new Set<string>();
  disabledStackRules.forEach((ruleId, index) => {
    const normalized = ruleId.trim();
    if (!normalized.length) {
      addFailure(failures, 'disabled_stack_rules', `disabled_stack_rules[${index}] must be a non-empty string`);
      return;
    }

    if (seenDisabled.has(normalized)) {
      addFailure(
        failures,
        'disabled_stack_rules',
        `disabled_stack_rules[${index}] duplicate rule id '${normalized}'`,
      );
    }

    seenDisabled.add(normalized);
  });

  return {
    valid: failures.length === 0,
    errors: failures,
  };
}

export function normalizeValidatedContractInput(
  input: ParsedContractInput,
): ValidatedContractInput {
  const envelopeFailures: ContractValidationFailure[] = [];
  const executionEnvelope = input.execution_envelope === undefined
    ? undefined
    : normalizeExecutionEnvelope(input.execution_envelope, envelopeFailures);

  return {
    task_description: input.task_description === null ? '' : input.task_description.trim(),
    task_id: input.task_id ?? null,
    ...(executionEnvelope === undefined ? {} : { execution_envelope: executionEnvelope }),
    task_title: null,
    task_source_feature: null,
    task_source_path: null,
    base_revision: input.base_revision === null ? '' : input.base_revision.trim(),
    allow_paths: input.allow_paths.map((entry: string) => entry.trim()),
    deny_paths: input.deny_paths.map((entry: string) => entry.trim()),
    max_files: input.max_files,
    max_changed_lines: input.max_changed_lines,
    allow_new_files: input.allow_new_files,
    allow_new_dependencies: input.allow_new_dependencies,
    allow_migrations: input.allow_migrations,
    allow_config_changes: input.allow_config_changes,
    allow_public_api_changes: input.allow_public_api_changes,
    preset: input.preset ? (input.preset.toLowerCase() as ContractPreset) : null,
    stack_profile: input.stack_profile
      ? (input.stack_profile.toLowerCase() as ValidatedContractInput['stack_profile'])
      : null,
    disabled_stack_rules: input.disabled_stack_rules.map((entry) => entry.trim()),
  };
}
