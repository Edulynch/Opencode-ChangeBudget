import * as assert from 'node:assert/strict';
import { rm, readdir, readFile, mkdir } from 'node:fs/promises';
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

    const result = await runCheck(root, ['--draft', draftPath]);
    assert.equal(result.decision, 'HUMAN_REVIEW');
    assert.equal(result.status, 'FAIL');
    assert.equal(result.reasonCodes.length > 0, true);
    assert.equal(result.reasonCodes[0], 'CBV-INPUT-INVALID');
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

test('status --budget reports HUMAN_REVIEW without mutating state', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    await runStart(root, ['--task', 'Budget status', '--base-revision', 'HEAD']);

    const statePath = getStateFilePath(root);
    const stateBefore = await readFile(statePath, 'utf8');
    const stateBeforeJson = await readLifecycleState(root);
    const activeContractId = stateBeforeJson?.active_contract_id;

    assert.equal(stateBeforeJson?.lifecycle_state, 'active');
    assert.equal(typeof activeContractId, 'string');

    const activeContractPath = join(root, '.changebudget', 'contracts', `${activeContractId}.json`);
    const activeContractBefore = await readJsonFile<{ base_revision: string }>(activeContractPath);

    const modifiedContract = {
      ...activeContractBefore,
      base_revision: 'does-not-exist',
    };
    await writeFile(activeContractPath, JSON.stringify(modifiedContract));

    const result = await runStatus(root, ['--budget']);
    assert.equal(result.budgetResult?.decision, 'HUMAN_REVIEW');
    assert.equal(result.budgetResult?.reasonCodes.includes('CBV-BASE-REVISION-UNKNOWN'), true);
    assert.equal(result.budgetResult?.violations[0]?.rule, 'max_files');
    assert.equal(result.budgetResult?.violations[0]?.reasonCode, 'CBV-BASE-REVISION-UNKNOWN');

    const stateAfter = await readFile(statePath, 'utf8');
    const activeContractAfter = await readJsonFile<{ base_revision: string }>(activeContractPath);
    const stateRecordAfter = await readLifecycleState(root);

    assert.equal(stateAfter, stateBefore);
    assert.equal(stateRecordAfter?.active_contract_id, activeContractId);
    assert.equal(activeContractAfter.base_revision, 'does-not-exist');
  } finally {
    await cleanupRoot(root);
  }
});

test('status --budget requires active contract for budget evaluation', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    const result = await runStatus(root, ['--budget']);
    assert.equal(result.budgetResult?.decision, 'HUMAN_REVIEW');
    assert.equal(result.budgetResult?.reasonCodes[0], 'CBV-INPUT-INVALID');
    assert.equal(result.budgetResult?.violations[0]?.reasonCode, 'CBV-INPUT-INVALID');
  } finally {
    await cleanupRoot(root);
  }
});

const CLI_PATH = join(process.cwd(), 'dist', 'src', 'cli', 'index.js');

const TASK_FIXTURE = {
  feature: '006-example-feature',
  sourcePath: 'specs/006-example-feature/tasks.md',
  id: 'T031',
  title: 'Implement the task bridge',
  taskLine: '- [ ] T031 Implement the task bridge\n',
  output: {
    id: 'T031',
    title: 'Implement the task bridge',
    source_feature: '006-example-feature',
    source_path: 'specs/006-example-feature/tasks.md',
  },
};

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function runGitStatusPorcelain(root: string): string {
  const result = spawnSync('git', ['status', '--porcelain=v1'], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git status --porcelain=v1 failed: ${result.stderr}`);
  }

  return result.stdout ?? '';
}

interface CliRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCliCommand(root: string, command: string, args: string[] = []): CliRunResult {
  const result = spawnSync(process.execPath, [CLI_PATH, command, ...args], {
    cwd: root,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function createTaskRepository(): Promise<string> {
  const root = await createRepositoryWithCommit();
  await mkdir(join(root, 'specs', TASK_FIXTURE.feature), { recursive: true });
  await writeFile(join(root, 'specs', TASK_FIXTURE.feature, 'tasks.md'), TASK_FIXTURE.taskLine);
  runGit(root, ['add', 'specs']);
  runGit(root, ['commit', '-m', 'seed specs']);
  return root;
}

test('T010-T012: check, status, and close propagate persisted task metadata', { concurrency: 1 }, async () => {
  const root = await createTaskRepository();

  try {
    await runInit(root);
    await runStart(root, ['T031', '--base-revision', 'HEAD']);

    const activeCheck = await runCheck(root);
    assert.equal(activeCheck.contractSource, 'active');
    assert.deepEqual(activeCheck.task, TASK_FIXTURE.output);

    const draftPath = join(root, 'task-draft.json');
    await writeFile(
      draftPath,
      JSON.stringify({
        schema_version: '1.0.0',
        id: 'draft-task',
        task_description: 'Draft task',
        task_id: 'T031',
        task_title: TASK_FIXTURE.title,
        task_source_feature: TASK_FIXTURE.feature,
        task_source_path: TASK_FIXTURE.sourcePath,
        base_revision: 'HEAD',
        allow_paths: ['src'],
        deny_paths: [],
        max_files: 10,
        max_changed_lines: 100,
        allow_new_files: true,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: true,
        allow_public_api_changes: false,
        preset: 'normal',
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    const draftCheck = await runCheck(root, ['--draft', draftPath]);
    assert.equal(draftCheck.contractSource, 'draft');
    assert.deepEqual(draftCheck.task, TASK_FIXTURE.output);

    const status = await runStatus(root);
    assert.equal(status.activeContract?.task_id, TASK_FIXTURE.id);
    assert.equal(status.activeContract?.task_title, TASK_FIXTURE.title);
    assert.equal(status.activeContract?.task_source_path, TASK_FIXTURE.sourcePath);

    const closeResult = await runClose(root);
    assert.equal(closeResult.contract.task_id, TASK_FIXTURE.id);
    assert.equal(closeResult.contract.task_title, TASK_FIXTURE.title);
    assert.equal(closeResult.contract.task_source_path, TASK_FIXTURE.sourcePath);

    const statusAfterClose = await runStatus(root);
    assert.equal(statusAfterClose.lastClosedContract?.task_id, TASK_FIXTURE.id);
    assert.equal(statusAfterClose.lastClosedContract?.task_source_path, TASK_FIXTURE.sourcePath);
  } finally {
    await cleanupRoot(root);
  }
});

test('T010-T012: task-free check, status, and close carry no task metadata', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    await runStart(root, ['--task', 'Legacy task', '--base-revision', 'HEAD']);

    const check = await runCheck(root);
    assert.equal(check.task, null);

    const status = await runStatus(root);
    assert.equal(status.activeContract?.task_id, null);
    assert.equal(status.activeContract?.task_source_path, null);

    const closeResult = await runClose(root);
    assert.equal(closeResult.contract.task_id, null);
    assert.equal(closeResult.contract.task_source_path, null);
  } finally {
    await cleanupRoot(root);
  }
});

test('T014: status/check/close read persisted metadata without re-resolving tasks.md', { concurrency: 1 }, async () => {
  const root = await createTaskRepository();

  try {
    await runInit(root);
    await runStart(root, ['T031', '--base-revision', 'HEAD']);

    const tasksMdPath = join(root, 'specs', TASK_FIXTURE.feature, 'tasks.md');
    const tasksMdBefore = await readFile(tasksMdPath, 'utf8');
    assert.equal(tasksMdBefore, TASK_FIXTURE.taskLine);
    const porcelainBefore = runGitStatusPorcelain(root);

    const status = await runStatus(root);
    const check = await runCheck(root);
    assert.equal(status.activeContract?.task_id, TASK_FIXTURE.id);
    assert.deepEqual(check.task, TASK_FIXTURE.output);

    assert.equal(await readFile(tasksMdPath, 'utf8'), tasksMdBefore);
    assert.equal(runGitStatusPorcelain(root), porcelainBefore);

    await rm(join(root, 'specs'), { recursive: true, force: true });

    const statusAfter = await runStatus(root);
    const checkAfter = await runCheck(root);
    assert.equal(statusAfter.activeContract?.task_id, TASK_FIXTURE.id);
    assert.deepEqual(checkAfter.task, TASK_FIXTURE.output);

    const closeResult = await runClose(root);
    assert.equal(closeResult.contract.task_id, TASK_FIXTURE.id);
    assert.equal(closeResult.contract.task_source_path, TASK_FIXTURE.sourcePath);
  } finally {
    await cleanupRoot(root);
  }
});

test('T013/T014: CLI renders task context for task-associated contracts', { concurrency: 1 }, async () => {
  const root = await createTaskRepository();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);
    const porcelainBefore = runGitStatusPorcelain(root);
    const start = runCliCommand(root, 'start', ['T031', '--base-revision', 'HEAD']);
    assert.equal(start.status, 0);

    const statusOut = runCliCommand(root, 'status').stdout;
    assert.equal(statusOut.includes(`Task: ${TASK_FIXTURE.id}\n`), true);
    assert.equal(statusOut.includes(`Source: ${TASK_FIXTURE.sourcePath}\n`), true);

    const checkOut = runCliCommand(root, 'check', ['--json']);
    const checkPayload = JSON.parse(checkOut.stdout) as { decision: string };
    assert.equal(checkPayload.decision, 'PASS');
    assert.deepEqual(Object.keys(checkPayload), ['comparisonMode', 'baselineState', 'decision', 'reasonCodes', 'excludedUnchangedCount', 'detectedDeltaCount']);

    const budgetOut = runCliCommand(root, 'status', ['--budget', '--json']);
    const budgetPayload = JSON.parse(budgetOut.stdout) as { decision: string };
    assert.equal(budgetPayload.decision, 'PASS');

    const closeOut = runCliCommand(root, 'close');
    assert.equal(
      closeOut.stdout.includes(`Contract closed.\nTask: ${TASK_FIXTURE.id}\nSource: ${TASK_FIXTURE.sourcePath}\n`),
      true,
    );

    const statusAfterClose = runCliCommand(root, 'status').stdout;
    assert.equal(statusAfterClose.includes('Last closed contract:'), true);
    assert.equal(statusAfterClose.includes(`Task: ${TASK_FIXTURE.id}\n`), true);
    assert.equal(statusAfterClose.includes(`Source: ${TASK_FIXTURE.sourcePath}\n`), true);

    assert.equal(runGitStatusPorcelain(root), porcelainBefore);
  } finally {
    await cleanupRoot(root);
  }
});

test('T013/T014: CLI preserves task-free base output byte-for-byte', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', ['--task', 'Legacy task', '--base-revision', 'HEAD']).status,
      0,
    );

    const statusOut = runCliCommand(root, 'status').stdout;
    assert.equal(statusOut.includes('Task: Legacy task\n'), true);
    assert.equal(statusOut.includes('Source:'), false);

    const checkOut = runCliCommand(root, 'check', ['--json']);
    const checkPayload = JSON.parse(checkOut.stdout) as Record<string, unknown>;
    assert.equal('task' in checkPayload, false);
    assert.deepEqual(Object.keys(checkPayload), ['comparisonMode', 'baselineState', 'decision', 'reasonCodes', 'excludedUnchangedCount', 'detectedDeltaCount']);

    const budgetOut = runCliCommand(root, 'status', ['--budget', '--json']);
    const budgetPayload = JSON.parse(budgetOut.stdout) as Record<string, unknown>;
    assert.deepEqual(Object.keys(budgetPayload), ['comparisonMode', 'baselineState', 'decision', 'reasonCodes', 'excludedUnchangedCount', 'detectedDeltaCount']);

    const closeOut = runCliCommand(root, 'close');
    assert.equal(closeOut.stdout, 'Contract closed.\n');

    const statusAfterClose = runCliCommand(root, 'status').stdout;
    assert.equal(statusAfterClose.includes('Last closed contract:'), true);
    assert.equal(statusAfterClose.includes('Source:'), false);
  } finally {
    await cleanupRoot(root);
  }
});

async function startAndGetActiveContractId(root: string): Promise<string> {
  assert.equal(runCliCommand(root, 'init').status, 0);
  assert.equal(runCliCommand(root, 'start', ['--task', 'classify', '--base-revision', 'HEAD']).status, 0);

  const statusOut = runCliCommand(root, 'status');
  const match = statusOut.stdout.match(/^Active contract:\s*(.+)$/m);
  assert.equal(match !== null, true);
  return match![1]!.trim();
}

test('T006: status, status --budget, and check classify a corrupt active contract identically', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    const contractId = await startAndGetActiveContractId(root);
    await writeFile(join(root, '.changebudget', 'contracts', `${contractId}.json`), '{ not-json', 'utf8');

    const status = runCliCommand(root, 'status');
    const statusBudget = runCliCommand(root, 'status', ['--budget']);
    const check = runCliCommand(root, 'check');

    for (const result of [status, statusBudget, check]) {
      assert.equal(result.status, 4, `exit code for ${result === status ? 'status' : result === statusBudget ? 'status --budget' : 'check'}`);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.includes('StateCorruptionError'), true);
    }

    assert.equal(statusBudget.stderr, status.stderr);
    assert.equal(check.stderr, status.stderr);
  } finally {
    await cleanupRoot(root);
  }
});

test('T006: status, status --budget, and check classify a missing active contract identically', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    const contractId = await startAndGetActiveContractId(root);
    await rm(join(root, '.changebudget', 'contracts', `${contractId}.json`), { force: true });

    const status = runCliCommand(root, 'status');
    const statusBudget = runCliCommand(root, 'status', ['--budget']);
    const check = runCliCommand(root, 'check');

    for (const result of [status, statusBudget, check]) {
      assert.equal(result.status, 4);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.includes('IOStateError'), true);
    }

    assert.equal(statusBudget.stderr, status.stderr);
    assert.equal(check.stderr, status.stderr);
  } finally {
    await cleanupRoot(root);
  }
});

test('T007: status surfaces a missing last-closed contract instead of silently ignoring it', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(runCliCommand(root, 'start', ['--task', 'close me', '--base-revision', 'HEAD']).status, 0);
    assert.equal(runCliCommand(root, 'close').status, 0);

    const state = JSON.parse(await readFile(join(root, '.changebudget', 'state.json'), 'utf8')) as {
      last_closed_contract_id: string;
    };
    assert.equal(typeof state.last_closed_contract_id, 'string');
    await rm(join(root, '.changebudget', 'contracts', `${state.last_closed_contract_id}.json`), { force: true });

    const status = runCliCommand(root, 'status');
    assert.equal(status.status, 4);
    assert.equal(status.stdout, '');
    assert.equal(status.stderr.includes('IOStateError'), true);
  } finally {
    await cleanupRoot(root);
  }
});

test('T007: status surfaces a corrupt last-closed contract instead of silently ignoring it', { concurrency: 1 }, async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(runCliCommand(root, 'start', ['--task', 'close me too', '--base-revision', 'HEAD']).status, 0);
    assert.equal(runCliCommand(root, 'close').status, 0);

    const state = JSON.parse(await readFile(join(root, '.changebudget', 'state.json'), 'utf8')) as {
      last_closed_contract_id: string;
    };
    const contractPath = join(root, '.changebudget', 'contracts', `${state.last_closed_contract_id}.json`);
    await writeFile(contractPath, '{ broken', 'utf8');

    const status = runCliCommand(root, 'status');
    assert.equal(status.status, 4);
    assert.equal(status.stdout, '');
    assert.equal(status.stderr.includes('StateCorruptionError'), true);
  } finally {
    await cleanupRoot(root);
  }
});
