import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getIntegrationSummary } from '../../src/cli/commands/integrate.js';
import type { IntegrationResult, ResourceAction } from '../../src/core/integration/opencode.js';

function result(operation: IntegrationResult['operation'], action: ResourceAction): IntegrationResult {
  return {
    operation,
    resources: {
      pluginWrapper: { path: '.opencode/plugins/changebudget.js', action },
    },
    runtimeGuardTargetExists: true,
    baselineWarning: null,
    readiness: 'READY',
  };
}

describe('integration summary', () => {
  it('describes normal install outcomes without changing dry-run or remove semantics', () => {
    assert.equal(getIntegrationSummary(result('install', 'CREATE')), 'Integration installed.');
    assert.equal(getIntegrationSummary(result('install', 'UPDATE')), 'Integration refreshed.');
    assert.equal(getIntegrationSummary(result('install', 'UNCHANGED')), 'Integration already current.');
    assert.equal(getIntegrationSummary(result('dry-run', 'CREATE')), null);
    assert.equal(getIntegrationSummary(result('remove', 'REMOVE')), null);
  });
});
