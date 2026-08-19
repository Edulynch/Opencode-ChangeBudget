import * as assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile, readdir } from 'node:fs/promises';
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

async function createSpecsFixture(root: string, feature: string, content: string): Promise<void> {
  await mkdir(join(root, 'specs', feature), { recursive: true });
  await writeFile(join(root, 'specs', feature, 'tasks.md'), content);
}

async function snapshotChangeBudget(root: string): Promise<string> {
  const stateDir = join(root, '.changebudget');
  const entries: Array<{ path: string; content: string }> = [];

  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        entries.push({ path: full.slice(stateDir.length + 1), content: await readFile(full, 'utf8') });
      }
    }
  }

  await walk(stateDir);

  return entries
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `${entry.path}:${entry.content}`)
    .join('\n');
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

test('start command rejects repository-added rules that duplicate builtin rule IDs', async () => {
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
            flutter: {
              added_rules: [
                {
                  id: 'flutter/configuration',
                  category: 'configuration',
                  target_patterns: ['**/extra.yaml'],
                  message: 'Duplicate builtin rule id',
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
          'Start with duplicate override rule',
          '--base-revision',
          'HEAD',
          '--stack-profile',
          'flutter',
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

test('start command rejects malformed stack-policy override JSON as input validation', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    const beforeState = await readLifecycleState(root);

    await mkdir(join(root, '.changebudget'), { recursive: true });
    await writeFile(
      join(root, '.changebudget', 'stack-policy-overrides.json'),
      '{ "profiles": { "flutter": {',
    );

    await assert.rejects(
      () =>
        runStart(root, [
          '--task',
          'Start with malformed override JSON',
          '--base-revision',
          'HEAD',
          '--stack-profile',
          'flutter',
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

test('start command rejects override added rules with missing required metadata', async () => {
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
            flutter: {
              added_rules: [
                {
                  category: 'configuration',
                  target_patterns: ['**/extra.yaml'],
                  message: 'Rule missing id',
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
          'Start with missing rule metadata',
          '--base-revision',
          'HEAD',
          '--stack-profile',
          'flutter',
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

test('start command associates a task and persists resolved task metadata', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await createSpecsFixture(
      root,
      '006-example-feature',
      '- [ ] T031 Implement task bridge\n- [x] T030 Already done\n',
    );
    await runInit(root);

    const result = await runStart(root, [
      'T031',
      '--base-revision',
      'HEAD',
      '--tiny',
    ]);

    assert.equal(result.state.lifecycle_state, 'active');

    const contract = await readJsonFile<{
      task_id: string | null;
      task_title: string | null;
      task_source_feature: string | null;
      task_source_path: string | null;
      task_description: string;
      preset: string | null;
    }>(getContractFilePath(root, result.contractId));

    assert.equal(contract.task_id, 'T031');
    assert.equal(contract.task_title, 'Implement task bridge');
    assert.equal(contract.task_source_feature, '006-example-feature');
    assert.equal(contract.task_source_path, 'specs/006-example-feature/tasks.md');
    assert.equal(contract.task_description, 'Implement task bridge');
    assert.equal(contract.preset, 'tiny');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command canonicalizes lowercase task ids', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await createSpecsFixture(
      root,
      '006-example-feature',
      '- [ ] T031 Implement task bridge\n',
    );
    await runInit(root);

    const result = await runStart(root, ['t031', '--base-revision', 'HEAD']);

    const contract = await readJsonFile<{
      task_id: string | null;
    }>(getContractFilePath(root, result.contractId));

    assert.equal(contract.task_id, 'T031');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command keeps explicit --task while storing resolved task_title', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await createSpecsFixture(
      root,
      '006-example-feature',
      '- [ ] T031 Implement task bridge\n',
    );
    await runInit(root);

    const result = await runStart(root, [
      'T031',
      '--task',
      'Custom description',
      '--base-revision',
      'HEAD',
    ]);

    const contract = await readJsonFile<{
      task_id: string | null;
      task_title: string | null;
      task_description: string;
    }>(getContractFilePath(root, result.contractId));

    assert.equal(contract.task_id, 'T031');
    assert.equal(contract.task_title, 'Implement task bridge');
    assert.equal(contract.task_description, 'Custom description');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command failed task starts leave .changebudget byte-identical', async () => {
  const root = await createTestRepoWithCommit();

  const scenarios: Array<{
    setup: () => Promise<void>;
    args: string[];
    errorName: string;
  }> = [
    {
      setup: () => createSpecsFixture(root, '006-example-feature', '- [ ] T031 Implement task bridge\n'),
      args: ['T999', '--base-revision', 'HEAD'],
      errorName: InputValidationError.name,
    },
    {
      setup: async () => {
        await createSpecsFixture(root, 'feature-alpha', '- [ ] T031 Ambiguous alpha\n');
        await createSpecsFixture(root, 'feature-beta', '- [ ] T031 Ambiguous beta\n');
      },
      args: ['T031', '--base-revision', 'HEAD'],
      errorName: InputValidationError.name,
    },
    {
      setup: () => createSpecsFixture(root, '006-example-feature', '- [ ] T031 Implement task bridge\n'),
      args: ['T31', '--base-revision', 'HEAD'],
      errorName: InputValidationError.name,
    },
    {
      setup: async () => undefined,
      args: ['T031', '--base-revision', 'HEAD'],
      errorName: InputValidationError.name,
    },
  ];

  try {
    await runInit(root);

    for (const scenario of scenarios) {
      await scenario.setup();
      const before = await snapshotChangeBudget(root);

      await assert.rejects(
        () => runStart(root, scenario.args),
        { name: scenario.errorName },
      );

      const after = await snapshotChangeBudget(root);
      assert.equal(after, before);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('start command applies budget-default annotation precedence (table-driven)', async () => {
  const scenarios: Array<{
    name: string;
    specsContent: string;
    args: string[];
    expectedPreset: string | null;
  }> = [
    {
      name: 'valid annotation sets preset when no CLI budget flag',
      specsContent: '- [ ] T031 [budget:tiny] Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD'],
      expectedPreset: 'tiny',
    },
    {
      name: 'explicit --normal overrides annotation',
      specsContent: '- [ ] T031 [budget:tiny] Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD', '--normal'],
      expectedPreset: 'normal',
    },
    {
      name: 'explicit --preset normal overrides annotation',
      specsContent: '- [ ] T031 [budget:tiny] Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD', '--preset', 'normal'],
      expectedPreset: 'normal',
    },
    {
      name: '--tiny shorthand equals --preset tiny',
      specsContent: '- [ ] T031 Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD', '--tiny'],
      expectedPreset: 'tiny',
    },
    {
      name: '--preset tiny equals --tiny shorthand',
      specsContent: '- [ ] T031 Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD', '--preset', 'tiny'],
      expectedPreset: 'tiny',
    },
    {
      name: 'invalid annotation ignored when CLI budget flag present',
      specsContent: '- [ ] T031 [budget:custom] Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD', '--tiny'],
      expectedPreset: 'tiny',
    },
    {
      name: 'explicit custom preset wins over annotation',
      specsContent: '- [ ] T031 [budget:tiny] Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD', '--preset', 'custom'],
      expectedPreset: 'custom',
    },
    {
      name: 'uppercase annotation value normalized to preset',
      specsContent: '- [ ] T031 [budget:FREE] Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD'],
      expectedPreset: 'free',
    },
    {
      name: 'task without budget annotation keeps default preset',
      specsContent: '- [ ] T031 Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD'],
      expectedPreset: null,
    },
  ];

  for (const scenario of scenarios) {
    const root = await createTestRepoWithCommit();
    try {
      await createSpecsFixture(root, '006-example-feature', scenario.specsContent);
      await runInit(root);

      const result = await runStart(root, scenario.args);
      assert.equal(result.state.lifecycle_state, 'active', scenario.name);

      const contract = await readJsonFile<{
        preset: string | null;
        task_id: string | null;
      }>(getContractFilePath(root, result.contractId));

      assert.equal(contract.preset, scenario.expectedPreset, scenario.name);
      assert.equal(contract.task_id, 'T031', scenario.name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('start command rejects invalid budget annotations without persisting state', async () => {
  const scenarios: Array<{
    name: string;
    specsContent: string;
    args: string[];
    message?: string;
  }> = [
    {
      name: 'invalid effective annotation fails without persisting',
      specsContent: '- [ ] T031 [budget:custom] Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD'],
      message: 'Invalid budget default value. Allowed values: tiny, normal, free',
    },
    {
      name: 'shorthand combined with --preset fails as deterministic input error',
      specsContent: '- [ ] T031 [budget:tiny] Implement task bridge\n',
      args: ['T031', '--base-revision', 'HEAD', '--tiny', '--preset', 'normal'],
      message: 'Budget preset was specified more than once. Use --preset or one of --tiny/--normal/--free, not both.',
    },
  ];

  for (const scenario of scenarios) {
    const root = await createTestRepoWithCommit();
    try {
      await createSpecsFixture(root, '006-example-feature', scenario.specsContent);
      await runInit(root);

      const before = await snapshotChangeBudget(root);

      await assert.rejects(
        () => runStart(root, scenario.args),
        scenario.message
          ? { name: InputValidationError.name, message: scenario.message }
          : { name: InputValidationError.name },
      );

      const after = await snapshotChangeBudget(root);
      assert.equal(after, before, scenario.name);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('start command classic start preserves explicit budget flags', async () => {
  const root = await createTestRepoWithCommit();

  try {
    await runInit(root);

    const result = await runStart(root, [
      '--task',
      'Classic task',
      '--base-revision',
      'HEAD',
      '--tiny',
    ]);

    const contract = await readJsonFile<{ preset: string | null }>(
      getContractFilePath(root, result.contractId),
    );

    assert.equal(contract.preset, 'tiny');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
