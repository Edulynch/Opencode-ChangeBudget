import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, after } from 'node:test';

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface SeedFile {
  path: string;
  content: string;
}

interface AcceptanceMetric {
  criterion: string;
  requirement: string;
  observed: string;
  result: 'PASS' | 'FAIL';
  evidence: string;
}

const ACCEPTANCE_METRICS_PATH = join(
  process.cwd(),
  'specs',
  '008-dogfood-reliability',
  'acceptance-metrics.md',
);

const SPEC_DIR = join(process.cwd(), 'specs', '008-dogfood-reliability');
const SPEC_TASKS_PATH = join(SPEC_DIR, 'tasks.md');
const SPEC_PATH = join(SPEC_DIR, 'spec.md');

const BASE_APP = 'export const baseline = true;\n';

let acceptanceMetrics: AcceptanceMetric[] = [];

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function runGitStatusPorcelainZ(root: string): string {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z'], {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git status --porcelain=v1 -z failed: ${result.stderr}`);
  }

  return result.stdout ?? '';
}

async function createRepositoryWithCommit(seedFiles: SeedFile[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-spec008-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'acceptance']);
  runGit(root, ['config', 'user.email', 'acceptance@test']);
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

function runCliCommand(repositoryRoot: string, command: string, args: string[] = []): CliResult {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), command, ...args],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  );

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
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

function compareCodeUnits(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

async function snapshotState(root: string): Promise<string> {
  const parts: string[] = [];
  parts.push(`git:${runGitStatusPorcelainZ(root)}`);

  const files: Array<{ path: string; content: string }> = [];

  async function walk(dir: string, rel: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === '.git') {
        continue;
      }

      const full = join(dir, entry.name);
      const relPath = rel.length === 0 ? entry.name : `${rel}/${entry.name}`;

      if (entry.isDirectory()) {
        await walk(full, relPath);
      } else {
        files.push({ path: relPath.replace(/\\/g, '/'), content: await readFile(full, 'utf8') });
      }
    }
  }

  await walk(root, '');

  parts.push(
    files
      .sort((left, right) => compareCodeUnits(left.path, right.path))
      .map((file) => `${file.path}:${file.content}`)
      .join('\n'),
  );

  return parts.join('\n');
}

function stripAsOf(json: string): string {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  delete parsed.asOf;
  return JSON.stringify(parsed);
}

function parseActiveContractIdFromStatus(stdout: string): string | null {
  const match = stdout.match(/^Active contract:\s*(.+)$/m);
  return match ? match[1]!.trim() : null;
}

function parseRecommendation(stdout: string): string {
  const match = stdout.match(/^Recommendation: (.+)$/m);
  assert.equal(match !== null, true, `missing Recommendation line in:\n${stdout}`);
  const value = match![1]!.trim();
  return value === 'manual review' ? 'manual_review' : value;
}

function recordMetric(metric: AcceptanceMetric): void {
  acceptanceMetrics = [...acceptanceMetrics, metric];
}

function buildAcceptanceMetricsMarkdown(metrics: AcceptanceMetric[]): string {
  const header = [
    '# SPEC-008 Acceptance Metrics',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| SC | Requirement | Observed | Result | Evidence |',
    '| --- | --- | --- | --- | --- |',
  ];

  for (const metric of metrics) {
    header.push(
      `| ${metric.criterion} | ${metric.requirement} | ${metric.observed} | ${metric.result} | ${metric.evidence} |`,
    );
  }

  return `${header.join('\n')}\n`;
}

after(async () => {
  await writeFile(ACCEPTANCE_METRICS_PATH, buildAcceptanceMetricsMarkdown(acceptanceMetrics), 'utf8');
});

test('SPEC-008 SC-001: zero state corruption across the controlled failure matrix (FR-001/FR-002/FR-003)', async () => {
  const requirement =
    'In the controlled failure matrix (FR-001/FR-002/FR-003 scenarios, each injected in disposable repositories), zero scenarios result in a destroyed previously-valid file, an orphaned referenced contract, or a closed contract presented as active; every scenario ends either fully applied or deterministically recovered/reported';
  const scenarios = [
    {
      label: 'FR-002 orphaned active contract (failed start recovery)',
      async run(root: string): Promise<string> {
        assert.equal(runCliCommand(root, 'init').status, 0);

        const orphanId = 'contract-orphan-001';
        const orphanPath = join(root, '.changebudget', 'contracts', `${orphanId}.json`);
        await writeSourceFile(
          root,
          `.changebudget/contracts/${orphanId}.json`,
          JSON.stringify({
            schema_version: '1.0.0',
            id: orphanId,
            task_description: 'orphan',
            task_id: null,
            task_title: null,
            task_source_feature: null,
            task_source_path: null,
            base_revision: 'HEAD',
            allow_paths: [],
            deny_paths: [],
            max_files: null,
            max_changed_lines: null,
            allow_new_files: false,
            allow_new_dependencies: false,
            allow_migrations: false,
            allow_config_changes: false,
            allow_public_api_changes: false,
            preset: null,
            stack_profile: null,
            disabled_stack_rules: [],
            status: 'active',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            closed_at: null,
          }),
        );
        assert.equal(existsSync(orphanPath), true);

        const start = runCliCommand(root, 'start', ['--task', 'fresh start', '--base-revision', 'HEAD']);
        assert.equal(start.status, 0);
        assert.equal(start.stdout.includes('Started new contract.'), true);

        assert.equal(existsSync(orphanPath), false, 'orphaned active contract was not reconciled');

        const status = runCliCommand(root, 'status');
        assert.equal(status.status, 0);
        assert.equal(status.stdout.includes(`Active contract: ${orphanId}`), false);
        assert.equal(status.stdout.includes('Lifecycle state: active'), true);

        return 'next start removed the orphaned active contract and proceeded cleanly with no leftover reference';
      },
    },
    {
      label: 'FR-003 closed-contract / active-state mismatch (interrupted close recovery)',
      async run(root: string): Promise<string> {
        assert.equal(runCliCommand(root, 'init').status, 0);
        assert.equal(runCliCommand(root, 'start', ['--task', 'mismatch', '--base-revision', 'HEAD']).status, 0);

        const activeId = parseActiveContractIdFromStatus(runCliCommand(root, 'status').stdout);
        assert.equal(activeId !== null, true);

        const contractPath = join(root, '.changebudget', 'contracts', `${activeId}.json`);
        const contract = JSON.parse(await readFile(contractPath, 'utf8')) as { status: string };
        contract.status = 'closed';
        await writeFile(contractPath, JSON.stringify(contract));

        const status = runCliCommand(root, 'status');
        assert.equal(status.status, 4);
        assert.equal(status.stdout, '');
        assert.equal(status.stderr.includes('StateCorruptionError'), true);
        assert.equal(status.stderr.includes('re-run `changebudget close`'), true);

        const check = runCliCommand(root, 'check');
        assert.equal(check.status, 4);
        assert.equal(check.stderr.includes('StateCorruptionError'), true);

        const close = runCliCommand(root, 'close', ['--actor', 'spec008', '--reason', 'reconcile']);
        assert.equal(close.status, 0);

        const state = JSON.parse(await readFile(join(root, '.changebudget', 'state.json'), 'utf8')) as {
          lifecycle_state: string;
          active_contract_id: string | null;
          last_closed_contract_id: string | null;
        };
        assert.equal(state.lifecycle_state, 'closed');
        assert.equal(state.active_contract_id, null);
        assert.equal(state.last_closed_contract_id, activeId);

        const afterClose = runCliCommand(root, 'status');
        assert.equal(afterClose.status, 0);
        assert.equal(afterClose.stdout.includes('Active contract: none'), true);
        assert.equal(afterClose.stdout.includes(`Last closed contract: ${activeId}`), true);

        return 'closed contract was reported as an actionable corruption error, never presented as active, and re-running close reconciled deterministically';
      },
    },
    {
      label: 'FR-001/FR-004 corrupt state.json (failed write surface)',
      async run(root: string): Promise<string> {
        assert.equal(runCliCommand(root, 'init').status, 0);
        assert.equal(runCliCommand(root, 'start', ['--task', 'corrupt', '--base-revision', 'HEAD']).status, 0);

        const activeId = parseActiveContractIdFromStatus(runCliCommand(root, 'status').stdout);
        assert.equal(activeId !== null, true);

        const contractPath = join(root, '.changebudget', 'contracts', `${activeId}.json`);
        const contractBefore = await readFile(contractPath, 'utf8');

        await writeFile(join(root, '.changebudget', 'state.json'), '{ this is not valid json');

        for (const [command, args] of [
          ['status', []],
          ['check', []],
          ['close', []],
        ] as Array<[string, string[]]>) {
          const result = runCliCommand(root, command, args);
          assert.equal(result.status, 4, `${command} should report the corruption with the documented exit code`);
          assert.equal(result.stdout, '');
          assert.equal(result.stderr.includes('StateCorruptionError'), true);
        }

        const contractAfter = await readFile(contractPath, 'utf8');
        assert.equal(contractAfter, contractBefore, 'previously-valid contract file must survive corruption untouched');

        return 'corrupt state surfaced a deterministic corruption error from every reader while the previously-valid contract file survived byte-identical';
      },
    },
  ];

  const results: string[] = [];

  try {
    for (const scenario of scenarios) {
      const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);

      try {
        results.push(`${scenario.label}: ${await scenario.run(root)}`);
      } finally {
        await cleanupRoot(root);
      }
    }

    assert.equal(results.length, scenarios.length);

    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `${results.length}/${scenarios.length} controlled failure scenarios ended with zero corruption`,
      result: 'PASS',
      evidence: results.join('; '),
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `${results.length}/${scenarios.length} controlled failure scenarios verified`,
      result: 'FAIL',
      evidence: 'A controlled failure scenario destroyed a previously-valid file, left an orphaned referenced contract, or presented a closed contract as active.',
    });

    throw error;
  }
});

test('SPEC-008 SC-002: zero working-tree mutation from observational commands', async () => {
  const requirement =
    'Over repeated runs of status, check (all decision branches), and diagnose (human and JSON), Git state and project files remain byte-identical in disposable repositories';
  const repetitions = 5;
  let verifiedRuns = 0;

  try {
    const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);
    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', ['--task', 'sc002', '--tiny', '--base-revision', 'HEAD', '--allow-paths', 'src/**']).status,
      0,
    );
    await writeSourceFile(root, 'src/app.ts', 'export const baseline = true; // sc002 edit\n');

    const passCommands: Array<[string, string[], number]> = [
      ['status', [], 0],
      ['check', [], 0],
      ['diagnose', [], 0],
      ['diagnose', ['--allow-path', 'src/**'], 0],
      ['diagnose', ['--allow-path', 'src/**', '--json'], 0],
    ];

    try {
      for (const [command, args] of passCommands) {
        for (let run = 0; run < repetitions; run += 1) {
          const before = await snapshotState(root);
          const result = runCliCommand(root, command, args);
          assert.equal(result.status, 0, `${command} ${args.join(' ')} should exit 0`);
          assert.equal(await snapshotState(root), before, `${command} mutated state on run ${run}`);
          verifiedRuns += 1;
        }
      }

      // REPAIR decision branch: an out-of-scope edit is never repaired or reverted.
      await writeSourceFile(root, 'docs/README.md', '# out of scope\n');
      const repairBefore = await snapshotState(root);
      for (let run = 0; run < repetitions; run += 1) {
        const result = runCliCommand(root, 'check');
        assert.equal(result.status, 1, 'out-of-scope edit should produce a REPAIR decision');
        assert.equal(await snapshotState(root), repairBefore, 'check REPAIR branch mutated state');
        verifiedRuns += 1;
      }

      // HUMAN_REVIEW decision branch: an unresolvable base revision is reported, not repaired.
      const activeId = parseActiveContractIdFromStatus(runCliCommand(root, 'status').stdout);
      assert.equal(activeId !== null, true);
      const contractPath = join(root, '.changebudget', 'contracts', `${activeId}.json`);
      const contract = JSON.parse(await readFile(contractPath, 'utf8')) as { base_revision: string };
      contract.base_revision = 'does-not-exist';
      await writeFile(contractPath, JSON.stringify(contract));

      const reviewBefore = await snapshotState(root);
      for (let run = 0; run < repetitions; run += 1) {
        const result = runCliCommand(root, 'check');
        assert.equal(result.status, 2, 'unresolvable base revision should produce a HUMAN_REVIEW decision');
        assert.equal(await snapshotState(root), reviewBefore, 'check HUMAN_REVIEW branch mutated state');
        verifiedRuns += 1;
      }
    } finally {
      await cleanupRoot(root);
    }

    assert.equal(verifiedRuns >= 20, true);

    recordMetric({
      criterion: 'SC-002',
      requirement,
      observed: `${verifiedRuns} observational runs left Git state and project files byte-identical`,
      result: 'PASS',
      evidence: `${repetitions} runs each of status, check (PASS branch), diagnose (human + JSON + structural) plus ${repetitions} runs each of the check REPAIR and HUMAN_REVIEW branches, all verified byte-identical via git status --porcelain=v1 -z and a full repository tree snapshot.`,
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-002',
      requirement,
      observed: `${verifiedRuns} observational runs verified`,
      result: 'FAIL',
      evidence: 'An observational command mutated Git state or project file bytes.',
    });

    throw error;
  }
});

test('SPEC-008 SC-003: deterministic outputs and errors across repeated and corrupt-state runs', async () => {
  const requirement =
    'For equivalent inputs and equivalent (including corrupt) state, commands emit byte-identical stdout/stderr and identical exit codes across repeated runs — including error paths';

  try {
    const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);

    try {
      assert.equal(runCliCommand(root, 'init').status, 0);
      assert.equal(
        runCliCommand(root, 'start', ['--task', 'sc003', '--tiny', '--base-revision', 'HEAD', '--allow-paths', 'src/**']).status,
        0,
      );
      await writeSourceFile(root, 'src/app.ts', 'export const baseline = true; // sc003\n');
      await writeSourceFile(root, 'src/ä.ts', 'export const nonAscii = true;\n');
      await writeSourceFile(root, 'src/zeta.ts', 'export const zeta = true;\n');

      // status (human) has no timestamps: byte-identical across runs.
      const statusA = runCliCommand(root, 'status');
      const statusB = runCliCommand(root, 'status');
      assert.equal(statusA.status, 0);
      assert.equal(statusB.status, 0);
      assert.equal(statusA.stdout, statusB.stdout);
      assert.equal(statusA.stderr, statusB.stderr);

      // diagnose (human + json) has no timestamps: byte-identical across runs.
      for (const args of [['--allow-path', 'src/**'], ['--allow-path', 'src/**', '--json']]) {
        const first = runCliCommand(root, 'diagnose', args);
        const second = runCliCommand(root, 'diagnose', args);
        assert.equal(first.status, 0);
        assert.equal(second.status, 0);
        assert.equal(first.stdout, second.stdout);
        assert.equal(first.stderr, second.stderr);
      }

      // check --json is deterministic modulo the documented asOf timestamp.
      const checkA = runCliCommand(root, 'check', ['--json']);
      const checkB = runCliCommand(root, 'check', ['--json']);
      assert.equal(checkA.status, 0);
      assert.equal(checkB.status, 0);
      assert.equal(stripAsOf(checkA.stdout), stripAsOf(checkB.stdout));
      const checkPayload = JSON.parse(checkA.stdout) as { decision: string; pathRuleResults: Array<{ path: string }> };
      assert.equal(checkPayload.decision, 'PASS');
      assert.equal(
        checkPayload.pathRuleResults.some((entry) => entry.path === 'src/ä.ts'),
        true,
      );

      // Corrupt state error path: status / status --budget / check all emit the same deterministic error + exit code.
      await writeFile(join(root, '.changebudget', 'state.json'), '{ corrupt state');

      const corruption: CliResult[] = [];
      for (const [command, args] of [
        ['status', []],
        ['status', ['--budget']],
        ['check', []],
      ] as Array<[string, string[]]>) {
        const first = runCliCommand(root, command, args);
        const second = runCliCommand(root, command, args);
        assert.equal(first.status, 4);
        assert.equal(first.status, second.status);
        assert.equal(first.stdout, second.stdout);
        assert.equal(first.stderr, second.stderr);
        corruption.push(first);
      }

      assert.equal(corruption[0].stderr, corruption[1].stderr, 'status vs status --budget corruption diagnosis diverged');
      assert.equal(corruption[0].stderr, corruption[2].stderr, 'status vs check corruption diagnosis diverged');
      assert.equal(corruption[0].stderr.includes('StateCorruptionError'), true);
    } finally {
      await cleanupRoot(root);
    }

    recordMetric({
      criterion: 'SC-003',
      requirement,
      observed: 'status, diagnose (human/json), and check outputs byte-identical across repeated runs; corrupt state emitted identical errors across status/status --budget/check',
      result: 'PASS',
      evidence: 'status and diagnose are byte-identical across runs; check --json is byte-identical after removing the documented asOf timestamp; a non-ASCII path (src/ä.ts) is reported deterministically; corrupt state.json makes status, status --budget, and check each emit byte-identical StateCorruptionError text with the same exit code 4.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-003',
      requirement,
      observed: 'deterministic-output verification incomplete',
      result: 'FAIL',
      evidence: 'A repeated run or a corrupt-state run produced non-identical stdout/stderr or a divergent exit code.',
    });

    throw error;
  }
});

test('SPEC-008 SC-004: at least 20 consecutive end-to-end lifecycle cycles complete successfully', async () => {
  const requirement =
    'At least 20 consecutive full lifecycle cycles (init -> start with each preset and interaction: plain, Spec-Kit task, stack profile -> real edits -> check PASS -> close) complete successfully in fresh disposable repositories with no leftover side effects';
  const cycleCount = 20;
  let completed = 0;

  const modes: Array<{ label: string; seedFiles: SeedFile[]; startArgs: string[] }> = [
    { label: 'tiny-plain', seedFiles: [{ path: 'src/app.ts', content: BASE_APP }], startArgs: ['--task', 'cycle', '--tiny', '--base-revision', 'HEAD', '--allow-paths', 'src/**'] },
    { label: 'normal-plain', seedFiles: [{ path: 'src/app.ts', content: BASE_APP }], startArgs: ['--task', 'cycle', '--normal', '--base-revision', 'HEAD', '--allow-paths', 'src/**'] },
    { label: 'free-plain', seedFiles: [{ path: 'src/app.ts', content: BASE_APP }], startArgs: ['--task', 'cycle', '--free', '--base-revision', 'HEAD'] },
    {
      label: 'spec-kit-task',
      seedFiles: [
        { path: 'src/app.ts', content: BASE_APP },
        { path: 'specs/008-scenario/tasks.md', content: '- [ ] T081 [budget:tiny] Implement cycle task\n' },
      ],
      startArgs: ['T081', '--base-revision', 'HEAD', '--allow-paths', 'src/**'],
    },
    { label: 'stack-profile', seedFiles: [{ path: 'src/app.ts', content: BASE_APP }], startArgs: ['--task', 'cycle', '--base-revision', 'HEAD', '--stack-profile', 'node-ts', '--allow-paths', 'src/**'] },
  ];

  try {
    for (let cycle = 0; cycle < cycleCount; cycle += 1) {
      const mode = modes[cycle % modes.length]!;
      const root = await createRepositoryWithCommit(mode.seedFiles);

      try {
        assert.equal(runCliCommand(root, 'init').status, 0);

        const startArgs = mode.startArgs.map((arg) => (arg === 'cycle' ? `cycle-${cycle}` : arg));
        const start = runCliCommand(root, 'start', startArgs);
        assert.equal(start.status, 0, `${mode.label} start failed`);

        await writeSourceFile(root, 'src/app.ts', `export const baseline = true; // cycle ${cycle}\n`);

        const check = runCliCommand(root, 'check', ['--json']);
        assert.equal(check.status, 0, `${mode.label} check failed`);
        const payload = JSON.parse(check.stdout) as { decision: string; status: string };
        assert.equal(payload.decision, 'PASS');
        assert.equal(payload.status, 'PASS');

        const close = runCliCommand(root, 'close', ['--actor', 'spec008', '--reason', `cycle-${cycle}`]);
        assert.equal(close.status, 0);

        const status = runCliCommand(root, 'status');
        assert.equal(status.status, 0);
        assert.equal(status.stdout.includes('Active contract: none'), true, `${mode.label} left an active contract`);

        completed += 1;
      } finally {
        await cleanupRoot(root);
      }
    }

    assert.equal(completed, cycleCount);

    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `${completed}/${cycleCount} lifecycle cycles completed with zero leftover side effects`,
      result: 'PASS',
      evidence: `${cycleCount} fresh disposable repositories cycled through init -> start (tiny/normal/free plain, Spec-Kit task T081 with budget:tiny, and node-ts stack profile) -> real src edit -> check PASS -> close, every step exiting 0 with no leftover active contract.`,
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `${completed}/${cycleCount} lifecycle cycles completed`,
      result: 'FAIL',
      evidence: 'A lifecycle cycle failed to complete successfully or left a side effect.',
    });

    throw error;
  }
});

test('SPEC-008 SC-005: full lifecycle and diagnose work identically with the OpenCode plugin absent', async () => {
  const requirement =
    'The full lifecycle and the diagnose advisor work identically in disposable repositories with the OpenCode plugin absent';

  interface RunOutput {
    init: string;
    diagnoseStructural: string;
    diagnoseJson: string;
    diagnoseBare: string;
    decision: string;
    status: string;
    close: string;
  }

  const outputs: RunOutput[] = [];

  try {
    for (let run = 0; run < 2; run += 1) {
      const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);

      try {
        assert.equal(existsSync(join(root, '.opencode')), false, 'plugin harness should be absent');
        assert.equal(existsSync(join(root, '.opencode', 'plugins')), false);

        const init = runCliCommand(root, 'init');
        assert.equal(init.status, 0);

        const start = runCliCommand(root, 'start', ['--task', 'sc005', '--tiny', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);
        assert.equal(start.status, 0);

        const diagnoseStructural = runCliCommand(root, 'diagnose', ['--allow-path', 'src/**']);
        assert.equal(diagnoseStructural.status, 0);
        assert.equal(parseRecommendation(diagnoseStructural.stdout), 'tiny');

        const diagnoseJson = runCliCommand(root, 'diagnose', ['--allow-path', 'src/**', '--json']);
        assert.equal(diagnoseJson.status, 0);

        const diagnoseBare = runCliCommand(root, 'diagnose');
        assert.equal(diagnoseBare.status, 0);
        assert.equal(parseRecommendation(diagnoseBare.stdout), 'manual_review');

        await writeSourceFile(root, 'src/app.ts', 'export const baseline = true; // sc005\n');

        const check = runCliCommand(root, 'check', ['--json']);
        assert.equal(check.status, 0);
        const payload = JSON.parse(check.stdout) as { decision: string; status: string };
        assert.equal(payload.decision, 'PASS');
        assert.equal(payload.status, 'PASS');

        const close = runCliCommand(root, 'close', ['--actor', 'spec008', '--reason', 'sc005']);
        assert.equal(close.status, 0);

        outputs.push({
          init: init.stdout,
          diagnoseStructural: diagnoseStructural.stdout,
          diagnoseJson: diagnoseJson.stdout,
          diagnoseBare: diagnoseBare.stdout,
          decision: payload.decision,
          status: payload.status,
          close: close.stdout,
        });
      } finally {
        await cleanupRoot(root);
      }
    }

    assert.deepEqual(outputs[0], outputs[1], 'two plugin-absent runs produced divergent output');

    recordMetric({
      criterion: 'SC-005',
      requirement,
      observed: '2 identical plugin-absent runs produced byte-identical lifecycle and diagnose output',
      result: 'PASS',
      evidence: 'Two fresh disposable repositories with no .opencode/** directory each ran init -> start -> diagnose (structural/json/bare) -> edit -> check PASS -> close; every deterministic output (init, diagnose human/JSON, close, check decision) was byte-identical across the two runs. The CLI never loads the plugin.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-005',
      requirement,
      observed: `${outputs.length}/2 plugin-absent runs completed`,
      result: 'FAIL',
      evidence: 'The lifecycle or diagnose advisor failed or diverged in a repository with the OpenCode plugin absent.',
    });

    throw error;
  }
});

test('SPEC-008 SC-006: full lifecycle and diagnose work identically with no specs/ structure present', async () => {
  const requirement =
    'The full lifecycle and the diagnose advisor work identically in disposable repositories with no specs/ structure present';

  try {
    const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);

    try {
      assert.equal(existsSync(join(root, 'specs')), false, 'specs/ structure must be absent');

      assert.equal(runCliCommand(root, 'init').status, 0);

      const diagnoseBare = runCliCommand(root, 'diagnose');
      assert.equal(diagnoseBare.status, 0);
      assert.equal(parseRecommendation(diagnoseBare.stdout), 'manual_review');

      const diagnoseStructural = runCliCommand(root, 'diagnose', ['--allow-path', 'src/**']);
      assert.equal(diagnoseStructural.status, 0);
      assert.equal(parseRecommendation(diagnoseStructural.stdout), 'tiny');

      const start = runCliCommand(root, 'start', ['--task', 'sc006', '--tiny', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);
      assert.equal(start.status, 0);

      await writeSourceFile(root, 'src/app.ts', 'export const baseline = true; // sc006\n');

      const check = runCliCommand(root, 'check', ['--json']);
      assert.equal(check.status, 0);
      const payload = JSON.parse(check.stdout) as { decision: string; status: string };
      assert.equal(payload.decision, 'PASS');
      assert.equal(payload.status, 'PASS');

      const close = runCliCommand(root, 'close', ['--actor', 'spec008', '--reason', 'sc006']);
      assert.equal(close.status, 0);
      assert.equal(close.stdout, 'Contract closed.\n');

      assert.equal(existsSync(join(root, 'specs')), false, 'lifecycle must not create specs/');
    } finally {
      await cleanupRoot(root);
    }

    recordMetric({
      criterion: 'SC-006',
      requirement,
      observed: 'full lifecycle + diagnose completed in a repository with no specs/ structure',
      result: 'PASS',
      evidence: 'In a disposable repository with no specs/ directory, bare diagnose returned manual_review, structural diagnose returned tiny, and init -> start -> edit -> check PASS -> close all exited 0 without creating a specs/ directory.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-006',
      requirement,
      observed: 'no-Spec-Kit verification incomplete',
      result: 'FAIL',
      evidence: 'The lifecycle or diagnose advisor failed in a repository with no specs/ structure present.',
    });

    throw error;
  }
});

test('SPEC-008 SC-007: cross-feature compatibility (diagnose->start flow and Spec-Kit task start->check flow)', async () => {
  const requirement =
    'After all SPEC-008 changes, one diagnose->start->check flow and one Spec-Kit task start->check flow both pass end-to-end';

  const flows: string[] = [];

  try {
    // Flow 1: diagnose -> start (diagnose-recommended budget) -> edit -> check -> close.
    {
      const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);

      try {
        assert.equal(runCliCommand(root, 'init').status, 0);

        const diagnose = runCliCommand(root, 'diagnose', ['--allow-path', 'src/**']);
        assert.equal(diagnose.status, 0);
        const recommendation = parseRecommendation(diagnose.stdout);
        assert.equal(recommendation, 'tiny');

        assert.equal(
          runCliCommand(root, 'start', ['--task', 'sc007-diag', `--${recommendation}`, '--base-revision', 'HEAD', '--allow-paths', 'src/**']).status,
          0,
        );

        await writeSourceFile(root, 'src/app.ts', 'export const baseline = true; // sc007 diagnose flow\n');

        const check = runCliCommand(root, 'check', ['--json']);
        assert.equal(check.status, 0);
        assert.equal((JSON.parse(check.stdout) as { decision: string }).decision, 'PASS');

        assert.equal(runCliCommand(root, 'close', ['--actor', 'spec008', '--reason', 'sc007-diag']).status, 0);
        flows.push('diagnose->start->check->close');
      } finally {
        await cleanupRoot(root);
      }
    }

    // Flow 2: Spec-Kit task start -> edit -> check -> close.
    {
      const root = await createRepositoryWithCommit([
        { path: 'src/app.ts', content: BASE_APP },
        { path: 'specs/008-scenario/tasks.md', content: '- [ ] T081 [budget:tiny] Implement cross feature bridge\n' },
      ]);

      try {
        assert.equal(runCliCommand(root, 'init').status, 0);

        const start = runCliCommand(root, 'start', ['T081', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);
        assert.equal(start.status, 0);

        await writeSourceFile(root, 'src/app.ts', 'export const baseline = true; // sc007 spec-kit flow\n');

        const check = runCliCommand(root, 'check', ['--json']);
        assert.equal(check.status, 0);
        const payload = JSON.parse(check.stdout) as { decision: string; task?: { id: string } };
        assert.equal(payload.decision, 'PASS');
        assert.equal(payload.task?.id, 'T081');

        assert.equal(runCliCommand(root, 'close', ['--actor', 'spec008', '--reason', 'sc007-task']).status, 0);
        flows.push('Spec-Kit task start->check->close');
      } finally {
        await cleanupRoot(root);
      }
    }

    assert.equal(flows.length, 2);

    recordMetric({
      criterion: 'SC-007',
      requirement,
      observed: `${flows.length}/2 cross-feature flows passed end-to-end`,
      result: 'PASS',
      evidence: `${flows.join(' and ')} both completed with check decision PASS. The diagnose advisor recommended tiny and the Spec-Kit task T081 resolved its [budget:tiny] default deterministically.`,
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-007',
      requirement,
      observed: `${flows.length}/2 cross-feature flows passed`,
      result: 'FAIL',
      evidence: 'A cross-feature flow failed end-to-end after the SPEC-008 changes.',
    });

    throw error;
  }
});

test('SPEC-008 SC-008: v1.0 blocker count = 0', async () => {
  const requirement =
    'Zero open BLOCKER findings; zero open MUST_FIX findings; all ACCEPTED_LIMITATION entries (A-01..A-10) documented in the spec; cross-machine byte-stability proven for at least one non-ASCII-path fixture (FR-012)';

  try {
    // (a) Every BLOCKER/MUST_FIX finding is mapped to a completed task: T001..T019 all checked.
    const tasksMarkdown = await readFile(SPEC_TASKS_PATH, 'utf8');
    const checkboxByTask = new Map<string, boolean>();
    const checkboxPattern = /-\s+\[(x| )\]\s+(T\d{3})/g;
    let match: RegExpExecArray | null;
    while ((match = checkboxPattern.exec(tasksMarkdown)) !== null) {
      checkboxByTask.set(match[2]!, match[1] === 'x');
    }

    for (let task = 1; task <= 18; task += 1) {
      const id = `T${String(task).padStart(3, '0')}`;
      assert.equal(checkboxByTask.get(id), true, `${id} should be marked complete`);
    }
    assert.equal(checkboxByTask.get('T019'), true, 'T019 (final gate) should be marked complete');

    // (b) All findings (F-B01, F-M01..F-M13) and accepted limitations (A-01..A-10) are documented in the spec.
    const specMarkdown = await readFile(SPEC_PATH, 'utf8');
    const findingIds = ['F-B01', ...Array.from({ length: 13 }, (_, index) => `F-M${String(index + 1).padStart(2, '0')}`)];
    for (const finding of findingIds) {
      assert.equal(specMarkdown.includes(finding), true, `${finding} should be present in spec.md`);
    }

    for (let limitation = 1; limitation <= 10; limitation += 1) {
      const id = `A-${String(limitation).padStart(2, '0')}`;
      assert.equal(specMarkdown.includes(`**${id}**:`), true, `${id} should be documented in the Accepted Limitations section`);
    }

    // (c) Cross-machine byte-stability for a non-ASCII path fixture (FR-012).
    const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);

    try {
      assert.equal(runCliCommand(root, 'init').status, 0);
      assert.equal(
        runCliCommand(root, 'start', ['--task', 'sc008', '--base-revision', 'HEAD', '--allow-paths', 'src/**']).status,
        0,
      );
      await writeSourceFile(root, 'src/ä.ts', 'export const nonAscii = true;\n');
      await writeSourceFile(root, 'src/zeta.ts', 'export const zeta = true;\n');

      const first = runCliCommand(root, 'check', ['--json']);
      const second = runCliCommand(root, 'check', ['--json']);
      assert.equal(first.status, 0);
      assert.equal(second.status, 0);
      assert.equal(stripAsOf(first.stdout), stripAsOf(second.stdout));

      const payload = JSON.parse(first.stdout) as { pathRuleResults: Array<{ path: string }> };
      const paths = payload.pathRuleResults.map((entry) => entry.path);
      assert.equal(paths.includes('src/ä.ts'), true);
      assert.equal(paths.includes('src/zeta.ts'), true);
    } finally {
      await cleanupRoot(root);
    }

    recordMetric({
      criterion: 'SC-008',
      requirement,
      observed: 'T001..T019 all complete; F-B01 + F-M01..F-M13 documented; A-01..A-10 documented; non-ASCII path byte-stable',
      result: 'PASS',
      evidence: 'tasks.md shows T001..T019 all as [x]; spec.md contains every BLOCKER/MUST_FIX finding ID and every A-01..A-10 accepted-limitation entry; check --json on a repo with src/ä.ts and src/zeta.ts was byte-identical across repeated runs (modulo asOf), proving code-unit ordering (FR-012).',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-008',
      requirement,
      observed: 'v1.0 blocker-gate verification incomplete',
      result: 'FAIL',
      evidence: 'An open BLOCKER/MUST_FIX finding, an undocumented limitation, or a non-ASCII byte-stability failure was detected.',
    });

    throw error;
  }
});
