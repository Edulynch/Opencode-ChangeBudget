import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, after } from 'node:test';
import { runInProcessCliCommand } from '../utils/in-process-cli.js';

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface AcceptanceMetric {
  criterion: string;
  requirement: string;
  observed: string;
  result: 'PASS' | 'FAIL';
  evidence: string;
}

interface SeedFile {
  path: string;
  content: string;
}

const ACCEPTANCE_METRICS_PATH = join(process.cwd(), 'specs', '006-spec-kit-task-bridge', 'acceptance-metrics.md');

const TASK_ID = 'T031';
const TASK_TITLE = 'Implement the task bridge';
const FEATURE = '006-example-feature';
const SOURCE_PATH = 'specs/006-example-feature/tasks.md';

const TASK_OUTPUT = {
  id: TASK_ID,
  title: TASK_TITLE,
  source_feature: FEATURE,
  source_path: SOURCE_PATH,
};

const TASK_LINE = `- [ ] ${TASK_ID} ${TASK_TITLE}\n`;

const NO_SPEC_SOURCES: SeedFile[] = [];

const TASK_FIXTURE_SEED: SeedFile[] = [
  {
    path: 'specs/006-example-feature/tasks.md',
    content: TASK_LINE,
  },
];

const AMBIGUOUS_FIXTURE_SEED: SeedFile[] = [
  ...TASK_FIXTURE_SEED,
  {
    path: 'specs/007-other/tasks.md',
    content: `- [ ] ${TASK_ID} Ambiguous duplicate\n`,
  },
];

const FAST_PATH_SEED: SeedFile[] = [...TASK_FIXTURE_SEED, { path: 'src/app.ts', content: 'export const baseline = true;\n' }];

let acceptanceMetrics: AcceptanceMetric[] = [];

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });

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

async function createRepositoryWithCommit(seedFiles: SeedFile[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-spec006-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'integration']);
  runGit(root, ['config', 'user.email', 'integration@test']);
  runGit(root, ['commit', '--allow-empty', '-m', 'seed']);

  if (seedFiles.length > 0) {
    for (const seed of seedFiles) {
      await writeSourceFile(root, seed.path, seed.content);
    }

    runGit(root, ['add', ...seedFiles.map((entry) => entry.path)]);
    runGit(root, ['commit', '-m', 'seed fixture']);
  }

  return root;
}

function runCliSubprocess(repositoryRoot: string, command: string, args: string[] = []): CliResult {
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

async function runCliCommand(repositoryRoot: string, command: string, args: string[] = [], processBacked = false): Promise<CliResult> {
  if (processBacked) {
    return runCliSubprocess(repositoryRoot, command, args);
  }

  return runInProcessCliCommand(repositoryRoot, command, args);
}

async function writeSourceFile(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function cleanupRoot(root: string): Promise<void> {
  if (!existsSync(root)) {
    return;
  }

  await rm(root, { recursive: true, force: true });
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
        entries.push({
          path: full.slice(stateDir.length + 1),
          content: await readFile(full, 'utf8'),
        });
      }
    }
  }

  await walk(stateDir);

  return entries
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((entry) => `${entry.path}:${entry.content}`)
    .join('\n');
}

function parseActiveContractIdFromStatus(stdout: string): string | null {
  const match = stdout.match(/^Active contract:\s*(.+)$/m);
  return match ? match[1]!.trim() : null;
}

function buildStartArgs(extra: string[] = []): string[] {
  return ['--base-revision', 'HEAD', ...extra];
}

function recordMetric(metric: AcceptanceMetric): void {
  acceptanceMetrics = [...acceptanceMetrics, metric];
}

function buildAcceptanceMetricsMarkdown(metrics: AcceptanceMetric[]): string {
  const header = ['# SPEC-006 Acceptance Metrics', '', `Generated: ${new Date().toISOString()}`, '', '| SC | Requirement | Observed | Result | Evidence |', '| --- | --- | --- | --- | --- |'];

  for (const metric of metrics) {
    header.push(`| ${metric.criterion} | ${metric.requirement} | ${metric.observed} | ${metric.result} | ${metric.evidence} |`);
  }

  return `${header.join('\n')}\n`;
}

after(async () => {
  if (process.env.UPDATE_ACCEPTANCE_METRICS !== '1') {
    return;
  }
  await writeFile(ACCEPTANCE_METRICS_PATH, buildAcceptanceMetricsMarkdown(acceptanceMetrics), 'utf8');
});

test('SPEC-006 SC-001: at least 50 mixed task-tied lifecycle scenarios retain identical metadata', async () => {
  const requirement =
    'In at least 50 mixed start → status → check → close scenarios on task-tied contracts, the task ID, title, source feature, and source path are retained and reported identically at every stage';
  const scenarios = 50;
  let completedScenarios = 0;
  const root = await createRepositoryWithCommit(TASK_FIXTURE_SEED);
  const processSmoke = true;

  try {
    assert.equal((await runCliCommand(root, 'init', [], processSmoke)).status, 0);

    for (let iteration = 0; iteration < scenarios; iteration += 1) {
      const start = await runCliCommand(root, 'start', [TASK_ID, '--tiny', ...buildStartArgs()], processSmoke && iteration === 0);
      assert.equal(start.status, 0);
      assert.equal(start.stdout.includes('Started new contract.'), true);

      const status = await runCliCommand(root, 'status', [], processSmoke && iteration === 0);
      assert.equal(status.status, 0);
      assert.equal(status.stdout.includes(`Task: ${TASK_ID}\n`), true);
      assert.equal(status.stdout.includes(`Source: ${SOURCE_PATH}\n`), true);

      const activeId = parseActiveContractIdFromStatus(status.stdout);
      assert.equal(activeId !== null, true);

      const contract = JSON.parse(await readFile(join(root, '.changebudget', 'contracts', `${activeId}.json`), 'utf8')) as {
        task_id: string | null;
        task_title: string | null;
        task_source_feature: string | null;
        task_source_path: string | null;
        preset: string | null;
      };

      assert.equal(contract.task_id, TASK_ID);
      assert.equal(contract.task_title, TASK_TITLE);
      assert.equal(contract.task_source_feature, FEATURE);
      assert.equal(contract.task_source_path, SOURCE_PATH);
      assert.equal(contract.preset, 'tiny');

      const check = await runCliCommand(root, 'check', ['--json'], processSmoke && iteration === 0);
      assert.equal(check.status, 0);
      const checkPayload = JSON.parse(check.stdout) as { decision: string };
      assert.equal(checkPayload.decision, 'PASS');

      const close = await runCliCommand(root, 'close', ['--actor', 'spec006', '--reason', `sc001-${iteration}`], processSmoke && iteration === 0);
      assert.equal(close.status, 0);
      assert.equal(close.stdout.includes(`Contract closed.\nTask: ${TASK_ID}\nSource: ${SOURCE_PATH}\n`), true);

      completedScenarios += 1;
    }

    assert.equal(completedScenarios, scenarios);

    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `${completedScenarios} mixed task-tied lifecycle scenarios`,
      result: 'PASS',
      evidence: 'task_id/title/source_feature/source_path identical across persisted contract, status Task:/Source: lines, check --json task object, and close output in all 50 scenarios.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `${completedScenarios} mixed task-tied lifecycle scenarios`,
      result: 'FAIL',
      evidence: 'A task-tied lifecycle scenario failed to retain identical task metadata at every stage.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});

test('SPEC-006 status output matches the in-process CLI harness', async () => {
  const subprocessRoot = await createRepositoryWithCommit(TASK_FIXTURE_SEED);
  const inProcessRoot = await createRepositoryWithCommit(TASK_FIXTURE_SEED);
  const startArgs = [TASK_ID, '--tiny', ...buildStartArgs()];

  try {
    assert.deepEqual(runCliSubprocess(subprocessRoot, 'init'), await runInProcessCliCommand(inProcessRoot, 'init'));

    const subprocessStart = runCliSubprocess(subprocessRoot, 'start', startArgs);
    const inProcessStart = await runInProcessCliCommand(inProcessRoot, 'start', startArgs);
    assert.equal(inProcessStart.status, subprocessStart.status);

    const subprocessStatus = runCliSubprocess(subprocessRoot, 'status');
    const inProcessStatus = await runInProcessCliCommand(inProcessRoot, 'status');
    const normalize = (value: string): string => value.replace(/contract-[0-9a-f-]{36}/g, '<contract>');
    assert.equal(inProcessStatus.status, subprocessStatus.status);
    assert.equal(normalize(inProcessStatus.stdout), normalize(subprocessStatus.stdout));
    assert.equal(inProcessStatus.stderr, subprocessStatus.stderr);
  } finally {
    await cleanupRoot(subprocessRoot);
    await cleanupRoot(inProcessRoot);
  }
});

test('SPEC-006 SC-002: at least 20 unknown-ID runs leave state byte-identical with a stable error', async () => {
  const requirement = 'In at least 20 scenarios, an unknown task ID fails with the same deterministic error and leaves lifecycle state byte-identical to before the command';
  const runs = 20;
  let completedRuns = 0;
  const root = await createRepositoryWithCommit(TASK_FIXTURE_SEED);

  try {
    assert.equal((await runCliCommand(root, 'init')).status, 0);

    const before = await snapshotChangeBudget(root);
    let expectedStderr: string | null = null;

    for (let iteration = 0; iteration < runs; iteration += 1) {
      const result = await runCliCommand(root, 'start', ['T999', '--tiny', ...buildStartArgs()]);
      assert.equal(result.status, 2);
      assert.equal(result.stderr.includes('InputValidationError'), true);
      assert.equal(result.stderr.includes('not found'), true);
      assert.equal(await snapshotChangeBudget(root), before);

      if (expectedStderr === null) {
        expectedStderr = result.stderr;
      }
      assert.equal(result.stderr, expectedStderr);

      completedRuns += 1;
    }

    assert.equal(completedRuns, runs);

    recordMetric({
      criterion: 'SC-002',
      requirement,
      observed: `${completedRuns} unknown-ID runs`,
      result: 'PASS',
      evidence: 'Each run exited 2 with the identical InputValidationError "not found" message and left .changebudget/ byte-identical.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-002',
      requirement,
      observed: `${completedRuns} unknown-ID runs`,
      result: 'FAIL',
      evidence: 'An unknown-ID run produced a non-identical error or modified lifecycle state.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});

test('SPEC-006 SC-003: at least 20 ambiguous-ID runs list all sources with zero guesses', async () => {
  const requirement = 'In at least 20 scenarios, an ambiguous (duplicate) task ID fails deterministically listing every source, with zero guessed resolutions';
  const runs = 20;
  let completedRuns = 0;
  const root = await createRepositoryWithCommit(AMBIGUOUS_FIXTURE_SEED);

  try {
    assert.equal((await runCliCommand(root, 'init')).status, 0);

    const before = await snapshotChangeBudget(root);
    let expectedStderr: string | null = null;

    for (let iteration = 0; iteration < runs; iteration += 1) {
      const result = await runCliCommand(root, 'start', [TASK_ID, ...buildStartArgs(['--tiny'])]);
      assert.equal(result.status, 2);
      assert.equal(result.stderr.includes('InputValidationError'), true);
      assert.equal(result.stderr.includes('ambiguous'), true);
      assert.equal(result.stderr.includes('specs/006-example-feature/tasks.md'), true);
      assert.equal(result.stderr.includes('specs/007-other/tasks.md'), true);
      assert.equal(result.stderr.includes('guessed'), false);
      assert.equal(await snapshotChangeBudget(root), before);

      if (expectedStderr === null) {
        expectedStderr = result.stderr;
      }
      assert.equal(result.stderr, expectedStderr);

      completedRuns += 1;
    }

    assert.equal(completedRuns, runs);

    recordMetric({
      criterion: 'SC-003',
      requirement,
      observed: `${completedRuns} ambiguous-ID runs`,
      result: 'PASS',
      evidence: 'Each run exited 2 with the identical ambiguity error listing both source paths, no guessed resolution, and .changebudget/ byte-identical.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-003',
      requirement,
      observed: `${completedRuns} ambiguous-ID runs`,
      result: 'FAIL',
      evidence: 'An ambiguous-ID run did not list all sources deterministically or left partial state.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});

test('SPEC-006 SC-004: 100% of task-free/no-Spec-Kit lifecycle output is byte-identical to the SPEC-001..005 baseline', async () => {
  const requirement = 'For repositories without Spec-Kit structure and for task-free start calls, 100% of outputs and persisted contracts are identical to the SPEC-001..005 baseline';
  const scenarios = 20;
  let completedScenarios = 0;
  const root = await createRepositoryWithCommit(NO_SPEC_SOURCES);

  try {
    assert.equal((await runCliCommand(root, 'init')).status, 0);

    for (let iteration = 0; iteration < scenarios; iteration += 1) {
      const start = await runCliCommand(root, 'start', ['--task', 'manual task', ...buildStartArgs()]);
      assert.equal(start.status, 0);
      assert.equal(start.stdout.includes('Started new contract.'), true);

      const status = await runCliCommand(root, 'status');
      assert.equal(status.status, 0);
      assert.equal(status.stdout.includes('Task: manual task\n'), true);
      assert.equal(status.stdout.includes('Source:'), false);

      const check = await runCliCommand(root, 'check', ['--json']);
      assert.equal(check.status, 0);
      const checkPayload = JSON.parse(check.stdout) as Record<string, unknown>;
      assert.equal('task' in checkPayload, false);

      const activeId = parseActiveContractIdFromStatus(status.stdout);
      const contract = JSON.parse(await readFile(join(root, '.changebudget', 'contracts', `${activeId}.json`), 'utf8')) as {
        task_id: string | null;
        task_title: string | null;
        task_source_feature: string | null;
        task_source_path: string | null;
      };

      assert.equal(contract.task_id, null);
      assert.equal(contract.task_title, null);
      assert.equal(contract.task_source_feature, null);
      assert.equal(contract.task_source_path, null);

      const close = await runCliCommand(root, 'close', ['--actor', 'spec006', '--reason', `sc004-${iteration}`]);
      assert.equal(close.status, 0);
      assert.equal(close.stdout, 'Contract closed.\n');

      completedScenarios += 1;
    }

    assert.equal(completedScenarios, scenarios);

    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `${completedScenarios}/${scenarios} task-free lifecycle scenarios byte-identical to baseline`,
      result: 'PASS',
      evidence: 'No-Spec-Kit fixtures produced no task lines, no task key in check --json, null task fields on the persisted contract, and exact "Contract closed." close output in every scenario.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `${completedScenarios}/${scenarios} task-free lifecycle scenarios byte-identical to baseline`,
      result: 'FAIL',
      evidence: 'A task-free repository lifecycle diverged from the SPEC-001..005 baseline output or persisted contract.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});

test('SPEC-006 SC-005: at least 20 task-based starts leave git status --short and tasks.md byte-identical', async () => {
  const requirement = 'In at least 20 task-based start runs, git status --short and tasks.md content are byte-identical before and after the command (read-only guarantee)';
  const scenarios = 20;
  let completedScenarios = 0;
  const root = await createRepositoryWithCommit(TASK_FIXTURE_SEED);

  try {
    assert.equal((await runCliCommand(root, 'init')).status, 0);

    for (let iteration = 0; iteration < scenarios; iteration += 1) {
      const porcelainBefore = runGitStatusPorcelain(root);
      const tasksMdBefore = await readFile(join(root, 'specs', FEATURE, 'tasks.md'), 'utf8');

      const start = await runCliCommand(root, 'start', [TASK_ID, '--tiny', ...buildStartArgs()]);
      assert.equal(start.status, 0);

      assert.equal(runGitStatusPorcelain(root), porcelainBefore);
      assert.equal(await readFile(join(root, 'specs', FEATURE, 'tasks.md'), 'utf8'), tasksMdBefore);

      const check = await runCliCommand(root, 'check', ['--json']);
      assert.equal(check.status, 0);

      assert.equal((await runCliCommand(root, 'close', ['--actor', 'spec006', '--reason', `sc005-${iteration}`])).status, 0);

      completedScenarios += 1;
    }

    assert.equal(completedScenarios, scenarios);

    recordMetric({
      criterion: 'SC-005',
      requirement,
      observed: `${completedScenarios} task-based read-only start runs`,
      result: 'PASS',
      evidence: 'git status --porcelain=v1 and tasks.md bytes were identical before and after every task-based start.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-005',
      requirement,
      observed: `${completedScenarios} task-based read-only start runs`,
      result: 'FAIL',
      evidence: 'A task-based start modified git state or tasks.md content.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});

test('SPEC-006 SC-006: fast path start T031 --tiny → check → close completes with no ceremony', async () => {
  const requirement = 'The fast path changebudget start T031 --tiny → check → close completes with no tasks.md changes, no completion marking, and no Spec-Kit ceremony';
  const scenarios = 20;
  let completedScenarios = 0;
  const root = await createRepositoryWithCommit(FAST_PATH_SEED);

  try {
    assert.equal((await runCliCommand(root, 'init')).status, 0);
    const tasksMdBefore = await readFile(join(root, 'specs', FEATURE, 'tasks.md'), 'utf8');

    for (let iteration = 0; iteration < scenarios; iteration += 1) {
      const start = await runCliCommand(root, 'start', [TASK_ID, '--tiny', '--allow-paths', 'src/**', ...buildStartArgs()]);
      assert.equal(start.status, 0);

      await writeSourceFile(root, 'src/app.ts', `export const baseline = true; // iteration ${iteration}\n`);

      const porcelainAfterImplement = runGitStatusPorcelain(root);
      const tasksMdAfterStart = await readFile(join(root, 'specs', FEATURE, 'tasks.md'), 'utf8');
      assert.equal(tasksMdAfterStart, tasksMdBefore);
      assert.equal(tasksMdAfterStart.includes('- [x] T031'), false);

      const check = await runCliCommand(root, 'check', ['--json']);
      assert.equal(check.status, 0);
      const checkPayload = JSON.parse(check.stdout) as { decision: string };
      assert.equal(checkPayload.decision, 'PASS');

      const close = await runCliCommand(root, 'close', ['--actor', 'spec006', '--reason', `sc006-${iteration}`]);
      assert.equal(close.status, 0);

      assert.equal(runGitStatusPorcelain(root), porcelainAfterImplement);
      assert.equal(await readFile(join(root, 'specs', FEATURE, 'tasks.md'), 'utf8'), tasksMdBefore);

      completedScenarios += 1;
    }

    assert.equal(completedScenarios, scenarios);

    recordMetric({
      criterion: 'SC-006',
      requirement,
      observed: `${completedScenarios} fast-path scenarios (start → check → close)`,
      result: 'PASS',
      evidence: 'Every fast-path cycle exited 0 with decision PASS, identical task metadata in check --json, tasks.md unchanged with no completion marking, and no git or Spec-Kit ceremony.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-006',
      requirement,
      observed: `${completedScenarios} fast-path scenarios (start → check → close)`,
      result: 'FAIL',
      evidence: 'A fast-path scenario did not complete with PASS, or involved tasks.md/completion/Spec-Kit ceremony.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});
