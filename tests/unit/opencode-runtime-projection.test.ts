import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RUNTIME_RULES,
  projectRuntimeDecision,
  type RuntimeProjectionInput,
  toRuntimePermissionStatus,
} from '../../opencode-plugin/src/projection.js';
import { DiagnosisResult } from '../../src/models/diagnose.js';

function buildInput(overrides: Partial<RuntimeProjectionInput>): RuntimeProjectionInput {
  return {
    policyDecision: 'PASS',
    mutationIntent: 'mutate',
    targetPath: 'src/index.ts',
    isInited: true,
    isPathDenied: false,
    isPathNotAllowed: false,
    isSensitive: {
      dependencies: false,
      migrations: false,
      config: false,
      publicApi: false,
    },
    newFileDenied: false,
    targetInChangeBudget: false,
    isTargetResolved: true,
    ...overrides,
  };
}

test('projectRuntimeDecision allows in passive mode when repository is not initialized', () => {
  const result = projectRuntimeDecision(buildInput({ isInited: false }));

  assert.equal(result.runtimeAction, 'allow');
  assert.equal(result.rule, RUNTIME_RULES.PASSIVE_MODE);
  assert.equal(result.reasonCode, RUNTIME_RULES.PASSIVE_MODE);
});

test('projectRuntimeDecision allows read-only operations even for HUMAN_REVIEW policy', () => {
  const result = projectRuntimeDecision(buildInput({ policyDecision: 'HUMAN_REVIEW', mutationIntent: 'read-only' }));

  assert.equal(result.runtimeAction, 'allow');
  assert.equal(result.rule, RUNTIME_RULES.ALLOW);
});

test('projectRuntimeDecision blocks mutations when policy is REPAIR', () => {
  const result = projectRuntimeDecision(buildInput({ policyDecision: 'REPAIR' }));

  assert.equal(result.runtimeAction, 'block');
  assert.equal(result.rule, RUNTIME_RULES.REPAIR);
});

test('projectRuntimeDecision blocks mutations when policy is HUMAN_REVIEW and path is mutable', () => {
  const result = projectRuntimeDecision(buildInput({ policyDecision: 'HUMAN_REVIEW', mutationIntent: 'mutate' }));

  assert.equal(result.runtimeAction, 'block');
  assert.equal(result.rule, RUNTIME_RULES.HUMAN_REVIEW);
});

test('projectRuntimeDecision blocks denied paths before other allow rules', () => {
  const result = projectRuntimeDecision(buildInput({ isPathDenied: true, isPathNotAllowed: true }));

  assert.equal(result.runtimeAction, 'block');
  assert.equal(result.rule, RUNTIME_RULES.PATH_DENY);
});

test('projectRuntimeDecision blocks mutations against .changebudget paths', () => {
  const result = projectRuntimeDecision(buildInput({ targetInChangeBudget: true, targetPath: '.changebudget/state.json' }));

  assert.equal(result.runtimeAction, 'block');
  assert.equal(result.rule, RUNTIME_RULES.CHANGEBUDGET);
});

test('projectRuntimeDecision asks when the target is outside allow_paths', () => {
  const result = projectRuntimeDecision(buildInput({ isPathNotAllowed: true, isSensitive: {
    dependencies: false,
    migrations: false,
    config: false,
    publicApi: false,
  } }));

  assert.equal(result.runtimeAction, 'ask');
  assert.equal(result.rule, RUNTIME_RULES.OUT_SCOPE);
});

test('projectRuntimeDecision asks for sensitive dependency updates', () => {
  const result = projectRuntimeDecision(buildInput({ isSensitive: {
    dependencies: true,
    migrations: false,
    config: false,
    publicApi: false,
  } }));

  assert.equal(result.runtimeAction, 'ask');
  assert.equal(result.rule, RUNTIME_RULES.DEPENDENCIES);
});

test('projectRuntimeDecision asks for migration-sensitive targets', () => {
  const result = projectRuntimeDecision(buildInput({ isSensitive: {
    dependencies: false,
    migrations: true,
    config: false,
    publicApi: false,
  } }));

  assert.equal(result.runtimeAction, 'ask');
  assert.equal(result.rule, RUNTIME_RULES.MIGRATIONS);
});

test('projectRuntimeDecision asks for config-sensitive targets when config changes are disallowed', () => {
  const result = projectRuntimeDecision(buildInput({ isSensitive: {
    dependencies: false,
    migrations: false,
    config: true,
    publicApi: false,
  } }));

  assert.equal(result.runtimeAction, 'ask');
  assert.equal(result.rule, RUNTIME_RULES.CONFIG);
});

test('projectRuntimeDecision asks for public-API-sensitive targets when public API changes are disallowed', () => {
  const result = projectRuntimeDecision(buildInput({ isSensitive: {
    dependencies: false,
    migrations: false,
    config: false,
    publicApi: true,
  } }));

  assert.equal(result.runtimeAction, 'ask');
  assert.equal(result.rule, RUNTIME_RULES.PUBLIC_API);
});

test('projectRuntimeDecision blocks a disallowed new file after preserving sensitive-path review', () => {
  const newFile = projectRuntimeDecision(buildInput({ newFileDenied: true }));
  const sensitiveNewFile = projectRuntimeDecision(buildInput({
    newFileDenied: true,
    isSensitive: {
      dependencies: true,
      migrations: false,
      config: false,
      publicApi: false,
    },
  }));

  assert.equal(newFile.runtimeAction, 'block');
  assert.equal(newFile.rule, RUNTIME_RULES.NEW_FILE_NOT_ALLOWED);
  assert.equal(sensitiveNewFile.runtimeAction, 'ask');
  assert.equal(sensitiveNewFile.rule, RUNTIME_RULES.DEPENDENCIES);
});

test('projectRuntimeDecision fails safely for unresolved mutation targets in initialized repositories', () => {
  const result = projectRuntimeDecision(buildInput({ isTargetResolved: false, targetPath: null }));

  assert.equal(result.runtimeAction, 'block');
  assert.equal(result.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);
});

test('projectRuntimeDecision keeps read-only operations allowed when target is unresolved', () => {
  const result = projectRuntimeDecision(buildInput({
    mutationIntent: 'read-only',
    isTargetResolved: false,
    targetPath: null,
  }));

  assert.equal(result.runtimeAction, 'allow');
  assert.equal(result.rule, RUNTIME_RULES.ALLOW);
});

test('projectRuntimeDecision defaults to allow when no blocking rule matches', () => {
  const result = projectRuntimeDecision(buildInput({ isPathNotAllowed: false, isPathDenied: false, isSensitive: {
    dependencies: false,
    migrations: false,
    config: false,
    publicApi: false,
  } }));

  assert.equal(result.runtimeAction, 'allow');
  assert.equal(result.rule, RUNTIME_RULES.ALLOW);
});

test('toRuntimePermissionStatus maps runtimeAction to permission status', () => {
  assert.equal(toRuntimePermissionStatus('allow'), 'allow');
  assert.equal(toRuntimePermissionStatus('ask'), 'ask');
  assert.equal(toRuntimePermissionStatus('block'), 'deny');
});

test('T018: projection input surface excludes Spec-Kit task fields', () => {
  const input = buildInput({});
  assert.equal('task_id' in input, false);
  assert.equal('task_title' in input, false);
  assert.equal('task_source_feature' in input, false);
  assert.equal('task_source_path' in input, false);
});

test('T018: projection output is identical regardless of contract task metadata', () => {
  const base = buildInput({ targetPath: 'src/index.ts', isPathDenied: false, isPathNotAllowed: false });

  const taskTiedInput = {
    ...base,
    task_id: 'T031',
    task_title: 'Implement the task bridge',
    task_source_feature: '006-example-feature',
    task_source_path: 'specs/006-example-feature/tasks.md',
  } as unknown as RuntimeProjectionInput;

  const withoutTasks = projectRuntimeDecision(base);
  const withTasks = projectRuntimeDecision(taskTiedInput);

  assert.deepEqual(withTasks, withoutTasks);
  assert.equal('task_id' in withTasks, false);
  assert.equal('task_title' in withTasks, false);
  assert.equal('task_source_feature' in withTasks, false);
  assert.equal('task_source_path' in withTasks, false);
});

test('T018: the diagnose result surface never feeds the runtime guard projection', () => {
  const diagnoseResult: DiagnosisResult = {
    recommendation: 'tiny',
    source: 'inferred',
    reasons: [{ signal: 'declared_paths', value: 1 }],
    inputs: {
      task_id: null,
      task_description: null,
      allow_paths: ['src/**'],
      deny_paths: [],
      stack_profile: null,
      json: false,
    },
  };

  const candidate = { ...diagnoseResult } as unknown as RuntimeProjectionInput;

  assert.equal('recommendation' in candidate, true);
  assert.equal('policyDecision' in candidate, false);

  const projected = projectRuntimeDecision(candidate);
  assert.equal(projected.reasonCode, RUNTIME_RULES.PASSIVE_MODE);
});

test('T018: diagnosis types carry no guard projection fields', () => {
  const diagnosisKeys = ['recommendation', 'source', 'reasons', 'inputs'] as const;
  const reasonKeys = ['signal', 'value'] as const;
  const guardKeys = Object.keys(buildInput({})) as readonly string[];

  for (const key of diagnosisKeys) {
    assert.equal(guardKeys.includes(key), false, `RuntimeProjectionInput must not accept ${key}`);
  }

  for (const key of reasonKeys) {
    assert.equal(guardKeys.includes(key), false, `RuntimeProjectionInput must not accept ${key}`);
  }
});

test('T018: repeated projections are byte-identical for a representative decision case', () => {
  const input = buildInput({ targetPath: 'src/index.ts' });
  const first = JSON.stringify(projectRuntimeDecision(input));
  const second = JSON.stringify(projectRuntimeDecision(input));
  assert.equal(second, first);
});
