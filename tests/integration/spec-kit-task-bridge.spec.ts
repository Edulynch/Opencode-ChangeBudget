import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm, readFile, mkdir, readdir } from 'node:fs/promises';
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

function createRepositoryWithCommit(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cb-bridge-')).then(async (root) => {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'bridge integration']);
    runGit(root, ['config', 'user.email', 'bridge@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    return root;
  });
}

async function createSpecsFixture(root: string, feature: string, content: string): Promise<void> {
  await mkdir(join(root, 'specs', feature), { recursive: true });
  await writeFile(join(root, 'specs', feature, 'tasks.md'), content);
}

async function createCommittedSpecsFixture(root: string, feature: string, content: string): Promise<void> {
  await createSpecsFixture(root, feature, content);
  runGit(root, ['add', 'specs']);
  runGit(root, ['commit', '-m', 'seed specs']);
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

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface TaskFixture {
  feature: string;
  sourcePath: string;
  id: string;
  title: string;
  output: {
    id: string;
    title: string;
    source_feature: string;
    source_path: string;
  };
}

const TASK_FIXTURE: TaskFixture = {
  feature: '006-example-feature',
  sourcePath: 'specs/006-example-feature/tasks.md',
  id: 'T031',
  title: 'Implement the task bridge',
  output: {
    id: 'T031',
    title: 'Implement the task bridge',
    source_feature: '006-example-feature',
    source_path: 'specs/006-example-feature/tasks.md',
  },
};

const TASK_LINE = `- [ ] ${TASK_FIXTURE.id} ${TASK_FIXTURE.title}\n`;

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

function runInit(repositoryRoot: string): CliResult {
  const result = runCliCommand(repositoryRoot, 'init');
  assert.equal(result.status, 0);
  return result;
}

function parseActiveContractIdFromStatus(stdout: string): string | null {
  const match = stdout.match(/^Active contract:\s*(.+)$/m);
  return match ? match[1]!.trim() : null;
}

async function readContractPreset(root: string, contractId: string): Promise<string | null> {
  const contract = JSON.parse(
    await readFile(join(root, '.changebudget', 'contracts', `${contractId}.json`), 'utf8'),
  ) as { preset: string | null };
  return contract.preset;
}

function activeContractIdFromStart(root: string, startStdout: string): string {
  const statusStdout = runCliCommand(root, 'status').stdout;
  const activeId = parseActiveContractIdFromStatus(statusStdout);
  if (activeId === null) {
    throw new Error(`no active contract after start (${startStdout})`);
  }
  return activeId;
}

test('T017: full task lifecycle retains identical task metadata end-to-end', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await createCommittedSpecsFixture(root, TASK_FIXTURE.feature, TASK_LINE);
    await runInit(root);

    const startResult = runCliCommand(root, 'start', ['T031', '--tiny', '--base-revision', 'HEAD']);
    assert.equal(startResult.status, 0);
    assert.equal(startResult.stdout.includes('Started new contract.'), true);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);
    assert.equal(statusResult.stdout.includes(`Task: ${TASK_FIXTURE.id}\n`), true);
    assert.equal(statusResult.stdout.includes(`Source: ${TASK_FIXTURE.sourcePath}\n`), true);

    const activeId = parseActiveContractIdFromStatus(statusResult.stdout);
    assert.equal(activeId !== null, true);

    const checkResult = runCliCommand(root, 'check', ['--json']);
    assert.equal(checkResult.status, 0);
    const checkPayload = JSON.parse(checkResult.stdout) as { decision: string };
    assert.equal(checkPayload.decision, 'PASS');

    const contract = JSON.parse(
      await readFile(join(root, '.changebudget', 'contracts', `${activeId}.json`), 'utf8'),
    ) as {
      task_id: string | null;
      task_title: string | null;
      task_source_feature: string | null;
      task_source_path: string | null;
      preset: string | null;
    };

    assert.equal(contract.task_id, TASK_FIXTURE.id);
    assert.equal(contract.task_title, TASK_FIXTURE.title);
    assert.equal(contract.task_source_feature, TASK_FIXTURE.feature);
    assert.equal(contract.task_source_path, TASK_FIXTURE.sourcePath);
    assert.equal(contract.preset, 'tiny');

    const closeResult = runCliCommand(root, 'close', ['--actor', 'quickstart', '--reason', 'r1']);
    assert.equal(closeResult.status, 0);
    assert.equal(
      closeResult.stdout.includes(`Contract closed.\nTask: ${TASK_FIXTURE.id}\nSource: ${TASK_FIXTURE.sourcePath}\n`),
      true,
    );

    const statusAfterClose = runCliCommand(root, 'status');
    assert.equal(statusAfterClose.status, 0);
    assert.equal(statusAfterClose.stdout.includes('Last closed contract:'), true);
    assert.equal(statusAfterClose.stdout.includes(`Task: ${TASK_FIXTURE.id}\n`), true);
    assert.equal(statusAfterClose.stdout.includes(`Source: ${TASK_FIXTURE.sourcePath}\n`), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T017: unknown and ambiguous task ids fail with stable errors and leave .changebudget byte-identical', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await createCommittedSpecsFixture(root, TASK_FIXTURE.feature, TASK_LINE);
    await runInit(root);

    const unknownBefore = await snapshotChangeBudget(root);
    const unknown = runCliCommand(root, 'start', ['T999', '--tiny', '--base-revision', 'HEAD']);
    assert.equal(unknown.status, 2);
    assert.equal(unknown.stderr.includes('InputValidationError'), true);
    assert.equal(unknown.stderr.includes('not found'), true);
    assert.equal(await snapshotChangeBudget(root), unknownBefore);

    await createSpecsFixture(root, '007-other', `- [ ] T031 Ambiguous duplicate\n`);
    const ambiguousBefore = await snapshotChangeBudget(root);
    const ambiguous = runCliCommand(root, 'start', ['T031', '--base-revision', 'HEAD']);
    assert.equal(ambiguous.status, 2);
    assert.equal(ambiguous.stderr.includes('InputValidationError'), true);
    assert.equal(ambiguous.stderr.includes('ambiguous'), true);
    assert.equal(ambiguous.stderr.includes(TASK_FIXTURE.sourcePath), true);
    assert.equal(ambiguous.stderr.includes('specs/007-other/tasks.md'), true);
    assert.equal(await snapshotChangeBudget(root), ambiguousBefore);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T017: task-based starts never modify tasks.md or the git working tree', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await createCommittedSpecsFixture(root, TASK_FIXTURE.feature, TASK_LINE);
    await runInit(root);

    const porcelainBefore = runGitStatusPorcelain(root);
    const tasksMdBefore = await readFile(join(root, 'specs', TASK_FIXTURE.feature, 'tasks.md'), 'utf8');

    const start = runCliCommand(root, 'start', ['T031', '--tiny', '--base-revision', 'HEAD']);
    assert.equal(start.status, 0);

    const porcelainAfter = runGitStatusPorcelain(root);
    const tasksMdAfter = await readFile(join(root, 'specs', TASK_FIXTURE.feature, 'tasks.md'), 'utf8');

    assert.equal(porcelainAfter, porcelainBefore);
    assert.equal(tasksMdAfter, tasksMdBefore);
    assert.equal(tasksMdAfter, TASK_LINE);
    assert.equal(tasksMdAfter.includes('- [ ] T031'), true);
    assert.equal(tasksMdAfter.includes('- [x] T031'), false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T017: budget default precedence works end-to-end through the CLI', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await createSpecsFixture(
      root,
      TASK_FIXTURE.feature,
      `- [ ] T031 [budget:tiny] Implement the task bridge\n- [ ] T032 [budget:custom] Custom budget\n`,
    );
    await runInit(root);

    const annotated = runCliCommand(root, 'start', ['T031', '--base-revision', 'HEAD']);
    assert.equal(annotated.status, 0);
    assert.equal(await readContractPreset(root, activeContractIdFromStart(root, annotated.stdout)), 'tiny');
    assert.equal(runCliCommand(root, 'close', ['--actor', 'quickstart', '--reason', 'r2']).status, 0);

    const override = runCliCommand(root, 'start', ['T031', '--normal', '--base-revision', 'HEAD']);
    assert.equal(override.status, 0);
    assert.equal(await readContractPreset(root, activeContractIdFromStart(root, override.stdout)), 'normal');
    assert.equal(runCliCommand(root, 'close', ['--actor', 'quickstart', '--reason', 'r3']).status, 0);

    const invalidBefore = await snapshotChangeBudget(root);
    const invalid = runCliCommand(root, 'start', ['T032', '--base-revision', 'HEAD']);
    assert.equal(invalid.status, 2);
    assert.equal(invalid.stderr.includes('InputValidationError'), true);
    assert.equal(invalid.stderr.includes('Invalid budget default value'), true);
    assert.equal(await snapshotChangeBudget(root), invalidBefore);

    const ignored = runCliCommand(root, 'start', ['T032', '--tiny', '--base-revision', 'HEAD']);
    assert.equal(ignored.status, 0);
    assert.equal(await readContractPreset(root, activeContractIdFromStart(root, ignored.stdout)), 'tiny');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T017: no-Spec-Kit repository runs the full lifecycle without task artifacts', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    const porcelainBefore = runGitStatusPorcelain(root);

    const start = runCliCommand(root, 'start', ['--task', 'manual task', '--base-revision', 'HEAD']);
    assert.equal(start.status, 0);
    assert.equal(start.stdout.includes('Started new contract.'), true);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);
    assert.equal(statusResult.stdout.includes('Task: manual task\n'), true);
    assert.equal(statusResult.stdout.includes('Source:'), false);

    const checkResult = runCliCommand(root, 'check', ['--json']);
    assert.equal(checkResult.status, 0);
    const checkPayload = JSON.parse(checkResult.stdout) as Record<string, unknown>;
    assert.equal('task' in checkPayload, false);

    const activeId = parseActiveContractIdFromStatus(statusResult.stdout);
    const contract = JSON.parse(
      await readFile(join(root, '.changebudget', 'contracts', `${activeId}.json`), 'utf8'),
    ) as {
      task_id: string | null;
      task_title: string | null;
      task_source_feature: string | null;
      task_source_path: string | null;
    };

    assert.equal(contract.task_id, null);
    assert.equal(contract.task_title, null);
    assert.equal(contract.task_source_feature, null);
    assert.equal(contract.task_source_path, null);

    const closeResult = runCliCommand(root, 'close', ['--actor', 'quickstart', '--reason', 'r5']);
    assert.equal(closeResult.status, 0);
    assert.equal(closeResult.stdout, 'Contract closed.\n');

    assert.equal(runGitStatusPorcelain(root), porcelainBefore);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
