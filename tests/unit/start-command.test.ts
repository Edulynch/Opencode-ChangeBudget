import * as assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import {
  getContractFilePath,
  readJsonFile,
  readLifecycleState,
  getStateFilePath,
} from '../../src/core/state/state.js';
import {
  GitEnvironmentError,
  InputValidationError,
  StateConflictError,
} from '../../src/models/errors.js';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function createTestRepoWithCommit(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cb-start-')).then(async (root) => {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'start test']);
    runGit(root, ['config', 'user.email', 'start@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'init']);
    return root;
  });
}

test('start command persists an active contract in initialized state', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    const result = await runStart(root, [
      '--task',
      'Refactor module',
      '--base-revision',
      'HEAD',
      '--allow-new-files',
      '--preset',
      'tiny',
    ]);

    assert.equal(result.state.lifecycle_state, 'active');

    const state = await readLifecycleState(root);
    assert.equal(state?.active_contract_id, result.contractId);

    const contract = await readJsonFile<{
      status: string;
      task_description: string;
      id: string;
    }>(getContractFilePath(root, result.contractId));

    assert.equal(contract.status, 'active');
    assert.equal(contract.id, result.contractId);
    assert.equal(contract.task_description, 'Refactor module');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command rejects uninitialized repositories', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'Refactor module',
          '--base-revision',
          'HEAD',
        ]),
      {
        name: StateConflictError.name,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command rejects invalid base revision', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'Refactor module',
          '--base-revision',
          'definitely-not-a-rev',
        ]),
      {
        name: InputValidationError.name,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command rejects duplicate active contract', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);
    await runStart(root, ['--task', 'first', '--base-revision', 'HEAD']);

    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'second',
          '--base-revision',
          'HEAD',
        ]),
      {
        name: StateConflictError.name,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
