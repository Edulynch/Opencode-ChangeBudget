import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { runCheck } from '../../../src/cli/commands/check.js';
import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('R1: baseline projection excludes unchanged inherited outside-allow files', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeUntracked('outside/inherited.txt', 'before\n');
    await runInit(fixture.root);
    await runStart(fixture.root, ['--task', 'projection', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);
    assert.equal((await runCheck(fixture.root)).decision, 'PASS');
  } finally {
    await fixture.cleanup();
  }
});

test('R2: baseline projection enforces a B-to-C edit to inherited outside-allow files', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeUntracked('outside/inherited.txt', 'before\n');
    await runInit(fixture.root);
    await runStart(fixture.root, ['--task', 'projection', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);

    await fixture.writeUntracked('outside/inherited.txt', 'after\n');
    const result = await runCheck(fixture.root);
    assert.equal(result.decision, 'REPAIR');
    assert.equal(result.reasonCodes.includes('CBV-PATH-NOT-ALLOWED'), true);
  } finally {
    await fixture.cleanup();
  }
});

test('R3: committed setup before start and an uncommitted in-scope edit retain normal evaluation', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeTracked('src/app.ts', 'export const value = 1;\n');
    await runInit(fixture.root);
    await runStart(fixture.root, ['--task', 'projection', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);

    await fixture.writeUnstaged('src/app.ts', 'export const value = 2;\n');
    const result = await runCheck(fixture.root);
    assert.equal(result.decision, 'PASS');
    assert.equal(result.changedFileCount, 1);
  } finally {
    await fixture.cleanup();
  }
});

test('R4: a commit after start is a baseline HEAD movement requiring human review', async () => {
  const fixture = await createWorkingTreeBaselineFixture();
  try {
    await fixture.writeTracked('src/app.ts', 'export const value = 1;\n');
    await runInit(fixture.root);
    await runStart(fixture.root, ['--task', 'projection', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);

    await fixture.writeUnstaged('src/app.ts', 'export const value = 2;\n');
    fixture.stage('src/app.ts');
    fixture.commit('post-start edit');

    const result = await runCheck(fixture.root);
    assert.equal(result.decision, 'HUMAN_REVIEW');
    assert.equal(result.reasonCodes.includes('BASELINE_HEAD_MOVED'), true);
  } finally {
    await fixture.cleanup();
  }
});
