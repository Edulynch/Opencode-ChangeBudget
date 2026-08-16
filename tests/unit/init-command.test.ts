import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { test } from 'node:test';

import { runInit } from '../../src/cli/commands/init.js';
import { GitEnvironmentError } from '../../src/models/errors.js';
import {
  getContractsDirectoryPath,
  getStateFilePath,
  pathExists,
  readJsonFile,
} from '../../src/core/state/state.js';

function initGitRepository(root: string): void {
  const initResult = spawnSync('git', ['init'], {
    cwd: root,
    encoding: 'utf8',
  });

  if (initResult.status !== 0) {
    throw new Error(`git init failed: ${initResult.stderr}`);
  }

  const configResult = spawnSync('git', ['config', 'user.name', 'init-test'], {
    cwd: root,
    encoding: 'utf8',
  });
  if (configResult.status !== 0) {
    throw new Error(`git config failed: ${configResult.stderr}`);
  }
}

test('init command creates baseline ChangeBudget state and contract directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-init-'));

  try {
    initGitRepository(root);

    const result = await runInit(root);
    assert.equal(result.changed, true);

    const statePath = getStateFilePath(result.repositoryRoot);
    const state = await readJsonFile<{ lifecycle_state: string }>(statePath);

    assert.equal(state.lifecycle_state, 'initialized');
    assert.equal(await pathExists(statePath), true);
    assert.equal(await pathExists(getContractsDirectoryPath(result.repositoryRoot)), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('init command is deterministic when already initialized', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-init-'));

  try {
    initGitRepository(root);

    const first = await runInit(root);
    const second = await runInit(root);

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.equal(second.state.lifecycle_state, 'initialized');
    assert.equal(second.state.updated_at, first.state.updated_at);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('init command rejects non-git directories without creating state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-init-'));

  try {
    await assert.rejects(() => runInit(root), {
      name: GitEnvironmentError.name,
    });

    assert.equal(await pathExists(getStateFilePath(root)), false);
    assert.equal(await pathExists(join(root, '.changebudget')), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
