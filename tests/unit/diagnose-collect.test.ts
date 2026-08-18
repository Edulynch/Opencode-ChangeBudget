import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { collectObservableSignals } from '../../src/core/diagnose/collect.js';
import { DiagnoseInput, ObservableSignals } from '../../src/models/diagnose.js';
import { SpecKitTaskResolution } from '../../src/models/spec-kit-task.js';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function createTrackedFixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-diagnose-collect-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'collect test']);
  runGit(root, ['config', 'user.email', 'collect@test']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'seed']);

  return root;
}

async function readTree(root: string): Promise<string> {
  const entries: string[] = [];

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        entries.push(`${full.slice(root.length + 1).replace(/\\/g, '/')}`);
      }
    }
  }

  await walk(root);
  return entries.sort().join('\n');
}

const NO_TASK = null;

function baseInput(overrides: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    task_id: null,
    task_description: null,
    allow_paths: [],
    deny_paths: [],
    stack_profile: null,
    json: false,
    ...overrides,
  };
}

test('T009: P counts distinct declared path prefixes (allow + deny)', async (t) => {
  const root = await createTrackedFixture({
    'src/ui/button.ts': '// b\n',
    'src/ui/panel.ts': '// p\n',
    'src/other/helper.ts': '// h\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const signals = await collectObservableSignals(
    root,
    baseInput({ allow_paths: ['src/ui/**'], deny_paths: ['src/other/**'] }),
    NO_TASK,
  );
  assert.equal(signals.declared_path_count, 2);
});

test('T009: N counts tracked files under declared prefixes via git ls-files', async (t) => {
  const root = await createTrackedFixture({
    'src/ui/button.ts': '// b\n',
    'src/ui/panel.ts': '// p\n',
    'src/other/helper.ts': '// h\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const signals = await collectObservableSignals(root, baseInput({ allow_paths: ['src/ui/**'] }), NO_TASK);
  assert.equal(signals.declared_path_count, 1);
  assert.equal(signals.tracked_file_count, 2);
});

test('T009: N is null when no declared paths (no git lookup)', async (t) => {
  const root = await createTrackedFixture({ 'a.txt': 'x\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const signals = await collectObservableSignals(root, baseInput({}), NO_TASK);
  assert.equal(signals.declared_path_count, 0);
  assert.equal(signals.tracked_file_count, null);
});

test('T009: N only counts tracked (indexed) files, ignoring untracked files', async (t) => {
  const root = await createTrackedFixture({ 'src/ui/a.ts': '// a\n' });
  await writeFile(join(root, 'src/ui/uncommitted.ts'), '// u\n');
  t.after(() => rm(root, { recursive: true, force: true }));

  const signals = await collectObservableSignals(root, baseInput({ allow_paths: ['src/ui/**'] }), NO_TASK);
  assert.equal(signals.tracked_file_count, 1);
});

test('T009: C is empty when no stack profile is given (no automatic detection)', async (t) => {
  const root = await createTrackedFixture({ 'pom.xml': '<project/>\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const signals = await collectObservableSignals(root, baseInput({ allow_paths: ['pom.xml'] }), NO_TASK);
  assert.equal(signals.sensitive_categories.length, 0);
});

test('T009: C classifies sensitive categories under an explicit stack profile', async (t) => {
  const root = await createTrackedFixture({
    'pom.xml': '<project/>\n',
    'src/main/resources/db/changelog/changelog.xml': '<changelog/>\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const migrations = await collectObservableSignals(
    root,
    baseInput({ allow_paths: ['src/main/resources/db/changelog/**'], stack_profile: 'spring-boot' }),
    NO_TASK,
  );
  assert.deepEqual(migrations.sensitive_categories, ['migrations']);

  const dependencies = await collectObservableSignals(
    root,
    baseInput({ allow_paths: ['pom.xml'], stack_profile: 'spring-boot' }),
    NO_TASK,
  );
  assert.deepEqual(dependencies.sensitive_categories, ['dependencies']);
});

test('T009: C is deduplicated and lexicographically sorted', async (t) => {
  const root = await createTrackedFixture({
    'pom.xml': '<project/>\n',
    'src/main/resources/application.yml': 'app: x\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const signals = await collectObservableSignals(
    root,
    baseInput({ allow_paths: ['pom.xml', 'src/main/resources/application.yml'], stack_profile: 'spring-boot' }),
    NO_TASK,
  );
  assert.deepEqual(signals.sensitive_categories, ['configuration', 'dependencies']);
});

test('T009: C stays empty when no rule pattern matches the declared paths', async (t) => {
  const root = await createTrackedFixture({ 'src/app.ts': '// x\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const signals = await collectObservableSignals(
    root,
    baseInput({ allow_paths: ['src/app.ts'], stack_profile: 'node-ts' }),
    NO_TASK,
  );
  assert.deepEqual(signals.sensitive_categories, []);
});

test('T009: task metadata maps only a valid budget annotation', async (t) => {
  const root = await createTrackedFixture({ 'a.txt': 'x\n' });
  t.after(() => rm(root, { recursive: true, force: true }));

  const valid: SpecKitTaskResolution = {
    task_id: 'T031',
    task_title: 'Implement task bridge',
    source_feature: '007-example',
    source_path: 'specs/007-example/tasks.md',
    budget_default: 'tiny',
  };
  const tiny = await collectObservableSignals(root, baseInput({}), valid);
  assert.equal(tiny.task_id, 'T031');
  assert.equal(tiny.task_budget_default, 'tiny');

  const invalid: SpecKitTaskResolution = {
    ...valid,
    budget_default: 'custom',
  };
  const ignored = await collectObservableSignals(root, baseInput({}), invalid);
  assert.equal(ignored.task_budget_default, null);

  const absent: SpecKitTaskResolution = {
    ...valid,
    budget_default: null,
  };
  const noAnnotation = await collectObservableSignals(root, baseInput({}), absent);
  assert.equal(noAnnotation.task_budget_default, null);
});

test('T009: collection is read-only — the repository tree is unchanged', async (t) => {
  const files = {
    'src/ui/a.ts': '// a\n',
    'pom.xml': '<project/>\n',
  };
  const root = await createTrackedFixture(files);
  t.after(() => rm(root, { recursive: true, force: true }));

  const before = await readTree(root);
  const signals: ObservableSignals = await collectObservableSignals(
    root,
    baseInput({ allow_paths: ['src/ui/**', 'pom.xml'], stack_profile: 'spring-boot' }),
    NO_TASK,
  );
  const after = await readTree(root);

  assert.equal(signals.tracked_file_count, 2);
  assert.deepEqual(signals.sensitive_categories, ['dependencies']);
  assert.equal(after, before);
});
