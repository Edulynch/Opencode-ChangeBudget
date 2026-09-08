import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getIntegrationSummary } from '../../src/cli/commands/integrate.js';
import type { IntegrationResult, ResourceAction } from '../../src/core/integration/opencode.js';

function result(operation: IntegrationResult['operation'], actions: readonly ResourceAction[]): IntegrationResult {
  const [pluginWrapper, instructions, opencodeConfig] = actions;
  if (pluginWrapper === undefined || instructions === undefined || opencodeConfig === undefined) {
    throw new Error('Test fixture requires three resource actions');
  }
  return {
    operation,
    resources: {
      pluginWrapper: { path: '.opencode/plugins/changebudget.js', action: pluginWrapper },
      instructions: { path: '.opencode/instructions/changebudget.md', action: instructions },
      opencodeConfig: { path: 'opencode.json', action: opencodeConfig },
    },
    runtimeGuardTargetExists: true,
    baselineWarning: null,
    readiness: 'READY',
  };
}

describe('integration summary', () => {
  it('describes normal install outcomes without changing dry-run or remove semantics', () => {
    assert.equal(getIntegrationSummary(result('install', ['CREATE', 'UNCHANGED', 'UPDATE'])), 'Integration installed.');
    assert.equal(getIntegrationSummary(result('install', ['UNCHANGED', 'UPDATE', 'UNCHANGED'])), 'Integration refreshed.');
    assert.equal(getIntegrationSummary(result('install', ['UNCHANGED', 'UNCHANGED', 'UNCHANGED'])), 'Integration already current.');
    assert.equal(getIntegrationSummary(result('dry-run', ['CREATE', 'CREATE', 'CREATE'])), null);
    assert.equal(getIntegrationSummary(result('remove', ['REMOVE', 'REMOVE', 'UPDATE'])), null);
  });
});
