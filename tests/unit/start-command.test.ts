import * as assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
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

test('start command rejects disabled stack rules when no stack profile is set', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'Attempt invalid stack config',
          '--base-revision',
          'HEAD',
          '--disable-stack-rule',
          'android/signing',
        ]),
      {
        name: InputValidationError.name,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command rejects unknown disabled stack rule IDs for selected profile', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'Start with unknown rule',
          '--base-revision',
          'HEAD',
          '--stack-profile',
          'android',
          '--disable-stack-rule',
          'android/does-not-exist',
        ]),
      {
        name: InputValidationError.name,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command validates contract-disabled IDs against repository overrides', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    await mkdir(join(root, '.changebudget'), { recursive: true });
    await writeFile(
      join(root, '.changebudget', 'stack-policy-overrides.json'),
      JSON.stringify(
        {
          profiles: {
            android: {
              added_rules: [
                {
                  id: 'android/local',
                  category: 'runtime',
                  target_patterns: ['**/*.kt'],
                  message: 'Android runtime local change',
                  severity: 'review',
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    const result = await runStart(root, [
      '--task',
      'Start with override rule',
      '--base-revision',
      'HEAD',
      '--stack-profile',
      'android',
      '--disable-stack-rule',
      'android/local',
    ]);

    assert.equal(result.state.lifecycle_state, 'active');
    const contract = await readJsonFile<{
      disabled_stack_rules: string[];
    }>(getContractFilePath(root, result.contractId));

    assert.deepEqual(contract.disabled_stack_rules, ['android/local']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command rejects disable ids from non-active profile overrides', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    await mkdir(join(root, '.changebudget'), { recursive: true });
    await writeFile(
      join(root, '.changebudget', 'stack-policy-overrides.json'),
      JSON.stringify(
        {
          profiles: {
            flutter: {
              added_rules: [
                {
                  id: 'flutter/local',
                  category: 'runtime',
                  target_patterns: ['**/*.dart'],
                  message: 'Flutter local rule',
                  severity: 'review',
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'Start cross profile disable',
          '--base-revision',
          'HEAD',
          '--stack-profile',
          'android',
          '--disable-stack-rule',
          'flutter/local',
        ]),
      {
        name: InputValidationError.name,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command rejects unknown stack profiles before contract persistence', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    const beforeState = await readLifecycleState(root);

    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'Bad profile',
          '--base-revision',
          'HEAD',
          '--stack-profile',
          'unknown-stack',
        ]),
      {
        name: InputValidationError.name,
      },
    );

    const afterState = await readLifecycleState(root);
    assert.deepEqual(afterState, beforeState);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command rejects override-defined disabled rule IDs for selected profile', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    const beforeState = await readLifecycleState(root);

    await mkdir(join(root, '.changebudget'), { recursive: true });
    await writeFile(
      join(root, '.changebudget', 'stack-policy-overrides.json'),
      JSON.stringify(
        {
          profiles: {
            android: {
              disable_rule_ids: ['android/does-not-exist'],
            },
          },
        },
        null,
        2,
      ),
    );

    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'Bad repository override',
          '--base-revision',
          'HEAD',
          '--stack-profile',
          'android',
        ]),
      {
        name: InputValidationError.name,
      },
    );

    const afterState = await readLifecycleState(root);
    assert.deepEqual(afterState, beforeState);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
