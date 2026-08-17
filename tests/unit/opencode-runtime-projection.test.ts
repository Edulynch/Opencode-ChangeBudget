import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  RUNTIME_RULES,
  projectRuntimeDecision,
  type RuntimeProjectionInput,
  toRuntimePermissionStatus,
} from '../../opencode-plugin/src/projection.js';

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
