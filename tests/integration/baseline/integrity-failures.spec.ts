import * as assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { test } from 'node:test';

import { runCheck } from '../../../src/cli/commands/check.js';
import { runInit } from '../../../src/cli/commands/init.js';
import { runStart } from '../../../src/cli/commands/start.js';
import { getBaselineEvidencePath } from '../../../src/core/state/state.js';
import { createWorkingTreeBaselineFixture } from '../../utils/working-tree-baseline-fixtures.js';

test('T031: unavailable and malformed retained evidence stays baseline-mode HUMAN_REVIEW', async (context) => {
  for (const mutation of ['remove', 'malform'] as const) {
    await context.test(mutation, async () => {
      const fixture = await createWorkingTreeBaselineFixture();
      try {
        await runInit(fixture.root);
        const started = await runStart(fixture.root, ['--task', 'integrity', '--base-revision', 'HEAD']);
        const evidencePath = getBaselineEvidencePath(fixture.root, started.contractId);
        if (mutation === 'remove') await rm(evidencePath);
        else await writeFile(evidencePath, '{broken', 'utf8');

        const result = await runCheck(fixture.root);
        assert.equal(result.comparisonMode, 'baseline');
        assert.equal(result.decision, 'HUMAN_REVIEW');
        assert.equal(result.reasonCodes.some((code) => code.startsWith('BASELINE_')), true);
      } finally {
        await fixture.cleanup();
      }
    });
  }
});

test('T031: corrupt and tampered retained evidence fails closed after reload', async (context) => {
  for (const mutation of ['corrupt', 'tamper'] as const) {
    await context.test(mutation, async () => {
      const fixture = await createWorkingTreeBaselineFixture();
      try {
        await fixture.writeUntracked('inherited.txt', 'before\n');
        await runInit(fixture.root);
        const started = await runStart(fixture.root, ['--task', 'integrity', '--base-revision', 'HEAD']);
        const evidencePath = getBaselineEvidencePath(fixture.root, started.contractId);
        const evidence = JSON.parse(await readFile(evidencePath, 'utf8')) as Record<string, unknown>;
        await writeFile(evidencePath, JSON.stringify(mutation === 'corrupt' ? { ...evidence, integrity: 'bad' } : { ...evidence, contractId: 'other' }), 'utf8');

        const result = await runCheck(fixture.root);
        assert.equal(result.comparisonMode, 'baseline');
        assert.equal(result.decision, 'HUMAN_REVIEW');
        assert.equal(result.reasonCodes[0]?.startsWith('BASELINE_'), true);
      } finally {
        await fixture.cleanup();
      }
    });
  }
});
