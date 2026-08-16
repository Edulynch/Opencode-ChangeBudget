import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function runGitStatus(root: string): string {
  const result = spawnSync('git', ['status', '--porcelain=v1'], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git status --porcelain=v1 failed: ${result.stderr}`);
  }

  return result.stdout ?? '';
}

function createRepositoryWithCommit(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cb-integration-')).then(async (root) => {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'integration']);
    runGit(root, ['config', 'user.email', 'integration@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    return root;
  });
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface CheckJsonResult {
  decision: 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';
  status: 'PASS' | 'FAIL';
  changedFileCount: number;
  changedLinesCount: number;
  binaryChangeCount: number;
  newFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  reasonCodes: string[];
  reason_codes: string[];
}

interface StatusBudgetJsonResult {
  lifecycleState: string;
  activeContractId: string | null;
  lastClosedContractId: string | null;
  budget: {
    decision: 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';
    reasonCodes: string[];
    reason_codes: string[];
    contractSource: 'active' | 'draft';
    contractId: string | null;
    baseRevision: string;
    status: 'PASS' | 'FAIL';
    changedFileCount: number;
    changedLinesCount: number;
    binaryChangeCount: number;
    newFileCount: number;
    deletedFileCount: number;
    renamedFileCount: number;
    limitResults: Array<{
      limitName: string;
      expected: number | null;
      observed: number;
      status: 'pass' | 'fail' | 'skip';
    }>;
    pathRuleResults: Array<{
      path: string;
      status: 'allow' | 'deny';
      matchedAllow: boolean;
      matchedDeny: boolean;
    }>;
    violations: Array<{ reasonCode?: string; reason_code?: string; severity?: 'repair' | 'review'; action?: 'repair' | 'review' }>; 
    asOf: string;
  };
}

function runCliCommand(repositoryRoot: string, command: string, args: string[] = []): CliResult {
  const result = spawnSync(process.execPath, [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), command, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function parseActiveContractIdFromStatus(stdout: string): string | null {
  const match = stdout.match(/^Active contract:\s*(.+)$/m);
  return match ? match[1]!.trim() : null;
}

function parseCheckBudgetJson(stdout: string): CheckJsonResult {
  return JSON.parse(stdout) as CheckJsonResult;
}

test('init, start, status, and check work through CLI flow', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const initResult = runCliCommand(root, 'init');
    assert.equal(initResult.status, 0);
    assert.equal(initResult.stdout.includes('Initialized ChangeBudget repository.'), true);

    const secondInit = runCliCommand(root, 'init');
    assert.equal(secondInit.status, 0);
    assert.equal(secondInit.stdout.includes('already initialized'), true);

    const startResult = runCliCommand(root, 'start', [
      '--task',
      'Integration start',
      '--base-revision',
      'HEAD',
      '--preset',
      'tiny',
    ]);
    assert.equal(startResult.status, 0);
    assert.equal(startResult.stdout.includes('Started new contract.'), true);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);
    const activeId = parseActiveContractIdFromStatus(statusResult.stdout);
    assert.equal(activeId !== null, true);

    const checkResult = runCliCommand(root, 'check');
    assert.equal(checkResult.status, 0);
    assert.equal(checkResult.stdout.includes('Status: PASS'), true);

    const draftPath = join(root, 'invalid-draft.json');
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
        allow_new_files: false,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: false,
        allow_public_api_changes: false,
        max_changed_lines: null,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    const draftCheckResult = runCliCommand(root, 'check', ['--draft', draftPath]);
    assert.equal(draftCheckResult.status, 2);
    assert.equal(draftCheckResult.stdout.includes('Decision: HUMAN_REVIEW'), true);
    assert.equal(draftCheckResult.stdout.includes('CBV-INPUT-INVALID'), true);
    assert.equal(draftCheckResult.stderr, '');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('start conflict and close safety are enforced through CLI', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const firstStart = runCliCommand(root, 'start', ['--task', 'first', '--base-revision', 'HEAD']);
    assert.equal(firstStart.status, 0);

    const secondStart = runCliCommand(root, 'start', ['--task', 'second', '--base-revision', 'HEAD']);
    assert.equal(secondStart.status, 3);
    assert.equal(secondStart.stderr.includes('StateConflictError'), true);

    const firstClose = runCliCommand(root, 'close', ['--actor', 'ci-bot', '--reason', 'done']);
    assert.equal(firstClose.status, 0);
    assert.equal(firstClose.stdout.includes('Contract closed.'), true);

    const closedStatus = runCliCommand(root, 'status');
    assert.equal(closedStatus.status, 0);
    assert.equal(closedStatus.stdout.includes('Active contract: none'), true);
    assert.equal(closedStatus.stdout.includes('Last closed contract:'), true);

    const secondClose = runCliCommand(root, 'close');
    assert.equal(secondClose.status, 3);
    assert.equal(secondClose.stderr.includes('StateConflictError'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check reports budget violations in output', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const startResult = runCliCommand(root, 'start', ['--task', 'budget', '--base-revision', 'HEAD', '--max-files', '1']);
    assert.equal(startResult.status, 0);

    await writeFile(join(root, 'first.txt'), 'first file\n');
    await writeFile(join(root, 'second.txt'), 'second file\n');

    const checkResult = runCliCommand(root, 'check');
    assert.equal(checkResult.status, 1);
    assert.equal(checkResult.stdout.includes('Status: FAIL'), true);
    assert.equal(checkResult.stdout.includes('max_files'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check in non-git directory reports environment error without creating state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-non-git-'));

  try {
    const checkResult = runCliCommand(root, 'check');

    assert.equal(checkResult.status, 4);
    assert.equal(checkResult.stdout, '');
    assert.equal(checkResult.stderr.includes('GitEnvironmentError'), true);
    assert.equal(checkResult.stderr.includes('Current directory is not a Git repository'), true);
    assert.equal(existsSync(join(root, '.changebudget')), false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check reports missing base revision with resolved context and no state mutation', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const startResult = runCliCommand(root, 'start', ['--task', 'Missing base revision', '--base-revision', 'HEAD']);
    assert.equal(startResult.status, 0);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);
    const activeContractId = parseActiveContractIdFromStatus(statusResult.stdout);
    assert.equal(activeContractId !== null, true);

    const statePath = join(root, '.changebudget', 'state.json');
    const contractPath = join(root, '.changebudget', 'contracts', `${activeContractId}.json`);

    const stateBefore = await readFile(statePath, 'utf8');
    const contractBefore = await readFile(contractPath, 'utf8');

    const invalidRevision = 'does-not-exist';
    const rewritten = JSON.parse(contractBefore) as { base_revision: string };
    rewritten.base_revision = invalidRevision;
    await writeFile(contractPath, JSON.stringify(rewritten));

    const checkResult = runCliCommand(root, 'check');
    assert.equal(checkResult.status, 2);
    assert.equal(checkResult.stdout.includes('Decision: HUMAN_REVIEW'), true);
    assert.equal(checkResult.stdout.includes('CBV-BASE-REVISION-UNKNOWN'), true);

    const stateAfter = await readFile(statePath, 'utf8');
    const contractAfter = JSON.parse(await readFile(contractPath, 'utf8')) as { base_revision: string };
    assert.equal(stateAfter, stateBefore);
    assert.equal(contractAfter.base_revision, invalidRevision);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check fails on malformed deny pattern without mutating state or index', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const startResult = runCliCommand(root, 'start', ['--task', 'Malformed pattern check', '--base-revision', 'HEAD']);
    assert.equal(startResult.status, 0);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);
    const activeContractId = parseActiveContractIdFromStatus(statusResult.stdout);
    assert.equal(activeContractId !== null, true);

    const statePath = join(root, '.changebudget', 'state.json');
    const contractPath = join(root, '.changebudget', 'contracts', `${activeContractId}.json`);

    const draftPath = join(root, 'invalid-pattern-contract.json');
    await writeFile(
      draftPath,
      JSON.stringify({
        schema_version: '1.0.0',
        id: 'bad-deny-pattern',
        task_description: 'Malformed deny pattern check',
        base_revision: 'HEAD',
        allow_paths: ['src/**'],
        deny_paths: ['src/[bad'],
        max_files: 3,
        max_changed_lines: 10,
        allow_new_files: true,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: true,
        allow_public_api_changes: false,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/example.ts'), 'const value = 1;\n');

    const statusBefore = runGitStatus(root);
    const stateBeforeAfterDraft = await readFile(statePath, 'utf8');
    const contractBeforeAfterDraft = await readFile(contractPath, 'utf8');

    const checkResult = runCliCommand(root, 'check', ['--draft', draftPath]);
    assert.equal(checkResult.status, 2);
    assert.equal(checkResult.stdout.includes('Decision: HUMAN_REVIEW'), true);
    assert.equal(checkResult.stdout.includes('CBV-RULE-CONFIG-INVALID'), true);
    assert.equal(checkResult.stdout.includes('Invalid path pattern'), true);
    assert.equal(checkResult.stderr, '');

    const statusAfter = runGitStatus(root);
    const stateAfter = await readFile(statePath, 'utf8');
    const contractAfter = await readFile(contractPath, 'utf8');

    assert.equal(statusAfter, statusBefore);
    assert.equal(stateAfter, stateBeforeAfterDraft);
    assert.equal(contractAfter, contractBeforeAfterDraft);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('status --budget --json mirrors check semantics and remains non-mutating', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Budget json',
        '--base-revision',
        'HEAD',
        '--max-files',
        '5',
        '--max-changed-lines',
        '100',
        '--allow-paths',
        'src/**',
      ]).status,
      0,
    );

    const statePath = join(root, '.changebudget', 'state.json');
    const stateBefore = await readFile(statePath, 'utf8');

    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'planned.ts'), 'export const planned = 1;\n');

    const checkResult = runCliCommand(root, 'check', ['--json']);
    assert.equal(checkResult.status, 0);
    const checkPayload = parseCheckBudgetJson(checkResult.stdout);
    assert.equal(typeof checkPayload.decision, 'string');

    const budgetResult = runCliCommand(root, 'status', ['--budget', '--json']);
    assert.equal(budgetResult.status, 0);

    const budgetStdout = budgetResult.stdout.trim();
    assert.equal(budgetStdout.startsWith('{'), true);
    assert.equal(budgetStdout.endsWith('}'), true);

    const budgetPayload = JSON.parse(budgetStdout) as StatusBudgetJsonResult;
    assert.equal(Array.isArray(budgetPayload.budget.reasonCodes), true);
    assert.equal(Array.isArray(budgetPayload.budget.reason_codes), true);
    assert.equal(Array.isArray(budgetPayload.budget.limitResults), true);
    assert.equal(Array.isArray(budgetPayload.budget.pathRuleResults), true);

    const lifecycleState = budgetPayload.lifecycleState;
    const activeContractId = budgetPayload.activeContractId;

    assert.equal(lifecycleState, 'active');
    assert.equal(typeof activeContractId, 'string');
    assert.equal(budgetPayload.budget.contractSource, 'active');

    assert.equal(typeof budgetPayload.budget.decision, 'string');
    assert.equal(budgetPayload.budget.decision, checkPayload.decision);
    assert.deepEqual(budgetPayload.budget.reasonCodes, checkPayload.reasonCodes);
    assert.deepEqual(budgetPayload.budget.reason_codes, checkPayload.reason_codes);

    assert.equal(budgetPayload.budget.changedFileCount, checkPayload.changedFileCount);
    assert.equal(budgetPayload.budget.changedLinesCount, checkPayload.changedLinesCount);
    assert.equal(budgetPayload.budget.binaryChangeCount, checkPayload.binaryChangeCount);
    assert.equal(budgetPayload.budget.newFileCount, checkPayload.newFileCount);
    assert.equal(budgetPayload.budget.deletedFileCount, checkPayload.deletedFileCount);
    assert.equal(budgetPayload.budget.renamedFileCount, checkPayload.renamedFileCount);
    assert.equal(budgetPayload.budget.status, checkPayload.status);
    assert.equal(typeof budgetPayload.budget.asOf, 'string');

    const stateAfter = await readFile(statePath, 'utf8');
    assert.equal(stateAfter, stateBefore);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
