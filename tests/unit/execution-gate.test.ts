import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateExecutionGate, type ExecutionGateInput } from '../../src/core/execution-gate.js';
import type {
  ExecutionGateResult,
  ExecutionAuthority,
  ExecutionEnvelope,
  NumericMaterialDecision,
} from '../../src/models/execution-gate.js';

function openEnvelope(authority: ExecutionAuthority): ExecutionEnvelope {
  return {
    goal: 'Deliver smoke validation',
    acceptance_criteria: [{ id: 'smoke', outcome: 'The smoke suite passes', required_evidence: ['smoke-output'] }],
    authority,
    satisfaction: { state: 'OPEN', evidence_by_criterion: {} },
    ledger: [],
  };
}

function delegatedAgentProposal(
  amount: number,
  necessity: 'optional' | 'required',
  minimumRequired?: number,
): NumericMaterialDecision {
  return {
    id: `delegated-${amount}-${necessity}`,
    kind: 'delegated_agent',
    requested: { amount },
    necessity,
    ...(minimumRequired === undefined ? {} : { minimum_required: minimumRequired }),
    criterion_refs: ['smoke'],
    evidence: ['delegation-needed'],
  };
}

test('returns non-material continuation for a legacy input without an envelope', () => {
  // Given a legacy contract operation without execution authority
  const input = { operation: { kind: 'MATERIAL_DECISION' as const, proposal: delegatedAgentProposal(2, 'required', 2) } };

  // When the execution gate evaluates the operation
  const result = evaluateExecutionGate(input);

  // Then it returns no governance or Git-budget result
  assert.deepEqual(result, { kind: 'NON_MATERIAL' });
});

test('returns non-material continuation for an open-envelope fast-path operation', () => {
  // Given an open envelope and a declared read-only fast path
  const input = { envelope: openEnvelope({}), operation: { kind: 'FAST_PATH' as const, operation: 'read_only' as const } };

  // When the execution gate evaluates the operation
  const result = evaluateExecutionGate(input);

  // Then it continues without a governance outcome
  assert.deepEqual(result, { kind: 'NON_MATERIAL' });
});

test('approves a normalized numeric request inside declared authority', () => {
  // Given a normalized numeric limit equal to the requested amount
  const input = { envelope: openEnvelope({ delegated_agent: { max: 2, constraint: 'HARD' } }), operation: { kind: 'MATERIAL_DECISION' as const, proposal: delegatedAgentProposal(2, 'optional') } };

  // When the execution gate compares the normalized numbers
  const result = evaluateExecutionGate(input);

  // Then it approves the declared authority
  assert.deepEqual(result, { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested numeric authority is declared by the envelope' } });
});

test('reduces a normalized numeric request outside declared authority', () => {
  // Given a normalized request larger than a positive declared limit
  const input = { envelope: openEnvelope({ delegated_agent: { max: 1, constraint: 'HARD' } }), operation: { kind: 'MATERIAL_DECISION' as const, proposal: delegatedAgentProposal(2, 'optional') } };

  // When the execution gate compares the normalized numbers
  const result = evaluateExecutionGate(input);

  // Then it returns the declared reducible limit
  assert.deepEqual(result, { kind: 'GOVERNANCE', outcome: { verdict: 'REDUCE', reason: 'Requested numeric authority exceeds the declared maximum', reduced_amount: 1 } });
});

test('approves an allowlist value declared by the envelope', () => {
  // Given an allowlist containing the requested validation value
  const input = { envelope: openEnvelope({ verification_expansion: { allowed: ['validation.smoke'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION' as const, proposal: { id: 'smoke-validation', kind: 'verification_expansion' as const, requested: { value: 'validation.smoke' }, necessity: 'optional' as const, criterion_refs: ['smoke'], evidence: ['validation-needed'] } } };

  // When the execution gate evaluates the proposal
  const result = evaluateExecutionGate(input);

  // Then it approves the declared value
  assert.deepEqual(result, { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } });
});

test('replaces a required value with its declared canonical alternative', () => {
  // Given an unsatisfied criterion and an allowed canonical validation alternative
  const input = { envelope: openEnvelope({ verification_expansion: { allowed: ['validation.smoke'], constraint: 'SOFT', canonical_alternatives: { 'validation.full': { value: 'validation.smoke', required_for: ['smoke'] } } } }), operation: { kind: 'MATERIAL_DECISION' as const, proposal: { id: 'full-validation', kind: 'verification_expansion' as const, requested: { value: 'validation.full' }, necessity: 'required' as const, criterion_refs: ['smoke'], evidence: ['full-validation-needed'] } } };

  // When the execution gate evaluates the required proposal
  const result = evaluateExecutionGate(input);

  // Then it returns the declared replacement
  assert.deepEqual(result, { kind: 'GOVERNANCE', outcome: { verdict: 'REPLACE', reason: 'A declared canonical alternative preserves an unsatisfied criterion', replacement_value: 'validation.smoke' } });
});

test('defers an optional value outside a SOFT allowlist', () => {
  // Given an optional value outside a zero SOFT allowlist
  const input = { envelope: openEnvelope({ research_expansion: { allowed: [], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION' as const, proposal: { id: 'research-deep', kind: 'research_expansion' as const, requested: { value: 'research.deep' }, necessity: 'optional' as const, criterion_refs: ['smoke'], evidence: ['research-useful'] } } };

  // When the execution gate evaluates the proposal
  const result = evaluateExecutionGate(input);

  // Then it defers the optional expansion
  assert.deepEqual(result, { kind: 'GOVERNANCE', outcome: { verdict: 'DEFER', reason: 'Optional value is outside the declared allowlist' } });
});

test('blocks an optional value outside a HARD allowlist', () => {
  // Given an optional value outside a zero HARD allowlist
  const input = { envelope: openEnvelope({ infrastructure_expansion: { allowed: [], constraint: 'HARD' } }), operation: { kind: 'MATERIAL_DECISION' as const, proposal: { id: 'windows-runner', kind: 'infrastructure_expansion' as const, requested: { value: 'runner.windows' }, necessity: 'optional' as const, criterion_refs: ['smoke'], evidence: ['windows-useful'] } } };

  // When the execution gate evaluates the proposal
  const result = evaluateExecutionGate(input);

  // Then it blocks the optional expansion
  assert.deepEqual(result, { kind: 'GOVERNANCE', outcome: { verdict: 'BLOCK', reason: 'The HARD allowlist prohibits optional expansion' } });
});

test('escalates a required irreducible numeric request beyond a HARD limit', () => {
  // Given a required numeric request whose minimum exceeds the declared limit
  const input = { envelope: openEnvelope({ delegated_agent: { max: 1, constraint: 'HARD' } }), operation: { kind: 'MATERIAL_DECISION' as const, proposal: delegatedAgentProposal(2, 'required', 2) } };

  // When the execution gate evaluates the irreducible request
  const result = evaluateExecutionGate(input);

  // Then it escalates without granting the requested authority
  assert.deepEqual(result, { kind: 'GOVERNANCE', outcome: { verdict: 'ESCALATE', reason: 'Required numeric authority exceeds the declared maximum' } });
});

const CLOSED_KIND_REPLAY_CASES = [
  { input: { envelope: openEnvelope({}), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'scope', kind: 'scope_expansion', requested_paths: ['src'], requests_new_files: false, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['scope-needed'] } } }, expected: { kind: 'NON_MATERIAL' } },
  { input: { envelope: openEnvelope({ delegated_agent: { max: 1, constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: delegatedAgentProposal(1, 'optional') } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested numeric authority is declared by the envelope' } } },
  { input: { envelope: openEnvelope({ concurrent_worker: { max: 1, constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'concurrent', kind: 'concurrent_worker', requested: { amount: 1 }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['concurrency-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested numeric authority is declared by the envelope' } } },
  { input: { envelope: openEnvelope({ reasoning_escalation: { allowed: ['reasoning.deep'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'reasoning', kind: 'reasoning_escalation', requested: { value: 'reasoning.deep' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['reasoning-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } } },
  { input: { envelope: openEnvelope({ research_expansion: { allowed: ['research.deep'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'research', kind: 'research_expansion', requested: { value: 'research.deep' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['research-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } } },
  { input: { envelope: openEnvelope({ architecture_review: { allowed: ['architecture.review'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'architecture', kind: 'architecture_review', requested: { value: 'architecture.review' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['architecture-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } } },
  { input: { envelope: openEnvelope({ verification_expansion: { allowed: ['verification.deep'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'verification', kind: 'verification_expansion', requested: { value: 'verification.deep' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['verification-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } } },
  { input: { envelope: openEnvelope({ documentation_expansion: { allowed: ['documentation.required'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'documentation', kind: 'documentation_expansion', requested: { value: 'documentation.required' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['documentation-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } } },
  { input: { envelope: openEnvelope({ infrastructure_expansion: { allowed: ['runner.linux'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'infrastructure', kind: 'infrastructure_expansion', requested: { value: 'runner.linux' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['infrastructure-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } } },
  { input: { envelope: openEnvelope({ external_service: { allowed: ['service.artifacts'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'service', kind: 'external_service', requested: { value: 'service.artifacts' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['service-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } } },
  { input: { envelope: openEnvelope({}), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'post-satisfaction', kind: 'post_satisfaction_work', operation: 'close', necessity: 'optional', criterion_refs: ['smoke'], evidence: ['close-needed'] } } }, expected: { kind: 'INVALID_PROPOSAL', reason: 'post_satisfaction_work is only valid after contract satisfaction' } },
] satisfies readonly { readonly input: ExecutionGateInput; readonly expected: ExecutionGateResult }[];

test('replays every closed material kind with the identical normalized result', () => {
  // Given normalized fixtures for every closed material kind
  for (const fixture of CLOSED_KIND_REPLAY_CASES) {
    // When the evaluator receives the same input twice
    const first = evaluateExecutionGate(fixture.input);
    const replay = evaluateExecutionGate(fixture.input);

    // Then both evaluations preserve the expected result and reason
    assert.deepEqual(first, fixture.expected);
    assert.deepEqual(replay, fixture.expected);
  }
});

test('uses zero-SOFT authority for missing known kinds and handles outside known values', () => {
  // Given missing and declared authority for normalized known kinds
  const cases = [
    { input: { envelope: openEnvelope({}), operation: { kind: 'MATERIAL_DECISION', proposal: delegatedAgentProposal(1, 'optional') } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'DEFER', reason: 'Optional numeric expansion is outside declared authority' } } },
    { input: { envelope: openEnvelope({}), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'missing-research', kind: 'research_expansion', requested: { value: 'research.deep' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['research-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'DEFER', reason: 'Optional value is outside the declared allowlist' } } },
    { input: { envelope: openEnvelope({ concurrent_worker: { max: 1, constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'outside-concurrency', kind: 'concurrent_worker', requested: { amount: 2 }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['concurrency-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'REDUCE', reason: 'Requested numeric authority exceeds the declared maximum', reduced_amount: 1 } } },
    { input: { envelope: openEnvelope({ documentation_expansion: { allowed: ['documentation.required'], constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'outside-documentation', kind: 'documentation_expansion', requested: { value: 'documentation.unrequired' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['documentation-needed'] } } }, expected: { kind: 'GOVERNANCE', outcome: { verdict: 'DEFER', reason: 'Optional value is outside the declared allowlist' } } },
  ] satisfies readonly { readonly input: ExecutionGateInput; readonly expected: ExecutionGateResult }[];

  // When each known-kind fixture is evaluated
  for (const fixture of cases) assert.deepEqual(evaluateExecutionGate(fixture.input), fixture.expected);
});

test('rejects malformed evidence and normalized proposal shapes before governance', () => {
  // Given typed proposals with structurally invalid evidence or numeric bounds
  const cases = [
    { input: { envelope: openEnvelope({}), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'missing-evidence', kind: 'research_expansion', requested: { value: 'research.deep' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: [] } } }, expected: { kind: 'INVALID_PROPOSAL', reason: 'Material decisions require an identity, criterion references, and necessity evidence' } },
    { input: { envelope: openEnvelope({ delegated_agent: { max: 1, constraint: 'SOFT' } }), operation: { kind: 'MATERIAL_DECISION', proposal: delegatedAgentProposal(1, 'required', 0) } }, expected: { kind: 'INVALID_PROPOSAL', reason: 'Required numeric decisions need a minimum_required within the requested amount' } },
  ] satisfies readonly { readonly input: ExecutionGateInput; readonly expected: ExecutionGateResult }[];

  // When the evaluator receives malformed normalized fixtures
  for (const fixture of cases) assert.deepEqual(evaluateExecutionGate(fixture.input), fixture.expected);
});

test('rejects unrecognized authority changes through the explicit unknown operation', () => {
  // Given an envelope and an unknown authority-changing operation
  const input: ExecutionGateInput = { envelope: openEnvelope({}), operation: { kind: 'UNKNOWN_AUTHORITY_CHANGE' } };

  // When the evaluator receives the operation
  const result = evaluateExecutionGate(input);

  // Then it returns an invalid-proposal result
  assert.deepEqual(result, { kind: 'INVALID_PROPOSAL', reason: 'Authority-changing operations must use a declared material decision kind' });
});

test('prioritizes canonical replacement and applies open and satisfied post-work behavior', () => {
  // Given a HARD replacement alternative and open or satisfied post-work proposals
  const replacement = { envelope: openEnvelope({ verification_expansion: { allowed: ['verification.smoke'], constraint: 'HARD', canonical_alternatives: { 'verification.full': { value: 'verification.smoke', required_for: ['smoke'] } } } }), operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'replacement', kind: 'verification_expansion', requested: { value: 'verification.full' }, necessity: 'required', criterion_refs: ['smoke'], evidence: ['verification-needed'] } } } satisfies ExecutionGateInput;
  const openPostWork = CLOSED_KIND_REPLAY_CASES[10].input;
  const satisfiedPostWork: ExecutionGateInput = { envelope: { ...openEnvelope({}), satisfaction: { state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: ['smoke-output'] } } }, operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'satisfied-post-work', kind: 'post_satisfaction_work', operation: 'close', necessity: 'optional', criterion_refs: ['smoke'], evidence: ['close-needed'] } } };

  // When the evaluator evaluates the precedence fixtures
  const replacementResult = evaluateExecutionGate(replacement);
  const openResult = evaluateExecutionGate(openPostWork);
  const satisfiedResult = evaluateExecutionGate(satisfiedPostWork);

  // Then replacement precedes HARD blocking, while post-work follows satisfaction state
  assert.deepEqual(replacementResult, { kind: 'GOVERNANCE', outcome: { verdict: 'REPLACE', reason: 'A declared canonical alternative preserves an unsatisfied criterion', replacement_value: 'verification.smoke' } });
  assert.deepEqual(openResult, { kind: 'INVALID_PROPOSAL', reason: 'post_satisfaction_work is only valid after contract satisfaction' });
  assert.deepEqual(satisfiedResult, { kind: 'GOVERNANCE', outcome: { verdict: 'BLOCK', reason: 'The contract is satisfied; additional operations require new authority' } });
});
