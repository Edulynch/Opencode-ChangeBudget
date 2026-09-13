import * as assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';

import { runCheck } from '../../src/cli/commands/check.js';
import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { evaluateExecutionGate, type ExecutionGateInput } from '../../src/core/execution-gate.js';
import type { ExecutionEnvelope, ExecutionGateResult } from '../../src/models/execution-gate.js';
import { createWorkingTreeBaselineFixture } from '../utils/working-tree-baseline-fixtures.js';

const DOCKER_RUNNER_ENVELOPE = {
  goal: 'Restore workflow capacity through a self-hosted Linux runner',
  acceptance_criteria: [{
    id: 'runner-smoke',
    outcome: 'A Linux runner completes the smoke validation',
    required_evidence: ['runner-online', 'smoke-output'],
  }],
  authority: {
    concurrent_worker: { max: 1, constraint: 'HARD' },
    infrastructure_expansion: { allowed: ['runner.linux'], constraint: 'HARD' },
    verification_expansion: {
      allowed: ['validation.smoke'],
      constraint: 'SOFT',
      canonical_alternatives: {
        'validation.full': { value: 'validation.smoke', required_for: ['runner-smoke'] },
      },
    },
    reasoning_escalation: { allowed: [], constraint: 'SOFT' },
    documentation_expansion: { allowed: [], constraint: 'SOFT' },
    architecture_review: { allowed: [], constraint: 'SOFT' },
    research_expansion: { allowed: [], constraint: 'SOFT' },
  },
  satisfaction: { state: 'OPEN', evidence_by_criterion: {} },
  ledger: [],
} satisfies ExecutionEnvelope;

const SATISFIED_DOCKER_RUNNER_ENVELOPE = {
  ...DOCKER_RUNNER_ENVELOPE,
  satisfaction: {
    state: 'CONTRACT_SATISFIED',
    evidence_by_criterion: { 'runner-smoke': ['runner-online', 'smoke-output'] },
  },
} satisfies ExecutionEnvelope;

type DockerRunnerDecisionFixture = {
  readonly name: string;
  readonly input: ExecutionGateInput;
  readonly expected: ExecutionGateResult;
};

const DOCKER_RUNNER_DECISION_FIXTURES = [
  {
    name: 'approves the required Linux runner setup',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'runner-linux', kind: 'infrastructure_expansion', requested: { value: 'runner.linux' }, necessity: 'required', criterion_refs: ['runner-smoke'], evidence: ['runner-required'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } },
  },
  {
    name: 'approves the required smoke validation',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'validation-smoke', kind: 'verification_expansion', requested: { value: 'validation.smoke' }, necessity: 'required', criterion_refs: ['runner-smoke'], evidence: ['smoke-required'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE', reason: 'Requested value is declared by the envelope' } },
  },
  {
    name: 'reduces an extra required worker to the declared minimum',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'extra-worker', kind: 'concurrent_worker', requested: { amount: 2 }, necessity: 'required', minimum_required: 1, criterion_refs: ['runner-smoke'], evidence: ['worker-required'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'REDUCE', reason: 'Declared authority preserves the required minimum', reduced_amount: 1 } },
  },
  {
    name: 'blocks an optional Windows runner under the hard infrastructure allowlist',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'runner-windows', kind: 'infrastructure_expansion', requested: { value: 'runner.windows' }, necessity: 'optional', criterion_refs: ['runner-smoke'], evidence: ['windows-optional'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'BLOCK', reason: 'The HARD allowlist prohibits optional expansion' } },
  },
  {
    name: 'defers optional reasoning',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'reasoning-deep', kind: 'reasoning_escalation', requested: { value: 'reasoning.deep' }, necessity: 'optional', criterion_refs: ['runner-smoke'], evidence: ['reasoning-optional'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'DEFER', reason: 'Optional value is outside the declared allowlist' } },
  },
  {
    name: 'defers optional documentation',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'documentation-release', kind: 'documentation_expansion', requested: { value: 'documentation.release' }, necessity: 'optional', criterion_refs: ['runner-smoke'], evidence: ['documentation-optional'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'DEFER', reason: 'Optional value is outside the declared allowlist' } },
  },
  {
    name: 'defers optional architecture review',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'architecture-review', kind: 'architecture_review', requested: { value: 'architecture.review' }, necessity: 'optional', criterion_refs: ['runner-smoke'], evidence: ['architecture-optional'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'DEFER', reason: 'Optional value is outside the declared allowlist' } },
  },
  {
    name: 'defers optional release readiness research',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'release-readiness', kind: 'research_expansion', requested: { value: 'release.readiness' }, necessity: 'optional', criterion_refs: ['runner-smoke'], evidence: ['release-optional'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'DEFER', reason: 'Optional value is outside the declared allowlist' } },
  },
  {
    name: 'replaces optional full regression with the canonical smoke validation',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'validation-full', kind: 'verification_expansion', requested: { value: 'validation.full' }, necessity: 'optional', criterion_refs: ['runner-smoke'], evidence: ['full-regression-useful'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'REPLACE', reason: 'A declared canonical alternative preserves an unsatisfied criterion', replacement_value: 'validation.smoke' } },
  },
  {
    name: 'escalates necessary undeclared infrastructure',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'runner-necessary', kind: 'infrastructure_expansion', requested: { value: 'runner.necessary' }, necessity: 'required', criterion_refs: ['runner-smoke'], evidence: ['infrastructure-required'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'ESCALATE', reason: 'Required value is outside the declared allowlist' } },
  },
  {
    name: 'escalates the necessary undeclared GitHub service',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'service-github', kind: 'external_service', requested: { value: 'service.github' }, necessity: 'required', criterion_refs: ['runner-smoke'], evidence: ['service-required'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'ESCALATE', reason: 'Required value is outside the declared allowlist' } },
  },
  {
    name: 'rejects a malformed proposal before governance',
    input: {
      envelope: DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'malformed-evidence', kind: 'documentation_expansion', requested: { value: 'documentation.release' }, necessity: 'optional', criterion_refs: ['runner-smoke'], evidence: [] } },
    },
    expected: { kind: 'INVALID_PROPOSAL', reason: 'Material decisions require an identity, criterion references, and necessity evidence' },
  },
  {
    name: 'rejects an unknown authority-changing operation',
    input: { envelope: DOCKER_RUNNER_ENVELOPE, operation: { kind: 'UNKNOWN_AUTHORITY_CHANGE' } },
    expected: { kind: 'INVALID_PROPOSAL', reason: 'Authority-changing operations must use a declared material decision kind' },
  },
  {
    name: 'blocks a valid refactor after satisfaction',
    input: {
      envelope: SATISFIED_DOCKER_RUNNER_ENVELOPE,
      operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'post-satisfaction-refactor', kind: 'scope_expansion', requested_paths: ['src/core'], requests_new_files: false, necessity: 'optional', criterion_refs: ['runner-smoke'], evidence: ['refactor-requested'] } },
    },
    expected: { kind: 'GOVERNANCE', outcome: { verdict: 'BLOCK', reason: 'The contract is satisfied; additional operations require new authority' } },
  },
] satisfies readonly DockerRunnerDecisionFixture[];

test('T016: evaluates the Docker-runner scenario as pure typed deterministic data', () => {
  for (const fixture of DOCKER_RUNNER_DECISION_FIXTURES) {
    // Given a normalized Docker-runner material decision
    const actual = evaluateExecutionGate(fixture.input);

    // Then governance matches the fixture without producing a Git-budget decision
    assert.deepEqual(actual, fixture.expected, fixture.name);
    assert.equal(Object.hasOwn(actual, 'decision'), false, `${fixture.name}: governance does not produce a Git-budget decision`);
  }
});

test('T016: derives Docker-runner Git-budget evidence through canonical local Git APIs', async (context) => {
  const scenarios = [
    {
      name: 'PASS for an unchanged runner budget',
      arrange: async () => {},
      expected: 'PASS',
    },
    {
      name: 'REPAIR for an out-of-scope Docker runner artifact',
      arrange: async (fixture: Awaited<ReturnType<typeof createWorkingTreeBaselineFixture>>) => fixture.writeUntracked('docker/runner.txt', 'outside scope\n'),
      expected: 'REPAIR',
    },
    {
      name: 'HUMAN_REVIEW when the local Git baseline advances',
      arrange: async (fixture: Awaited<ReturnType<typeof createWorkingTreeBaselineFixture>>) => {
        await fixture.writeUnstaged('src/runner.ts', 'export const runner = true;\n');
        fixture.stage('src/runner.ts');
        fixture.commit('advance Docker runner baseline');
      },
      expected: 'HUMAN_REVIEW',
    },
  ] as const;

  for (const scenario of scenarios) {
    await context.test(scenario.name, async () => {
      // Given a local disposable Git repository with a Docker-runner-shaped budget
      const fixture = await createWorkingTreeBaselineFixture();
      try {
        await runInit(fixture.root);
        await runStart(fixture.root, ['--task', 'Docker runner budget', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);

        // When the fixture applies its local Git state and invokes the canonical checker
        await scenario.arrange(fixture);
        const result = await runCheck(fixture.root);

        // Then canonical Git evidence produces the expected independent budget decision
        assert.equal(result.decision, scenario.expected);
      } finally {
        await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
      }
    });
  }
});
