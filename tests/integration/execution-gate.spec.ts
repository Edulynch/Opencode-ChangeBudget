import * as assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { test } from 'node:test';

import { runInit } from '../../src/cli/commands/init.js';
import { runCheck } from '../../src/cli/commands/check.js';
import { runStart } from '../../src/cli/commands/start.js';
import { evaluateExecutionGate, type ExecutionGateInput } from '../../src/core/execution-gate.js';
import {
  evaluateAndRecordMaterialDecisionInPlace,
  readContract,
  writeExecutionEnvelopeInPlace,
  writeSatisfactionRecordInPlace,
} from '../../src/core/state/contracts.js';
import type { ExecutionEnvelope } from '../../src/models/execution-gate.js';
import { InputValidationError, StateCorruptionError } from '../../src/models/errors.js';
import {
  createWorkingTreeBaselineFixture,
  type WorkingTreeBaselineFixture,
} from '../utils/working-tree-baseline-fixtures.js';

const requiredEvidence = ['smoke-output', 'smoke-report'] as const;

function openEnvelope(): ExecutionEnvelope {
  return {
    goal: 'Deliver the smoke validation',
    acceptance_criteria: [{ id: 'smoke', outcome: 'The smoke suite passes', required_evidence: requiredEvidence }],
    authority: {
      architecture_review: { allowed: ['architecture.hardening'], constraint: 'HARD' },
      documentation_expansion: { allowed: ['documentation.release'], constraint: 'HARD' },
      infrastructure_expansion: { allowed: ['runner.linux'], constraint: 'HARD' },
    },
    satisfaction: { state: 'OPEN', evidence_by_criterion: {} },
    ledger: [],
  };
}

test('T011: persists fully evidenced satisfaction irreversibly before applying the evaluator latch', async () => {
  // Given an active disposable contract with an envelope that requires both evidence records
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await runInit(fixture.root);
    const started = await runStart(fixture.root, ['--task', 'execution latch', '--base-revision', 'HEAD']);
    const openContract = await readContract(fixture.root, started.contractId);
    const persistedOpen = await writeExecutionEnvelopeInPlace(fixture.root, {
      contract: openContract,
      envelope: openEnvelope(),
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const satisfied = { state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: requiredEvidence } } as const;

    // When T003 persists the completed satisfaction record and it is reloaded
    const persistedSatisfied = await writeSatisfactionRecordInPlace(fixture.root, {
      contract: persistedOpen,
      satisfaction: satisfied,
      updatedAt: '2026-01-01T00:01:00.000Z',
    });
    const reloaded = await readContract(fixture.root, persistedSatisfied.id);

    // Then both required evidence records remain latched and the contract cannot reopen
    assert.deepEqual(reloaded.execution_envelope?.satisfaction, satisfied);
    await assert.rejects(
      () => writeSatisfactionRecordInPlace(fixture.root, {
        contract: persistedSatisfied,
        satisfaction: { state: 'OPEN', evidence_by_criterion: {} },
        updatedAt: '2026-01-01T00:02:00.000Z',
      }),
      StateCorruptionError,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('T014: rejects execution-envelope replacement and satisfaction evidence regression', async () => {
  // Given an active contract with an open envelope and persisted criterion evidence
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await runInit(fixture.root);
    const started = await runStart(fixture.root, ['--task', 'execution persistence', '--base-revision', 'HEAD']);
    const openContract = await readContract(fixture.root, started.contractId);
    const persistedOpen = await writeExecutionEnvelopeInPlace(fixture.root, {
      contract: openContract,
      envelope: openEnvelope(),
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const persistedEvidence = await writeSatisfactionRecordInPlace(fixture.root, {
      contract: persistedOpen,
      satisfaction: { state: 'OPEN', evidence_by_criterion: { smoke: ['smoke-output'] } },
      updatedAt: '2026-01-01T00:01:00.000Z',
    });
    const persistedSatisfied = await writeSatisfactionRecordInPlace(fixture.root, {
      contract: persistedEvidence,
      satisfaction: { state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: requiredEvidence } },
      updatedAt: '2026-01-01T00:02:00.000Z',
    });

    // When a write attempts to replace the envelope or remove open or satisfied evidence
    // Then every destructive write is rejected before the atomic contract write
    await assert.rejects(() => writeExecutionEnvelopeInPlace(fixture.root, {
      contract: persistedEvidence,
      envelope: { ...openEnvelope(), acceptance_criteria: [] },
      updatedAt: '2026-01-01T00:03:00.000Z',
    }), StateCorruptionError);
    await assert.rejects(() => writeSatisfactionRecordInPlace(fixture.root, {
      contract: persistedEvidence,
      satisfaction: { state: 'OPEN', evidence_by_criterion: {} },
      updatedAt: '2026-01-01T00:03:00.000Z',
    }), StateCorruptionError);
    await assert.rejects(() => writeSatisfactionRecordInPlace(fixture.root, {
      contract: persistedSatisfied,
      satisfaction: { state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: ['smoke-output'] } },
      updatedAt: '2026-01-01T00:03:00.000Z',
    }), StateCorruptionError);
  } finally {
    await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('SPEC-014: authoritative transactions preserve stale envelope, satisfaction, and ledger updates', async () => {
  // Given a contract snapshot shared by independently prepared envelope and satisfaction writes
  const fixture = await createWorkingTreeBaselineFixture();
  const firstProposal = {
    id: 'first-ledger-entry', kind: 'documentation_expansion', requested: { value: 'documentation.release' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['first-needed'],
  } as const;
  const secondProposal = {
    id: 'second-ledger-entry', kind: 'documentation_expansion', requested: { value: 'documentation.release' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['second-needed'],
  } as const;

  try {
    await runInit(fixture.root);
    const started = await runStart(fixture.root, ['--task', 'stale mutation persistence', '--base-revision', 'HEAD']);
    const noEnvelopeSnapshot = await readContract(fixture.root, started.contractId);
    const persistedEnvelope = await writeExecutionEnvelopeInPlace(fixture.root, {
      contract: noEnvelopeSnapshot,
      envelope: openEnvelope(),
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // When stale callers submit a second envelope, fresh proposals, independent evidence, and a stale rollback
    await assert.rejects(
      () => writeExecutionEnvelopeInPlace(fixture.root, {
        contract: noEnvelopeSnapshot,
        envelope: { ...openEnvelope(), goal: 'stale replacement' },
        updatedAt: '2026-01-01T00:01:00.000Z',
      }),
      StateCorruptionError,
    );
    await evaluateAndRecordMaterialDecisionInPlace(fixture.root, {
      contractId: started.contractId,
      proposal: firstProposal,
      evaluatedAt: '2026-01-01T00:02:00.000Z',
    });
    await evaluateAndRecordMaterialDecisionInPlace(fixture.root, {
      contractId: started.contractId,
      proposal: secondProposal,
      evaluatedAt: '2026-01-01T00:03:00.000Z',
    });
    const afterFirstEvidence = await writeSatisfactionRecordInPlace(fixture.root, {
      contract: persistedEnvelope,
      satisfaction: { state: 'OPEN', evidence_by_criterion: { smoke: ['smoke-output'] } },
      updatedAt: '2026-01-01T00:04:00.000Z',
    });
    const afterMergedEvidence = await writeSatisfactionRecordInPlace(fixture.root, {
      contract: persistedEnvelope,
      satisfaction: { state: 'OPEN', evidence_by_criterion: { smoke: ['smoke-report'] } },
      updatedAt: '2026-01-01T00:05:00.000Z',
    });
    await assert.rejects(
      () => writeSatisfactionRecordInPlace(fixture.root, {
        contract: persistedEnvelope,
        satisfaction: { state: 'OPEN', evidence_by_criterion: {} },
        updatedAt: '2026-01-01T00:06:00.000Z',
      }),
      StateCorruptionError,
    );
    const replay = await evaluateAndRecordMaterialDecisionInPlace(fixture.root, {
      contractId: started.contractId,
      proposal: firstProposal,
      evaluatedAt: '2026-01-01T00:07:00.000Z',
    });
    const conflict = await evaluateAndRecordMaterialDecisionInPlace(fixture.root, {
      contractId: started.contractId,
      proposal: { ...firstProposal, requested: { value: 'documentation.conflict' } },
      evaluatedAt: '2026-01-01T00:08:00.000Z',
    });

    // Then disk state has the one envelope, merged/latching satisfaction, and authoritative ledger decisions
    const persisted = await readContract(fixture.root, started.contractId);
    assert.deepEqual(afterFirstEvidence.execution_envelope?.satisfaction, {
      state: 'OPEN', evidence_by_criterion: { smoke: ['smoke-output'] },
    });
    assert.deepEqual(afterMergedEvidence.execution_envelope?.satisfaction, {
      state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: ['smoke-output', 'smoke-report'] },
    });
    assert.deepEqual(persisted.execution_envelope?.satisfaction, {
      state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: ['smoke-output', 'smoke-report'] },
    });
    assert.partialDeepStrictEqual(replay, { executionGateResult: { kind: 'GOVERNANCE', outcome: { verdict: 'BLOCK' } } });
    assert.partialDeepStrictEqual(conflict, { executionGateResult: { kind: 'INVALID_PROPOSAL' } });
    assert.deepEqual(
      new Set(persisted.execution_envelope?.ledger.map((entry) => entry.proposal_id)),
      new Set([firstProposal.id, secondProposal.id]),
    );
  } finally {
    await fixture.cleanup();
  }
});

test('SPEC-014: authoritative material evaluation replays current authority without duplicate ledger entries', async () => {
  // Given an open envelope and an approved material proposal
  const fixture = await createWorkingTreeBaselineFixture();
  const proposal = {
    id: 'authoritative-ledger-entry',
    kind: 'documentation_expansion',
    requested: { value: 'documentation.release' },
    necessity: 'optional',
    criterion_refs: ['smoke'],
    evidence: ['needed'],
  } as const;
  try {
    await runInit(fixture.root);
    const started = await runStart(fixture.root, ['--task', 'authoritative material evaluation', '--base-revision', 'HEAD']);
    const persistedEnvelope = await writeExecutionEnvelopeInPlace(fixture.root, {
      contract: await readContract(fixture.root, started.contractId),
      envelope: openEnvelope(),
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // When the proposal transaction commits before satisfaction and replays after satisfaction
    const first = await evaluateAndRecordMaterialDecisionInPlace(fixture.root, {
      contractId: started.contractId,
      proposal,
      evaluatedAt: '2026-01-01T00:01:00.000Z',
    });
    await writeSatisfactionRecordInPlace(fixture.root, {
      contract: persistedEnvelope,
      satisfaction: { state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: requiredEvidence } },
      updatedAt: '2026-01-01T00:02:00.000Z',
    });
    const replay = await evaluateAndRecordMaterialDecisionInPlace(fixture.root, {
      contractId: started.contractId,
      proposal,
      evaluatedAt: '2026-01-01T00:03:00.000Z',
    });
    const collision = await evaluateAndRecordMaterialDecisionInPlace(fixture.root, {
      contractId: started.contractId,
      proposal: { ...proposal, requested: { value: 'documentation.conflict' } },
      evaluatedAt: '2026-01-01T00:04:00.000Z',
    });
    const persisted = await readContract(fixture.root, started.contractId);

    // Then the result is always from the current envelope and only the fresh transaction appends
    assert.partialDeepStrictEqual(first, { executionGateResult: { kind: 'GOVERNANCE', outcome: { verdict: 'APPROVE' } } });
    assert.partialDeepStrictEqual(replay, { executionGateResult: { kind: 'GOVERNANCE', outcome: { verdict: 'BLOCK' } } });
    assert.partialDeepStrictEqual(collision, { executionGateResult: { kind: 'INVALID_PROPOSAL' } });
    assert.equal(persisted.execution_envelope?.ledger.length, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('T007: accumulates check satisfaction evidence and only satisfies completed criteria', async () => {
  // Given an active envelope contract with a criterion that requires two evidence records
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await runInit(fixture.root);
    const started = await runStart(fixture.root, ['--task', 'check satisfaction', '--base-revision', 'HEAD']);
    const openContract = await readContract(fixture.root, started.contractId);
    await writeExecutionEnvelopeInPlace(fixture.root, {
      contract: openContract,
      envelope: openEnvelope(),
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    // When check runs unflagged, then receives the required evidence across two explicit submissions
    const unflaggedResult = await runCheck(fixture.root);
    const afterUnflaggedCheck = await readContract(fixture.root, started.contractId);
    const partialResult = await runCheck(fixture.root, ['--satisfaction-evidence-json', '{"satisfied":[{"criterion_ref":"smoke","evidence":["smoke-output"]}]}']);
    const partiallySatisfied = await readContract(fixture.root, started.contractId);
    const completeResult = await runCheck(fixture.root, ['--satisfaction-evidence-json={"satisfied":[{"criterion_ref":"smoke","evidence":["smoke-report"]}]}']);
    const satisfied = await readContract(fixture.root, started.contractId);

    // Then check retains prior evidence and latches only after all declared evidence is present
    assert.deepEqual(afterUnflaggedCheck.execution_envelope?.satisfaction, openEnvelope().satisfaction);
    assert.deepEqual(
      [partialResult.status, partialResult.decision, partialResult.reasonCodes],
      [unflaggedResult.status, unflaggedResult.decision, unflaggedResult.reasonCodes],
    );
    assert.deepEqual(
      [completeResult.status, completeResult.decision, completeResult.reasonCodes],
      [unflaggedResult.status, unflaggedResult.decision, unflaggedResult.reasonCodes],
    );
    assert.deepEqual(partiallySatisfied.execution_envelope?.satisfaction, {
      state: 'OPEN',
      evidence_by_criterion: { smoke: ['smoke-output'] },
    });
    assert.deepEqual(satisfied.execution_envelope?.satisfaction, {
      state: 'CONTRACT_SATISFIED',
      evidence_by_criterion: { smoke: ['smoke-output', 'smoke-report'] },
    });
  } finally {
    await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('T007: rejects malformed, repeated, duplicate, and empty satisfaction evidence input', async () => {
  // Given a repository where check can parse its explicit satisfaction evidence input
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await runInit(fixture.root);
    const invalidArgs = [
      ['--satisfaction-evidence-json', '{'],
      ['--satisfaction-evidence-json', '[]'],
      ['--satisfaction-evidence-json', '{"satisfied":[]}'],
      ['--satisfaction-evidence-json', '{"satisfied":[{"criterion_ref":"smoke","evidence":[]}]}'],
      ['--satisfaction-evidence-json', '{"satisfied":[{"criterion_ref":"smoke","evidence":["smoke-output"]},{"criterion_ref":"smoke","evidence":["smoke-report"]}]}'],
      ['--satisfaction-evidence-json', '{"satisfied":[]}', '--satisfaction-evidence-json', '{"satisfied":[]}'],
    ];

    // When check receives each invalid form
    const failures = await Promise.all(invalidArgs.map(async (args) => {
      await assert.rejects(
        () => runCheck(fixture.root, args),
        (error: unknown) => error instanceof InputValidationError && error.field === '--satisfaction-evidence-json',
      );
    }));

    // Then every invalid form is rejected at the input boundary
    assert.equal(failures.length, invalidArgs.length);
  } finally {
    await rm(fixture.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
  }
});

test('T011: blocks valid post-satisfaction material and non-material mutations before governance', () => {
  // Given a satisfied envelope whose material proposals would otherwise match declared authority
  const envelope: ExecutionEnvelope = {
    ...openEnvelope(),
    satisfaction: { state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: requiredEvidence } },
  };
  const blocked = [
    { operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'refactor', kind: 'scope_expansion', requested_paths: ['src/core'], requests_new_files: false, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['refactor-needed'] } } },
    { operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'documentation', kind: 'documentation_expansion', requested: { value: 'documentation.release' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['documentation-needed'] } } },
    { operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'hardening', kind: 'architecture_review', requested: { value: 'architecture.hardening' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['hardening-needed'] } } },
    { operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'infrastructure', kind: 'infrastructure_expansion', requested: { value: 'runner.linux' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: ['infrastructure-needed'] } } },
    { operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'feature', kind: 'post_satisfaction_work', operation: 'feature-work', necessity: 'optional', criterion_refs: ['smoke'], evidence: ['feature-needed'] } } },
    { operation: { kind: 'FAST_PATH', operation: 'necessary_implementation' } },
  ] satisfies readonly Omit<ExecutionGateInput, 'envelope'>[];

  // When each valid additional operation reaches the evaluator
  const results = blocked.map((input) => evaluateExecutionGate({ envelope, ...input }));

  // Then satisfaction blocks every mutation without materiality or governance bypass
  for (const result of results) assert.deepEqual(result, { kind: 'GOVERNANCE', outcome: { verdict: 'BLOCK', reason: 'The contract is satisfied; additional operations require new authority' } });
});

test('T011: preserves structural-invalid precedence and only allows declared residual operations', () => {
  // Given a satisfied envelope with an invalid proposal and every allowed residual operation
  const envelope: ExecutionEnvelope = {
    ...openEnvelope(),
    satisfaction: { state: 'CONTRACT_SATISFIED', evidence_by_criterion: { smoke: requiredEvidence } },
  };
  const invalid: ExecutionGateInput = { envelope, operation: { kind: 'MATERIAL_DECISION', proposal: { id: 'invalid', kind: 'documentation_expansion', requested: { value: 'documentation.release' }, necessity: 'optional', criterion_refs: ['smoke'], evidence: [] } } };
  const allowed = ['read_only', 'introspection', 'authorized_validation', 'changebudget_check', 'incidental_cleanup', 'normal_close'] as const;

  // When the evaluator receives the invalid proposal and residual operations after satisfaction
  const invalidResult = evaluateExecutionGate(invalid);
  const allowedResults = allowed.map((operation) => evaluateExecutionGate({ envelope, operation: { kind: 'FAST_PATH', operation } }));

  // Then invalidity wins before the satisfaction guard and only listed operations continue
  assert.deepEqual(invalidResult, { kind: 'INVALID_PROPOSAL', reason: 'Material decisions require an identity, criterion references, and necessity evidence' });
  for (const result of allowedResults) assert.deepEqual(result, { kind: 'NON_MATERIAL' });
});

test('T015: unflagged no-envelope checks preserve lifecycle decisions without governance or runtime results', async (context) => {
  const scenarios = [
    {
      name: 'a clean active contract',
      expected: { decision: 'PASS', status: 'PASS' },
      arrange: async (_fixture: WorkingTreeBaselineFixture) => {},
    },
    {
      name: 'an out-of-scope post-start file',
      expected: { decision: 'REPAIR', status: 'FAIL' },
      arrange: async (fixture: WorkingTreeBaselineFixture) => fixture.writeUntracked('outside/repair.txt', 'repair\n'),
    },
    {
      name: 'a post-start commit',
      expected: { decision: 'HUMAN_REVIEW', status: 'FAIL' },
      arrange: async (fixture: WorkingTreeBaselineFixture) => {
        await fixture.writeUnstaged('src/review.ts', 'export const review = true;\n');
        fixture.stage('src/review.ts');
        fixture.commit('post-start change');
      },
    },
  ] as const;

  for (const scenario of scenarios) {
    await context.test(scenario.name, async () => {
      // Given an active legacy contract started without an execution-envelope flag
      const fixture = await createWorkingTreeBaselineFixture();
      try {
        await runInit(fixture.root);
        const started = await runStart(fixture.root, ['--task', 'legacy execution', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);
        assert.equal((await readContract(fixture.root, started.contractId)).execution_envelope, undefined);

        // When the existing unflagged check evaluates the lifecycle scenario
        await scenario.arrange(fixture);
        const result = await runCheck(fixture.root);

        // Then Git-budget outcomes retain their meaning without governance or runtime projection
        assert.deepEqual({ decision: result.decision, status: result.status }, scenario.expected);
        assert.equal(Object.hasOwn(result, 'executionGateResult'), false);
        assert.equal(Object.hasOwn(result, 'runtimeAction'), false);
      } finally {
        await fixture.cleanup();
      }
    });
  }
});
