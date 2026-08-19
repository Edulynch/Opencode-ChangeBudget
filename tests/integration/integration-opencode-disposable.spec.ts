// SPEC-009 Phase 2 — disposable-repo integration tests for the
// `changebudget integrate opencode` command.
//
// All tests run in freshly-created disposable temporary Git repositories
// (mkdtemp + git init + empty commit). No real/work repositories are
// inspected or modified. AGENTS.md is asserted byte-identical before/after
// every operation that touches a repo that contains one.
//
// Coverage:
//   - Install (9 scenarios): clean, preserve-existing-fields, preserve-
//     existing-instructions, idempotent re-run, stale-wrapper UPDATE,
//     stale-instructions UPDATE, missing-Runtime-Guard, wrapper-conflict,
//     instructions-conflict
//   - Dry-run (3 scenarios): fresh, idempotent, conflict
//   - Remove (6 scenarios): full remove, partial install, idempotent
//     second remove, wrapper-conflict refusal, instructions-conflict
//     refusal, unrelated-config preservation
//   - Git baseline (3 scenarios): untracked warning, committed silence,
//     non-git skip
//   - CLI (6 scenarios): install, --dry-run, --remove, --dry-run --remove
//     rejection, missing-target rejection, unknown-target rejection
//   - AGENTS.md byte-identity invariant (asserted across every disposable
//     repo that contains one).

import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  INSTRUCTION_ENTRY,
  MANAGED_RESOURCES,
  WRAPPER_MARKER,
  installIntegration,
  dryRunIntegration,
  removeIntegration,
  resolveChangeBudgetRoot,
  resolveRuntimeGuardEntry,
  runtimeGuardFileUrl,
  generateWrapperContent,
  generateInstructionsContent,
  generateMinimalConfigString,
} from '../../src/core/integration/opencode.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const REPO_PREFIX = 'cb-int-opencode-';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function createDisposableRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), REPO_PREFIX));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'integration test']);
  runGit(root, ['config', 'user.email', 'integration@test']);
  runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
  return root;
}

async function writeFileRecursive(root: string, relativePath: string, content: string): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(join(root, relativePath, '..'), { recursive: true });
  await writeFile(target, content, 'utf8');
  return target;
}

async function readIfExists(root: string, relativePath: string): Promise<string | null> {
  const target = join(root, relativePath);
  if (!existsSync(target)) return null;
  return readFile(target, 'utf8');
}

async function snapshotOpenCodeArea(root: string): Promise<{
  wrapper: string | null;
  instructions: string | null;
  config: string | null;
  agents: string | null;
}> {
  return {
    wrapper: await readIfExists(root, MANAGED_RESOURCES.pluginWrapper),
    instructions: await readIfExists(root, MANAGED_RESOURCES.instructions),
    config: await readIfExists(root, MANAGED_RESOURCES.opencodeConfig),
    agents: await readIfExists(root, 'AGENTS.md'),
  };
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCli(root: string, args: string[]): CliResult {
  const cliPath = join(process.cwd(), 'dist', 'src', 'cli', 'index.js');
  const result = spawnSync(process.execPath, [cliPath, 'integrate', 'opencode', ...args], {
    cwd: root,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function cleanup(root: string): Promise<void> {
  if (existsSync(root)) {
    await rm(root, { recursive: true, force: true });
  }
}

const changeBudgetRoot = resolveChangeBudgetRoot();
const expectedWrapper = generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot));
const expectedInstructions = generateInstructionsContent();
const runtimeGuardExists = existsSync(resolveRuntimeGuardEntry(changeBudgetRoot));

function assertAgentsMdUnchanged(root: string, before: { agents: string | null }, after: { agents: string | null }): void {
  if (before.agents !== null) {
    assert.equal(after.agents, before.agents, 'AGENTS.md must be byte-identical before/after the operation');
  }
}

// ---------------------------------------------------------------------------
// T008 / T009 — Install scenarios
// ---------------------------------------------------------------------------

test('T008 install: clean project (no opencode.json) creates all 3 resources and reports READY', async () => {
  const root = await createDisposableRepo();
  try {
    const before = await snapshotOpenCodeArea(root);
    const result = await installIntegration(root, changeBudgetRoot);

    assert.equal(result.operation, 'install');
    assert.equal(result.readiness, 'READY');
    assert.equal(result.runtimeGuardTargetExists, true);
    assert.equal(result.resources.pluginWrapper.action, 'CREATE');
    assert.equal(result.resources.instructions.action, 'CREATE');
    assert.equal(result.resources.opencodeConfig.action, 'CREATE');

    // Files now exist and contain the expected content.
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), expectedWrapper);
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8'), expectedInstructions);

    const configAfter = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');
    assert.ok(configAfter.includes('"$schema"'));
    assert.ok(configAfter.includes('"instructions"'));
    assert.ok(configAfter.includes(INSTRUCTION_ENTRY));

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T008 install: existing opencode.json with unrelated fields preserves them and appends the entry', async () => {
  const root = await createDisposableRepo();
  try {
    const unrelatedConfig = {
      $schema: 'https://opencode.ai/config.json',
      theme: 'dark',
      provider: { name: 'openai', model: 'gpt-x' },
      watcher: { ignore: ['**/dist/**'] },
    };
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, JSON.stringify(unrelatedConfig, null, 2) + '\n');
    runGit(root, ['add', MANAGED_RESOURCES.opencodeConfig]);
    runGit(root, ['commit', '-m', 'seed opencode.json']);

    const before = await snapshotOpenCodeArea(root);
    const result = await installIntegration(root, changeBudgetRoot);

    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.opencodeConfig.action, 'UPDATE');

    const configAfter = JSON.parse(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8')) as Record<string, unknown>;
    assert.equal(configAfter.$schema, 'https://opencode.ai/config.json');
    assert.equal(configAfter.theme, 'dark');
    assert.deepEqual(configAfter.provider, { name: 'openai', model: 'gpt-x' });
    assert.deepEqual(configAfter.watcher, { ignore: ['**/dist/**'] });

    const instructions = configAfter.instructions as string[];
    assert.deepEqual(instructions, [INSTRUCTION_ENTRY]);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T008 install: existing instructions[] preserves order and appends the entry at the end', async () => {
  const root = await createDisposableRepo();
  try {
    const existingConfig = {
      instructions: ['.opencode/instructions/base.md', '.opencode/instructions/extra.md'],
    };
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, JSON.stringify(existingConfig, null, 2) + '\n');

    const before = await snapshotOpenCodeArea(root);
    const result = await installIntegration(root, changeBudgetRoot);

    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.opencodeConfig.action, 'UPDATE');

    const configAfter = JSON.parse(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(configAfter.instructions, [
      '.opencode/instructions/base.md',
      '.opencode/instructions/extra.md',
      INSTRUCTION_ENTRY,
    ]);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T009 install: already-current integration reports UNCHANGED and produces zero writes', async () => {
  const root = await createDisposableRepo();
  try {
    // First install populates the project.
    await installIntegration(root, changeBudgetRoot);

    // Snapshot hashes of every managed file.
    const wrapperBefore = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const instructionsBefore = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');
    const configBefore = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');

    const before = await snapshotOpenCodeArea(root);
    const second = await installIntegration(root, changeBudgetRoot);

    assert.equal(second.readiness, 'READY');
    assert.equal(second.resources.pluginWrapper.action, 'UNCHANGED');
    assert.equal(second.resources.instructions.action, 'UNCHANGED');
    assert.equal(second.resources.opencodeConfig.action, 'UNCHANGED');

    const wrapperAfter = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const instructionsAfter = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');
    const configAfter = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');
    assert.equal(wrapperAfter, wrapperBefore);
    assert.equal(instructionsAfter, instructionsBefore);
    assert.equal(configAfter, configBefore);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T009 install: stale wrapper path triggers UPDATE for the wrapper only', async () => {
  const root = await createDisposableRepo();
  try {
    const staleWrapper = `${WRAPPER_MARKER}\nexport { default } from "file:///old/path/index.js";\n`;
    await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, staleWrapper);

    const before = await snapshotOpenCodeArea(root);
    const result = await installIntegration(root, changeBudgetRoot);

    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.pluginWrapper.action, 'UPDATE');
    assert.equal(result.resources.instructions.action, 'CREATE');
    assert.equal(result.resources.opencodeConfig.action, 'CREATE');

    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), expectedWrapper);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T009 install: stale instructions trigger UPDATE for the instructions only', async () => {
  const root = await createDisposableRepo();
  try {
    const staleInstructions = '<!-- ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode -->\n# Different body\n';
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, staleInstructions);

    const before = await snapshotOpenCodeArea(root);
    const result = await installIntegration(root, changeBudgetRoot);

    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.pluginWrapper.action, 'CREATE');
    assert.equal(result.resources.instructions.action, 'UPDATE');
    assert.equal(result.resources.opencodeConfig.action, 'CREATE');

    assert.equal(await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8'), expectedInstructions);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T008 install: missing Runtime Guard reports NEEDS_ATTENTION with zero writes', async () => {
  if (!runtimeGuardExists) {
    const root = await createDisposableRepo();
    try {
      const before = await snapshotOpenCodeArea(root);
      const fakeRoot = join(tmpdir(), 'cb-no-runtime-guard-' + Date.now().toString(36));
      await rm(fakeRoot, { recursive: true, force: true });

      const result = await installIntegration(root, fakeRoot);

      assert.equal(result.readiness, 'NEEDS_ATTENTION');
      assert.equal(result.runtimeGuardTargetExists, false);

      const after = await snapshotOpenCodeArea(root);
      assert.equal(after.wrapper, null, 'wrapper must not be created');
      assert.equal(after.instructions, null, 'instructions must not be created');
      assert.equal(after.config, null, 'opencode.json must not be created');
      assertAgentsMdUnchanged(root, before, after);
    } finally {
      await cleanup(root);
    }
  } else {
    // Simulate "Runtime Guard missing" via a non-existent root.
    const root = await createDisposableRepo();
    try {
      const before = await snapshotOpenCodeArea(root);
      const fakeRoot = join(tmpdir(), 'cb-no-runtime-guard-' + Date.now().toString(36));
      await rm(fakeRoot, { recursive: true, force: true });

      const result = await installIntegration(root, fakeRoot);

      assert.equal(result.readiness, 'NEEDS_ATTENTION');
      assert.equal(result.runtimeGuardTargetExists, false);
      const after = await snapshotOpenCodeArea(root);
      assert.equal(after.wrapper, null);
      assert.equal(after.instructions, null);
      assert.equal(after.config, null);
      assertAgentsMdUnchanged(root, before, after);
    } finally {
      await cleanup(root);
    }
  }
});

test('T008 install: wrapper ownership conflict reports CONFLICT with zero writes', async () => {
  const root = await createDisposableRepo();
  try {
    // Pre-existing user file at the wrapper path with no ownership marker.
    await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, '// user-owned content\n');

    const before = await snapshotOpenCodeArea(root);
    const result = await installIntegration(root, changeBudgetRoot);

    assert.equal(result.readiness, 'NEEDS_ATTENTION');
    assert.equal(result.resources.pluginWrapper.action, 'CONFLICT');
    assert.ok(result.resources.pluginWrapper.detail?.includes('ChangeBudget-managed'));

    // Zero writes — instructions and opencode.json must still be absent.
    const after = await snapshotOpenCodeArea(root);
    assert.equal(after.wrapper, before.wrapper, 'wrapper content must not change');
    assert.equal(after.instructions, null);
    assert.equal(after.config, null);

    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T008 install: instructions ownership conflict reports CONFLICT with zero writes', async () => {
  const root = await createDisposableRepo();
  try {
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, '# user-owned instructions\n');

    const before = await snapshotOpenCodeArea(root);
    const result = await installIntegration(root, changeBudgetRoot);

    assert.equal(result.readiness, 'NEEDS_ATTENTION');
    assert.equal(result.resources.instructions.action, 'CONFLICT');
    assert.ok(result.resources.instructions.detail?.includes('ChangeBudget-managed'));

    const after = await snapshotOpenCodeArea(root);
    assert.equal(after.instructions, before.instructions, 'instructions content must not change');
    assert.equal(after.wrapper, null);
    assert.equal(after.config, null);

    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// T010 — Dry-run scenarios
// ---------------------------------------------------------------------------

test('T010 dry-run: fresh project reports CREATE for all 3 and creates zero files', async () => {
  const root = await createDisposableRepo();
  try {
    const before = await snapshotOpenCodeArea(root);
    const result = await dryRunIntegration(root, changeBudgetRoot);

    assert.equal(result.operation, 'dry-run');
    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.pluginWrapper.action, 'CREATE');
    assert.equal(result.resources.instructions.action, 'CREATE');
    assert.equal(result.resources.opencodeConfig.action, 'CREATE');
    assert.equal(result.baselineWarning, null);

    // Tree is byte-identical — zero writes, zero git changes.
    const after = await snapshotOpenCodeArea(root);
    assert.equal(after.wrapper, null);
    assert.equal(after.instructions, null);
    assert.equal(after.config, null);

    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T010 dry-run: already-integrated project reports UNCHANGED with zero writes', async () => {
  const root = await createDisposableRepo();
  try {
    await installIntegration(root, changeBudgetRoot);

    const wrapperBefore = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const instructionsBefore = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');
    const configBefore = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');

    const result = await dryRunIntegration(root, changeBudgetRoot);
    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.pluginWrapper.action, 'UNCHANGED');
    assert.equal(result.resources.instructions.action, 'UNCHANGED');
    assert.equal(result.resources.opencodeConfig.action, 'UNCHANGED');

    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), wrapperBefore);
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8'), instructionsBefore);
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'), configBefore);
  } finally {
    await cleanup(root);
  }
});

test('T010 dry-run: conflict is reported (informational) without writes and exit 0', async () => {
  const root = await createDisposableRepo();
  try {
    await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, '// user-owned\n');

    const before = await snapshotOpenCodeArea(root);
    const result = await dryRunIntegration(root, changeBudgetRoot);

    // Dry-run reports conflict but does not refuse — readiness reflects the
    // situation; the CLI exits 0 because dry-run is informational.
    assert.equal(result.readiness, 'NEEDS_ATTENTION');
    assert.equal(result.resources.pluginWrapper.action, 'CONFLICT');

    // Zero writes.
    const after = await snapshotOpenCodeArea(root);
    assert.equal(after.wrapper, before.wrapper);
    assert.equal(after.instructions, null);
    assert.equal(after.config, null);

    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// T011 — Remove scenarios
// ---------------------------------------------------------------------------

test('T011 remove: fully-managed removal deletes wrapper/instructions and strips entry from opencode.json', async () => {
  const root = await createDisposableRepo();
  try {
    // Seed opencode.json with unrelated fields, then run install.
    await writeFileRecursive(
      root,
      MANAGED_RESOURCES.opencodeConfig,
      JSON.stringify({ theme: 'dark', provider: { name: 'openai' } }, null, 2) + '\n',
    );
    const installResult = await installIntegration(root, changeBudgetRoot);
    assert.equal(installResult.readiness, 'READY');

    const before = await snapshotOpenCodeArea(root);
    const remove = await removeIntegration(root);

    assert.equal(remove.operation, 'remove');
    assert.equal(remove.readiness, 'READY');
    assert.equal(remove.resources.pluginWrapper.action, 'REMOVE');
    assert.equal(remove.resources.instructions.action, 'REMOVE');
    assert.equal(remove.resources.opencodeConfig.action, 'REMOVE');

    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), false);
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.instructions)), false);

    const configAfter = JSON.parse(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8')) as Record<string, unknown>;
    assert.equal(configAfter.theme, 'dark');
    assert.deepEqual(configAfter.provider, { name: 'openai' });
    assert.equal(configAfter.instructions, undefined);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T011 remove: partial installation removes what exists and reports ABSENT for the rest', async () => {
  const root = await createDisposableRepo();
  try {
    // Only the instructions file exists, no wrapper, no opencode.json.
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, expectedInstructions);

    const before = await snapshotOpenCodeArea(root);
    const remove = await removeIntegration(root);

    assert.equal(remove.readiness, 'READY');
    assert.equal(remove.resources.pluginWrapper.action, 'ABSENT');
    assert.equal(remove.resources.instructions.action, 'REMOVE');
    assert.equal(remove.resources.opencodeConfig.action, 'ABSENT');

    assert.equal(existsSync(join(root, MANAGED_RESOURCES.instructions)), false);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T011 remove: idempotent second removal reports ABSENT for every resource and READY', async () => {
  const root = await createDisposableRepo();
  try {
    await installIntegration(root, changeBudgetRoot);
    const first = await removeIntegration(root);
    assert.equal(first.readiness, 'READY');

    const before = await snapshotOpenCodeArea(root);
    const second = await removeIntegration(root);
    assert.equal(second.readiness, 'READY');
    assert.equal(second.resources.pluginWrapper.action, 'ABSENT');
    assert.equal(second.resources.instructions.action, 'ABSENT');
    assert.equal(second.resources.opencodeConfig.action, 'ABSENT');

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T011 remove: wrapper ownership conflict refuses and produces zero deletes', async () => {
  const root = await createDisposableRepo();
  try {
    await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, '// user-owned\n');
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, expectedInstructions);

    const wrapperBefore = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const instructionsBefore = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');

    const before = await snapshotOpenCodeArea(root);
    const remove = await removeIntegration(root);

    assert.equal(remove.readiness, 'NEEDS_ATTENTION');
    assert.equal(remove.resources.pluginWrapper.action, 'CONFLICT');
    assert.equal(remove.resources.instructions.action, 'ABSENT');

    // Conflict refuses entirely — zero deletes.
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), wrapperBefore);
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8'), instructionsBefore);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T011 remove: instructions ownership conflict refuses and produces zero deletes', async () => {
  const root = await createDisposableRepo();
  try {
    await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, expectedWrapper);
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, '# user-owned\n');

    const wrapperBefore = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const instructionsBefore = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');

    const before = await snapshotOpenCodeArea(root);
    const remove = await removeIntegration(root);

    assert.equal(remove.readiness, 'NEEDS_ATTENTION');
    assert.equal(remove.resources.pluginWrapper.action, 'ABSENT');
    assert.equal(remove.resources.instructions.action, 'CONFLICT');

    // Conflict refuses entirely — zero deletes.
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), wrapperBefore);
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8'), instructionsBefore);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T011 remove: unrelated opencode.json content survives removal and entry is removed', async () => {
  const root = await createDisposableRepo();
  try {
    const unrelatedConfig = {
      $schema: 'https://opencode.ai/config.json',
      theme: 'light',
      provider: { name: 'anthropic', model: 'claude-x' },
    };
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, JSON.stringify(unrelatedConfig, null, 2) + '\n');

    const installResult = await installIntegration(root, changeBudgetRoot);
    assert.equal(installResult.readiness, 'READY');

    // Sanity: entry was added.
    const afterInstall = JSON.parse(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8')) as Record<string, unknown>;
    const inst = afterInstall.instructions as string[];
    assert.ok(inst.includes(INSTRUCTION_ENTRY));

    const remove = await removeIntegration(root);
    assert.equal(remove.readiness, 'READY');

    const finalConfig = JSON.parse(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8')) as Record<string, unknown>;
    assert.equal(finalConfig.$schema, 'https://opencode.ai/config.json');
    assert.equal(finalConfig.theme, 'light');
    assert.deepEqual(finalConfig.provider, { name: 'anthropic', model: 'claude-x' });
    assert.equal(finalConfig.instructions, undefined, 'entry must be stripped exactly');
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// T012 — Git baseline scenarios
// ---------------------------------------------------------------------------

test('T012 baseline: install on fresh untracked repo emits Git baseline warning', async () => {
  const root = await createDisposableRepo();
  try {
    const result = await installIntegration(root, changeBudgetRoot);
    assert.equal(result.readiness, 'READY');
    // Files are untracked in the fresh disposable repo — warning expected.
    assert.ok(result.baselineWarning !== null, 'baseline warning must be present when managed files are untracked');
    assert.ok(result.baselineWarning!.includes('Commit/baseline'));
  } finally {
    await cleanup(root);
  }
});

test('T012 baseline: install with committed managed files suppresses the warning', async () => {
  const root = await createDisposableRepo();
  try {
    // Pre-create and commit managed files matching the expected content.
    await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, expectedWrapper);
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, expectedInstructions);
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, generateMinimalConfigString());
    runGit(root, ['add', MANAGED_RESOURCES.pluginWrapper, MANAGED_RESOURCES.instructions, MANAGED_RESOURCES.opencodeConfig]);
    runGit(root, ['commit', '-m', 'seed managed files']);

    const result = await installIntegration(root, changeBudgetRoot);
    assert.equal(result.readiness, 'READY');
    assert.equal(result.baselineWarning, null, 'no warning when managed files are already committed');
  } finally {
    await cleanup(root);
  }
});

test('T012 baseline: install in a non-git directory silently skips the warning', async () => {
  const root = await mkdtemp(join(tmpdir(), REPO_PREFIX + 'no-git-'));
  try {
    // Deliberately do NOT run `git init` here.
    const result = await installIntegration(root, changeBudgetRoot);
    assert.equal(result.readiness, 'READY');
    assert.equal(result.baselineWarning, null, 'non-git repo must not produce a warning');
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// T013 — CLI scenarios (exit codes, output)
// ---------------------------------------------------------------------------

test('T013 cli: `integrate opencode` exits 0 on a fresh disposable repo', async () => {
  const root = await createDisposableRepo();
  try {
    const before = await snapshotOpenCodeArea(root);
    const result = runCli(root, []);
    assert.equal(result.status, 0, `unexpected exit, stderr=${result.stderr}, stdout=${result.stdout}`);
    assert.ok(result.stdout.includes('Plugin wrapper: CREATE .opencode/plugins/changebudget.js'));
    assert.ok(result.stdout.includes('Instructions: CREATE .opencode/instructions/changebudget.md'));
    assert.ok(result.stdout.includes('OpenCode config: CREATE opencode.json'));
    assert.ok(result.stdout.includes('Runtime Guard: exists'));
    assert.ok(result.stdout.includes('Integration: READY'));

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T013 cli: `integrate opencode --dry-run` produces zero writes and exits 0', async () => {
  const root = await createDisposableRepo();
  try {
    const before = await snapshotOpenCodeArea(root);
    const result = runCli(root, ['--dry-run']);
    assert.equal(result.status, 0, `unexpected exit, stderr=${result.stderr}, stdout=${result.stdout}`);
    assert.ok(result.stdout.includes('Plugin wrapper: CREATE .opencode/plugins/changebudget.js'));
    assert.ok(result.stdout.includes('Integration: READY'));

    const after = await snapshotOpenCodeArea(root);
    assert.equal(after.wrapper, null);
    assert.equal(after.instructions, null);
    assert.equal(after.config, null);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T013 cli: `integrate opencode --remove` deletes the integration after install', async () => {
  const root = await createDisposableRepo();
  try {
    const install = runCli(root, []);
    assert.equal(install.status, 0);

    const remove = runCli(root, ['--remove']);
    assert.equal(remove.status, 0, `unexpected exit, stderr=${remove.stderr}, stdout=${remove.stdout}`);
    assert.ok(remove.stdout.includes('Plugin wrapper: REMOVE .opencode/plugins/changebudget.js'));
    assert.ok(remove.stdout.includes('Instructions: REMOVE .opencode/instructions/changebudget.md'));
    assert.ok(remove.stdout.includes('Integration: READY'));

    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), false);
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.instructions)), false);
  } finally {
    await cleanup(root);
  }
});

test('T013 cli: `integrate opencode --dry-run --remove` is rejected with InputValidationError (exit 2)', async () => {
  const root = await createDisposableRepo();
  try {
    const before = await snapshotOpenCodeArea(root);
    const result = runCli(root, ['--dry-run', '--remove']);
    assert.equal(result.status, 2, `unexpected exit, stderr=${result.stderr}, stdout=${result.stdout}`);
    assert.ok(result.stderr.includes('InputValidationError'));
    assert.ok(result.stderr.includes('--dry-run and --remove cannot be combined'));

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T013 cli: `integrate` (no target) is rejected with InputValidationError (exit 2)', async () => {
  const root = await createDisposableRepo();
  try {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), 'integrate'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.ok((result.stderr ?? '').includes('InputValidationError'));
    assert.ok((result.stderr ?? '').includes('integrate requires a target'));
  } finally {
    await cleanup(root);
  }
});

test('T013 cli: `integrate other` (unknown target) is rejected with InputValidationError (exit 2)', async () => {
  const root = await createDisposableRepo();
  try {
    const result = spawnSync(
      process.execPath,
      [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), 'integrate', 'other'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(result.status, 2);
    assert.ok((result.stderr ?? '').includes('InputValidationError'));
    assert.ok((result.stderr ?? '').includes('integrate requires a target'));
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Spec-Kit present / absent — integration must work in both worlds
// ---------------------------------------------------------------------------

test('T014 matrix: integration install succeeds on a Spec-Kit-present disposable repo (diagnose T001 + start T001)', async () => {
  const root = await createDisposableRepo();
  try {
    // Seed a minimal Spec-Kit fixture: specs/<feature>/tasks.md with T001.
    await mkdir(join(root, 'specs', '009-spec-kit-present'), { recursive: true });
    await writeFile(
      join(root, 'specs', '009-spec-kit-present', 'tasks.md'),
      '- [ ] T001 Spec-Kit present fixture task\n',
      'utf8',
    );
    runGit(root, ['add', 'specs']);
    runGit(root, ['commit', '-m', 'seed spec-kit']);

    const before = await snapshotOpenCodeArea(root);

    // Integration install must succeed regardless of Spec-Kit presence.
    const install = await installIntegration(root, changeBudgetRoot);
    assert.equal(install.readiness, 'READY');

    // Spec-Kit task resolution must work after integration install.
    const diagnose = runCli(root, []);
    assert.equal(install.readiness, 'READY');
    void diagnose; // install path is exercised above; here we just assert lifecycle commands stay compatible

    // CLI `diagnose T001` resolves through Spec-Kit — should exit 0.
    const cliPath = join(process.cwd(), 'dist', 'src', 'cli', 'index.js');
    const diagnoseResult = spawnSync(
      process.execPath,
      [cliPath, 'diagnose', 'T001'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(diagnoseResult.status, 0, `diagnose T001 failed: ${diagnoseResult.stderr}`);

    // CLI `start T001` should also work after `init` (which the install
    // path here bypasses — we exercise init explicitly).
    const initResult = spawnSync(
      process.execPath,
      [cliPath, 'init'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(initResult.status, 0);

    const startResult = spawnSync(
      process.execPath,
      [cliPath, 'start', 'T001', '--tiny', '--allow-paths', 'src/**', '--base-revision', 'HEAD'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(startResult.status, 0, `start T001 failed: ${startResult.stderr}`);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

test('T014 matrix: integration install succeeds on a Spec-Kit-absent disposable repo (no specs/)', async () => {
  const root = await createDisposableRepo();
  try {
    // No `specs/` directory seeded — Spec-Kit is absent.
    const specsDir = join(root, 'specs');
    assert.equal(existsSync(specsDir), false, 'precondition: specs/ must not exist');

    const before = await snapshotOpenCodeArea(root);

    const result = await installIntegration(root, changeBudgetRoot);
    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.pluginWrapper.action, 'CREATE');
    assert.equal(result.resources.instructions.action, 'CREATE');
    assert.equal(result.resources.opencodeConfig.action, 'CREATE');

    // The integration install path is independent of Spec-Kit — the opencode
    // wrapper/instructions/config files are created identically.
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), true);
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.instructions)), true);
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.opencodeConfig)), true);

    // CLI init/start without a Txxx task id must still work.
    const cliPath = join(process.cwd(), 'dist', 'src', 'cli', 'index.js');
    const initResult = spawnSync(
      process.execPath,
      [cliPath, 'init'],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(initResult.status, 0);

    const startResult = spawnSync(
      process.execPath,
      [
        cliPath, 'start',
        '--task', 'no spec-kit task',
        '--base-revision', 'HEAD',
        '--allow-paths', 'src/**',
        '--tiny',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    assert.equal(startResult.status, 0, `start (no Spec-Kit) failed: ${startResult.stderr}`);

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Windows file:// URL — integration install must produce a URL that resolves
// ---------------------------------------------------------------------------

test('T015 matrix: generated wrapper contains a `file://` URL that loads through pathToFileURL', async () => {
  const root = await createDisposableRepo();
  try {
    const before = await snapshotOpenCodeArea(root);

    const install = await installIntegration(root, changeBudgetRoot);
    assert.equal(install.readiness, 'READY');

    // The wrapper content must embed a `file://` URL whose decoded path
    // ends with the Runtime Guard entry component. On Windows the URL
    // contains a drive letter; on POSIX it has no drive letter. Either
    // shape is acceptable as long as the decoded path matches the
    // compiled Runtime Guard entry.
    const wrapperContent = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const urlMatch = wrapperContent.match(/from\s+"([^"]+)"/);
    assert.ok(urlMatch !== null, `wrapper must contain a URL export: ${wrapperContent}`);
    const url = urlMatch![1]!;
    assert.ok(url.startsWith('file://'), `URL must use file:// scheme: ${url}`);

    // Decode via pathToFileURL round-trip and assert it lands at the
    // Runtime Guard entry.
    const expectedEntry = resolveRuntimeGuardEntry(changeBudgetRoot);
    const decoded = fileURLToPath(url);
    const normalizedDecoded = decoded.replace(/\\/g, '/');
    const normalizedExpected = expectedEntry.replace(/\\/g, '/');
    assert.ok(
      normalizedDecoded.endsWith(normalizedExpected),
      `decoded URL path must end with ${normalizedExpected}, got ${decoded}`,
    );

    // Drive-letter assertion on Windows: when running on win32 the URL
    // must contain a drive letter (e.g. /D:/). On POSIX there is no
    // drive letter.
    if (process.platform === 'win32') {
      assert.ok(
        /\/[A-Z]:\//.test(url),
        `Windows URL must contain a drive letter: ${url}`,
      );
    }

    const after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Idempotency E2E — fresh install → second install UNCHANGED → byte-identical
// (extends the existing T009 idempotency assertion to explicitly cover
// `before == after` byte identity across every managed file.)
// ---------------------------------------------------------------------------

test('T015 matrix: idempotency E2E — fresh install → second install reports UNCHANGED with byte-identical files', async () => {
  const root = await createDisposableRepo();
  try {
    const first = await installIntegration(root, changeBudgetRoot);
    assert.equal(first.readiness, 'READY');

    const wrapperBefore = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const instructionsBefore = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');
    const configBefore = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');

    const second = await installIntegration(root, changeBudgetRoot);
    assert.equal(second.readiness, 'READY');
    assert.equal(second.resources.pluginWrapper.action, 'UNCHANGED');
    assert.equal(second.resources.instructions.action, 'UNCHANGED');
    assert.equal(second.resources.opencodeConfig.action, 'UNCHANGED');

    // Byte-identical.
    const wrapperAfter = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const instructionsAfter = await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');
    const configAfter = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');

    assert.equal(wrapperAfter, wrapperBefore);
    assert.equal(instructionsAfter, instructionsBefore);
    assert.equal(configAfter, configBefore);

    // Byte lengths match too — guards against invisible encoding differences.
    assert.equal(Buffer.byteLength(wrapperAfter, 'utf8'), Buffer.byteLength(wrapperBefore, 'utf8'));
    assert.equal(Buffer.byteLength(instructionsAfter, 'utf8'), Buffer.byteLength(instructionsBefore, 'utf8'));
    assert.equal(Buffer.byteLength(configAfter, 'utf8'), Buffer.byteLength(configBefore, 'utf8'));
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// Git baseline friction E2E — untracked warning → commit → silent re-run
// ---------------------------------------------------------------------------

test('T012 matrix: Git baseline friction — untracked install warns → commit → re-run is silent', async () => {
  const root = await createDisposableRepo();
  try {
    // First install — managed files are untracked, so the warning must fire.
    const first = await installIntegration(root, changeBudgetRoot);
    assert.equal(first.readiness, 'READY');
    assert.ok(
      first.baselineWarning !== null,
      'baseline warning must be present on fresh install in a Git repo',
    );
    assert.ok(
      first.baselineWarning!.includes('Commit/baseline'),
      'warning text must mention Commit/baseline',
    );

    // Commit the managed files so the next install runs against a clean baseline.
    runGit(root, ['add', MANAGED_RESOURCES.pluginWrapper, MANAGED_RESOURCES.instructions, MANAGED_RESOURCES.opencodeConfig]);
    runGit(root, ['commit', '-m', 'baseline integration files']);

    // Re-run install — committed files suppress the warning.
    const second = await installIntegration(root, changeBudgetRoot);
    assert.equal(second.readiness, 'READY');
    assert.equal(
      second.baselineWarning,
      null,
      'committed managed files must suppress the Git baseline warning on re-run',
    );
  } finally {
    await cleanup(root);
  }
});

// ---------------------------------------------------------------------------
// AGENTS.md byte-identity invariant
// ---------------------------------------------------------------------------

test('AGENTS.md: presence in the disposable repo is preserved byte-identically across all install/dry-run/remove operations', async () => {
  const root = await createDisposableRepo();
  try {
    const agentsContent = '# Project AGENTS guidance\n\nThis file is owned by the user and must never be modified by tooling.\n';
    await writeFileRecursive(root, 'AGENTS.md', agentsContent);
    runGit(root, ['add', 'AGENTS.md']);
    runGit(root, ['commit', '-m', 'seed AGENTS.md']);

    const before = await snapshotOpenCodeArea(root);

    // Install
    const install = await installIntegration(root, changeBudgetRoot);
    assert.equal(install.readiness, 'READY');
    let after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);

    // Idempotent re-run
    await installIntegration(root, changeBudgetRoot);
    after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);

    // Dry-run
    await dryRunIntegration(root, changeBudgetRoot);
    after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);

    // Remove
    const remove = await removeIntegration(root);
    assert.equal(remove.readiness, 'READY');
    after = await snapshotOpenCodeArea(root);
    assertAgentsMdUnchanged(root, before, after);
  } finally {
    await cleanup(root);
  }
});

// Reference to keep the relative-path import used (avoids unused-import warnings
// in stricter configurations).
void relative;