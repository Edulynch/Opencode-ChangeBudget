import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, writeFile, rm, readFile, mkdir, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const FEATURE = '007-feature';
const SOURCE_PATH = `specs/${FEATURE}/tasks.md`;

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

async function createRepositoryWithCommit(files: Record<string, string> = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-diagnose-'));

  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(join(root, relativePath.split('/').slice(0, -1).join('/')), { recursive: true });
    await writeFile(target, content);
  }

  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'diagnose integration']);
  runGit(root, ['config', 'user.email', 'diagnose@test']);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'seed']);

  return root;
}

async function createEmptyRepositoryWithCommit(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-diagnose-'));

  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'diagnose integration']);
  runGit(root, ['config', 'user.email', 'diagnose@test']);
  runGit(root, ['commit', '--allow-empty', '-m', 'seed']);

  return root;
}

async function createSpecsFixture(root: string, feature: string, content: string): Promise<void> {
  await mkdir(join(root, 'specs', feature), { recursive: true });
  await writeFile(join(root, 'specs', feature, 'tasks.md'), content);
}

async function writeTrackedFile(root: string, relativePath: string, content: string): Promise<void> {
  await mkdir(join(root, relativePath.split('/').slice(0, -1).join('/')), { recursive: true });
  await writeFile(join(root, relativePath), content);
  runGit(root, ['add', relativePath.replace(/\\/g, '/')]);
  runGit(root, ['commit', '-m', `add ${relativePath}`]);
}

async function snapshotState(root: string): Promise<string> {
  const parts: string[] = [];
  parts.push(`git:${runGitStatusPorcelain(root)}`);

  const stateDir = join(root, '.changebudget');
  if (existsSync(stateDir)) {
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

    parts.push(
      entries
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((entry) => `.changebudget/${entry.path}:${entry.content}`)
        .join('\n'),
    );
  }

  const specsDir = join(root, 'specs');
  if (existsSync(specsDir)) {
    const taskFiles: string[] = [];

    async function collect(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await collect(full);
        } else if (entry.name === 'tasks.md') {
          taskFiles.push(`${full.slice(root.length + 1).replace(/\\/g, '/')}:${await readFile(full, 'utf8')}`);
        }
      }
    }

    await collect(specsDir);
    parts.push(taskFiles.sort().join('\n'));
  }

  return parts.join('\n');
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCliCommand(root: string, command: string, args: string[] = []): CliResult {
  const result = spawnSync(process.execPath, [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), command, ...args], {
    cwd: root,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function runCliDiagnose(root: string, args: string[] = []): CliResult {
  return runCliCommand(root, 'diagnose', args);
}

test('T011: bare diagnose run reports manual review with declared_paths 0 and exits 0', async () => {
  const root = await createEmptyRepositoryWithCommit();

  try {
    const before = await snapshotState(root);
    const result = runCliDiagnose(root);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Recommendation: manual review\n'), true);
    assert.equal(result.stdout.includes('Source: inferred\n'), true);
    assert.equal(result.stdout.includes('  - declared_paths: 0\n'), true);
    assert.equal(await snapshotState(root), before);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T011: prose-only diagnose run reports manual review and never guesses a preset', async () => {
  const root = await createEmptyRepositoryWithCommit();

  try {
    const before = await snapshotState(root);
    const result = runCliDiagnose(root, ['--task', 'Refactor module']);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Recommendation: manual review\n'), true);
    assert.equal(result.stdout.includes('  - declared_paths: 0\n'), true);
    assert.equal(await snapshotState(root), before);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T011: structural diagnose run yields deterministic recommendation, source, and ordered reasons', async () => {
  const root = await createRepositoryWithCommit({
    'src/ui/button.ts': '// button\n',
    'src/ui/panel.ts': '// panel\n',
    'src/ui/header.ts': '// header\n',
    'src/other/helper.ts': '// helper\n',
  });

  try {
    const result = runCliDiagnose(root, ['--allow-path', 'src/ui/**']);

    assert.equal(result.status, 0);
    const lines = result.stdout.split('\n');
    assert.equal(lines.filter((line) => line.startsWith('Recommendation:')).length, 1);
    assert.equal(lines.filter((line) => line.startsWith('Source:')).length, 1);
    assert.equal(result.stdout.includes('  - declared_paths: 1\n'), true);
    assert.equal(result.stdout.includes('  - tracked_files: 3\n'), true);

    const firstRun = result.stdout;
    const secondRun = runCliDiagnose(root, ['--allow-path', 'src/ui/**']).stdout;
    assert.equal(secondRun, firstRun);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T011: successful runs leave the git working tree byte-identical', async () => {
  const root = await createRepositoryWithCommit({
    'src/ui/button.ts': '// button\n',
    'src/ui/panel.ts': '// panel\n',
  });

  try {
    const porcelainBefore = runGitStatusPorcelain(root);
    const result = runCliDiagnose(root, ['--allow-path', 'src/ui/**']);
    assert.equal(result.status, 0);
    assert.equal(runGitStatusPorcelain(root), porcelainBefore);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T014: valid [budget:tiny] annotation wins as explicit intent with task reasons', async () => {
  const root = await createEmptyRepositoryWithCommit();
  await createSpecsFixture(root, FEATURE, `- [ ] T031 [budget:tiny] Implement task bridge\n`);
  runGit(root, ['add', 'specs']);
  runGit(root, ['commit', '-m', 'seed specs']);

  try {
    const result = runCliDiagnose(root, ['T031']);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Recommendation: tiny\n'), true);
    assert.equal(result.stdout.includes('Source: explicit\n'), true);
    assert.equal(result.stdout.includes('  - task_id: T031\n'), true);
    assert.equal(result.stdout.includes('  - task_budget_default: tiny\n'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T014: conflicting larger declared scope does not override the explicit annotation', async () => {
  const root = await createRepositoryWithCommit({
    'src/ui/a.ts': '// a\n',
    'src/ui/b.ts': '// b\n',
    'src/ui/c.ts': '// c\n',
    'src/ui/d.ts': '// d\n',
    'src/ui/e.ts': '// e\n',
    'src/ui/f.ts': '// f\n',
  });
  await createSpecsFixture(root, FEATURE, `- [ ] T031 [budget:tiny] Implement task bridge\n`);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'seed specs']);

  try {
    const result = runCliDiagnose(root, ['T031', '--allow-path', 'src/ui/**', '--stack-profile', 'node-ts']);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Recommendation: tiny\n'), true);
    assert.equal(result.stdout.includes('Source: explicit\n'), true);
    assert.equal(result.stdout.includes('  - task_budget_default: tiny\n'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T014: invalid [budget:custom] annotation is treated as absent and structural signals decide', async () => {
  const root = await createRepositoryWithCommit({
    'src/ui/a.ts': '// a\n',
    'src/ui/b.ts': '// b\n',
  });
  await createSpecsFixture(root, FEATURE, `- [ ] T031 [budget:custom] Custom budget\n`);
  runGit(root, ['add', '.']);
  runGit(root, ['commit', '-m', 'seed specs']);

  try {
    const result = runCliDiagnose(root, ['T031', '--allow-path', 'src/ui/**']);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Recommendation: tiny\n'), true);
    assert.equal(result.stdout.includes('Source: inferred\n'), true);
    assert.equal(result.stdout.includes('Recommendation: custom\n'), false);
    assert.equal(result.stdout.includes('  - task_budget_default: custom\n'), false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T014: unknown and ambiguous task ids fail deterministically with exit 2 and no recommendation', async () => {
  const root = await createEmptyRepositoryWithCommit();
  await createSpecsFixture(root, FEATURE, `- [ ] T031 [budget:tiny] Implement task bridge\n`);
  runGit(root, ['add', 'specs']);
  runGit(root, ['commit', '-m', 'seed specs']);

  try {
    const unknownBefore = await snapshotState(root);
    const unknown = runCliDiagnose(root, ['T999']);
    assert.equal(unknown.status, 2);
    assert.equal(unknown.stderr.includes('InputValidationError'), true);
    assert.equal(unknown.stderr.includes('not found'), true);
    assert.equal(unknown.stdout.includes('Recommendation:'), false);
    assert.equal(await snapshotState(root), unknownBefore);

    await createSpecsFixture(root, '007-other', `- [ ] T031 Ambiguous duplicate\n`);
    const ambiguousBefore = await snapshotState(root);
    const ambiguous = runCliDiagnose(root, ['T031']);
    assert.equal(ambiguous.status, 2);
    assert.equal(ambiguous.stderr.includes('InputValidationError'), true);
    assert.equal(ambiguous.stderr.includes('ambiguous'), true);
    assert.equal(ambiguous.stdout.includes('Recommendation:'), false);
    assert.equal(await snapshotState(root), ambiguousBefore);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T014: task diagnosis never mutates tasks.md or the git working tree', async () => {
  const tasksContent = `- [ ] T031 [budget:tiny] Implement task bridge\n`;
  const root = await createEmptyRepositoryWithCommit();
  await createSpecsFixture(root, FEATURE, tasksContent);
  runGit(root, ['add', 'specs']);
  runGit(root, ['commit', '-m', 'seed specs']);

  try {
    const before = await snapshotState(root);
    const tasksMdBefore = await readFile(join(root, SOURCE_PATH), 'utf8');

    const result = runCliDiagnose(root, ['t031']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('  - task_id: T031\n'), true);

    const after = await snapshotState(root);
    const tasksMdAfter = await readFile(join(root, SOURCE_PATH), 'utf8');
    assert.equal(after, before);
    assert.equal(tasksMdAfter, tasksMdBefore);
    assert.equal(tasksMdAfter, tasksContent);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T015: no Spec-Kit structure and no stack profile still yields a deterministic structural recommendation', async () => {
  const root = await createRepositoryWithCommit({
    'src/ui/button.ts': '// button\n',
    'src/ui/panel.ts': '// panel\n',
    'src/ui/header.ts': '// header\n',
  });

  try {
    const result = runCliDiagnose(root, ['--allow-path', 'src/ui/**']);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Recommendation: tiny\n'), true);
    assert.equal(result.stdout.includes('Source: inferred\n'), true);
    assert.equal(result.stdout.includes('  - declared_paths: 1\n'), true);
    assert.equal(result.stdout.includes('  - tracked_files: 3\n'), true);
    assert.equal(result.stdout.includes('sensitive_category'), false);

    const first = result.stdout;
    const second = runCliDiagnose(root, ['--allow-path', 'src/ui/**']).stdout;
    assert.equal(second, first);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T015: no stack profile means no category evidence is fabricated', async () => {
  const root = await createRepositoryWithCommit({
    'pom.xml': '<project/>\n',
    'src/main/java/App.java': '// App\n',
  });

  try {
    const result = runCliDiagnose(root, ['--allow-path', 'pom.xml']);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('sensitive_category'), false);
    assert.equal(result.stdout.includes('  - declared_paths: 1\n'), true);
    assert.equal(result.stdout.includes('  - tracked_files: 1\n'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T015: bare run without Spec-Kit or stack reports manual review, not an error, and leaves state unchanged', async () => {
  const root = await createRepositoryWithCommit({
    'src/ui/button.ts': '// button\n',
  });

  try {
    const before = await snapshotState(root);
    const result = runCliDiagnose(root);

    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('Recommendation: manual review\n'), true);
    assert.equal(result.stdout.includes('  - declared_paths: 0\n'), true);
    assert.equal(await snapshotState(root), before);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T017: diagnose with an active contract reports normally, ignores diff evidence, and mutates nothing', async () => {
  const root = await createEmptyRepositoryWithCommit();
  await runCliCommand(root, 'init');
  await createSpecsFixture(root, FEATURE, `- [ ] T031 [budget:tiny] Implement task bridge\n`);
  runGit(root, ['add', 'specs']);
  runGit(root, ['commit', '-m', 'seed specs']);

  try {
    const start = runCliCommand(root, 'start', ['T031', '--base-revision', 'HEAD']);
    assert.equal(start.status, 0);

    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'outside'), { recursive: true });
    await writeFile(join(root, 'src', 'working.ts'), '// uncommitted, matches declared path\n');
    await writeFile(join(root, 'outside', 'extra.ts'), '// uncommitted, outside declared path\n');

    const before = await snapshotState(root);
    const args = ['--allow-path', 'src/**'];

    const first = runCliDiagnose(root, args);
    assert.equal(first.status, 0);
    const second = runCliDiagnose(root, args);
    assert.equal(second.status, 0);
    assert.equal(second.stdout, first.stdout);
    assert.equal(await snapshotState(root), before);
    assert.equal(runCliCommand(root, 'status').status, 0);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T017: N comes from the tracked index only — uncommitted working-tree files do not count', async () => {
  const root = await createEmptyRepositoryWithCommit();
  await runCliCommand(root, 'init');
  await createSpecsFixture(root, FEATURE, `- [ ] T031 [budget:tiny] Implement task bridge\n`);
  runGit(root, ['add', 'specs']);
  runGit(root, ['commit', '-m', 'seed specs']);

  try {
    runCliCommand(root, 'start', ['T031', '--base-revision', 'HEAD']);

    await writeTrackedFile(root, 'src/committed.ts', '// tracked\n');

    await writeFile(join(root, 'src', 'uncommitted.ts'), '// dirty, not in the index\n');

    const result = runCliDiagnose(root, ['--allow-path', 'src/**']);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes('  - tracked_files: 1\n'), true);
    assert.equal(result.stdout.includes('  - tracked_files: 2\n'), false);

    const json = JSON.parse(runCliDiagnose(root, ['--allow-path', 'src/**', '--json']).stdout) as {
      reasons: Array<{ signal: string; value: number | string }>;
    };
    const trackedReason = json.reasons.find((reason) => reason.signal === 'tracked_files');
    assert.deepEqual(trackedReason, { signal: 'tracked_files', value: 1 });
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T020: --json emits fixed key order and a literal manual_review on bare runs', async () => {
  const root = await createEmptyRepositoryWithCommit();

  try {
    const result = runCliDiagnose(root, ['--json']);
    assert.equal(result.status, 0);

    const payload = JSON.parse(result.stdout) as Record<string, unknown>;
    assert.deepEqual(Object.keys(payload), ['recommendation', 'source', 'reasons', 'inputs']);
    assert.equal(payload.recommendation, 'manual_review');
    assert.equal(payload.source, 'inferred');
    assert.deepEqual(payload.reasons, [{ signal: 'declared_paths', value: 0 }]);

    const inputs = payload.inputs as Record<string, unknown>;
    assert.deepEqual(Object.keys(inputs), ['task_id', 'task_description', 'allow_paths', 'deny_paths', 'stack_profile']);
    assert.equal(inputs.task_id, null);
    assert.equal(inputs.task_description, null);
    assert.deepEqual(inputs.allow_paths, []);
    assert.deepEqual(inputs.deny_paths, []);
    assert.equal(inputs.stack_profile, null);

    const repeats = [runCliDiagnose(root, ['--json']).stdout, runCliDiagnose(root, ['--json']).stdout];
    assert.equal(repeats[1], repeats[0]);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T020: --json and human output agree on recommendation, source, and ordered reasons', async () => {
  const root = await createRepositoryWithCommit({
    'src/ui/a.ts': '// a\n',
    'src/ui/b.ts': '// b\n',
    'src/ui/c.ts': '// c\n',
  });

  try {
    const human = runCliDiagnose(root, ['--allow-path', 'src/ui/**']).stdout;
    const json = runCliDiagnose(root, ['--allow-path', 'src/ui/**', '--json']).stdout;
    const payload = JSON.parse(json) as {
      recommendation: string;
      source: string;
      reasons: Array<{ signal: string; value: string | number }>;
    };

    assert.equal(payload.recommendation, 'tiny');
    assert.equal(payload.source, 'inferred');
    assert.deepEqual(payload.reasons, [
      { signal: 'declared_paths', value: 1 },
      { signal: 'tracked_files', value: 3 },
    ]);

    assert.equal(human.includes(`Recommendation: ${payload.recommendation}\n`), true);
    assert.equal(human.includes(`Source: ${payload.source}\n`), true);

    const humanReasonLines = human
      .split('\n')
      .filter((line) => line.startsWith('  - '))
      .map((line) => line.replace(/^  - /, ''));
    const jsonReasonLines = payload.reasons.map((reason) => `${reason.signal}: ${reason.value}`);
    assert.deepEqual(jsonReasonLines, humanReasonLines);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T020: explicit task annotation serializes as configured intent with task metadata in --json', async () => {
  const root = await createEmptyRepositoryWithCommit();
  await createSpecsFixture(root, FEATURE, `- [ ] T031 [budget:tiny] Implement task bridge\n`);
  runGit(root, ['add', 'specs']);
  runGit(root, ['commit', '-m', 'seed specs']);

  try {
    const json = runCliDiagnose(root, ['T031', '--json']).stdout;
    const payload = JSON.parse(json) as Record<string, unknown>;

    assert.equal(payload.recommendation, 'tiny');
    assert.equal(payload.source, 'explicit');
    assert.deepEqual(payload.reasons, [
      { signal: 'declared_paths', value: 0 },
      { signal: 'task_id', value: 'T031' },
      { signal: 'task_budget_default', value: 'tiny' },
    ]);

    const inputs = payload.inputs as Record<string, unknown>;
    assert.equal(inputs.task_id, 'T031');
    assert.equal(inputs.stack_profile, null);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T020: repeated --json runs on identical state are byte-identical across shapes', async () => {
  const root = await createRepositoryWithCommit({
    'src/main/resources/db/changelog/changelog.xml': '<changelog/>\n',
    'src/main/resources/db/changelog/001-init.xml': '<changelog/>\n',
  });

  try {
    const args = ['--allow-path', 'src/main/resources/db/changelog/**', '--stack-profile', 'spring-boot', '--json'];
    const first = runCliDiagnose(root, args).stdout;
    const second = runCliDiagnose(root, args).stdout;
    assert.equal(second, first);

    const payload = JSON.parse(first) as {
      recommendation: string;
      reasons: Array<{ signal: string; value: string | number }>;
    };
    assert.equal(payload.recommendation, 'manual_review');
    assert.deepEqual(payload.reasons, [
      { signal: 'declared_paths', value: 1 },
      { signal: 'tracked_files', value: 2 },
      { signal: 'sensitive_category', value: 'migrations' },
    ]);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});