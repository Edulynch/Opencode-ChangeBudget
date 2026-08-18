import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateRecommendation, buildReasons } from '../../src/core/diagnose/advisor.js';
import {
  DiagnoseInput,
  DiagnosisOutcome,
  DiagnosisResult,
  DiagnosisSource,
  ObservableSignals,
  RecommendationReason,
} from '../../src/models/diagnose.js';

const DEFAULT_INPUT: DiagnoseInput = {
  task_id: null,
  task_description: null,
  allow_paths: [],
  deny_paths: [],
  stack_profile: null,
  json: false,
};

interface SignalOverrides {
  declared_path_count?: number;
  tracked_file_count?: number | null;
  sensitive_categories?: string[];
  task_id?: string | null;
  task_budget_default?: 'tiny' | 'normal' | 'free' | null;
}

function makeSignals(overrides: SignalOverrides = {}): ObservableSignals {
  return {
    declared_path_count: overrides.declared_path_count ?? 0,
    tracked_file_count: overrides.tracked_file_count ?? null,
    sensitive_categories: overrides.sensitive_categories ?? [],
    task_id: overrides.task_id ?? null,
    task_budget_default: overrides.task_budget_default ?? null,
  };
}

interface AdvisorCase {
  name: string;
  signals: SignalOverrides;
  expected: DiagnosisOutcome;
  source: DiagnosisSource;
  reasons?: RecommendationReason[];
}

const CASES: AdvisorCase[] = [
  // Rule 1 — explicit [budget:...] annotation wins
  {
    name: 'explicit tiny annotation wins with no scope',
    signals: { task_budget_default: 'tiny' },
    expected: 'tiny',
    source: 'explicit',
    reasons: [{ signal: 'declared_paths', value: 0 }, { signal: 'task_budget_default', value: 'tiny' }],
  },
  {
    name: 'explicit tiny annotation wins over conflicting large scope',
    signals: {
      declared_path_count: 10,
      tracked_file_count: 500,
      sensitive_categories: ['configuration'],
      task_budget_default: 'tiny',
    },
    expected: 'tiny',
    source: 'explicit',
    reasons: [
      { signal: 'declared_paths', value: 10 },
      { signal: 'tracked_files', value: 500 },
      { signal: 'task_budget_default', value: 'tiny' },
      { signal: 'sensitive_category', value: 'configuration' },
    ],
  },
  {
    name: 'explicit normal annotation wins',
    signals: { declared_path_count: 1, tracked_file_count: 1, task_budget_default: 'normal' },
    expected: 'normal',
    source: 'explicit',
  },
  {
    name: 'explicit free annotation wins',
    signals: { task_budget_default: 'free' },
    expected: 'free',
    source: 'explicit',
  },
  {
    name: 'explicit annotation wins over high-risk category',
    signals: {
      declared_path_count: 1,
      tracked_file_count: 1,
      sensitive_categories: ['migrations'],
      task_budget_default: 'tiny',
    },
    expected: 'tiny',
    source: 'explicit',
  },

  // Rule 2 — P = 0 → manual review
  {
    name: 'no declared paths, no task → manual review',
    signals: {},
    expected: 'manual_review',
    source: 'inferred',
    reasons: [{ signal: 'declared_paths', value: 0 }],
  },
  {
    name: 'no declared paths with task but no annotation → manual review',
    signals: { task_id: 'T031' },
    expected: 'manual_review',
    source: 'inferred',
    reasons: [
      { signal: 'declared_paths', value: 0 },
      { signal: 'task_id', value: 'T031' },
    ],
  },
  {
    name: 'no declared paths with prose but no scope → manual review',
    signals: { declared_path_count: 0 },
    expected: 'manual_review',
    source: 'inferred',
  },

  // Rule 3 — C contains migrations/release_artifacts → manual review
  {
    name: 'migrations category → manual review (small scope)',
    signals: { declared_path_count: 1, tracked_file_count: 1, sensitive_categories: ['migrations'] },
    expected: 'manual_review',
    source: 'inferred',
    reasons: [
      { signal: 'declared_paths', value: 1 },
      { signal: 'tracked_files', value: 1 },
      { signal: 'sensitive_category', value: 'migrations' },
    ],
  },
  {
    name: 'release_artifacts category → manual review',
    signals: { declared_path_count: 2, tracked_file_count: 3, sensitive_categories: ['release_artifacts'] },
    expected: 'manual_review',
    source: 'inferred',
  },
  {
    name: 'migrations plus other categories → manual review',
    signals: {
      declared_path_count: 2,
      tracked_file_count: 3,
      sensitive_categories: ['configuration', 'migrations'],
    },
    expected: 'manual_review',
    source: 'inferred',
  },

  // Rule 4 — N ≤ 5 && P ≤ 2 && C empty → tiny
  {
    name: 'tiny: N=1, P=1, no categories',
    signals: { declared_path_count: 1, tracked_file_count: 1 },
    expected: 'tiny',
    source: 'inferred',
  },
  {
    name: 'tiny: N=5, P=2, no categories (upper boundary)',
    signals: { declared_path_count: 2, tracked_file_count: 5 },
    expected: 'tiny',
    source: 'inferred',
  },
  {
    name: 'tiny: N=5, P=1, no categories',
    signals: { declared_path_count: 1, tracked_file_count: 5 },
    expected: 'tiny',
    source: 'inferred',
  },

  // Rule 4 fails → Rule 5
  {
    name: 'just over tiny: N=6, P=1 → normal',
    signals: { declared_path_count: 1, tracked_file_count: 6 },
    expected: 'normal',
    source: 'inferred',
  },
  {
    name: 'just over tiny: N=5, P=3 → normal (P > 2)',
    signals: { declared_path_count: 3, tracked_file_count: 5 },
    expected: 'normal',
    source: 'inferred',
  },
  {
    name: 'tiny failed by non-empty C (configuration) → normal',
    signals: { declared_path_count: 1, tracked_file_count: 1, sensitive_categories: ['configuration'] },
    expected: 'normal',
    source: 'inferred',
  },
  {
    name: 'normal: N=50, P=3 (upper boundary)',
    signals: { declared_path_count: 3, tracked_file_count: 50 },
    expected: 'normal',
    source: 'inferred',
  },
  {
    name: 'normal with sensitive category dependencies',
    signals: { declared_path_count: 2, tracked_file_count: 20, sensitive_categories: ['dependencies'] },
    expected: 'normal',
    source: 'inferred',
  },

  // Rule 5 fails → free
  {
    name: 'free: N=51, P=1 (just over normal)',
    signals: { declared_path_count: 1, tracked_file_count: 51 },
    expected: 'free',
    source: 'inferred',
  },
  {
    name: 'free: N=50, P=4 (P > 3)',
    signals: { declared_path_count: 4, tracked_file_count: 50 },
    expected: 'free',
    source: 'inferred',
  },
  {
    name: 'free: N=100, P=5',
    signals: { declared_path_count: 5, tracked_file_count: 100 },
    expected: 'free',
    source: 'inferred',
  },
  {
    name: 'free: large scope with categories',
    signals: {
      declared_path_count: 6,
      tracked_file_count: 200,
      sensitive_categories: ['configuration', 'public_api'],
    },
    expected: 'free',
    source: 'inferred',
  },

  // First-match precedence across overlapping conditions
  {
    name: 'annotation beats P=0 (rule 1 before rule 2)',
    signals: { task_budget_default: 'normal' },
    expected: 'normal',
    source: 'explicit',
  },
  {
    name: 'annotation beats high-risk category (rule 1 before rule 3)',
    signals: {
      declared_path_count: 1,
      tracked_file_count: 1,
      sensitive_categories: ['release_artifacts'],
      task_budget_default: 'free',
    },
    expected: 'free',
    source: 'explicit',
  },
  {
    name: 'migrations beats tiny-size scope (rule 3 before rule 4)',
    signals: { declared_path_count: 1, tracked_file_count: 1, sensitive_categories: ['migrations'] },
    expected: 'manual_review',
    source: 'inferred',
  },
  {
    name: 'P=0 beats any tracked count (rule 2 before rule 4)',
    signals: { declared_path_count: 0, tracked_file_count: 1 },
    expected: 'manual_review',
    source: 'inferred',
  },
  {
    name: 'tiny: N=1, P=2, no categories',
    signals: { declared_path_count: 2, tracked_file_count: 1 },
    expected: 'tiny',
    source: 'inferred',
  },
  {
    name: 'normal: N=6, P=3 (rule 4 fails on both axes, rule 5 passes)',
    signals: { declared_path_count: 3, tracked_file_count: 6 },
    expected: 'normal',
    source: 'inferred',
  },
  {
    name: 'free: N=1000, P=1 (immense tracked count)',
    signals: { declared_path_count: 1, tracked_file_count: 1000 },
    expected: 'free',
    source: 'inferred',
  },
  {
    name: 'normal with non-high-risk category when rule 4 fails but rule 5 passes',
    signals: { declared_path_count: 3, tracked_file_count: 40, sensitive_categories: ['public_api'] },
    expected: 'normal',
    source: 'inferred',
  },
];

test('T003: evaluateRecommendation follows the committed decision table in fixed first-match order', () => {
  for (const scenario of CASES) {
    const result = evaluateRecommendation(makeSignals(scenario.signals), DEFAULT_INPUT);
    assert.equal(result.recommendation, scenario.expected, `outcome for: ${scenario.name}`);
    assert.equal(result.source, scenario.source, `source for: ${scenario.name}`);
  }
});

test('T003: outcomes are restricted to the four committed values', () => {
  const outcomes = CASES.map((scenario) => evaluateRecommendation(makeSignals(scenario.signals), DEFAULT_INPUT).recommendation);
  const allowed: DiagnosisOutcome[] = ['tiny', 'normal', 'free', 'manual_review'];
  for (const outcome of outcomes) {
    assert.equal(allowed.includes(outcome), true, `unexpected outcome: ${outcome}`);
  }
});

test('T003: reasons carry the exact signal/value pairs and ordering for representative outcomes', () => {
  const exact = CASES.filter((scenario) => scenario.reasons !== undefined);
  assert.ok(exact.length >= 5, 'expected at least 5 cases with explicit reason assertions');

  for (const scenario of exact) {
    const result = evaluateRecommendation(makeSignals(scenario.signals), DEFAULT_INPUT);
    assert.deepEqual(result.reasons, scenario.reasons, `reasons for: ${scenario.name}`);
  }
});

test('T003: sensitive categories appear as reasons in lexicographic order', () => {
  const signals = makeSignals({
    declared_path_count: 2,
    tracked_file_count: 10,
    sensitive_categories: ['public_api', 'configuration', 'dependencies'],
  });
  const result = evaluateRecommendation(signals, DEFAULT_INPUT);

  assert.deepEqual(result.reasons, [
    { signal: 'declared_paths', value: 2 },
    { signal: 'tracked_files', value: 10 },
    { signal: 'sensitive_category', value: 'configuration' },
    { signal: 'sensitive_category', value: 'dependencies' },
    { signal: 'sensitive_category', value: 'public_api' },
  ]);
});

test('T003: repeated equivalent evaluations are byte-identical', () => {
  const signals = makeSignals({
    declared_path_count: 3,
    tracked_file_count: 40,
    sensitive_categories: ['configuration'],
    task_id: 'T031',
    task_budget_default: 'normal',
  });
  const input: DiagnoseInput = {
    ...DEFAULT_INPUT,
    task_id: 'T031',
    allow_paths: ['src/**', 'tests/**'],
    stack_profile: 'node-ts',
  };

  const first = evaluateRecommendation(signals, input);
  const second = evaluateRecommendation(signals, input);
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test('T003: buildReasons emits deterministic structural→task→category ordering', () => {
  const signals = makeSignals({
    declared_path_count: 2,
    tracked_file_count: 8,
    task_id: 'T031',
    task_budget_default: 'tiny',
    sensitive_categories: ['dependencies'],
  });

  const reasons = buildReasons(signals);
  assert.deepEqual(reasons, [
    { signal: 'declared_paths', value: 2 },
    { signal: 'tracked_files', value: 8 },
    { signal: 'task_id', value: 'T031' },
    { signal: 'task_budget_default', value: 'tiny' },
    { signal: 'sensitive_category', value: 'dependencies' },
  ]);
});

test('T003: inputs are echoed unchanged on the result', () => {
  const input: DiagnoseInput = {
    task_id: null,
    task_description: 'manual task',
    allow_paths: ['src/ui/**'],
    deny_paths: [],
    stack_profile: 'node-ts',
    json: true,
  };
  const signals = makeSignals({ declared_path_count: 1, tracked_file_count: 3 });
  const result: DiagnosisResult = evaluateRecommendation(signals, input);
  assert.deepEqual(result.inputs, input);
});

// T010 — manual-review / uncertainty matrix (SC-004). Every row below MUST
// resolve to manual_review (100%), never a guessed default preset (FR-009).
const MANUAL_REVIEW_CASES: Array<{
  name: string;
  signals: SignalOverrides;
  reasons?: RecommendationReason[];
}> = [
  {
    name: 'bare run: no declared paths, no task, no scope',
    signals: {},
    reasons: [{ signal: 'declared_paths', value: 0 }],
  },
  {
    name: 'task resolved but no annotation and no declared paths',
    signals: { task_id: 'T031' },
    reasons: [
      { signal: 'declared_paths', value: 0 },
      { signal: 'task_id', value: 'T031' },
    ],
  },
  {
    name: 'prose-only input: no structural signals',
    signals: {},
    reasons: [{ signal: 'declared_paths', value: 0 }],
  },
  {
    name: 'declared paths but zero tracked files still resolves as manual review via P=0',
    signals: { declared_path_count: 0 },
    reasons: [{ signal: 'declared_paths', value: 0 }],
  },
  {
    name: 'C contains migrations at tiny-boundary scale',
    signals: { declared_path_count: 1, tracked_file_count: 1, sensitive_categories: ['migrations'] },
    reasons: [
      { signal: 'declared_paths', value: 1 },
      { signal: 'tracked_files', value: 1 },
      { signal: 'sensitive_category', value: 'migrations' },
    ],
  },
  {
    name: 'C contains migrations at normal-boundary scale',
    signals: { declared_path_count: 2, tracked_file_count: 40, sensitive_categories: ['migrations'] },
  },
  {
    name: 'C contains release_artifacts at tiny-boundary scale',
    signals: { declared_path_count: 1, tracked_file_count: 1, sensitive_categories: ['release_artifacts'] },
    reasons: [
      { signal: 'declared_paths', value: 1 },
      { signal: 'tracked_files', value: 1 },
      { signal: 'sensitive_category', value: 'release_artifacts' },
    ],
  },
  {
    name: 'C contains release_artifacts at free-boundary scale',
    signals: { declared_path_count: 6, tracked_file_count: 200, sensitive_categories: ['release_artifacts'] },
  },
  {
    name: 'C contains both high-risk migrations and release_artifacts',
    signals: {
      declared_path_count: 3,
      tracked_file_count: 10,
      sensitive_categories: ['migrations', 'release_artifacts'],
    },
  },
  {
    name: 'C contains migrations alongside a non-high-risk category',
    signals: {
      declared_path_count: 2,
      tracked_file_count: 20,
      sensitive_categories: ['configuration', 'migrations'],
    },
  },
  {
    name: 'C contains release_artifacts alongside configuration',
    signals: {
      declared_path_count: 2,
      tracked_file_count: 30,
      sensitive_categories: ['configuration', 'release_artifacts'],
    },
  },
  {
    name: 'task resolved, declared paths, but annotation invalid so high-risk category decides',
    signals: { declared_path_count: 1, tracked_file_count: 1, sensitive_categories: ['migrations'] },
    reasons: [
      { signal: 'declared_paths', value: 1 },
      { signal: 'tracked_files', value: 1 },
      { signal: 'sensitive_category', value: 'migrations' },
    ],
  },
];

test('T010: insufficient/high-uncertainty evidence always yields manual review, never a guessed default', () => {
  assert.ok(MANUAL_REVIEW_CASES.length >= 10, 'SC-004 requires at least 10 manual-review scenarios');

  for (const scenario of MANUAL_REVIEW_CASES) {
    const result = evaluateRecommendation(makeSignals(scenario.signals), DEFAULT_INPUT);
    assert.equal(result.recommendation, 'manual_review', `outcome for: ${scenario.name}`);
    assert.equal(result.source, 'inferred', `source for: ${scenario.name}`);
  }
});

test('T010: manual-review results name the exact evidence that decided them', () => {
  for (const scenario of MANUAL_REVIEW_CASES) {
    const result = evaluateRecommendation(makeSignals(scenario.signals), DEFAULT_INPUT);
    assert.equal(result.recommendation, 'manual_review', `outcome for: ${scenario.name}`);

    if (scenario.reasons) {
      assert.deepEqual(result.reasons, scenario.reasons, `reasons for: ${scenario.name}`);
    }

    for (const reason of result.reasons) {
      assert.ok(
        (['declared_paths', 'tracked_files', 'task_id', 'task_budget_default', 'sensitive_category'] as string[]).includes(
          reason.signal,
        ),
        `unexpected reason signal in: ${scenario.name}`,
      );
    }
  }
});

test('T010: undecidable-but-non-empty scope still resolves per the decision table, no fabricated default', () => {
  const resolveRows: Array<{ name: string; signals: SignalOverrides; expected: DiagnosisOutcome }> = [
    {
      name: 'non-empty declared paths, no high-risk category, N=6/P=1 → normal',
      signals: { declared_path_count: 1, tracked_file_count: 6 },
      expected: 'normal',
    },
    {
      name: 'non-empty declared paths, N=100/P=5 → free',
      signals: { declared_path_count: 5, tracked_file_count: 100 },
      expected: 'free',
    },
    {
      name: 'task with valid annotation still wins over non-empty scope',
      signals: { declared_path_count: 4, tracked_file_count: 100, task_budget_default: 'tiny' },
      expected: 'tiny',
    },
  ];

  for (const scenario of resolveRows) {
    const result = evaluateRecommendation(makeSignals(scenario.signals), DEFAULT_INPUT);
    assert.equal(result.recommendation, scenario.expected, `outcome for: ${scenario.name}`);
    assert.notEqual(result.recommendation, 'manual_review', `should have resolved, not reviewed: ${scenario.name}`);
  }
});
