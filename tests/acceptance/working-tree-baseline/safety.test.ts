import * as assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { runCheck } from '../../../src/cli/commands/check.js';
import { runClose } from '../../../src/cli/commands/close.js';
import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { runStatus } from '../../../src/cli/commands/status.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('T041: start, check, status, and close preserve the user file and Git index', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeTracked('tracked.txt', 'before\n');
    await fixture.writeUnstaged('tracked.txt', 'dirty\n');
    await runInit(fixture.root);
    const before = { file: await readFile(`${fixture.root}/tracked.txt`, 'utf8'), index: await readFile(`${fixture.root}/.git/index`) };
    await runStart(fixture.root, ['--task', 'safety', '--base-revision', 'HEAD']);
    await runCheck(fixture.root);
    await runStatus(fixture.root, ['--budget']);
    await runClose(fixture.root);
    assert.deepEqual({ file: await readFile(`${fixture.root}/tracked.txt`, 'utf8'), index: await readFile(`${fixture.root}/.git/index`) }, before);
  } finally { await fixture.cleanup(); }
});
