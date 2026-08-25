import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

function git(root: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('start leaves dirty user files and Git state unchanged', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeTracked('tracked.txt', 'original\n');
    await fixture.writeUnstaged('tracked.txt', 'dirty\n');
    await fixture.writeUntracked('untracked.txt', 'untracked\n');
    await runInit(fixture.root);
    const before = { status: git(fixture.root, ['status', '--porcelain=v1']), head: fixture.head(), index: await readFile(`${fixture.root}/.git/index`) };

    const result = await runStart(fixture.root, ['--task', 'readonly baseline', '--base-revision', 'HEAD']);
    const after = { status: git(fixture.root, ['status', '--porcelain=v1']), head: fixture.head(), index: await readFile(`${fixture.root}/.git/index`) };

    assert.equal(result.state.active_contract_id, result.contractId);
    assert.deepEqual(after, before);
  } finally {
    await fixture.cleanup();
  }
});
