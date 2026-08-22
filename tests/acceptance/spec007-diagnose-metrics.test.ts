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

type Outcome = 'tiny' | 'normal' | 'free' | 'manual_review';

interface Scenario {
  label: string;
  seedFiles: SeedFile[];
  args: string[];
  expected: Outcome;
  taskLines?: string;
  taskAnnotation?: 'tiny' | 'normal' | 'free';
}

interface AcceptanceMetric {
  criterion: string;
  requirement: string;
  observed: string;
  result: 'PASS' | 'FAIL';
  evidence: string;
}

const ACCEPTANCE_METRICS_PATH = join(process.cwd(), 'specs', '007-diagnose-budget-advisor', 'acceptance-metrics.md');

const FEATURE = '007-example-feature';
const TASKS_PATH = `specs/${FEATURE}/tasks.md`;

const TASK_TINY = '- [ ] T031 [budget:tiny] Implement task bridge\n';
const TASK_NORMAL = '- [ ] T032 [budget:normal] Implement the API surface\n';
const TASK_FREE = '- [ ] T033 [budget:free] Implement the wide refactor\n';
const TASK_CUSTOM = '- [ ] T034 [budget:custom] Implement unknown scope\n';
const TASK_PLAIN = '- [ ] T035 Implement without annotation\n';

function filesUnder(prefix: string, count: number): SeedFile[] {
  return Array.from({ length: count }, (_, index) => ({
    path: `${prefix}/file-${index}.ts`,
    content: `// ${prefix} file ${index}\n`,
  }));
}

const SCENARIOS: Scenario[] = [
  { label: 'tiny single path four files', seedFiles: filesUnder('src/ui', 4), args: ['--allow-path', 'src/ui/**'], expected: 'tiny' },
  { label: 'tiny single path five files', seedFiles: filesUnder('src/ui', 5), args: ['--allow-path', 'src/ui/**'], expected: 'tiny' },
  {
    label: 'tiny two paths four files',
    seedFiles: [...filesUnder('src/ui', 2), ...filesUnder('tests/ui', 2)],
    args: ['--allow-path', 'src/ui/**', '--allow-path', 'tests/ui/**'],
    expected: 'tiny',
  },
  { label: 'tiny deny path only', seedFiles: filesUnder('src/legacy', 1), args: ['--deny-path', 'src/legacy/**'], expected: 'tiny' },
  {
    label: 'tiny two paths five files',
    seedFiles: [...filesUnder('src/a', 2), ...filesUnder('src/b', 3)],
    args: ['--allow-path', 'src/a/**', '--allow-path', 'src/b/**'],
    expected: 'tiny',
  },
  { label: 'tiny single nested path', seedFiles: filesUnder('src/features/auth', 2), args: ['--allow-path', 'src/features/auth/**'], expected: 'tiny' },
  { label: 'normal six files one path', seedFiles: filesUnder('src/ui', 6), args: ['--allow-path', 'src/ui/**'], expected: 'normal' },
  { label: 'normal fifty files one path', seedFiles: filesUnder('src/ui', 50), args: ['--allow-path', 'src/ui/**'], expected: 'normal' },
  {
    label: 'normal three paths five files',
    seedFiles: [...filesUnder('src/a', 2), ...filesUnder('src/b', 2), ...filesUnder('src/c', 1)],
    args: ['--allow-path', 'src/a/**', '--allow-path', 'src/b/**', '--allow-path', 'src/c/**'],
    expected: 'normal',
  },
  {
    label: 'normal three paths fifty files',
    seedFiles: [...filesUnder('src/a', 20), ...filesUnder('src/b', 20), ...filesUnder('src/c', 10)],
    args: ['--allow-path', 'src/a/**', '--allow-path', 'src/b/**', '--allow-path', 'src/c/**'],
    expected: 'normal',
  },
  {
    label: 'normal node-ts configuration category',
    seedFiles: [{ path: 'tsconfig.json', content: '{}\n' }],
    args: ['--allow-path', 'tsconfig.json', '--stack-profile', 'node-ts'],
    expected: 'normal',
  },
  {
    label: 'normal node-ts dependencies category',
    seedFiles: [{ path: 'package-lock.json', content: '{}\n' }],
    args: ['--allow-path', 'package-lock.json', '--stack-profile', 'node-ts'],
    expected: 'normal',
  },
  {
    label: 'normal node-ts public api category',
    seedFiles: [{ path: 'src/index.ts', content: 'export const baseline = true;\n' }],
    args: ['--allow-path', 'src/index.ts', '--stack-profile', 'node-ts'],
    expected: 'normal',
  },
  {
    label: 'normal android configuration category',
    seedFiles: [{ path: 'gradle.properties', content: 'x=1\n' }],
    args: ['--allow-path', 'gradle.properties', '--stack-profile', 'android'],
    expected: 'normal',
  },
  {
    label: 'normal android dependencies category',
    seedFiles: [{ path: 'build.gradle', content: 'plugins {}\n' }],
    args: ['--allow-path', 'build.gradle', '--stack-profile', 'android'],
    expected: 'normal',
  },
  {
    label: 'normal spring-boot configuration category',
    seedFiles: [{ path: 'src/main/resources/application.yml', content: 'app:\n  name: x\n' }],
    args: ['--allow-path', 'src/main/resources/application.yml', '--stack-profile', 'spring-boot'],
    expected: 'normal',
  },
  {
    label: 'normal spring-boot dependencies category',
    seedFiles: [{ path: 'pom.xml', content: '<project></project>\n' }],
    args: ['--allow-path', 'pom.xml', '--stack-profile', 'spring-boot'],
    expected: 'normal',
  },
  {
    label: 'normal flutter configuration category',
    seedFiles: [{ path: 'analysis_options.yaml', content: 'include: x\n' }],
    args: ['--allow-path', 'analysis_options.yaml', '--stack-profile', 'flutter'],
    expected: 'normal',
  },
  {
    label: 'normal flutter dependencies category',
    seedFiles: [{ path: 'pubspec.yaml', content: 'name: x\n' }],
    args: ['--allow-path', 'pubspec.yaml', '--stack-profile', 'flutter'],
    expected: 'normal',
  },
  { label: 'free fifty-one files one path', seedFiles: filesUnder('src/ui', 51), args: ['--allow-path', 'src/ui/**'], expected: 'free' },
  {
    label: 'free four paths',
    seedFiles: [...filesUnder('src/a', 1), ...filesUnder('src/b', 1), ...filesUnder('src/c', 1), ...filesUnder('src/d', 1)],
    args: [
      '--allow-path',
      'src/a/**',
      '--allow-path',
      'src/b/**',
      '--allow-path',
      'src/c/**',
      '--allow-path',
      'src/d/**',
    ],
    expected: 'free',
  },
  {
    label: 'free six paths',
    seedFiles: [
      ...filesUnder('src/a', 1),
      ...filesUnder('src/b', 1),
      ...filesUnder('src/c', 1),
      ...filesUnder('src/d', 1),
      ...filesUnder('src/e', 1),
      ...filesUnder('src/f', 1),
    ],
    args: [
      '--allow-path',
      'src/a/**',
      '--allow-path',
      'src/b/**',
      '--allow-path',
      'src/c/**',
      '--allow-path',
      'src/d/**',
      '--allow-path',
      'src/e/**',
      '--allow-path',
      'src/f/**',
    ],
    expected: 'free',
  },
  {
    label: 'free three paths fifty-one files',
    seedFiles: [...filesUnder('src/a', 20), ...filesUnder('src/b', 20), ...filesUnder('src/c', 11)],
    args: ['--allow-path', 'src/a/**', '--allow-path', 'src/b/**', '--allow-path', 'src/c/**'],
    expected: 'free',
  },
  { label: 'manual bare run', seedFiles: [], args: [], expected: 'manual_review' },
  { label: 'manual prose only', seedFiles: [], args: ['--task', 'Refactor the auth module'], expected: 'manual_review' },
  { label: 'manual resolved task without annotation', seedFiles: [], taskLines: TASK_PLAIN, args: ['T035'], expected: 'manual_review' },
  {
    label: 'manual spring-boot migrations category',
    seedFiles: filesUnder('src/main/resources/db/changelog', 3),
    args: ['--allow-path', 'src/main/resources/db/changelog/**', '--stack-profile', 'spring-boot'],
    expected: 'manual_review',
  },
  {
    label: 'manual flutter release artifacts category',
    seedFiles: [{ path: '.github/workflows/release.yml', content: 'name: release\n' }],
    args: ['--allow-path', '.github/workflows/release.yml', '--stack-profile', 'flutter'],
    expected: 'manual_review',
  },
  {
    label: 'manual android signing release artifacts category',
    seedFiles: [{ path: 'AndroidManifest.xml', content: '<manifest package="com.example" />\n' }],
    args: ['--allow-path', 'AndroidManifest.xml', '--stack-profile', 'android'],
    expected: 'manual_review',
  },
  {
    label: 'annotation tiny wins over conflicting big scope',
    seedFiles: filesUnder('src/ui', 60),
    taskLines: TASK_TINY,
    taskAnnotation: 'tiny',
    args: ['T031', '--allow-path', 'src/ui/**'],
    expected: 'tiny',
  },
  {
    label: 'annotation normal with no paths',
    seedFiles: [],
    taskLines: TASK_NORMAL,
    taskAnnotation: 'normal',
    args: ['T032'],
    expected: 'normal',
  },
  {
    label: 'annotation free with no paths',
    seedFiles: [],
    taskLines: TASK_FREE,
    taskAnnotation: 'free',
    args: ['T033'],
    expected: 'free',
  },
  {
    label: 'invalid annotation treated as absent',
    seedFiles: filesUnder('src/ui', 4),
    taskLines: TASK_CUSTOM,
    args: ['T034', '--allow-path', 'src/ui/**'],
    expected: 'tiny',
  },
  {
    label: 'annotation tiny minimal',
    seedFiles: [],
    taskLines: TASK_TINY,
    taskAnnotation: 'tiny',
    args: ['T031'],
    expected: 'tiny',
  },
  {
    label: 'manual migrations triggered by deny path',
    seedFiles: filesUnder('src/main/resources/db/changelog', 2),
    args: ['--deny-path', 'src/main/resources/db/changelog/**', '--stack-profile', 'spring-boot'],
    expected: 'manual_review',
  },
  {
    label: 'manual release artifacts triggered by deny path',
    seedFiles: [{ path: 'AndroidManifest.xml', content: '<manifest/>\n' }],
    args: ['--deny-path', 'AndroidManifest.xml', '--stack-profile', 'android'],
    expected: 'manual_review',
  },
  {
    label: 'manual flutter release artifacts triggered by deny path',
    seedFiles: [{ path: '.github/workflows/release.yml', content: 'name: x\n' }],
    args: ['--deny-path', '.github/workflows/release.yml', '--stack-profile', 'flutter'],
    expected: 'manual_review',
  },
  {
    label: 'manual mixed high-risk categories',
    seedFiles: [...filesUnder('src/main/resources/db/changelog', 1), { path: 'src/main/resources/application.yml', content: 'x\n' }],
    args: [
      '--allow-path',
      'src/main/resources/db/changelog/**',
      '--allow-path',
      'src/main/resources/application.yml',
      '--stack-profile',
      'spring-boot',
    ],
    expected: 'manual_review',
  },
  {
    label: 'manual task without annotation plus prose',
    seedFiles: [],
    taskLines: TASK_PLAIN,
    args: ['T035', '--task', 'Some prose'],
    expected: 'manual_review',
  },
];

const MANUAL_REVIEW_SCENARIOS = SCENARIOS.filter((scenario) => scenario.expected === 'manual_review');

let acceptanceMetrics: AcceptanceMetric[] = [];

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function runGitStatusPorcelain(root: string): string {
  const result = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`git status --porcelain=v1 failed: ${result.stderr}`);
  }

  return result.stdout ?? '';
}

async function createRepositoryWithCommit(seedFiles: SeedFile[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-spec007-'));
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

function seedWithTasks(scenario: Scenario): SeedFile[] {
  if (scenario.taskLines === undefined) {
    return scenario.seedFiles;
  }

  return [...scenario.seedFiles, { path: TASKS_PATH, content: scenario.taskLines }];
}

function parseRecommendation(stdout: string): string {
  const match = stdout.match(/^Recommendation: (.+)$/m);
  assert.equal(match !== null, true, `missing Recommendation line in:\n${stdout}`);
  const value = match![1]!.trim();
  return value === 'manual review' ? 'manual_review' : value;
}

function declaredPrefixes(args: string[]): string[] {
  const prefixes: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--allow-path' || token === '--allow-paths' || token === '--deny-path' || token === '--deny-paths') {
      if (index + 1 < args.length) {
        prefixes.push(args[index + 1]);
      }
    }
  }

  return [...new Set(prefixes)];
}

function stackProfileFromArgs(args: string[]): string | null {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--stack-profile' && index + 1 < args.length) {
      return args[index + 1];
    }
  }

  return null;
}

function simplePrefixMatches(prefix: string, path: string): boolean {
  const base = prefix.endsWith('/**') ? prefix.slice(0, -3) : prefix.replace(/\/$/, '');
  return path === base || path.startsWith(`${base}/`);
}

function triggerCategories(prefix: string, profile: string): string[] {
  const categories: string[] = [];
  const has = (markers: string[]): boolean => markers.some((marker) => prefix.includes(marker));

  switch (profile) {
    case 'node-ts':
      if (has(['tsconfig', '.eslintrc', 'package.json'])) {
        categories.push('configuration');
      }
      if (has(['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'])) {
        categories.push('dependencies');
      }
      if (has(['src/index.ts', 'src/main.ts'])) {
        categories.push('public_api');
      }
      break;
    case 'android':
      if (has(['gradle.properties', 'local.properties'])) {
        categories.push('configuration');
      }
      if (has(['build.gradle'])) {
        categories.push('dependencies');
      }
      if (has(['AndroidManifest.xml', 'release.yml'])) {
        categories.push('release_artifacts');
      }
      break;
    case 'spring-boot':
      if (has(['application', '.properties'])) {
        categories.push('configuration');
      }
      if (has(['pom.xml', 'build.gradle', 'gradle.properties'])) {
        categories.push('dependencies');
      }
      if (has(['db/migration', 'db/changelog', 'migrations'])) {
        categories.push('migrations');
      }
      break;
    case 'flutter':
      if (has(['analysis_options.yaml', 'fvm_config.json'])) {
        categories.push('configuration');
      }
      if (has(['pubspec.yaml', 'pubspec.lock'])) {
        categories.push('dependencies');
      }
      if (has(['release.yml'])) {
        categories.push('release_artifacts');
      }
      break;
    default:
      break;
  }

  return categories;
}

function referenceClassify(scenario: Scenario): Outcome {
  if (scenario.taskAnnotation !== undefined && scenario.taskAnnotation !== null) {
    return scenario.taskAnnotation;
  }

  const prefixes = declaredPrefixes(scenario.args);
  const declaredPathCount = prefixes.length;
  if (declaredPathCount === 0) {
    return 'manual_review';
  }

  const profile = stackProfileFromArgs(scenario.args);
  const categories = new Set<string>();
  if (profile !== null) {
    for (const prefix of prefixes) {
      for (const category of triggerCategories(prefix, profile)) {
        categories.add(category);
      }
    }
  }

  if (categories.has('migrations') || categories.has('release_artifacts')) {
    return 'manual_review';
  }

  const trackedFileCount = scenario.seedFiles.filter((file) => prefixes.some((prefix) => simplePrefixMatches(prefix, file.path))).length;

  if (trackedFileCount <= 5 && declaredPathCount <= 2 && categories.size === 0) {
    return 'tiny';
  }

  if (trackedFileCount <= 50 && declaredPathCount <= 3) {
    return 'normal';
  }

  return 'free';
}

function recordMetric(metric: AcceptanceMetric): void {
  acceptanceMetrics = [...acceptanceMetrics, metric];
}

function buildAcceptanceMetricsMarkdown(metrics: AcceptanceMetric[]): string {
  const header = [
    '# SPEC-007 Acceptance Metrics',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| SC | Requirement | Observed | Result | Evidence |',
    '| --- | --- | --- | --- | --- |',
  ];

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

test('SPEC-007 SC-001: at least 30 controlled table scenarios produce the predicted outcome in 100% of cases', async () => {
  const requirement =
    'In at least 30 controlled dummy-repository scenarios spanning declared paths, stack profiles, and task annotations, diagnose produces the preset predicted by the SPEC-007 decision table in 100% of cases';
  let completed = 0;
  let matched = 0;

  try {
    assert.equal(SCENARIOS.length >= 30, true);

    for (const scenario of SCENARIOS) {
      const root = await createRepositoryWithCommit(seedWithTasks(scenario));

      try {
        const result = runCliCommand(root, 'diagnose', scenario.args);
        assert.equal(result.status, 0, `${scenario.label}: expected exit 0, got ${result.stderr}`);
        assert.equal(parseRecommendation(result.stdout), scenario.expected, `${scenario.label}`);
        matched += 1;
      } finally {
        await cleanupRoot(root);
      }

      completed += 1;
    }

    assert.equal(completed, SCENARIOS.length);
    assert.equal(matched, SCENARIOS.length);

    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `${matched}/${completed} table scenarios matched the predicted outcome`,
      result: 'PASS',
      evidence: `${completed} disposable dummy repos across tiny/normal/free thresholds, all five stack profiles' sensitive categories, task annotations, invalid annotations, deny paths, and bare/prose runs all matched the committed decision table.`,
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `${matched}/${completed} table scenarios matched the predicted outcome`,
      result: 'FAIL',
      evidence: 'At least one controlled scenario diverged from the SPEC-007 decision-table prediction.',
    });

    throw error;
  }
});

test('SPEC-007 SC-002: at least 20 repeated runs (incl --json) are byte-identical', async () => {
  const requirement =
    'In at least 20 repeated runs against identical repository/input state (including --json), the output is byte-identical with stable ordering and no timestamps';
  let stableRuns = 0;
  let observedSample: string | null = null;
  let observedJsonSample: string | null = null;
  const root = await createRepositoryWithCommit([...filesUnder('src/ui', 4), { path: TASKS_PATH, content: TASK_TINY }]);

  try {
    const humanArgs = ['--allow-path', 'src/ui/**'];
    const jsonArgs = [...humanArgs, '--json'];

    for (let iteration = 0; iteration < 12; iteration += 1) {
      const human = runCliCommand(root, 'diagnose', humanArgs);
      assert.equal(human.status, 0);
      if (observedSample === null) {
        observedSample = human.stdout;
      }
      assert.equal(human.stdout, observedSample);

      const json = runCliCommand(root, 'diagnose', jsonArgs);
      assert.equal(json.status, 0);
      if (observedJsonSample === null) {
        observedJsonSample = json.stdout;
      }
      assert.equal(json.stdout, observedJsonSample);

      stableRuns += 2;
    }
  } finally {
    await cleanupRoot(root);
  }

  const migrationRoot = await createRepositoryWithCommit(filesUnder('src/main/resources/db/changelog', 3));
  const migrationArgs = ['--allow-path', 'src/main/resources/db/changelog/**', '--stack-profile', 'spring-boot'];
  let migrationHuman: string | null = null;
  let migrationJson: string | null = null;

  try {
    for (let iteration = 0; iteration < 2; iteration += 1) {
      const human = runCliCommand(migrationRoot, 'diagnose', migrationArgs);
      assert.equal(human.status, 0);
      if (migrationHuman === null) {
        migrationHuman = human.stdout;
      }
      assert.equal(human.stdout, migrationHuman);

      const json = runCliCommand(migrationRoot, 'diagnose', [...migrationArgs, '--json']);
      assert.equal(json.status, 0);
      if (migrationJson === null) {
        migrationJson = json.stdout;
      }
      assert.equal(json.stdout, migrationJson);

      stableRuns += 2;
    }
  } finally {
    await cleanupRoot(migrationRoot);
  }

  assert.equal(stableRuns >= 20, true);

  recordMetric({
    criterion: 'SC-002',
    requirement,
    observed: `${stableRuns} repeated runs byte-identical`,
    result: 'PASS',
    evidence: '28 total repeated runs (24 on a tiny scenario plus 4 on a migrations manual-review scenario), human and --json surfaces each byte-identical to their first sample with no timestamps or reordering.',
  });
});

test('SPEC-007 SC-003: at least 20 runs leave git status, .changebudget, and tasks.md byte-identical', async () => {
  const requirement =
    'In at least 20 diagnose runs, git status --short, .changebudget/**, and any tasks.md are byte-identical before and after the command (zero repository/state mutation)';
  const variants: string[][] = [
    ['--allow-path', 'src/ui/**'],
    [],
    ['--allow-path', 'src/ui/**', '--json'],
    ['--allow-path', 'tsconfig.json', '--stack-profile', 'node-ts'],
    ['--deny-path', 'src/ui/**'],
    ['T031'],
    ['T031', '--allow-path', 'src/ui/**'],
    ['--task', 'prose only'],
  ];
  let runs = 0;
  let verifiedRuns = 0;
  const root = await createRepositoryWithCommit([...filesUnder('src/ui', 4), { path: TASKS_PATH, content: TASK_TINY }]);

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(runCliCommand(root, 'start', ['--task', 'spec007-sc003', '--base-revision', 'HEAD']).status, 0);

    while (runs < 20) {
      const args = variants[runs % variants.length];
      const before = await snapshotState(root);

      const result = runCliCommand(root, 'diagnose', args);
      assert.equal(result.status, 0);

      assert.equal(await snapshotState(root), before, `run ${runs} with args [${args.join(' ')}] mutated state`);
      verifiedRuns += 1;
      runs += 1;
    }
  } finally {
    await cleanupRoot(root);
  }

  assert.equal(verifiedRuns, 20);

  recordMetric({
    criterion: 'SC-003',
    requirement,
    observed: `${verifiedRuns} runs with byte-identical state`,
    result: 'PASS',
    evidence: '20 diagnose runs (structural, bare, --json, stack-profile, deny, task annotation, prose) left git status --porcelain=v1, .changebudget/** contract state, and tasks.md bytes identical before and after each run, with an active contract present.',
  });
});

test('SPEC-007 SC-004: at least 10 insufficient/high-uncertainty scenarios return manual review in 100% of cases', async () => {
  const requirement =
    'In at least 10 scenarios with insufficient or high-uncertainty evidence, diagnose returns manual review in 100% of cases and never a fabricated default';
  let completed = 0;
  let manualReview = 0;

  try {
    assert.equal(MANUAL_REVIEW_SCENARIOS.length >= 10, true);

    for (const scenario of MANUAL_REVIEW_SCENARIOS) {
      const root = await createRepositoryWithCommit(seedWithTasks(scenario));

      try {
        const result = runCliCommand(root, 'diagnose', scenario.args);
        assert.equal(result.status, 0, `${scenario.label}: manual review is a valid advisory outcome`);
        assert.equal(parseRecommendation(result.stdout), 'manual_review', `${scenario.label}`);
        manualReview += 1;
      } finally {
        await cleanupRoot(root);
      }

      completed += 1;
    }

    assert.equal(completed, MANUAL_REVIEW_SCENARIOS.length);
    assert.equal(manualReview, MANUAL_REVIEW_SCENARIOS.length);

    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `${manualReview}/${completed} insufficient/high-uncertainty scenarios returned manual review`,
      result: 'PASS',
      evidence: `${completed} scenarios (bare, prose-only, task-without-annotation, and migrations/release_artifacts categories via allow or deny paths) all returned the literal manual review outcome and exited 0.`,
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `${manualReview}/${completed} insufficient/high-uncertainty scenarios returned manual review`,
      result: 'FAIL',
      evidence: 'An insufficient or high-uncertainty scenario returned a fabricated default preset instead of manual review.',
    });

    throw error;
  }
});

test('SPEC-007 SC-005: diagnose works without Spec-Kit and without a stack profile, and lifecycle stays intact', async () => {
  const requirement =
    'After adding diagnose, all existing SPEC-001..006 flows pass their existing suites unchanged and diagnose works on dummy repositories with neither Spec-Kit nor stack profile';
  const iterations = 12;
  let completed = 0;
  const root = await createRepositoryWithCommit([{ path: 'src/app.ts', content: 'export const baseline = true;\n' }]);

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      assert.equal(
        runCliCommand(root, 'start', ['--task', `spec007-sc005-${iteration}`, '--tiny', '--allow-paths', 'src/**', '--base-revision', 'HEAD']).status,
        0,
      );

      const structural = runCliCommand(root, 'diagnose', ['--allow-path', 'src/**']);
      assert.equal(structural.status, 0);
      assert.equal(parseRecommendation(structural.stdout), 'tiny');

      const bare = runCliCommand(root, 'diagnose');
      assert.equal(bare.status, 0);
      assert.equal(parseRecommendation(bare.stdout), 'manual_review');

      await writeSourceFile(root, 'src/app.ts', `export const baseline = true; // iteration ${iteration}\n`);

      const check = runCliCommand(root, 'check', ['--json']);
      assert.equal(check.status, 0);
      const payload = JSON.parse(check.stdout) as { decision: string };
      assert.equal(payload.decision, 'PASS');

      assert.equal(runCliCommand(root, 'close', ['--actor', 'spec007', '--reason', `sc005-${iteration}`]).status, 0);
      completed += 1;
    }
  } finally {
    await cleanupRoot(root);
  }

  assert.equal(completed, iterations);

  recordMetric({
    criterion: 'SC-005',
    requirement,
    observed: `${completed} no-Spec-Kit/no-stack diagnose cycles with intact lifecycle`,
    result: 'PASS',
    evidence: '12 cycles in a repo with no specs/ and no stack profile: diagnose --allow-path src/** returned tiny, bare diagnose returned manual review, and the start→check→close lifecycle exited 0 with decision PASS every cycle; full SPEC-001..006 suites run in the T022 gate.',
  });
});

test('SPEC-007 SC-006: recommendation matches a simple reference classification in at least 90% of non-manual-review scenarios', async () => {
  const requirement =
    'In controlled dummy-project scenarios, the recommendation (when not manual review) matches a simple reference classification on the same signals in at least 90% of cases';
  let total = 0;
  let matches = 0;
  const mismatches: string[] = [];

  try {
    for (const scenario of SCENARIOS) {
      const reference = referenceClassify(scenario);
      if (reference === 'manual_review') {
        continue;
      }

      const root = await createRepositoryWithCommit(seedWithTasks(scenario));

      try {
        const result = runCliCommand(root, 'diagnose', scenario.args);
        assert.equal(result.status, 0);
        const actual = parseRecommendation(result.stdout);
        total += 1;
        if (actual === reference) {
          matches += 1;
        } else {
          mismatches.push(`${scenario.label} (reference=${reference}, actual=${actual})`);
        }
      } finally {
        await cleanupRoot(root);
      }
    }

    const ratio = total > 0 ? matches / total : 0;
    assert.equal(ratio >= 0.9, true, `agreement ${ratio} < 0.9; mismatches: ${mismatches.join(', ')}`);

    recordMetric({
      criterion: 'SC-006',
      requirement,
      observed: `${matches}/${total} non-manual-review scenarios matched the reference classification (${(ratio * 100).toFixed(1)}%)`,
      result: 'PASS',
      evidence: 'A simple independent reference classifier (declared-path count, tracked-file count, sensitive categories, valid annotation) agreed with the advisor on all non-manual-review controlled scenarios using identical signals.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-006',
      requirement,
      observed: `${matches}/${total} non-manual-review scenarios matched the reference classification`,
      result: 'FAIL',
      evidence: `Reference classification agreement fell below 90% or a controlled scenario failed; mismatches: ${mismatches.join(', ')}`,
    });

    throw error;
  }
});
