import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  parseTaskLine,
  discoverTaskSources,
  resolveSpecKitTask,
} from '../../src/core/spec-kit/tasks.js';
import {
  isTaskIdInput,
  canonicalizeTaskId,
  SpecKitTaskResolution,
} from '../../src/models/spec-kit-task.js';
import { ChangeBudgetError, InputValidationError, IOStateError } from '../../src/models/errors.js';

async function createFixtureRepo(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-spec-kit-tasks-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }

  return root;
}

async function readTree(root: string): Promise<Record<string, string>> {
  const output: Record<string, string> = {};

  async function walk(directory: string): Promise<void> {
    const items = await readdir(directory, { withFileTypes: true });

    for (const item of items) {
      const absolute = join(directory, item.name);
      const relative = absolute.slice(root.length + 1).replace(/\\/g, '/');

      if (item.isDirectory()) {
        await walk(absolute);
      } else {
        output[relative] = await readFile(absolute, 'utf8');
      }
    }
  }

  await walk(root);
  return output;
}

test('T003: task ID grammar accepts valid IDs and canonicalizes to uppercase', () => {
  const valid = ['T031', 't031', 'T12345'];

  for (const value of valid) {
    assert.equal(isTaskIdInput(value), true, `expected ${value} to match the task ID grammar`);
  }

  assert.equal(canonicalizeTaskId('t031'), 'T031');
  assert.equal(canonicalizeTaskId('T12345'), 'T12345');
});

test('T003: task ID grammar rejects invalid IDs', () => {
  const invalid = ['T31', 'T031x', '031', 'T', 'T03', 'foo', '', 'specs/foo'];

  for (const value of invalid) {
    assert.equal(isTaskIdInput(value), false, `expected ${value} to be rejected`);
  }
});

test('T003: parseTaskLine parses valid task lines into canonical IDs and titles', () => {
  const cases = [
    {
      line: '- [ ] T031 Implement task bridge',
      id: 'T031',
      title: 'Implement task bridge',
      budget: null,
    },
    { line: '- [ ] t042 lowercase id', id: 'T042', title: 'lowercase id', budget: null },
    { line: '- [x] T030 Sign off baseline', id: 'T030', title: 'Sign off baseline', budget: null },
    { line: '- [X] T029 Done uppercase', id: 'T029', title: 'Done uppercase', budget: null },
    {
      line: '- [ ] T031 [budget:tiny] Implement task bridge',
      id: 'T031',
      title: 'Implement task bridge',
      budget: 'tiny',
    },
    {
      line: '- [ ] T031 [budget:normal] [other] Title here',
      id: 'T031',
      title: 'Title here',
      budget: 'normal',
    },
    {
      line: '- [ ] T031 [BUDGET:free] Free budget',
      id: 'T031',
      title: 'Free budget',
      budget: 'free',
    },
    {
      line: '- [ ] T031 Add [budget] support',
      id: 'T031',
      title: 'Add [budget] support',
      budget: null,
    },
  ];

  for (const scenario of cases) {
    const parsed = parseTaskLine(scenario.line);
    assert.notEqual(parsed, null, `expected a parsed line for: ${scenario.line}`);
    assert.equal(parsed!.kind, 'ok');
    assert.deepEqual(parsed!.entry, {
      task_id: scenario.id,
      title: scenario.title,
      budget_annotation: scenario.budget,
    });
  }
});

test('T003: parseTaskLine extracts budget annotations syntactically without validation', () => {
  const lines = ['- [ ] T031 [budget:custom] Custom', '- [ ] T031 [budget:] Empty', '- [ ] T031 [budget:small] Small'];

  for (const line of lines) {
    const parsed = parseTaskLine(line);
    assert.equal(parsed?.kind, 'ok');
    assert.equal(typeof parsed!.entry.budget_annotation, 'string');
  }

  assert.equal(parseTaskLine('- [ ] T031 [budget:custom] Custom')!.entry.budget_annotation, 'custom');
  assert.equal(parseTaskLine('- [ ] T031 [budget:] Empty')!.entry.budget_annotation, '');
});

test('T003: parseTaskLine returns null for malformed and non-task lines', () => {
  const cases = [
    '',
    '   ',
    'text without dash',
    '- [] T031 no checkbox',
    '- [- ] T031 weird',
    '- [ ] 31 too few digits',
    '- [ ] T031x bad id',
    '- [ ] T31 bad id',
    '- T031 no checkbox',
    '# heading',
    '- [x] T031x no title bad id',
  ];

  for (const line of cases) {
    assert.equal(parseTaskLine(line), null, `expected null for: ${line}`);
  }
});

test('T003: parseTaskLine flags task lines with empty titles', () => {
  const cases = [
    { line: '- [ ] T031', budget: null },
    { line: '- [ ] T031   ', budget: null },
    { line: '- [ ] T031 [budget:tiny]', budget: 'tiny' },
    { line: '- [x] T030', budget: null },
  ];

  for (const scenario of cases) {
    const parsed = parseTaskLine(scenario.line);
    assert.equal(parsed?.kind, 'empty_title', `expected empty_title for: ${scenario.line}`);
    assert.equal(parsed!.entry.task_id, scenario.line.includes('T030') ? 'T030' : 'T031');
    assert.equal(parsed!.entry.budget_annotation, scenario.budget);
  }
});

test('T003: discoverTaskSources returns no sources when specs/ is absent', async (t) => {
  const root = await createFixtureRepo({});
  t.after(() => rm(root, { recursive: true, force: true }));

  assert.deepEqual(await discoverTaskSources(root), []);
});

test('T003: discoverTaskSources lists feature directories with tasks.md in lexicographic order', async (t) => {
  const root = await createFixtureRepo({
    'specs/beta/tasks.md': '- [ ] T001 beta\n',
    'specs/alpha/tasks.md': '- [ ] T002 alpha\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const sources = await discoverTaskSources(root);
  assert.deepEqual(sources, [
    { feature: 'alpha', relativePath: 'specs/alpha/tasks.md' },
    { feature: 'beta', relativePath: 'specs/beta/tasks.md' },
  ]);
});

test('T009: discoverTaskSources orders non-ASCII feature directories by code units', async (t) => {
  const root = await createFixtureRepo({
    'specs/ä/tasks.md': '- [ ] T001 ae task\n',
    'specs/z/tasks.md': '- [ ] T002 zed task\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const sources = await discoverTaskSources(root);
  assert.deepEqual(sources, [
    { feature: 'z', relativePath: 'specs/z/tasks.md' },
    { feature: 'ä', relativePath: 'specs/ä/tasks.md' },
  ]);
});

test('T003: discoverTaskSources ignores non-feature entries and features without tasks.md', async (t) => {
  const root = await createFixtureRepo({
    'specs/with-tasks/tasks.md': '- [ ] T001 main\n',
    'specs/with-tasks/nested/tasks.md': '- [ ] T002 nested\n',
    'specs/empty/README.md': 'no tasks here',
    'specs/notes.md': '- [ ] T003 loose\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const sources = await discoverTaskSources(root);
  assert.deepEqual(sources, [
    { feature: 'with-tasks', relativePath: 'specs/with-tasks/tasks.md' },
  ]);
});

test('T003: resolveSpecKitTask resolves the sole exact match deterministically', async (t) => {
  const root = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T031 Title in alpha\n- [ ] T042 Other task\n',
    'specs/beta/tasks.md': '- [ ] T043 Unrelated\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const resolution = await resolveSpecKitTask(root, 'T031');
  assert.deepEqual(resolution, {
    task_id: 'T031',
    task_title: 'Title in alpha',
    source_feature: 'alpha',
    source_path: 'specs/alpha/tasks.md',
    budget_default: null,
  });

  const lowercaseEquivalent = await resolveSpecKitTask(root, 't031');
  assert.deepEqual(lowercaseEquivalent, resolution);
});

test('T003: resolveSpecKitTask carries a syntax-only budget annotation', async (t) => {
  const root = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T032 [budget:tiny] Small task\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const resolution = await resolveSpecKitTask(root, 'T032');
  assert.equal(resolution.budget_default, 'tiny');
});

test('T003: resolveSpecKitTask fails deterministically for unknown task IDs', async (t) => {
  const root = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T031 Title\n',
    'specs/beta/tasks.md': '- [ ] T043 Unrelated\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(resolveSpecKitTask(root, 'T999'), (error: unknown) => {
    assert.ok(error instanceof InputValidationError);
    assert.equal(
      (error as InputValidationError).message,
      'Task id T999 was not found in any tasks.md file under specs/.',
    );
    assert.deepEqual(
      (error as InputValidationError).context.scanned_sources,
      ['specs/alpha/tasks.md', 'specs/beta/tasks.md'],
    );
    return true;
  });
});

test('T003: resolveSpecKitTask fails deterministically for ambiguous task IDs across sources', async (t) => {
  const root = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T033 Alpha copy\n',
    'specs/beta/tasks.md': '- [ ] T033 Beta copy\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(resolveSpecKitTask(root, 'T033'), (error: unknown) => {
    assert.ok(error instanceof InputValidationError);
    assert.deepEqual(
      (error as InputValidationError).context.sources,
      ['specs/alpha/tasks.md', 'specs/beta/tasks.md'],
    );
    return true;
  });
});

test('T003: resolveSpecKitTask fails deterministically for duplicate IDs within one source', async (t) => {
  const root = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T034 First\n- [ ] T034 Second\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(resolveSpecKitTask(root, 'T034'), (error: unknown) => {
    assert.ok(error instanceof InputValidationError);
    assert.deepEqual((error as InputValidationError).context.sources, ['specs/alpha/tasks.md']);
    return true;
  });
});

test('T003: resolveSpecKitTask fails deterministically when the sole match has no usable title', async (t) => {
  const root = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T035\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(resolveSpecKitTask(root, 'T035'), (error: unknown) => {
    assert.ok(error instanceof InputValidationError);
    assert.equal(
      (error as InputValidationError).message,
      'Task id T035 cannot be associated because its task line has no usable title.',
    );
    assert.equal((error as InputValidationError).context.source_path, 'specs/alpha/tasks.md');
    return true;
  });
});

test('T003: resolveSpecKitTask is read-only and leaves the fixture untouched', async (t) => {
  const files: Record<string, string> = {
    'specs/alpha/tasks.md': '- [ ] T031 [budget:tiny] Read only\n- [x] T030 Done\n',
  };
  const root = await createFixtureRepo(files);
  t.after(() => rm(root, { recursive: true, force: true }));

  const before = await readTree(root);
  const resolution: SpecKitTaskResolution = await resolveSpecKitTask(root, 'T031');
  const after = await readTree(root);

  assert.equal(resolution.task_id, 'T031');
  assert.deepEqual(after, before);
});

test('T009: lowercase input resolves identically to canonical across case variants', async (t) => {
  const root = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T031 Title in alpha\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const expected: SpecKitTaskResolution = {
    task_id: 'T031',
    task_title: 'Title in alpha',
    source_feature: 'alpha',
    source_path: 'specs/alpha/tasks.md',
    budget_default: null,
  };

  const inputs = ['T031', 't031'];
  for (const input of inputs) {
    const resolution = await resolveSpecKitTask(root, input);
    assert.deepEqual(resolution, expected, `resolution for ${input}`);
  }

  assert.deepEqual(
    await resolveSpecKitTask(root, 't031'),
    await resolveSpecKitTask(root, 'T031'),
  );
});

test('T009: an unreadable tasks.md yields IOStateError, never a silent not-found', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cb-spec-kit-unreadable-'));

  try {
    await mkdir(join(root, 'specs', 'alpha', 'tasks.md'), { recursive: true });

    await assert.rejects(resolveSpecKitTask(root, 'T999'), (error: unknown) => {
      assert.ok(error instanceof IOStateError);
      assert.equal(error.name, 'IOStateError');
      assert.notEqual(error instanceof InputValidationError, true);
      assert.equal((error as IOStateError).message.includes('specs/alpha/tasks.md'), true);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T009: symlinked directories under specs/ are excluded from discovery and resolution', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'cb-spec-kit-symlink-'));

  try {
    await mkdir(join(root, 'specs', 'real'), { recursive: true });
    await writeFile(join(root, 'specs', 'real', 'tasks.md'), '- [ ] T031 Real only\n');

    await mkdir(join(root, 'linked-target'), { recursive: true });
    await writeFile(join(root, 'linked-target', 'tasks.md'), '- [ ] T999 Outside tasks\n');
    await symlink(join(root, 'linked-target'), join(root, 'specs', 'linked'), 'dir');

    const sources = await discoverTaskSources(root);
    assert.deepEqual(sources, [
      { feature: 'real', relativePath: 'specs/real/tasks.md' },
    ]);

    const inReal = await resolveSpecKitTask(root, 'T031');
    assert.equal(inReal.source_feature, 'real');

    await assert.rejects(resolveSpecKitTask(root, 'T999'), (error: unknown) => {
      assert.ok(error instanceof InputValidationError);
      assert.deepEqual(
        (error as InputValidationError).context.scanned_sources,
        ['specs/real/tasks.md'],
      );
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('T009: repeated resolution calls produce byte-identical errors and leave the tree untouched', async (t) => {
  const root = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T031 Title in alpha\n- [ ] T033 Edge\n',
    'specs/beta/tasks.md': '- [ ] T032 Other\n',
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const snapshotTree = await readTree(root);

  async function capture(repoRoot: string, input: string, label: string): Promise<string> {
    try {
      await resolveSpecKitTask(repoRoot, input);
      throw new Error(`expected ${label} to reject`);
    } catch (error: unknown) {
      if (error instanceof Error) {
        const context = error instanceof ChangeBudgetError ? error.context : {};
        return `${error.name}|${error.message}|${JSON.stringify(context)}`;
      }

      throw error;
    }
  }

  const unknownFirst = await capture(root, 'T999', 'unknown');
  const unknownSecond = await capture(root, 'T999', 'unknown');
  assert.equal(unknownSecond, unknownFirst);

  const edgeFirst = await capture(root, 'T033', 'edge');
  const edgeSecond = await capture(root, 'T033', 'edge');
  assert.equal(edgeSecond, edgeFirst);

  const ambiguousRoot = await createFixtureRepo({
    'specs/alpha/tasks.md': '- [ ] T031 Alpha\n',
    'specs/beta/tasks.md': '- [ ] T031 Beta\n',
  });
  t.after(() => rm(ambiguousRoot, { recursive: true, force: true }));

  const ambiguityFirst = await capture(ambiguousRoot, 'T031', 'ambiguity');
  const ambiguitySecond = await capture(ambiguousRoot, 'T031', 'ambiguity');
  assert.equal(ambiguitySecond, ambiguityFirst);

  const resolvedFirst = await resolveSpecKitTask(root, 'T031');
  const resolvedSecond = await resolveSpecKitTask(root, 'T031');
  assert.deepEqual(resolvedSecond, resolvedFirst);

  assert.deepEqual(await readTree(root), snapshotTree);
});