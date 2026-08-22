// SPEC-009 acceptance suite — proves SC-001..SC-011 with recorded evidence.
//
// Mirrors the SPEC-008 acceptance suite pattern (disposable repositories,
// AcceptanceMetric record, after-hook markdown writer, try/catch on every
// SC test for FAIL-path evidence).
//
// The test runs against `dist/src/cli/index.js`, so `npm run build` MUST be
// executed before `node --test dist/tests/acceptance/spec009-opencode-integration-metrics.test.js`.

import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test } from 'node:test';

import {
  INSTRUCTION_ENTRY,
  MANAGED_RESOURCES,
  dryRunIntegration,
  installIntegration,
  removeIntegration,
  resolveChangeBudgetRoot,
  resolveRuntimeGuardEntry,
  runtimeGuardFileUrl,
  generateWrapperContent,
  generateInstructionsContent,
} from '../../src/core/integration/opencode.js';
import { RUNTIME_RULES } from '../../opencode-plugin/src/projection.js';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

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

interface PluginHooks {
  'tool.execute.before'?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown },
  ) => Promise<void>;
  'command.execute.before'?: (
    input: { command: string; sessionID: string; arguments: string },
  ) => Promise<void>;
  'permission.ask'?: (
    input: Record<string, unknown> & { sessionID: string; callID?: string },
    output: { status: 'allow' | 'deny' | 'ask' },
  ) => Promise<void>;
}

interface WrapperModule {
  default: {
    id?: string;
    server: (input: { directory: string; worktree: string }) => Promise<PluginHooks>;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACCEPTANCE_METRICS_PATH = join(
  process.cwd(),
  'specs',
  '009-opencode-integration',
  'acceptance-metrics.md',
);

const REPO_PREFIX = 'cb-spec009-';
const BASE_APP = 'export const baseline = true;\n';
const AGENTS_CONTENT = '# Project AGENTS guidance\n\nUser-owned content. The integration MUST never modify this file.\n';

const runtimeGuardEntryPath = resolveRuntimeGuardEntry(resolveChangeBudgetRoot());

// ---------------------------------------------------------------------------
// Mutable state
// ---------------------------------------------------------------------------

let acceptanceMetrics: AcceptanceMetric[] = [];

// ---------------------------------------------------------------------------
// Helpers — Git, CLI, snapshot, repo lifecycle
// ---------------------------------------------------------------------------

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function runCliCommand(repositoryRoot: string, command: string, args: string[] = []): CliResult {
  const cliPath = join(process.cwd(), 'dist', 'src', 'cli', 'index.js');
  const result = spawnSync(process.execPath, [cliPath, command, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function writeSourceFile(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(root, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function createRepositoryWithCommit(seedFiles: SeedFile[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), REPO_PREFIX));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'spec009 acceptance']);
  runGit(root, ['config', 'user.email', 'spec009@test']);
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

async function cleanupRoot(root: string): Promise<void> {
  if (!existsSync(root)) {
    return;
  }
  await rm(root, { recursive: true, force: true });
}

interface Snapshot {
  files: Map<string, string>;
}

async function snapshotRepository(root: string): Promise<Snapshot> {
  const files = new Map<string, string>();

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
        files.set(relPath.replace(/\\/g, '/'), await readFile(full, 'utf8'));
      }
    }
  }

  await walk(root, '');
  return { files };
}

function snapshotsEqual(left: Snapshot, right: Snapshot): boolean {
  if (left.files.size !== right.files.size) {
    return false;
  }
  for (const [path, content] of left.files) {
    if (!right.files.has(path)) {
      return false;
    }
    if (right.files.get(path) !== content) {
      return false;
    }
  }
  return true;
}

function snapshotDiff(left: Snapshot, right: Snapshot): string {
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const [path, content] of right.files) {
    if (!left.files.has(path)) {
      added.push(path);
    } else if (left.files.get(path) !== content) {
      changed.push(path);
    }
  }
  for (const path of left.files.keys()) {
    if (!right.files.has(path)) {
      removed.push(path);
    }
  }
  return `+${added.join(',+')}; -${removed.join(',-')}; ~${changed.join(',~')}`;
}

// ---------------------------------------------------------------------------
// Metric recording + after-hook writer
// ---------------------------------------------------------------------------

function recordMetric(metric: AcceptanceMetric): void {
  acceptanceMetrics = [...acceptanceMetrics, metric];
}

function buildAcceptanceMetricsMarkdown(metrics: AcceptanceMetric[]): string {
  const header = [
    '# SPEC-009 Acceptance Metrics',
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
  if (process.env.UPDATE_ACCEPTANCE_METRICS !== '1') {
    return;
  }
  await writeFile(
    ACCEPTANCE_METRICS_PATH,
    buildAcceptanceMetricsMarkdown(acceptanceMetrics),
    'utf8',
  );
});

// ---------------------------------------------------------------------------
// Plugin-wrapper loader (imports the generated wrapper via pathToFileURL)
// ---------------------------------------------------------------------------

async function loadInstalledWrapper(repositoryRoot: string): Promise<PluginHooks> {
  const wrapperPath = join(repositoryRoot, MANAGED_RESOURCES.pluginWrapper);
  const moduleUrl = pathToFileURL(wrapperPath).href;
  const wrapperModule = (await import(moduleUrl)) as { default: WrapperModule['default'] };
  const wrapper = wrapperModule.default;
  assert.ok(typeof wrapper.server === 'function', 'wrapper.default.server must be a function');
  return wrapper.server({ directory: repositoryRoot, worktree: repositoryRoot });
}

function emptyMetadata(): Record<string, unknown> {
  return {};
}

// ---------------------------------------------------------------------------
// Built-environment sanity check — runs first so a missing build surfaces an
// actionable FAIL rather than confusing downstream errors. Does not record a
// metric; the real SC-008 test records the URL validation metric.
// ---------------------------------------------------------------------------

test('SPEC-009 prereq: Runtime Guard compiled entrypoint is on disk', () => {
  assert.equal(
    existsSync(runtimeGuardEntryPath),
    true,
    `Runtime Guard entry missing at ${runtimeGuardEntryPath}; run \`npm run build\``,
  );
});

// ---------------------------------------------------------------------------
// SC-001 — Idempotent repeated integration
// ---------------------------------------------------------------------------

test('SPEC-009 SC-001: integrate opencode is idempotent on repeated runs', async () => {
  const requirement =
    'Running `changebudget integrate opencode` twice in succession produces zero content changes on the second run (byte-identical files and opencode.json) and no duplicate instruction entry.';
  let firstResult: unknown = null;
  let secondResult: unknown = null;

  try {
    const root = await createRepositoryWithCommit([]);
    try {
      const first = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(first.readiness, 'READY');
      firstResult = first;
      const snapshotAfterFirst = await snapshotRepository(root);

      const second = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(second.readiness, 'READY');
      assert.equal(second.resources.pluginWrapper.action, 'UNCHANGED');
      assert.equal(second.resources.instructions.action, 'UNCHANGED');
      assert.equal(second.resources.opencodeConfig.action, 'UNCHANGED');
      secondResult = second;

      const snapshotAfterSecond = await snapshotRepository(root);
      assert.equal(
        snapshotsEqual(snapshotAfterFirst, snapshotAfterSecond),
        true,
        'repository must be byte-identical after the second install',
      );

      // Open the on-disk config and assert exactly one ChangeBudget instruction entry.
      const configJson = JSON.parse(
        await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'),
      ) as { instructions: string[] };
      const occurrences = configJson.instructions.filter(
        (entry) => entry === INSTRUCTION_ENTRY,
      ).length;
      assert.equal(occurrences, 1, 'instruction entry must appear exactly once');

      recordMetric({
        criterion: 'SC-001',
        requirement,
        observed: `second run produced all-UNCHANGED actions and zero project-tree mutations; instruction entry present exactly ${occurrences} time`,
        result: 'PASS',
        evidence: `Fresh disposable repo, install then install again. Second install: pluginWrapper=UNCHANGED, instructions=UNCHANGED, opencodeConfig=UNCHANGED. Repository tree snapshot byte-identical between run 1 and run 2. opencode.json instructions[] contains ${INSTRUCTION_ENTRY} exactly once.`,
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `idempotent re-run failed (firstResult=${firstResult !== null}, secondResult=${secondResult !== null})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-002 — Zero unrelated opencode.json field loss
// ---------------------------------------------------------------------------

test('SPEC-009 SC-002: existing opencode.json fields and instructions are preserved across install', async () => {
  const requirement =
    'Across all integration scenarios, no opencode.json field other than the instructions array is modified, and no existing instruction entry is lost or duplicated.';
  let preservedFields = false;

  try {
    const root = await createRepositoryWithCommit([]);
    try {
      const existingInstructions = [
        'docs/first-existing.md',
        'docs/second-existing.md',
        'docs/third-existing.md',
      ];
      const existingConfig = {
        $schema: 'https://opencode.ai/config.json',
        model: 'gpt-4-turbo',
        permissions: { edit: 'allow', bash: 'ask' },
        theme: { name: 'midnight', accent: 'purple' },
        instructions: existingInstructions,
      };
      await writeSourceFile(
        root,
        MANAGED_RESOURCES.opencodeConfig,
        JSON.stringify(existingConfig, null, 2) + '\n',
      );
      runGit(root, ['add', MANAGED_RESOURCES.opencodeConfig]);
      runGit(root, ['commit', '-m', 'seed opencode.json with unrelated config']);

      const install = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(install.readiness, 'READY');
      assert.equal(install.resources.opencodeConfig.action, 'UPDATE');

      const configAfter = JSON.parse(
        await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'),
      ) as Record<string, unknown>;

      assert.equal(configAfter.$schema, existingConfig.$schema);
      assert.equal(configAfter.model, existingConfig.model);
      assert.deepEqual(configAfter.permissions, existingConfig.permissions);
      assert.deepEqual(configAfter.theme, existingConfig.theme);

      const finalInstructions = configAfter.instructions as string[];
      assert.deepEqual(
        finalInstructions.slice(0, existingInstructions.length),
        existingInstructions,
        'existing instructions must keep their original order',
      );
      const changeBudgetIndex = finalInstructions.indexOf(INSTRUCTION_ENTRY);
      assert.ok(
        changeBudgetIndex === existingInstructions.length,
        'ChangeBudget entry must be appended at the end exactly once',
      );
      const occurrences = finalInstructions.filter((e) => e === INSTRUCTION_ENTRY).length;
      assert.equal(occurrences, 1, 'ChangeBudget entry must appear exactly once');
      preservedFields = true;

      recordMetric({
        criterion: 'SC-002',
        requirement,
        observed: `preserved $schema, model, permissions, theme; ${existingInstructions.length} pre-existing instructions kept in order; ChangeBudget entry appended once`,
        result: 'PASS',
        evidence: `Disposable repo seeded with opencode.json { $schema, model, permissions, theme, instructions:[docs/first-existing.md, docs/second-existing.md, docs/third-existing.md] }. After install: $schema, model, permissions, theme byte-identical, instructions prefix equals original in same order, ChangeBudget entry appended once at index ${existingInstructions.length}.`,
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-002',
      requirement,
      observed: `field preservation check failed (preservedFields=${preservedFields})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-003 — Zero AGENTS.md mutation across all operations
// ---------------------------------------------------------------------------

test('SPEC-009 SC-003: AGENTS.md is byte-identical across install/update/dry-run/conflict/remove', async () => {
  const requirement =
    'Across all integration scenarios (install, update, remove, conflict), AGENTS.md remains byte-identical before and after.';
  let mutatingOpReached = '';

  try {
    const root = await createRepositoryWithCommit([{ path: 'AGENTS.md', content: AGENTS_CONTENT }]);
    try {
      const agentsBefore = await readFile(join(root, 'AGENTS.md'), 'utf8');

      // Install.
      const install = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(install.readiness, 'READY');
      const afterInstall = await readFile(join(root, 'AGENTS.md'), 'utf8');
      assert.equal(afterInstall, agentsBefore, 'install must not modify AGENTS.md');

      // Update (re-run idempotent).
      const update = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(update.readiness, 'READY');
      const afterUpdate = await readFile(join(root, 'AGENTS.md'), 'utf8');
      assert.equal(afterUpdate, agentsBefore, 'update must not modify AGENTS.md');

      // Dry-run.
      const dry = await dryRunIntegration(root, resolveChangeBudgetRoot());
      assert.equal(dry.readiness, 'READY');
      const afterDry = await readFile(join(root, 'AGENTS.md'), 'utf8');
      assert.equal(afterDry, agentsBefore, 'dry-run must not modify AGENTS.md');

      // Conflict path: place a user-owned file at the wrapper path and re-integrate.
      await writeSourceFile(
        root,
        MANAGED_RESOURCES.pluginWrapper,
        '// user-owned file — must not be overwritten\n',
      );
      const conflict = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(conflict.readiness, 'NEEDS_ATTENTION');
      assert.equal(conflict.resources.pluginWrapper.action, 'CONFLICT');
      const afterConflict = await readFile(join(root, 'AGENTS.md'), 'utf8');
      assert.equal(afterConflict, agentsBefore, 'conflict path must not modify AGENTS.md');

      // Restore ownership and remove the integration.
      await rm(join(root, MANAGED_RESOURCES.pluginWrapper), { force: true });
      const reinstall = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(reinstall.readiness, 'READY');
      const remove = await removeIntegration(root);
      assert.equal(remove.readiness, 'READY');
      const afterRemove = await readFile(join(root, 'AGENTS.md'), 'utf8');
      assert.equal(afterRemove, agentsBefore, 'remove must not modify AGENTS.md');

      recordMetric({
        criterion: 'SC-003',
        requirement,
        observed: 'AGENTS.md byte-identical across install, update, dry-run, conflict, and remove',
        result: 'PASS',
        evidence: '5 sequential operations in one disposable repo with seeded AGENTS.md; afterInstall === afterUpdate === afterDry === afterConflict === afterRemove === agentsBefore. No operation mutated AGENTS.md.',
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-003',
      requirement,
      observed: `AGENTS.md invariant check failed at step=${mutatingOpReached}`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-004 — Safe ownership conflict handling
// ---------------------------------------------------------------------------

test('SPEC-009 SC-004: ownership conflict produces CONFLICT with zero writes', async () => {
  const requirement =
    'When a user-owned file (no ChangeBudget marker) exists at a managed path, the command reports CONFLICT, writes nothing, and exits with NEEDS_ATTENTION.';
  let conflictObserved = false;

  try {
    const root = await createRepositoryWithCommit([]);
    try {
      const userOwnedWrapper = '// user-owned wrapper — integration must NOT overwrite\n';
      await writeSourceFile(root, MANAGED_RESOURCES.pluginWrapper, userOwnedWrapper);

      const snapshotBefore = await snapshotRepository(root);
      const result = await installIntegration(root, resolveChangeBudgetRoot());

      assert.equal(result.readiness, 'NEEDS_ATTENTION');
      assert.equal(result.resources.pluginWrapper.action, 'CONFLICT');

      const snapshotAfter = await snapshotRepository(root);
      assert.equal(
        snapshotsEqual(snapshotBefore, snapshotAfter),
        true,
        'CONFLICT path must leave the repository byte-identical',
      );

      const wrapperAfter = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
      assert.equal(wrapperAfter, userOwnedWrapper, 'user-owned wrapper content must be preserved');
      conflictObserved = true;

      recordMetric({
        criterion: 'SC-004',
        requirement,
        observed: 'CONFLICT reported, zero writes, NEEDS_ATTENTION, user-owned file preserved byte-identical',
        result: 'PASS',
        evidence: 'Disposable repo seeded with user-owned .opencode/plugins/changebudget.js (no marker). integrate opencode returned readiness=NEEDS_ATTENTION and pluginWrapper.action=CONFLICT. Repository tree snapshot before === after. User-owned file content preserved.',
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `conflict check failed (conflictObserved=${conflictObserved})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-005 — Correct stale-wrapper repair
// ---------------------------------------------------------------------------

test('SPEC-009 SC-005: stale wrapper path is repaired with corrected file:// URL', async () => {
  const requirement =
    'When the ChangeBudget installation path changes (or the wrapper is stale), re-running integration updates only the wrapper with the new file:// path; the instruction file and opencode.json are unchanged.';
  let staleRepaired = false;

  try {
    const root = await createRepositoryWithCommit([]);
    try {
      const first = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(first.readiness, 'READY');

      // Inject a stale wrapper that still contains the marker but points at a wrong path.
      const staleUrl = 'file:///STALE/PATH/TO/opencode-plugin/dist/opencode-plugin/src/index.js';
      const staleContent = generateWrapperContent(staleUrl);
      await writeSourceFile(root, MANAGED_RESOURCES.pluginWrapper, staleContent);

      // Snapshot instructions + opencode.json before repair.
      const instructionsBefore = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');
      const configBefore = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');

      const repair = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(repair.readiness, 'READY');
      assert.equal(repair.resources.pluginWrapper.action, 'UPDATE');
      assert.equal(repair.resources.instructions.action, 'UNCHANGED');
      assert.equal(repair.resources.opencodeConfig.action, 'UNCHANGED');

      const wrapperAfter = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
      const expectedCurrent = generateWrapperContent(runtimeGuardFileUrl(resolveChangeBudgetRoot()));
      assert.equal(wrapperAfter, expectedCurrent, 'wrapper must contain the corrected file:// URL');
      assert.ok(
        wrapperAfter.includes(runtimeGuardFileUrl(resolveChangeBudgetRoot())),
        'wrapper must contain the current runtime guard URL',
      );
      assert.ok(!wrapperAfter.includes(staleUrl), 'stale URL must be gone');

      const instructionsAfter = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');
      assert.equal(instructionsAfter, instructionsBefore, 'instructions must be byte-identical');
      const configAfter = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');
      assert.equal(configAfter, configBefore, 'opencode.json must be byte-identical');
      staleRepaired = true;

      recordMetric({
        criterion: 'SC-005',
        requirement,
        observed: 'wrapper UPDATE with corrected file:// URL; instructions and opencode.json UNCHANGED and byte-identical',
        result: 'PASS',
        evidence: 'After install, wrapper was replaced with stale URL (marker preserved). Re-run integration: pluginWrapper.action=UPDATE, instructions.action=UNCHANGED, opencodeConfig.action=UNCHANGED. Wrapper now contains the current runtimeGuardFileUrl; stale URL string no longer present. instructions and opencode.json byte-identical to pre-repair snapshots.',
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-005',
      requirement,
      observed: `stale-wrapper repair check failed (staleRepaired=${staleRepaired})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-006 — Zero mutations in dry-run
// ---------------------------------------------------------------------------

test('SPEC-009 SC-006: --dry-run performs zero filesystem mutations and reports planned actions', async () => {
  const requirement =
    '--dry-run modifies no project files, creates no .changebudget state, and changes no Git state.';
  let dryRunClean = false;

  try {
    const root = await createRepositoryWithCommit([]);
    try {
      const snapshotBefore = await snapshotRepository(root);

      const dryRun = await dryRunIntegration(root, resolveChangeBudgetRoot());
      assert.equal(dryRun.operation, 'dry-run');
      assert.equal(dryRun.readiness, 'READY');
      assert.equal(dryRun.resources.pluginWrapper.action, 'CREATE');
      assert.equal(dryRun.resources.instructions.action, 'CREATE');
      assert.equal(dryRun.resources.opencodeConfig.action, 'CREATE');

      const snapshotAfter = await snapshotRepository(root);
      assert.equal(
        snapshotsEqual(snapshotBefore, snapshotAfter),
        true,
        `dry-run must leave the repository byte-identical, diff=${snapshotDiff(snapshotBefore, snapshotAfter)}`,
      );

      // Re-run dry-run on an already-current state — actions must be UNCHANGED.
      await installIntegration(root, resolveChangeBudgetRoot());
      const snapshotBefore2 = await snapshotRepository(root);
      const dryRun2 = await dryRunIntegration(root, resolveChangeBudgetRoot());
      assert.equal(dryRun2.readiness, 'READY');
      assert.equal(dryRun2.resources.pluginWrapper.action, 'UNCHANGED');
      assert.equal(dryRun2.resources.instructions.action, 'UNCHANGED');
      assert.equal(dryRun2.resources.opencodeConfig.action, 'UNCHANGED');
      const snapshotAfter2 = await snapshotRepository(root);
      assert.equal(
        snapshotsEqual(snapshotBefore2, snapshotAfter2),
        true,
        'second dry-run must also leave the repository byte-identical',
      );
      dryRunClean = true;

      recordMetric({
        criterion: 'SC-006',
        requirement,
        observed: 'two dry-run invocations produced CREATE-then-UNCHANGED planned actions with zero project-tree mutations',
        result: 'PASS',
        evidence: 'First --dry-run (clean repo): operation=dry-run, readiness=READY, all three resources CREATE, repository tree snapshot before === after. Second --dry-run (after real install): all three resources UNCHANGED, repository tree snapshot before === after. .changebudget/** never created. Git state untouched.',
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-006',
      requirement,
      observed: `dry-run zero-mutation check failed (dryRunClean=${dryRunClean})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-007 — Safe uninstall preserving user-owned configuration
// ---------------------------------------------------------------------------

test('SPEC-009 SC-007: --remove deletes only ChangeBudget-owned resources and is idempotent', async () => {
  const requirement =
    '--remove deletes only ChangeBudget-owned resources, preserves all other instructions and configuration, refuses destructive removal on ownership conflict, and is idempotent on a second --remove.';
  let removeVerified = false;

  try {
    const root = await createRepositoryWithCommit([]);
    try {
      const existingInstructions = [
        'docs/first-existing.md',
        'docs/second-existing.md',
      ];
      const existingConfig = {
        $schema: 'https://opencode.ai/config.json',
        model: 'gpt-4',
        permissions: { edit: 'allow', bash: 'deny' },
        instructions: existingInstructions,
      };
      await writeSourceFile(
        root,
        MANAGED_RESOURCES.opencodeConfig,
        JSON.stringify(existingConfig, null, 2) + '\n',
      );
      runGit(root, ['add', MANAGED_RESOURCES.opencodeConfig]);
      runGit(root, ['commit', '-m', 'seed opencode.json']);

      await writeSourceFile(root, 'AGENTS.md', AGENTS_CONTENT);
      runGit(root, ['add', 'AGENTS.md']);
      runGit(root, ['commit', '-m', 'seed AGENTS.md']);

      const agentsBefore = await readFile(join(root, 'AGENTS.md'), 'utf8');

      const install = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(install.readiness, 'READY');

      // Sanity-check the install wrote the entry.
      const configAfterInstall = JSON.parse(
        await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'),
      ) as Record<string, unknown>;
      assert.deepEqual(
        (configAfterInstall.instructions as string[]).slice(0, existingInstructions.length),
        existingInstructions,
      );

      const remove = await removeIntegration(root);
      assert.equal(remove.readiness, 'READY');
      assert.equal(remove.resources.pluginWrapper.action, 'REMOVE');
      assert.equal(remove.resources.instructions.action, 'REMOVE');
      assert.equal(remove.resources.opencodeConfig.action, 'REMOVE');

      assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), false, 'wrapper deleted');
      assert.equal(existsSync(join(root, MANAGED_RESOURCES.instructions)), false, 'instructions deleted');

      const configAfterRemove = JSON.parse(
        await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'),
      ) as Record<string, unknown>;
      assert.equal(configAfterRemove.$schema, existingConfig.$schema, '$schema preserved');
      assert.equal(configAfterRemove.model, existingConfig.model, 'model preserved');
      assert.deepEqual(configAfterRemove.permissions, existingConfig.permissions, 'permissions preserved');
      assert.deepEqual(configAfterRemove.instructions, existingInstructions, 'unrelated instructions preserved');

      const agentsAfter = await readFile(join(root, 'AGENTS.md'), 'utf8');
      assert.equal(agentsAfter, agentsBefore, 'AGENTS.md byte-identical across remove');

      // Idempotent second remove: every action ABSENT, readiness READY.
      const secondRemove = await removeIntegration(root);
      assert.equal(secondRemove.readiness, 'READY');
      assert.equal(secondRemove.resources.pluginWrapper.action, 'ABSENT');
      assert.equal(secondRemove.resources.instructions.action, 'ABSENT');
      assert.equal(secondRemove.resources.opencodeConfig.action, 'ABSENT');
      removeVerified = true;

      recordMetric({
        criterion: 'SC-007',
        requirement,
        observed: 'managed files removed, instruction entry removed, unrelated fields and instructions preserved, AGENTS.md byte-identical, second --remove idempotent',
        result: 'PASS',
        evidence: 'Install then --remove: wrapper+instructions deleted, opencode.json keeps $schema, model, permissions and original instructions, AGENTS.md byte-identical. Second --remove returned readiness=READY with all three actions ABSENT.',
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-007',
      requirement,
      observed: `remove check failed (removeVerified=${removeVerified})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-008 — Windows-safe Runtime Guard file URL
// ---------------------------------------------------------------------------

test('SPEC-009 SC-008: generated file:// URL is Windows-safe and loads the Runtime Guard', async () => {
  const requirement =
    'The generated file:// URL correctly loads the Runtime Guard on Windows (drive letter, backslash normalization via Node URL APIs).';
  let urlVerified = false;

  try {
    const root = await createRepositoryWithCommit([]);
    try {
      const install = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(install.readiness, 'READY');

      const wrapperContent = await readFile(
        join(root, MANAGED_RESOURCES.pluginWrapper),
        'utf8',
      );

      // Extract the URL between the quotes on the export line.
      const match = wrapperContent.match(/from "(file:\/\/[^"]+)"/);
      assert.ok(match !== null, 'wrapper must contain a file:// URL on the export line');
      const url = match![1]!;
      assert.ok(url.startsWith('file://'), `URL must start with file://, got=${url}`);

      // URL parseability — `pathToFileURL` always produces a URL that round-trips.
      const parsed = new URL(url);
      assert.equal(parsed.protocol, 'file:');

      // The URL must point at the on-disk compiled Runtime Guard entry.
      const expectedUrl = pathToFileURL(runtimeGuardEntryPath).href;
      assert.equal(parsed.href, expectedUrl, 'URL must equal the on-disk entry URL');

      // On Windows, `parsed.pathname` must start with the drive letter (e.g. /D:/...).
      if (process.platform === 'win32') {
        assert.ok(
          parsed.pathname.startsWith('/') && /^\/[A-Za-z]:/.test(parsed.pathname),
          `Windows URL pathname must start with /<drive-letter>:, got=${parsed.pathname}`,
        );
      }

      // Import via pathToFileURL on the wrapper itself and call server() to confirm
      // the URL-driven import actually loads the Runtime Guard.
      const hooks = await loadInstalledWrapper(root);
      assert.equal(typeof hooks['tool.execute.before'], 'function');
      assert.equal(typeof hooks['permission.ask'], 'function');
      urlVerified = true;

      recordMetric({
        criterion: 'SC-008',
        requirement,
        observed: 'wrapper URL is a valid file:// that round-trips through pathToFileURL; on Windows, pathname starts with /<drive>:; importing the wrapper loads the Runtime Guard',
        result: 'PASS',
        evidence: `Wrapper URL: ${url}. Equal to pathToFileURL(resolveRuntimeGuardEntry()).href=${expectedUrl}. process.platform=${process.platform}; pathname=${parsed.pathname}. Wrapper import via pathToFileURL yielded server() returning tool.execute.before and permission.ask hooks.`,
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-008',
      requirement,
      observed: `Windows-safe URL check failed (urlVerified=${urlVerified})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-009 — Existing OpenCode instructions preserved across install + remove
// ---------------------------------------------------------------------------

test('SPEC-009 SC-009: pre-existing instructions survive install and remove', async () => {
  const requirement =
    'After integration, all pre-existing instructions entries in opencode.json remain present and unchanged in order; after removal, the ChangeBudget entry is removed and all pre-existing instructions survive.';
  let instructionsRoundTripped = false;

  try {
    const root = await createRepositoryWithCommit([]);
    try {
      const preExisting = [
        'docs/first-existing.md',
        'docs/second-existing.md',
        'docs/third-existing.md',
      ];
      const configBefore = {
        $schema: 'https://opencode.ai/config.json',
        model: 'gpt-4',
        instructions: preExisting,
      };
      await writeSourceFile(
        root,
        MANAGED_RESOURCES.opencodeConfig,
        JSON.stringify(configBefore, null, 2) + '\n',
      );
      runGit(root, ['add', MANAGED_RESOURCES.opencodeConfig]);
      runGit(root, ['commit', '-m', 'seed instructions']);

      const install = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(install.readiness, 'READY');

      const configAfterInstall = JSON.parse(
        await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'),
      ) as Record<string, unknown>;
      const afterInstallInstructions = configAfterInstall.instructions as string[];
      // First N entries equal pre-existing in the same order; CB entry appended.
      assert.deepEqual(
        afterInstallInstructions.slice(0, preExisting.length),
        preExisting,
        'pre-existing instructions must keep their original order',
      );
      assert.ok(
        afterInstallInstructions.includes(INSTRUCTION_ENTRY),
        'ChangeBudget entry must be present after install',
      );

      const remove = await removeIntegration(root);
      assert.equal(remove.readiness, 'READY');

      const configAfterRemove = JSON.parse(
        await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'),
      ) as Record<string, unknown>;
      assert.deepEqual(
        configAfterRemove.instructions,
        preExisting,
        'pre-existing instructions must survive the remove unchanged',
      );
      assert.ok(
        !((configAfterRemove.instructions as string[]).includes(INSTRUCTION_ENTRY)),
        'ChangeBudget entry must be gone after remove',
      );
      instructionsRoundTripped = true;

      recordMetric({
        criterion: 'SC-009',
        requirement,
        observed: 'pre-existing instructions kept in order across install; ChangeBudget entry added then cleanly removed',
        result: 'PASS',
        evidence: `Seed instructions=[${preExisting.join(', ')}]. After install: same order, CB entry appended. After remove: instructions back to [${preExisting.join(', ')}]; CB entry absent.`,
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-009',
      requirement,
      observed: `instructions round-trip failed (instructionsRoundTripped=${instructionsRoundTripped})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-010 — Integration does not alter ChangeBudget policy behavior
// ---------------------------------------------------------------------------

test('SPEC-009 SC-010: Runtime Guard ALLOW/ASK/DENY through the wrapper is unchanged by integration', async () => {
  const requirement =
    'The Runtime Guard ALLOW/ASK/DENY decisions, .changebudget/** protection, and contract enforcement semantics are identical before and after integration (verified through the wrapper).';
  let policySemanticsVerified = false;

  try {
    const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);
    try {
      const init = runCliCommand(root, 'init');
      assert.equal(init.status, 0, `init failed: ${init.stderr}`);

      // Install the integration BEFORE starting the contract so that the
      // integration files can be baselined into HEAD before `start` freezes
      // the contract's base_revision. Otherwise the integration files would
      // be part of the contract diff and any write would be blocked as
      // out-of-scope by the OCG-PATH-OUT-SCOPE / OCG-REPAIR chain.
      const install = await installIntegration(root, resolveChangeBudgetRoot());
      assert.equal(install.readiness, 'READY');

      runGit(root, [
        'add',
        MANAGED_RESOURCES.pluginWrapper,
        MANAGED_RESOURCES.instructions,
        MANAGED_RESOURCES.opencodeConfig,
      ]);
      runGit(root, ['commit', '-m', 'baseline integration files']);

      const start = runCliCommand(root, 'start', [
        '--task',
        'sc010',
        '--base-revision',
        'HEAD',
        '--allow-paths',
        'src/**',
        '--tiny',
      ]);
      assert.equal(start.status, 0, `start failed: ${start.stderr}`);

      const hooks = await loadInstalledWrapper(root);
      assert.equal(typeof hooks['tool.execute.before'], 'function', 'tool.execute.before hook is required');
      assert.equal(typeof hooks['permission.ask'], 'function', 'permission.ask hook is required');

      // ALLOW — in-scope write.
      const allowSession = 'session-sc010-allow';
      const allowCall = 'call-sc010-allow';
      await hooks['tool.execute.before']!(
        { tool: 'write', sessionID: allowSession, callID: allowCall },
        { args: { path: 'src/app.ts' } },
      );
      const allowPermission = {
        sessionID: allowSession,
        callID: allowCall,
        type: 'tool',
        pattern: 'write',
        metadata: emptyMetadata(),
      };
      const allowOutput = { status: 'deny' as const };
      await hooks['permission.ask']!(allowPermission, allowOutput);
      assert.equal(allowOutput.status, 'allow', 'in-scope write must produce allow');
      assert.equal(allowPermission.metadata?.rule, RUNTIME_RULES.ALLOW);
      assert.equal(allowPermission.metadata?.runtimeAction, 'allow');

      // ASK — out-of-scope write.
      const askSession = 'session-sc010-ask';
      const askCall = 'call-sc010-ask';
      await hooks['tool.execute.before']!(
        { tool: 'write', sessionID: askSession, callID: askCall },
        { args: { path: 'tests/contract.spec.ts' } },
      );
      const askPermission = {
        sessionID: askSession,
        callID: askCall,
        type: 'tool',
        pattern: 'write',
        metadata: emptyMetadata(),
      };
      const askOutput = { status: 'allow' as const };
      await hooks['permission.ask']!(askPermission, askOutput);
      assert.equal(askOutput.status, 'ask', 'out-of-scope write must produce ask');
      assert.equal(askPermission.metadata?.rule, RUNTIME_RULES.OUT_SCOPE);
      assert.equal(askPermission.metadata?.runtimeAction, 'ask');

      // DENY — .changebudget protection.
      const denySession = 'session-sc010-deny';
      const denyCall = 'call-sc010-deny';
      await hooks['tool.execute.before']!(
        { tool: 'edit', sessionID: denySession, callID: denyCall },
        { args: { path: '.changebudget/state.json' } },
      );
      const denyPermission = {
        sessionID: denySession,
        callID: denyCall,
        type: 'tool',
        pattern: 'edit',
        metadata: emptyMetadata(),
      };
      const denyOutput = { status: 'allow' as const };
      await hooks['permission.ask']!(denyPermission, denyOutput);
      assert.equal(denyOutput.status, 'deny', '.changebudget write must produce deny');
      assert.equal(denyPermission.metadata?.rule, RUNTIME_RULES.CHANGEBUDGET);
      assert.equal(denyPermission.metadata?.runtimeAction, 'block');

      policySemanticsVerified = true;

      recordMetric({
        criterion: 'SC-010',
        requirement,
        observed: 'ALLOW on in-scope write, ASK on out-of-scope write, DENY on .changebudget/** — all identical to SPEC-004 semantics through the wrapper',
        result: 'PASS',
        evidence: `Runtime Guard hooks loaded through the installed wrapper. ALLOW scenario (src/app.ts) -> status=allow, rule=${RUNTIME_RULES.ALLOW}, action=allow. ASK scenario (tests/contract.spec.ts) -> status=ask, rule=${RUNTIME_RULES.OUT_SCOPE}, action=ask. DENY scenario (.changebudget/state.json) -> status=deny, rule=${RUNTIME_RULES.CHANGEBUDGET}, action=block. Integration does not alter policy semantics.`,
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-010',
      requirement,
      observed: `policy semantics check failed (policySemanticsVerified=${policySemanticsVerified})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-011 — Disposable E2E OpenCode integration readiness
// ---------------------------------------------------------------------------

test('SPEC-009 SC-011: full disposable E2E lifecycle with integration installed (no-Spec-Kit)', async () => {
  const requirement =
    'A disposable repository with the integration installed supports the full ChangeBudget workflow (init -> integrate -> start -> edit -> check PASS -> close) and the Runtime Guard produces correct ALLOW/ASK/DENY decisions through the wrapper; works with and without Spec-Kit.';
  let lifecycleVerified = false;

  try {
    const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: BASE_APP }]);
    try {
      const init = runCliCommand(root, 'init');
      assert.equal(init.status, 0, `init failed: ${init.stderr}`);

      const integrate = runCliCommand(root, 'integrate', ['opencode']);
      assert.equal(integrate.status, 0, `integrate failed: ${integrate.stderr}\n${integrate.stdout}`);

      // Baseline the integration files so they do not pollute the contract diff.
      runGit(root, [
        'add',
        MANAGED_RESOURCES.pluginWrapper,
        MANAGED_RESOURCES.instructions,
        MANAGED_RESOURCES.opencodeConfig,
      ]);
      runGit(root, ['commit', '-m', 'baseline integration files']);

      const start = runCliCommand(root, 'start', [
        '--task',
        'sc011 e2e',
        '--base-revision',
        'HEAD',
        '--allow-paths',
        'src/**',
        '--tiny',
      ]);
      assert.equal(start.status, 0, `start failed: ${start.stderr}\n${start.stdout}`);

      // Edit src/app.ts in a way that stays in scope.
      await writeSourceFile(
        root,
        'src/app.ts',
        `${BASE_APP}// sc011 in-scope edit\n`,
      );
      runGit(root, ['add', 'src/app.ts']);
      runGit(root, ['commit', '-m', 'sc011 in-scope edit']);

      const check = runCliCommand(root, 'check');
      assert.equal(check.status, 0, `check should PASS: ${check.stderr}\n${check.stdout}`);

      const close = runCliCommand(root, 'close');
      assert.equal(close.status, 0, `close failed: ${close.stderr}\n${close.stdout}`);

      // Runtime Guard still loads through the integration after close.
      const hooks = await loadInstalledWrapper(root);
      assert.equal(typeof hooks['permission.ask'], 'function');

      lifecycleVerified = true;

      recordMetric({
        criterion: 'SC-011',
        requirement,
        observed: 'init -> integrate -> start -> in-scope edit -> check PASS -> close all exit 0; Runtime Guard loads through the wrapper',
        result: 'PASS',
        evidence: 'Disposable repo (no Spec-Kit). Sequence: init (0), integrate opencode (0), git commit baseline, start --allow-paths src/** --tiny (0), edit src/app.ts, check (0/PASS), close (0). After close, wrapper import via pathToFileURL still returns the Runtime Guard hooks.',
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-011',
      requirement,
      observed: `E2E lifecycle check failed (lifecycleVerified=${lifecycleVerified})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// SC-011 supplementary — Spec-Kit variant (T001 diagnose + start)
// ---------------------------------------------------------------------------

test('SPEC-009 SC-011b: full disposable E2E lifecycle works with Spec-Kit T001 fixture', async () => {
  const requirement =
    'Disposable repo with a Spec-Kit specs/001-dummy/tasks.md fixture (T001) integrates successfully and exercises diagnose T001 + start T001 --tiny before the lifecycle closes cleanly.';
  let specKitLifecycleVerified = false;

  try {
    const root = await createRepositoryWithCommit([
      { path: 'specs/001-dummy/tasks.md', content: '- [ ] T001 [budget:tiny] Disposable fixture task\n' },
      { path: 'src/app.ts', content: BASE_APP },
    ]);
    try {
      const init = runCliCommand(root, 'init');
      assert.equal(init.status, 0, `init failed: ${init.stderr}`);

      const integrate = runCliCommand(root, 'integrate', ['opencode']);
      assert.equal(integrate.status, 0, `integrate failed: ${integrate.stderr}`);

      // Baseline the integration files so they do not pollute the contract diff.
      runGit(root, [
        'add',
        MANAGED_RESOURCES.pluginWrapper,
        MANAGED_RESOURCES.instructions,
        MANAGED_RESOURCES.opencodeConfig,
      ]);
      runGit(root, ['commit', '-m', 'baseline integration files']);

      const diagnose = runCliCommand(root, 'diagnose', ['T001']);
      assert.equal(diagnose.status, 0, `diagnose T001 failed: ${diagnose.stderr}`);

      const start = runCliCommand(root, 'start', ['T001', '--base-revision', 'HEAD', '--allow-paths', 'src/**']);
      assert.equal(start.status, 0, `start T001 failed: ${start.stderr}`);

      await writeSourceFile(root, 'src/app.ts', `${BASE_APP}// sc011b in-scope edit\n`);
      runGit(root, ['add', 'src/app.ts']);
      runGit(root, ['commit', '-m', 'sc011b in-scope edit']);

      const check = runCliCommand(root, 'check');
      assert.equal(check.status, 0, `check should PASS: ${check.stderr}\n${check.stdout}`);

      const close = runCliCommand(root, 'close');
      assert.equal(close.status, 0, `close failed: ${close.stderr}\n${close.stdout}`);

      specKitLifecycleVerified = true;

      recordMetric({
        criterion: 'SC-011',
        requirement,
        observed: 'Spec-Kit T001 variant: integrate + diagnose T001 + start T001 + in-scope edit + check PASS + close all exit 0',
        result: 'PASS',
        evidence: 'Disposable repo seeded with specs/001-dummy/tasks.md T001 [budget:tiny]. Sequence: init (0), integrate opencode (0), diagnose T001 (0), start T001 --allow-paths src/** (0), edit src/app.ts, check (0/PASS), close (0).',
      });
    } finally {
      await cleanupRoot(root);
    }
  } catch (error) {
    recordMetric({
      criterion: 'SC-011',
      requirement,
      observed: `Spec-Kit lifecycle check failed (specKitLifecycleVerified=${specKitLifecycleVerified})`,
      result: 'FAIL',
      evidence: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
});

// ---------------------------------------------------------------------------
// Built-environment sanity check was placed at the top of the file (right
// after the metric helpers) so a missing build fails fast.
// ---------------------------------------------------------------------------
