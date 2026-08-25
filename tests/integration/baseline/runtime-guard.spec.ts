import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { RUNTIME_RULES, projectRuntimeDecision } from '../../../opencode-plugin/src/projection.js';

test('T036: baseline reporting never changes Runtime Guard deny, sensitive, or ChangeBudget protection', () => {
  const common = { policyDecision: 'PASS' as const, mutationIntent: 'mutate' as const, isInited: true, isPathDenied: false, isPathNotAllowed: false, isSensitive: { dependencies: false, migrations: false, config: false, publicApi: false }, isTargetResolved: true };
  assert.equal(projectRuntimeDecision({ ...common, targetPath: '.changebudget/state.json', targetInChangeBudget: true }).rule, RUNTIME_RULES.CHANGEBUDGET);
  assert.equal(projectRuntimeDecision({ ...common, targetPath: 'secret.env', targetInChangeBudget: false, isPathDenied: true }).rule, RUNTIME_RULES.PATH_DENY);
  assert.equal(projectRuntimeDecision({ ...common, targetPath: 'package.json', targetInChangeBudget: false, isSensitive: { dependencies: true, migrations: false, config: false, publicApi: false } }).runtimeAction, 'ask');
});
