import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
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
    assert.equal(checkResult.stdout.includes('Contract validation succeeded.'), true);

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
    assert.equal(draftCheckResult.stderr.includes('InputValidationError'), true);
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
