import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { runClose } from '../../../src/cli/commands/close.js';
import { readBaselineEvidence } from '../../../src/core/state/state.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

const CANONICAL_KEYS = [
  'comparisonMode',
  'baselineState',
  'decision',
  'reasonCodes',
  'excludedUnchangedCount',
  'detectedDeltaCount',
] as const;

function runCli(root: string, args: readonly string[]): string {
  const cliPath = fileURLToPath(new URL('../../../src/cli/index.js', import.meta.url));
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('T035: check and status serialize the identical canonical baseline result', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeUntracked('inherited.txt', 'before\n');
    await runInit(fixture.root);
    await runStart(fixture.root, ['--task', 'reporting', '--base-revision', 'HEAD']);

    const check = JSON.parse(runCli(fixture.root, ['check', '--json'])) as Record<string, unknown>;
    const status = JSON.parse(runCli(fixture.root, ['status', '--budget', '--json'])) as Record<string, unknown>;

    assert.deepEqual(Object.keys(check), CANONICAL_KEYS);
    assert.deepEqual(status, check);
    assert.deepEqual(check, {
      comparisonMode: 'baseline',
      baselineState: 'captured',
      decision: 'PASS',
      reasonCodes: [],
      excludedUnchangedCount: 1,
      detectedDeltaCount: 0,
    });
  } finally {
    await fixture.cleanup();
  }
});

test('T034/T035: close retains the auditable baseline association and concise lifecycle output', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await runInit(fixture.root);
    const started = await runStart(fixture.root, ['--task', 'close retention', '--base-revision', 'HEAD']);
    const closed = await runClose(fixture.root, ['--actor', 'human', '--reason', 'accepted']);
    assert.equal(closed.contract.id, started.contractId);
    assert.equal(closed.contract.baseline_ref !== null, true);
    assert.notEqual(await readBaselineEvidence(fixture.root, started.contractId), null);
  } finally {
    await fixture.cleanup();
  }
});
