import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface CheckSummary {
  status: 'PASS' | 'FAIL';
  changedFileCount: number;
  changedLinesCount: number;
  binaryChangeCount: number;
  newFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  limitResultLines: string[];
  pathRuleLines: string[];
  violationLines: string[];
}

interface CheckViolationJson {
  rule: string;
  message: string;
  reasonCode?: string;
  reason_code?: string;
  severity?: string;
}

interface CheckJsonSummary {
  decision: 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';
  status: 'PASS' | 'FAIL';
  contractSource: 'active' | 'draft';
  reasonCodes: string[];
  reason_codes: string[];
  stackPolicySummary?: {
    profile_id: string;
    effectiveRuleIds: string[];
    overriddenRuleIds: string[];
    disabledRuleIds: string[];
    statusByRuleId: Array<{ ruleId: string; status: 'active' | 'overridden' | 'disabled' }>;
  } | null;
  limitResults: Array<{ limitName: string; expected: number | null; observed: number; status: 'pass' | 'fail' | 'skip' }>;
  violations: CheckViolationJson[];
}

function parseActiveContractIdFromStatus(stdout: string): string | null {
  const match = stdout.match(/^Active contract:\s*(.+)$/m);
  return match ? match[1]!.trim() : null;
}

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
  return mkdtemp(join(tmpdir(), 'cb-budget-')).then(async (root) => {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'integration']);
    runGit(root, ['config', 'user.email', 'integration@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    return root;
  });
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

function parseCheckSummary(stdout: string): CheckSummary {
  const lines = stdout.split(/\r?\n/);
  const statusLine = lines.find((entry) => entry.startsWith('Status: '));
  if (!statusLine) {
    throw new Error('Unable to parse check status from CLI output');
  }

  const status = statusLine.replace('Status: ', '') as 'PASS' | 'FAIL';

  const parseMetric = (label: string): number => {
    const metricLine = lines.find((entry) => entry.startsWith(label));
    if (!metricLine) {
      throw new Error(`Missing metric line: ${label}`);
    }

    const raw = metricLine.split(':')[1]?.trim();
    const value = Number.parseInt(raw ?? '', 10);
    if (Number.isNaN(value)) {
      throw new Error(`Invalid metric value for ${label}: ${metricLine}`);
    }

    return value;
  };

  const limitResultLines: string[] = [];
  const pathRuleLines: string[] = [];
  const violationLines: string[] = [];

  let section: 'none' | 'limits' | 'pathPolicy' | 'violations' = 'none';

  for (const line of lines) {
    if (line.startsWith('Limit results:')) {
      section = 'limits';
      continue;
    }

    if (line.startsWith('Path policy results:')) {
      section = 'pathPolicy';
      continue;
    }

    if (line.startsWith('Violations: none')) {
      section = 'none';
      continue;
    }

    if (line.startsWith('Violations:')) {
      section = 'violations';
      continue;
    }

    if (!line.startsWith('  - ')) {
      continue;
    }

    if (section === 'limits') {
      limitResultLines.push(line);
      continue;
    }

    if (section === 'pathPolicy') {
      pathRuleLines.push(line);
      continue;
    }

    if (section === 'violations') {
      violationLines.push(line);
    }
  }

  return {
    status,
    changedFileCount: parseMetric('Changed files:'),
    changedLinesCount: parseMetric('Changed lines:'),
    binaryChangeCount: parseMetric('Binary changes:'),
    newFileCount: parseMetric('Added files:'),
    deletedFileCount: parseMetric('Deleted files:'),
    renamedFileCount: parseMetric('Renamed files:'),
    limitResultLines,
    pathRuleLines,
    violationLines,
  };
}

function parseCheckJsonSummary(stdout: string): CheckJsonSummary {
  return JSON.parse(stdout) as CheckJsonSummary;
}

async function writeSourceFile(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

async function writeBinaryFile(root: string, relativePath: string, content: number[]): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.from(content));
}

function parsePathRule(summary: CheckSummary, path: string): string {
  const line = summary.pathRuleLines.find((entry) => entry.startsWith(`  - ${path}:`));
  if (!line) {
    throw new Error(`Missing path policy result for ${path}`);
  }

  return line;
}

async function cleanupRoot(root: string): Promise<void> {
  if (!existsSync(root)) {
    return;
  }

  try {
    await removeDirectoryTree(root);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

async function removeDirectoryTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const next = join(root, entry.name);
    if (entry.isDirectory()) {
      await removeDirectoryTree(next);
      continue;
    }

    await rm(next, { force: true });
  }

  await rm(root, { recursive: true, force: true });
}

test('check pass flow allows allowed file path and uses PASS status', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/allowed.ts', 'export const value = 1;\n');
    runGit(root, ['add', 'src/allowed.ts']);
    runGit(root, ['commit', '-m', 'seed tracked file']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Allowed change pass',
        '--base-revision',
        'HEAD',
        '--max-files',
        '3',
        '--max-changed-lines',
        '20',
        '--allow-paths',
        'src/**',
        '--deny-paths',
        'src/secrets/**',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/allowed.ts', 'export const value = 1;\nexport const next = 2;\n');

    const checkResult = runCliCommand(root, 'check');
    const summary = parseCheckSummary(checkResult.stdout);
    assert.equal(checkResult.status, 0);
    assert.equal(summary.status, 'PASS');
    assert.equal(summary.changedFileCount, 1);
    assert.equal(summary.pathRuleLines.length, 1);

    const pathRuleLine = parsePathRule(summary, 'src/allowed.ts');
    assert.ok(pathRuleLine.includes('allow'));
    assert.ok(pathRuleLine.includes('allow=true'));
    assert.ok(pathRuleLine.includes('deny=false'));
  } finally {
    await cleanupRoot(root);
  }
});

test('check --json returns deterministic PASS schema for successful evaluations', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/allowed.ts', 'export const value = 1;\n');
    runGit(root, ['add', 'src/allowed.ts']);
    runGit(root, ['commit', '-m', 'seed tracked file']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Allowed change pass',
        '--base-revision',
        'HEAD',
        '--max-files',
        '3',
        '--max-changed-lines',
        '20',
        '--allow-paths',
        'src/**',
        '--deny-paths',
        'src/secrets/**',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/allowed.ts', 'export const value = 1;\nexport const next = 2;\n');

    const checkResult = runCliCommand(root, 'check', ['--json']);
    const payload = parseCheckJsonSummary(checkResult.stdout);

    assert.equal(checkResult.status, 0);
    assert.equal(payload.decision, 'PASS');
    assert.equal(payload.status, 'PASS');
    assert.equal(payload.contractSource, 'active');
    assert.equal(payload.reasonCodes.length, 0);
    assert.equal(Array.isArray(payload.reason_codes), true);
    assert.equal(payload.limitResults[0]?.limitName, 'max_files');
    assert.equal(payload.limitResults[1]?.limitName, 'max_changed_lines');
    assert.equal(payload.violations.length, 0);
  } finally {
    await cleanupRoot(root);
  }
});

test('check --json reports deterministic REPAIR output with stable reasons', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/one.ts', 'export const one = 1;\n');
    await writeSourceFile(root, 'src/two.ts', 'export const two = 2;\n');
    runGit(root, ['add', 'src/one.ts', 'src/two.ts']);
    runGit(root, ['commit', '-m', 'seed tracked files']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'File budget test',
        '--base-revision',
        'HEAD',
        '--max-files',
        '1',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/one.ts', 'export const one = 1;\nexport const oneNew = 1;\n');
    await writeSourceFile(root, 'src/two.ts', 'export const two = 2;\nexport const twoNew = 2;\n');

    const checkResult = runCliCommand(root, 'check', ['--json']);
    const payload = parseCheckJsonSummary(checkResult.stdout);

    assert.equal(checkResult.status, 1);
    assert.equal(payload.decision, 'REPAIR');
    assert.equal(payload.status, 'FAIL');
    assert.equal(payload.reasonCodes.includes('CBV-LIMIT-FILES-EXCEEDED'), true);
    assert.equal(payload.reason_codes.includes('CBV-LIMIT-FILES-EXCEEDED'), true);
    assert.equal(payload.violations.length, 1);
    assert.equal(payload.violations[0]?.rule, 'max_files');
    assert.equal(payload.violations[0]?.reason_code, 'CBV-LIMIT-FILES-EXCEEDED');
    assert.equal(payload.violations[0]?.severity, 'repair');
  } finally {
    await cleanupRoot(root);
  }
});

test('check --json emits stack profile-specific reason codes for matching stack rules', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'app/AndroidManifest.xml', '<manifest xmlns:android="http://schemas.android.com/apk/res/android"\n');
    runGit(root, ['add', 'app/AndroidManifest.xml']);
    runGit(root, ['commit', '-m', 'seed android manifest']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Android stack policy test',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'android',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'app/AndroidManifest.xml', '<manifest android:versionCode="2"\n');

    const firstCheck = runCliCommand(root, 'check', ['--json']);
    const firstPayload = parseCheckJsonSummary(firstCheck.stdout);

    assert.equal(firstCheck.status, 1);
    assert.equal(firstPayload.decision, 'REPAIR');
    assert.equal(firstPayload.status, 'FAIL');
    assert.equal(firstPayload.reasonCodes.includes('CBS-ANDROID-SIGNING'), true);
    assert.equal(firstPayload.reason_codes.includes('CBS-ANDROID-SIGNING'), true);
    assert.equal(firstPayload.violations.length, 1);
    assert.equal(firstPayload.violations[0]?.rule, 'stack_profile_rule');
    assert.equal(firstPayload.violations[0]?.reason_code, 'CBS-ANDROID-SIGNING');
    assert.equal(firstPayload.violations[0]?.severity, 'review');
    assert.equal(typeof firstPayload.stackPolicySummary, 'object');
    assert.equal(firstPayload.stackPolicySummary !== null, true);
    assert.equal(firstPayload.stackPolicySummary?.profile_id, 'android');

    const secondCheck = runCliCommand(root, 'check', ['--json']);
    const secondPayload = parseCheckJsonSummary(secondCheck.stdout);

    assert.equal(secondCheck.status, 1);
    assert.deepEqual(secondPayload.reasonCodes, firstPayload.reasonCodes);
    assert.deepEqual(secondPayload.reason_codes, firstPayload.reason_codes);
    assert.deepEqual(secondPayload.violations, firstPayload.violations);
  } finally {
    await cleanupRoot(root);
  }
});

test('check --json respects repository-level Flutter stack overrides', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await Promise.all([
      writeSourceFile(root, 'analysis_options.yaml', 'analyze: true\n'),
      writeSourceFile(root, 'pubspec.yaml', 'name: stack-policy\n'),
    ]);
    runGit(root, ['add', 'analysis_options.yaml', 'pubspec.yaml']);
    runGit(root, ['commit', '-m', 'seed flutter files']);

    assert.equal(runCliCommand(root, 'init').status, 0);

    await writeFile(
      join(root, '.changebudget', 'stack-policy-overrides.json'),
      JSON.stringify(
        {
          profiles: {
            flutter: {
              disable_rule_ids: ['flutter/configuration'],
            },
          },
        },
        null,
        2,
      ),
    );

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Flutter override test',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'flutter',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'analysis_options.yaml', 'analyze: false\n');
    const configurationCheck = runCliCommand(root, 'check', ['--json']);
    const configurationPayload = parseCheckJsonSummary(configurationCheck.stdout);

    assert.equal(configurationCheck.status, 0);
    assert.equal(configurationPayload.status, 'PASS');
    assert.equal(configurationPayload.reasonCodes.includes('CBS-FLUTTER-CONFIGURATION'), false);
    assert.equal(configurationPayload.stackPolicySummary?.overriddenRuleIds.includes('flutter/configuration'), true);

    await writeSourceFile(root, 'analysis_options.yaml', 'analyze: true\n');
    await writeSourceFile(root, 'pubspec.yaml', 'name: stack-policy\ndescription: policy test\n');
    const dependencyCheck = runCliCommand(root, 'check', ['--json']);
    const dependencyPayload = parseCheckJsonSummary(dependencyCheck.stdout);

    assert.equal(dependencyCheck.status, 1);
    assert.equal(dependencyPayload.decision, 'REPAIR');
    assert.equal(dependencyPayload.reasonCodes.includes('CBS-FLUTTER-DEPENDENCIES'), true);
    assert.equal(dependencyPayload.reason_codes.includes('CBS-FLUTTER-CONFIGURATION'), false);
  } finally {
    await cleanupRoot(root);
  }
});

test('check --json reports node-ts stack profile reasons', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'tsconfig.json', '{"compilerOptions": {"strict": true}}\n');
    runGit(root, ['add', 'tsconfig.json']);
    runGit(root, ['commit', '-m', 'seed tsconfig']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Node profile test',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'node-ts',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'tsconfig.json', '{"compilerOptions": {"strict": false}}\n');

    const nodeCheck = runCliCommand(root, 'check', ['--json']);
    const payload = parseCheckJsonSummary(nodeCheck.stdout);

    assert.equal(nodeCheck.status, 1);
    assert.equal(payload.decision, 'REPAIR');
    assert.equal(payload.status, 'FAIL');
    assert.equal(payload.reasonCodes.includes('CBS-NODE-TS-CONFIGURATION'), true);
    assert.equal(payload.reason_codes.includes('CBS-NODE-TS-CONFIGURATION'), true);
    assert.equal(payload.violations.some((entry) => entry.reason_code === 'CBS-NODE-TS-CONFIGURATION'), true);
    assert.equal(payload.stackPolicySummary?.profile_id, 'node-ts');
  } finally {
    await cleanupRoot(root);
  }
});

test('check --json reports spring-boot stack profile reasons', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'app/application-dev.yml', 'app.name: demo\n');
    runGit(root, ['add', 'app/application-dev.yml']);
    runGit(root, ['commit', '-m', 'seed spring boot config']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Spring Boot profile test',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'spring-boot',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'app/application-dev.yml', 'app.name: updated-demo\n');

    const bootCheck = runCliCommand(root, 'check', ['--json']);
    const payload = parseCheckJsonSummary(bootCheck.stdout);

    assert.equal(bootCheck.status, 1);
    assert.equal(payload.decision, 'REPAIR');
    assert.equal(payload.status, 'FAIL');
    assert.equal(payload.reasonCodes.includes('CBS-SPRING-BOOT-CONFIGURATION'), true);
    assert.equal(payload.reason_codes.includes('CBS-SPRING-BOOT-CONFIGURATION'), true);
    assert.equal(payload.violations.some((entry) => entry.reason_code === 'CBS-SPRING-BOOT-CONFIGURATION'), true);
    assert.equal(payload.stackPolicySummary?.profile_id, 'spring-boot');
  } finally {
    await cleanupRoot(root);
  }
});

test('stack profile effective rule ordering is deterministic across profile switches', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'tsconfig.json', '{"compilerOptions": {"strict": true}}\n');
    await writeSourceFile(root, 'app/application-dev.yml', 'app.name: demo\n');
    await writeSourceFile(root, 'notes.md', 'baseline\n');
    runGit(root, ['add', 'tsconfig.json', 'app/application-dev.yml', 'notes.md']);
    runGit(root, ['commit', '-m', 'seed profile fixtures']);

    assert.equal(runCliCommand(root, 'init').status, 0);

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Node profile ordering',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'node-ts',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'notes.md', 'node profile touch\n');
    const nodeCheck = runCliCommand(root, 'check', ['--json']);
    const nodePayload = parseCheckJsonSummary(nodeCheck.stdout);

    assert.equal(nodeCheck.status, 0);
    assert.deepEqual(nodePayload.stackPolicySummary?.effectiveRuleIds, [
      'node-ts/configuration',
      'node-ts/dependencies',
      'node-ts/public-api',
    ]);

    assert.equal(runCliCommand(root, 'close', ['--actor', 'ci-bot', '--reason', 'switch profile']).status, 0);

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Spring profile ordering',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'spring-boot',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'notes.md', 'spring profile touch\n');
    const bootCheck = runCliCommand(root, 'check', ['--json']);
    const bootPayload = parseCheckJsonSummary(bootCheck.stdout);

    assert.equal(bootCheck.status, 0);
    assert.deepEqual(bootPayload.stackPolicySummary?.effectiveRuleIds, [
      'spring-boot/configuration',
      'spring-boot/dependencies',
      'spring-boot/migrations',
    ]);
  } finally {
    await cleanupRoot(root);
  }
});

test('check --json applies repository-added stack rules', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/main.kt', 'fun main() { println("hello") }\n');
    runGit(root, ['add', 'src/main.kt']);
    runGit(root, ['commit', '-m', 'seed kotlin file']);

    await mkdir(join(root, '.changebudget'), { recursive: true });

    await writeFile(
      join(root, '.changebudget', 'stack-policy-overrides.json'),
      JSON.stringify(
        {
          profiles: {
            android: {
              added_rules: [
                {
                  id: 'android/local-runtime',
                  profile_id: 'android',
                  category: 'runtime',
                  target_patterns: ['**/*.kt'],
                  message: 'Android Kotlin runtime change should be reviewed.',
                  severity: 'review',
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Android added rule test',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'android',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/main.kt', 'fun main() { println("hello again") }\n');

    const addedRuleCheck = runCliCommand(root, 'check', ['--json']);
    const payload = parseCheckJsonSummary(addedRuleCheck.stdout);

    assert.equal(addedRuleCheck.status, 1);
    assert.equal(payload.decision, 'REPAIR');
    assert.equal(payload.status, 'FAIL');
    assert.equal(payload.reasonCodes.includes('CBS-ANDROID-LOCAL-RUNTIME'), true);
    assert.equal(payload.reason_codes.includes('CBS-ANDROID-LOCAL-RUNTIME'), true);
    assert.equal(payload.violations.some((entry) => entry.reason_code === 'CBS-ANDROID-LOCAL-RUNTIME'), true);
    assert.equal(
      payload.stackPolicySummary?.effectiveRuleIds.includes('android/local-runtime'), true,
    );
    assert.equal(
      payload.stackPolicySummary?.statusByRuleId.find((entry) => entry.ruleId === 'android/local-runtime')?.status,
      'active',
    );
  } finally {
    await cleanupRoot(root);
  }
});

test('stack-policy overrides are repository-scoped', async () => {
  const [scopedRoot, cleanRoot] = await Promise.all([
    createRepositoryWithCommit(),
    createRepositoryWithCommit(),
  ]);

  try {
    await writeSourceFile(scopedRoot, 'analysis_options.yaml', 'analyze: false\n');
    await writeSourceFile(cleanRoot, 'analysis_options.yaml', 'analyze: false\n');

    runGit(scopedRoot, ['add', 'analysis_options.yaml']);
    runGit(scopedRoot, ['commit', '-m', 'seed flutter config']);
    runGit(cleanRoot, ['add', 'analysis_options.yaml']);
    runGit(cleanRoot, ['commit', '-m', 'seed flutter config']);

    await mkdir(join(scopedRoot, '.changebudget'), { recursive: true });
    await writeFile(
      join(scopedRoot, '.changebudget', 'stack-policy-overrides.json'),
      JSON.stringify(
        {
          profiles: {
            flutter: {
              disable_rule_ids: ['flutter/configuration'],
            },
          },
        },
        null,
        2,
      ),
    );

    assert.equal(runCliCommand(scopedRoot, 'init').status, 0);
    assert.equal(runCliCommand(cleanRoot, 'init').status, 0);

    assert.equal(
      runCliCommand(scopedRoot, 'start', [
        '--task',
        'Scoped override contract',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'flutter',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    assert.equal(
      runCliCommand(cleanRoot, 'start', [
        '--task',
        'Clean contract',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'flutter',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(scopedRoot, 'analysis_options.yaml', 'analyze: true\n');
    await writeSourceFile(cleanRoot, 'analysis_options.yaml', 'analyze: true\n');

    const scopedCheck = runCliCommand(scopedRoot, 'check', ['--json']);
    const scopedPayload = parseCheckJsonSummary(scopedCheck.stdout);
    const cleanCheck = runCliCommand(cleanRoot, 'check', ['--json']);
    const cleanPayload = parseCheckJsonSummary(cleanCheck.stdout);

    assert.equal(scopedCheck.status, 0);
    assert.equal(scopedPayload.status, 'PASS');
    assert.equal(scopedPayload.reasonCodes.includes('CBS-FLUTTER-CONFIGURATION'), false);

    assert.equal(cleanCheck.status, 1);
    assert.equal(cleanPayload.status, 'FAIL');
    assert.equal(cleanPayload.reasonCodes.includes('CBS-FLUTTER-CONFIGURATION'), true);
  } finally {
    await Promise.all([
      cleanupRoot(scopedRoot),
      cleanupRoot(cleanRoot),
    ]);
  }
});

test('check reports max_files violation with deterministic FAIL status', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/one.ts', 'export const one = 1;\n');
    await writeSourceFile(root, 'src/two.ts', 'export const two = 2;\n');
    runGit(root, ['add', 'src/one.ts', 'src/two.ts']);
    runGit(root, ['commit', '-m', 'seed tracked files']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'File budget test',
        '--base-revision',
        'HEAD',
        '--max-files',
        '1',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/one.ts', 'export const one = 1;\nexport const oneNew = 1;\n');
    await writeSourceFile(root, 'src/two.ts', 'export const two = 2;\nexport const twoNew = 2;\n');

    const checkResult = runCliCommand(root, 'check');
    const summary = parseCheckSummary(checkResult.stdout);
    assert.equal(checkResult.status, 1);
    assert.equal(summary.status, 'FAIL');
    assert.equal(summary.changedFileCount, 2);
    assert.equal(
      summary.violationLines.some((entry) =>
        entry.includes('  - max_files: File budget exceeded') && entry.includes('expected=1') && entry.includes('observed=2')
      ),
      true,
    );
    assert.equal(summary.violationLines.length, 1);
  } finally {
    await cleanupRoot(root);
  }
});

test('check computes changed lines with added+removed semantics at the exact threshold', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/lines.ts', 'line1\nline2\nline3\n');
    runGit(root, ['add', 'src/lines.ts']);
    runGit(root, ['commit', '-m', 'seed tracked lines']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Line budget test',
        '--base-revision',
        'HEAD',
        '--max-files',
        '10',
        '--max-changed-lines',
        '9',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/lines.ts', 'updated-1\nupdated-2\nupdated-3\nupdated-4\nupdated-5\nupdated-6\n');

    const checkResult = runCliCommand(root, 'check');
    const summary = parseCheckSummary(checkResult.stdout);
    assert.equal(checkResult.status, 0);
    assert.equal(summary.status, 'PASS');
    assert.equal(summary.changedLinesCount, 9);
    assert.equal(summary.violationLines.length, 0);
  } finally {
    await cleanupRoot(root);
  }
});

test('quickstart scenario 4 stays stable for same line budget checks', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/lines.ts', 'line1\nline2\nline3\n');
    runGit(root, ['add', 'src/lines.ts']);
    runGit(root, ['commit', '-m', 'seed lines for stability']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Line budget repeatability',
        '--base-revision',
        'HEAD',
        '--max-files',
        '10',
        '--max-changed-lines',
        '9',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/lines.ts', 'updated-1\nupdated-2\nupdated-3\nupdated-4\nupdated-5\nupdated-6\n');

    const first = parseCheckSummary(runCliCommand(root, 'check').stdout);
    const second = parseCheckSummary(runCliCommand(root, 'check').stdout);

    assert.equal(first.status, 'PASS');
    assert.equal(second.status, 'PASS');
    assert.equal(first.changedLinesCount, 9);
    assert.equal(first.changedLinesCount, second.changedLinesCount);
    assert.equal(first.violationLines.length, 0);
    assert.deepEqual(first.violationLines, second.violationLines);
  } finally {
    await cleanupRoot(root);
  }
});

test('draft-only check evaluates without changing active lifecycle state', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/active.ts', 'const active = 1;\n');
    runGit(root, ['add', 'src/active.ts']);
    runGit(root, ['commit', '-m', 'seed draft base']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Stateful active contract',
        '--base-revision',
        'HEAD',
        '--max-files',
        '2',
        '--max-changed-lines',
        '50',
      ]).status,
      0,
    );

    const statusBefore = runCliCommand(root, 'status');
    assert.equal(statusBefore.status, 0);
    const activeContractId = parseActiveContractIdFromStatus(statusBefore.stdout);
    assert.equal(activeContractId !== null, true);

    const statePath = join(root, '.changebudget', 'state.json');
    const stateBefore = await readFile(statePath, 'utf8');

    const draftPath = join(root, 'draft.json');
    await writeFile(
      draftPath,
      JSON.stringify({
        schema_version: '1.0.0',
        id: 'draft-quickstart',
        task_description: 'Draft path check',
        base_revision: 'HEAD',
        allow_paths: ['src/**'],
        deny_paths: [],
        max_files: 2,
        max_changed_lines: 20,
        allow_new_files: false,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_public_api_changes: false,
        allow_config_changes: false,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    await writeSourceFile(root, 'src/active.ts', 'const active = 1;\nconst next = 2;\n');

    const checkResult = runCliCommand(root, 'check', ['--draft', draftPath]);
    assert.equal(checkResult.status, 1);

    const statusAfter = runCliCommand(root, 'status');
    assert.equal(statusAfter.status, 0);
    assert.equal(parseActiveContractIdFromStatus(statusAfter.stdout), activeContractId);

    const stateAfter = await readFile(statePath, 'utf8');
    assert.equal(stateAfter, stateBefore);
  } finally {
    await cleanupRoot(root);
  }
});

test('quickstart scenario 10 preserves violation ids across repeated runs', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await Promise.all([
      writeSourceFile(root, 'src/first.ts', 'export const first = 1;\n'),
      writeSourceFile(root, 'src/second.ts', 'export const second = 2;\n'),
    ]);
    runGit(root, ['add', 'src/first.ts', 'src/second.ts']);
    runGit(root, ['commit', '-m', 'seed files for repeated failure']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Violation stability',
        '--base-revision',
        'HEAD',
        '--max-files',
        '1',
        '--max-changed-lines',
        '2',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/first.ts', 'export const first = 1;\nexport const firstNext = 1;\n');
    await writeSourceFile(root, 'src/second.ts', 'export const second = 2;\nexport const secondNext = 2;\n');

    const firstRun = parseCheckSummary(runCliCommand(root, 'check').stdout);
    const secondRun = parseCheckSummary(runCliCommand(root, 'check').stdout);

    assert.equal(firstRun.status, 'FAIL');
    assert.equal(secondRun.status, 'FAIL');
    assert.equal(firstRun.changedFileCount, secondRun.changedFileCount);
    assert.equal(firstRun.changedLinesCount, secondRun.changedLinesCount);
    assert.equal(firstRun.violationLines.length, 1);
    assert.deepEqual(firstRun.violationLines, secondRun.violationLines);
  } finally {
    await cleanupRoot(root);
  }
});

test('check counts staged, unstaged, deleted, and untracked changes in one run', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await Promise.all([
      writeSourceFile(root, 'src/staged.ts', 'staged\n'),
      writeSourceFile(root, 'src/unstaged.ts', 'unstaged\n'),
      writeSourceFile(root, 'src/deleted.ts', 'deleted\n'),
    ]);
    runGit(root, ['add', 'src/staged.ts', 'src/unstaged.ts', 'src/deleted.ts']);
    runGit(root, ['commit', '-m', 'seed mixed changes']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Mixed source mix',
        '--base-revision',
        'HEAD',
        '--max-files',
        '4',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/staged.ts', 'staged\nplus staged change\n');
    runGit(root, ['add', 'src/staged.ts']);

    await writeSourceFile(root, 'src/unstaged.ts', 'unstaged\nplus unstaged change\n');
    await rm(join(root, 'src/deleted.ts'), { force: true });
    await writeSourceFile(root, 'src/untracked.ts', 'newly added\n');

    const checkResult = runCliCommand(root, 'check');
    const summary = parseCheckSummary(checkResult.stdout);

    assert.equal(checkResult.status, 0);
    assert.equal(summary.status, 'PASS');
    assert.equal(summary.changedFileCount, 4);
    assert.equal(summary.newFileCount, 1);
    assert.equal(summary.deletedFileCount, 1);

    assert.equal(summary.pathRuleLines.length, 4);
    assert.equal(summary.pathRuleLines.some((entry) => entry.includes('src/staged.ts')), true);
    assert.equal(summary.pathRuleLines.some((entry) => entry.includes('src/unstaged.ts')), true);
    assert.equal(summary.pathRuleLines.some((entry) => entry.includes('src/deleted.ts')), true);
    assert.equal(summary.pathRuleLines.some((entry) => entry.includes('src/untracked.ts')), true);
  } finally {
    await cleanupRoot(root);
  }
});

test('check reports rename, delete, and binary change deterministically', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await Promise.all([
      writeSourceFile(root, 'docs/feature.ts', 'export const feature = 1;\n'),
      writeSourceFile(root, 'docs/obsolete.ts', ''),
      writeBinaryFile(root, 'assets/logo.bin', [0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d, 0x0a, 0x0a, 0x1a]),
    ]);

    runGit(root, ['add', 'docs/feature.ts', 'docs/obsolete.ts', 'assets/logo.bin']);
    runGit(root, ['commit', '-m', 'seed rename delete binary']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Rename delete binary',
        '--base-revision',
        'HEAD',
        '--max-files',
        '4',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    runGit(root, ['mv', 'docs/feature.ts', 'docs/renamed-feature.ts']);
    runGit(root, ['rm', 'docs/obsolete.ts']);
    await writeBinaryFile(root, 'assets/logo.bin', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    runGit(root, ['add', 'assets/logo.bin']);

    const first = parseCheckSummary(runCliCommand(root, 'check').stdout);
    const second = parseCheckSummary(runCliCommand(root, 'check').stdout);

    assert.equal(first.status, 'PASS');
    assert.equal(first.changedFileCount, 4);
    assert.equal(first.renamedFileCount, 1);
    assert.equal(first.deletedFileCount, 2);
    assert.equal(first.binaryChangeCount, 1);
    assert.equal(first.newFileCount, 0);
    assert.equal(first.changedLinesCount, 0);
    assert.equal(first.pathRuleLines.length, 4);
    assert.ok(first.pathRuleLines.some((entry) => entry.includes('docs/renamed-feature.ts')));
    assert.ok(first.pathRuleLines.some((entry) => entry.includes('docs/feature.ts')));
    assert.ok(first.pathRuleLines.some((entry) => entry.includes('docs/obsolete.ts')));
    assert.ok(first.pathRuleLines.some((entry) => entry.includes('assets/logo.bin')));
    assert.equal(first.violationLines.length, 0);

    assert.deepEqual(first, second);
  } finally {
    await cleanupRoot(root);
  }
});

test('check in json mode returns HUMAN_REVIEW for unresolved base revision', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const startResult = runCliCommand(root, 'start', [
      '--task',
      'Missing base revision',
      '--base-revision',
      'HEAD',
    ]);
    assert.equal(startResult.status, 0);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);

    const activeIdMatch = /Active contract:\s*(.+)$/m.exec(statusResult.stdout);
    const activeContractId = activeIdMatch ? activeIdMatch[1]!.trim() : null;
    assert.equal(activeContractId !== null, true);

    const contractPath = join(root, '.changebudget', 'contracts', `${activeContractId}.json`);
    const raw = JSON.parse(await readFile(contractPath, 'utf8')) as { base_revision: string };
    raw.base_revision = 'does-not-exist';
    await writeFile(contractPath, JSON.stringify(raw));

    const checkResult = runCliCommand(root, 'check', ['--json']);
    const payload = parseCheckJsonSummary(checkResult.stdout);

    assert.equal(checkResult.status, 2);
    assert.equal(payload.decision, 'HUMAN_REVIEW');
    assert.equal(payload.status, 'FAIL');
    assert.equal(payload.reasonCodes.includes('CBV-BASE-REVISION-UNKNOWN'), true);
    assert.equal(payload.reason_codes.includes('CBV-BASE-REVISION-UNKNOWN'), true);
    assert.equal(payload.violations.length, 1);
    assert.equal(payload.violations[0]?.rule, 'max_files');
    assert.equal(payload.violations[0]?.reason_code, 'CBV-BASE-REVISION-UNKNOWN');
  } finally {
    await cleanupRoot(root);
  }
});

test('check output is deterministic across repeated runs without working-tree changes', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/steady.ts', 'steady line\n');
    runGit(root, ['add', 'src/steady.ts']);
    runGit(root, ['commit', '-m', 'seed steady file']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Deterministic repeat',
        '--base-revision',
        'HEAD',
        '--max-files',
        '4',
        '--max-changed-lines',
        '20',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/steady.ts', 'steady line\nwith repeat check\n');

    const first = parseCheckSummary(runCliCommand(root, 'check').stdout);
    const second = parseCheckSummary(runCliCommand(root, 'check').stdout);

    assert.deepEqual(first, second);
  } finally {
    await cleanupRoot(root);
  }
});

test('check allows non-denied paths when allow list is empty and denies matching paths', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await Promise.all([
      writeSourceFile(root, 'src/allowed.ts', 'export const allow = 1;\n'),
      writeSourceFile(root, 'src/secrets/key.ts', 'export const secret = 1;\n'),
    ]);
    runGit(root, ['add', 'src/allowed.ts', 'src/secrets/key.ts']);
    runGit(root, ['commit', '-m', 'seed scoped files']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Allow-empty deny-only',
        '--base-revision',
        'HEAD',
        '--deny-paths',
        'src/secrets/**',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/allowed.ts', 'export const allow = 2;\n');
    await writeSourceFile(root, 'src/secrets/key.ts', 'export const secret = 2;\n');

    const checkResult = runCliCommand(root, 'check');
    const summary = parseCheckSummary(checkResult.stdout);

    assert.equal(checkResult.status, 1);
    assert.equal(summary.status, 'FAIL');
    assert.equal(summary.changedFileCount, 2);

    const allowedRule = parsePathRule(summary, 'src/allowed.ts');
    assert.ok(allowedRule.includes('allow=true'));
    assert.ok(allowedRule.includes('deny=false'));

    const deniedRule = parsePathRule(summary, 'src/secrets/key.ts');
    assert.ok(deniedRule.includes('allow=true'));
    assert.ok(deniedRule.includes('deny=true'));

    assert.equal(
      summary.violationLines.some((entry) => entry.includes('deny_paths') && entry.includes('src/secrets/key.ts')),
      true,
    );
  } finally {
    await cleanupRoot(root);
  }
});

test('check denies denied paths even when they also match allow patterns', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/secrets/credentials.ts', 'export const credentials = 1;\n');
    runGit(root, ['add', 'src/secrets/credentials.ts']);
    runGit(root, ['commit', '-m', 'seed secret file']);

    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Deny overlaps allow',
        '--base-revision',
        'HEAD',
        '--allow-paths',
        'src/**',
        '--deny-paths',
        'src/secrets/**',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeSourceFile(root, 'src/secrets/credentials.ts', 'export const credentials = 2;\n');

    const checkResult = runCliCommand(root, 'check');
    const summary = parseCheckSummary(checkResult.stdout);

    assert.equal(checkResult.status, 1);
    assert.equal(summary.status, 'FAIL');

    const overlapRule = parsePathRule(summary, 'src/secrets/credentials.ts');
    assert.ok(overlapRule.includes('allow=true'));
    assert.ok(overlapRule.includes('deny=true'));

    assert.equal(
      summary.violationLines.some((entry) => entry.includes('deny_paths') && entry.includes('src/secrets/credentials.ts')),
      true,
    );
  } finally {
    await cleanupRoot(root);
  }
});
