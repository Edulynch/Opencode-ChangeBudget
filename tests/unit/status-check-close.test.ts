import * as assert from 'node:assert/strict';
import { rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runStatus } from '../../src/cli/commands/status.js';
import { runCheck } from '../../src/cli/commands/check.js';
import { runClose } from '../../src/cli/commands/close.js';
import { StateConflictError, InputValidationError } from '../../src/models/errors.js';
import {
  readLifecycleState,
  getStateFilePath,
  readJsonFile,
} from '../../src/core/state/state.js';

async function removeDirectoryTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const next = join(root, entry.name);
    if (entry.isDirectory()) {
      await removeDirectoryTree(next);
    } else {
      await rm(next, { force: true });
    }
  }

  await rm(root, { recursive: true, force: true });
}

async function cleanupRoot(root: string): Promise<void> {
  try {
    await removeDirectoryTree(root);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

function createRepositoryWithCommit(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cb-status-')).then(async (root) => {
    const initResult = spawnSync('git', ['init'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (initResult.status !== 0) {
      throw new Error(`git init failed: ${initResult.stderr}`);
    }

    const nameResult = spawnSync('git', ['config', 'user.name', 'status test'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (nameResult.status !== 0) {
      throw new Error(`git config name failed: ${nameResult.stderr}`);
    }

    const emailResult = spawnSync('git', ['config', 'user.email', 'status@test'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (emailResult.status !== 0) {
      throw new Error(`git config email failed: ${emailResult.stderr}`);
    }

    const commitResult = spawnSync('git', ['commit', '--allow-empty', '-m', 'seed'], {
      cwd: root,
      encoding: 'utf8',
    });
    if (commitResult.status !== 0) {
      throw new Error(`git commit failed: ${commitResult.stderr}`);
    }

    return root;
  });
}

test('status reports uninitialized state before init', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    const result = await runStatus(root);
    assert.equal(result.lifecycleState, null);
    assert.equal(result.activeContract, null);
    assert.equal(result.lastClosedContract, null);
  } finally {
    await cleanupRoot(root);
  }
});

test('status resolves active contract after start', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    const init = await runInit(root);
    assert.equal(init.changed, true);

    const started = await runStart(root, [
      '--task',
      'Refactor status',
      '--base-revision',
      'HEAD',
      '--max-files',
      '11',
    ]);

    const result = await runStatus(root);
    assert.equal(result.lifecycleState?.lifecycle_state, 'active');
    assert.equal(result.activeContract?.id, started.contractId);
    assert.equal(result.lastClosedContract, null);
  } finally {
    await cleanupRoot(root);
  }
});

test('check validates active contract and draft files', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    await runStart(root, ['--task', 'Refactor check', '--base-revision', 'HEAD']);

    const active = await runCheck(root);
    assert.equal(active.contractSource, 'active');

    const draftPath = join(root, 'draft-contract.json');
    await writeFile(
      draftPath,
      JSON.stringify({
        schema_version: '1.0.0',
        id: 'draft-1',
        task_description: 'Draft check',
        base_revision: 'HEAD',
        allow_paths: ['src'],
        deny_paths: [],
        max_files: 10,
        max_changed_lines: 2,
        allow_new_files: true,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: true,
        allow_public_api_changes: false,
        preset: 'tiny',
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    const draft = await runCheck(root, ['--draft', draftPath]);
    assert.equal(draft.contractSource, 'draft');
    assert.equal(draft.contractId, 'draft-1');
  } finally {
    await cleanupRoot(root);
  }
});

test('check fails with missing required fields in draft', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    const draftPath = join(root, 'bad-contract.json');
    await writeFile(
      draftPath,
      JSON.stringify({
        schema_version: '1.0.0',
        id: 'bad-1',
        task_description: '',
        base_revision: '',
        allow_paths: [42],
        deny_paths: [''],
        allow_new_files: true,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: true,
        allow_public_api_changes: false,
        max_files: -1,
        max_changed_lines: null,
        status: 'draft',
        created_at: 'now',
        updated_at: 'now',
        closed_at: null,
      }),
    );

    await assert.rejects(() => runCheck(root, ['--draft', draftPath]), {
      name: InputValidationError.name,
    });
  } finally {
    await cleanupRoot(root);
  }
});

test('close transitions active contract to closed and stores close metadata', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    const started = await runStart(root, [
      '--task',
      'Refactor close',
      '--base-revision',
      'HEAD',
      '--allow-new-files',
    ]);

    const result = await runClose(root, ['--actor', 'ci-bot', '--reason', 'done']);
    assert.equal(result.contractId, started.contractId);
    assert.equal(result.state.lifecycle_state, 'closed');

    const contract = await readJsonFile<{
      status: string;
      closed_by: string | null;
      close_reason: string | null;
      closed_at: string | null;
    }>(
      join(root, '.changebudget/contracts', `${started.contractId}.json`),
    );

    assert.equal(contract.status, 'closed');
    assert.equal(contract.closed_by, 'ci-bot');
    assert.equal(contract.close_reason, 'done');
    assert.equal(contract.closed_at !== null, true);

    const state = await readLifecycleState(root);
    assert.equal(state?.lifecycle_state, 'closed');
    assert.equal(state?.active_contract_id, null);
    assert.equal(state?.last_closed_contract_id, started.contractId);
  } finally {
    await cleanupRoot(root);
  }
});

test('close fails safely without active contract', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    await assert.rejects(() => runClose(root), {
      name: StateConflictError.name,
    });

    const statePath = getStateFilePath(root);
    const state = await readJsonFile<{ lifecycle_state: string }>(statePath);
    assert.equal(state.lifecycle_state, 'initialized');
  } finally {
    await cleanupRoot(root);
  }
});

test('check requires active contract or draft file', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    await assert.rejects(() => runCheck(root), {
      name: InputValidationError.name,
    });
  } finally {
    await cleanupRoot(root);
  }
});

test('status rejects unexpected arguments', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    await assert.rejects(() => runStatus(root, ['--verbose']), {
      name: InputValidationError.name,
    });
  } finally {
    await cleanupRoot(root);
  }
});
