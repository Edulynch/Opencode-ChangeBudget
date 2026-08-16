import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runCheck } from '../../src/cli/commands/check.js';
import { getStateFilePath } from '../../src/core/state/state.js';
import { StateCorruptionError, InputValidationError } from '../../src/models/errors.js';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function createRepositoryWithCommit(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cb-validation-')).then(async (root) => {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'validation test']);
    runGit(root, ['config', 'user.email', 'validation@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    return root;
  });
}

test('runStart reports deterministic input validation when required fields are empty', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    await assert.rejects(
      () => runStart(root, ['--task', '', '--base-revision', '']),
      (error: unknown) => {
        assert.equal(error instanceof InputValidationError, true);
        if (error instanceof InputValidationError) {
          assert.equal(error.message.includes('Contract input validation failed'), true);
          assert.equal(error.message.includes('task_description'), true);
          assert.equal(error.message.includes('base_revision'), true);
        }
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runCheck fails with invalid draft path and reports actionable message', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    const draftPath = join(root, 'bad-check-contract.json');
    await writeFile(
      draftPath,
      JSON.stringify({
        schema_version: '1.0.0',
        id: 'invalid',
        task_description: '',
        base_revision: 'HEAD',
        allow_paths: [''],
        deny_paths: [],
        max_files: -1,
        allow_new_files: true,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: true,
        allow_public_api_changes: false,
        max_changed_lines: 0,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    await assert.rejects(
      () => runCheck(root, ['--draft', draftPath]),
      (error: unknown) => {
        assert.equal(error instanceof InputValidationError, true);
        if (error instanceof InputValidationError) {
          assert.equal(error.message.startsWith('Contract validation failed:'), true);
          assert.equal(error.context?.errors !== undefined, true);
        }
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('invalid lifecycle file is treated as corruption', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    const statePath = getStateFilePath(root);
    await writeFile(statePath, '{"schema_version":"1.0.0"}', { encoding: 'utf8' });

    const loaded = readFileSync(statePath, 'utf8');
    assert.equal(loaded.includes('schema_version'), true);

    await assert.rejects(
      () => runCheck(root),
      (error: unknown) => {
        assert.equal(error instanceof StateCorruptionError, true);
        if (error instanceof StateCorruptionError) {
          assert.equal(error.message.includes('invalid structure'), true);
        }
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
