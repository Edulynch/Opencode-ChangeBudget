import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runCheck } from '../../src/cli/commands/check.js';
import { runClose } from '../../src/cli/commands/close.js';
import { readLifecycleState } from '../../src/core/state/state.js';
import { generateInstructionsContent } from '../../src/core/integration/opencode-content.js';
import { InputValidationError } from '../../src/models/errors.js';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-forced-close-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'forced close test']);
  runGit(root, ['config', 'user.email', 'forced-close@test']);
  await writeFile(join(root, 'allowed.txt'), 'seed\n');
  runGit(root, ['add', 'allowed.txt']);
  runGit(root, ['commit', '-m', 'seed']);
  return root;
}

test('forced close requires an explicit non-empty reason and preserves active state on rejection', { concurrency: 1 }, async () => {
  const root = await createRepository();

  try {
    await runInit(root);
    await runStart(root, [
      '--task',
      'Exercise forced close recovery',
      '--base-revision',
      'HEAD',
      '--allow-path',
      'allowed.txt',
    ]);
    await writeFile(join(root, 'blocked.txt'), 'outside authority\n');

    const check = await runCheck(root);
    assert.equal(check.decision, 'REPAIR');

    await assert.rejects(
      () => runClose(root, ['--force']),
      (error: unknown) => error instanceof InputValidationError
        && error.message.includes('--reason is required with --force'),
    );

    await assert.rejects(
      () => runClose(root, ['--force', '--reason=']),
      (error: unknown) => error instanceof InputValidationError
        && error.message.includes('--reason is required with --force'),
    );

    const state = await readLifecycleState(root);
    assert.equal(state?.lifecycle_state, 'active');
    assert.equal(typeof state?.active_contract_id, 'string');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('forced close releases a blocked contract without converting the failed check to PASS', { concurrency: 1 }, async () => {
  const root = await createRepository();

  try {
    await runInit(root);
    const started = await runStart(root, [
      '--task',
      'Recover blocked contract',
      '--base-revision',
      'HEAD',
      '--allow-path',
      'allowed.txt',
    ]);
    await writeFile(join(root, 'blocked.txt'), 'outside authority\n');

    const beforeClose = await runCheck(root);
    assert.equal(beforeClose.decision, 'REPAIR');

    const result = await runClose(root, [
      '--force',
      '--reason',
      'Developer authorized replacement of blocked contract',
      '--actor',
      'developer',
    ]);

    assert.equal(result.state.lifecycle_state, 'closed');
    assert.equal(result.contract.status, 'closed');
    assert.equal(result.contract.forced_close, true);
    assert.equal(result.contract.closed_by, 'developer');
    assert.equal(result.contract.close_reason, 'Developer authorized replacement of blocked contract');

    const persisted = JSON.parse(
      await readFile(join(root, '.changebudget', 'contracts', `${started.contractId}.json`), 'utf8'),
    ) as {
      status: string;
      forced_close?: boolean;
      close_reason?: string | null;
    };

    assert.equal(persisted.status, 'closed');
    assert.equal(persisted.forced_close, true);
    assert.equal(persisted.close_reason, 'Developer authorized replacement of blocked contract');

    const state = await readLifecycleState(root);
    assert.equal(state?.lifecycle_state, 'closed');
    assert.equal(state?.active_contract_id, null);
    assert.equal(state?.last_closed_contract_id, started.contractId);

    // The administrative recovery must not rewrite the repository into compliance.
    assert.equal((await readFile(join(root, 'blocked.txt'), 'utf8')), 'outside authority\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('OpenCode instructions reserve forced close for explicit developer authorization', () => {
  const instructions = generateInstructionsContent();

  assert.match(instructions, /changebudget close --force --reason/);
  assert.match(instructions, /explicit developer authorization/);
  assert.match(instructions, /does not mean PASS/);
  assert.match(instructions, /Never invoke `--force` on your own initiative/);
});
