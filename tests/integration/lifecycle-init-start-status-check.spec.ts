import * as assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
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

function runGitStatus(root: string): string {
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
  return mkdtemp(join(tmpdir(), 'cb-integration-')).then(async (root) => {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'integration']);
    runGit(root, ['config', 'user.email', 'integration@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    return root;
  });
}

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface CheckJsonResult {
  decision: 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';
  status: 'PASS' | 'FAIL';
  changedFileCount: number;
  changedLinesCount: number;
  binaryChangeCount: number;
  newFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  reasonCodes: string[];
  reason_codes: string[];
}

interface StatusBudgetJsonResult {
  lifecycleState: string;
  activeContractId: string | null;
  lastClosedContractId: string | null;
  budget: {
    decision: 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';
    reasonCodes: string[];
    reason_codes: string[];
    stackPolicySummary?: {
      profile_id: string;
      effectiveRuleIds: string[];
      overriddenRuleIds: string[];
      disabledRuleIds: string[];
      statusByRuleId: Array<{ ruleId: string; status: 'active' | 'overridden' | 'disabled' }>;
    } | null;
    contractSource: 'active' | 'draft';
    contractId: string | null;
    baseRevision: string;
    status: 'PASS' | 'FAIL';
    changedFileCount: number;
    changedLinesCount: number;
    binaryChangeCount: number;
    newFileCount: number;
    deletedFileCount: number;
    renamedFileCount: number;
    limitResults: Array<{
      limitName: string;
      expected: number | null;
      observed: number;
      status: 'pass' | 'fail' | 'skip';
    }>;
    pathRuleResults: Array<{
      path: string;
      status: 'allow' | 'deny';
      matchedAllow: boolean;
      matchedDeny: boolean;
    }>;
    violations: Array<{ reasonCode?: string; reason_code?: string; severity?: 'repair' | 'review'; action?: 'repair' | 'review' }>; 
    asOf: string;
  };
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

function parseActiveContractIdFromStatus(stdout: string): string | null {
  const match = stdout.match(/^Active contract:\s*(.+)$/m);
  return match ? match[1]!.trim() : null;
}

function parseCheckBudgetJson(stdout: string): CheckJsonResult {
  return JSON.parse(stdout) as CheckJsonResult;
}

test('init, start, status, and check work through CLI flow', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const initResult = runCliCommand(root, 'init');
    assert.equal(initResult.status, 0);
    assert.equal(initResult.stdout.includes('Initialized ChangeBudget repository.'), true);

    const secondInit = runCliCommand(root, 'init');
    assert.equal(secondInit.status, 0);
    assert.equal(secondInit.stdout.includes('already initialized'), true);

    const startResult = runCliCommand(root, 'start', [
      '--task',
      'Integration start',
      '--base-revision',
      'HEAD',
      '--preset',
      'tiny',
    ]);
    assert.equal(startResult.status, 0);
    assert.equal(startResult.stdout.includes('Started new contract.'), true);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);
    const activeId = parseActiveContractIdFromStatus(statusResult.stdout);
    assert.equal(activeId !== null, true);

    const checkResult = runCliCommand(root, 'check');
    assert.equal(checkResult.status, 0);
    assert.equal(checkResult.stdout.includes('Status: PASS'), true);

    const draftPath = join(root, 'invalid-draft.json');
    await writeFile(
      draftPath,
      JSON.stringify({
        schema_version: '1.0.0',
        id: 'invalid',
        task_description: '',
        base_revision: 'HEAD',
        allow_paths: [''],
        deny_paths: [],
        max_files: -1,
        allow_new_files: false,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: false,
        allow_public_api_changes: false,
        max_changed_lines: null,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    const draftCheckResult = runCliCommand(root, 'check', ['--draft', draftPath]);
    assert.equal(draftCheckResult.status, 2);
    assert.equal(draftCheckResult.stdout.includes('Decision: HUMAN_REVIEW'), true);
    assert.equal(draftCheckResult.stdout.includes('CBV-INPUT-INVALID'), true);
    assert.equal(draftCheckResult.stderr, '');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('start conflict and close safety are enforced through CLI', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const firstStart = runCliCommand(root, 'start', ['--task', 'first', '--base-revision', 'HEAD']);
    assert.equal(firstStart.status, 0);

    const secondStart = runCliCommand(root, 'start', ['--task', 'second', '--base-revision', 'HEAD']);
    assert.equal(secondStart.status, 3);
    assert.equal(secondStart.stderr.includes('StateConflictError'), true);

    const firstClose = runCliCommand(root, 'close', ['--actor', 'ci-bot', '--reason', 'done']);
    assert.equal(firstClose.status, 0);
    assert.equal(firstClose.stdout.includes('Contract closed.'), true);

    const closedStatus = runCliCommand(root, 'status');
    assert.equal(closedStatus.status, 0);
    assert.equal(closedStatus.stdout.includes('Active contract: none'), true);
    assert.equal(closedStatus.stdout.includes('Last closed contract:'), true);

    const secondClose = runCliCommand(root, 'close');
    assert.equal(secondClose.status, 3);
    assert.equal(secondClose.stderr.includes('StateConflictError'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('contract-level stack-rule disables do not leak between contracts', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeFile(join(root, 'analysis_options.yaml'), 'analyze: false\n');
    runGit(root, ['add', 'analysis_options.yaml']);
    runGit(root, ['commit', '-m', 'seed flutter config']);

    assert.equal(runCliCommand(root, 'init').status, 0);

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Contract 1',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'flutter',
        '--disable-stack-rule',
        'flutter/configuration',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    await writeFile(join(root, 'analysis_options.yaml'), 'analyze: true\n');
    const firstCheck = runCliCommand(root, 'check', ['--json']);
    const firstPayload = parseCheckBudgetJson(firstCheck.stdout);

    assert.equal(firstCheck.status, 0);
    assert.equal(firstPayload.decision, 'PASS');
    assert.equal(firstPayload.reasonCodes.includes('CBS-FLUTTER-CONFIGURATION'), false);

    assert.equal(runCliCommand(root, 'close', ['--actor', 'ci-bot', '--reason', 'disabled for test']).status, 0);

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Contract 2',
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

    await writeFile(join(root, 'analysis_options.yaml'), 'analyze: false # adjacent contract\n');
    const secondCheck = runCliCommand(root, 'check', ['--json']);
    const secondPayload = parseCheckBudgetJson(secondCheck.stdout);

    assert.equal(secondCheck.status, 1);
    assert.equal(secondPayload.decision, 'REPAIR');
    assert.equal(secondPayload.reasonCodes.includes('CBS-FLUTTER-CONFIGURATION'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check reports budget violations in output', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const startResult = runCliCommand(root, 'start', ['--task', 'budget', '--base-revision', 'HEAD', '--max-files', '1']);
    assert.equal(startResult.status, 0);

    await writeFile(join(root, 'first.txt'), 'first file\n');
    await writeFile(join(root, 'second.txt'), 'second file\n');

    const checkResult = runCliCommand(root, 'check');
    assert.equal(checkResult.status, 1);
    assert.equal(checkResult.stdout.includes('Status: FAIL'), true);
    assert.equal(checkResult.stdout.includes('max_files'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check in non-git directory reports environment error without creating state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-non-git-'));

  try {
    const checkResult = runCliCommand(root, 'check');

    assert.equal(checkResult.status, 4);
    assert.equal(checkResult.stdout, '');
    assert.equal(checkResult.stderr.includes('GitEnvironmentError'), true);
    assert.equal(checkResult.stderr.includes('Current directory is not a Git repository'), true);
    assert.equal(existsSync(join(root, '.changebudget')), false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check reports missing base revision with resolved context and no state mutation', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const startResult = runCliCommand(root, 'start', ['--task', 'Missing base revision', '--base-revision', 'HEAD']);
    assert.equal(startResult.status, 0);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);
    const activeContractId = parseActiveContractIdFromStatus(statusResult.stdout);
    assert.equal(activeContractId !== null, true);

    const statePath = join(root, '.changebudget', 'state.json');
    const contractPath = join(root, '.changebudget', 'contracts', `${activeContractId}.json`);

    const stateBefore = await readFile(statePath, 'utf8');
    const contractBefore = await readFile(contractPath, 'utf8');

    const invalidRevision = 'does-not-exist';
    const rewritten = JSON.parse(contractBefore) as { base_revision: string };
    rewritten.base_revision = invalidRevision;
    await writeFile(contractPath, JSON.stringify(rewritten));

    const checkResult = runCliCommand(root, 'check');
    assert.equal(checkResult.status, 2);
    assert.equal(checkResult.stdout.includes('Decision: HUMAN_REVIEW'), true);
    assert.equal(checkResult.stdout.includes('CBV-BASE-REVISION-UNKNOWN'), true);

    const stateAfter = await readFile(statePath, 'utf8');
    const contractAfter = JSON.parse(await readFile(contractPath, 'utf8')) as { base_revision: string };
    assert.equal(stateAfter, stateBefore);
    assert.equal(contractAfter.base_revision, invalidRevision);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check fails on malformed deny pattern without mutating state or index', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const startResult = runCliCommand(root, 'start', ['--task', 'Malformed pattern check', '--base-revision', 'HEAD']);
    assert.equal(startResult.status, 0);

    const statusResult = runCliCommand(root, 'status');
    assert.equal(statusResult.status, 0);
    const activeContractId = parseActiveContractIdFromStatus(statusResult.stdout);
    assert.equal(activeContractId !== null, true);

    const statePath = join(root, '.changebudget', 'state.json');
    const contractPath = join(root, '.changebudget', 'contracts', `${activeContractId}.json`);

    const draftPath = join(root, 'invalid-pattern-contract.json');
    await writeFile(
      draftPath,
      JSON.stringify({
        schema_version: '1.0.0',
        id: 'bad-deny-pattern',
        task_description: 'Malformed deny pattern check',
        base_revision: 'HEAD',
        allow_paths: ['src/**'],
        deny_paths: ['src/[bad'],
        max_files: 3,
        max_changed_lines: 10,
        allow_new_files: true,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: true,
        allow_public_api_changes: false,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/example.ts'), 'const value = 1;\n');

    const statusBefore = runGitStatus(root);
    const stateBeforeAfterDraft = await readFile(statePath, 'utf8');
    const contractBeforeAfterDraft = await readFile(contractPath, 'utf8');

    const checkResult = runCliCommand(root, 'check', ['--draft', draftPath]);
    assert.equal(checkResult.status, 2);
    assert.equal(checkResult.stdout.includes('Decision: HUMAN_REVIEW'), true);
    assert.equal(checkResult.stdout.includes('CBV-RULE-CONFIG-INVALID'), true);
    assert.equal(checkResult.stdout.includes('Invalid path pattern'), true);
    assert.equal(checkResult.stderr, '');

    const statusAfter = runGitStatus(root);
    const stateAfter = await readFile(statePath, 'utf8');
    const contractAfter = await readFile(contractPath, 'utf8');

    assert.equal(statusAfter, statusBefore);
    assert.equal(stateAfter, stateBeforeAfterDraft);
    assert.equal(contractAfter, contractBeforeAfterDraft);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('status --budget --json mirrors check semantics and remains non-mutating', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Budget json',
        '--base-revision',
        'HEAD',
        '--max-files',
        '5',
        '--max-changed-lines',
        '100',
        '--allow-paths',
        'src/**',
      ]).status,
      0,
    );

    const statePath = join(root, '.changebudget', 'state.json');
    const stateBefore = await readFile(statePath, 'utf8');

    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src', 'planned.ts'), 'export const planned = 1;\n');

    const checkResult = runCliCommand(root, 'check', ['--json']);
    assert.equal(checkResult.status, 0);
    const checkPayload = parseCheckBudgetJson(checkResult.stdout);
    assert.equal(typeof checkPayload.decision, 'string');

    const budgetResult = runCliCommand(root, 'status', ['--budget', '--json']);
    assert.equal(budgetResult.status, 0);

    const budgetStdout = budgetResult.stdout.trim();
    assert.equal(budgetStdout.startsWith('{'), true);
    assert.equal(budgetStdout.endsWith('}'), true);

    const budgetPayload = JSON.parse(budgetStdout) as { decision: string; reasonCodes: string[] };
    assert.equal(budgetPayload.decision, checkPayload.decision);
    assert.deepEqual(budgetPayload.reasonCodes, checkPayload.reasonCodes);

    const stateAfter = await readFile(statePath, 'utf8');
    assert.equal(stateAfter, stateBefore);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('status --budget --json includes stack policy summary for stack-profile contracts', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Stack status profile',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'node-ts',
        '--max-files',
        '8',
        '--max-changed-lines',
        '200',
      ]).status,
      0,
    );

    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions": { "strict": true } }\n');

    const statusResult = runCliCommand(root, 'status', ['--budget', '--json']);
    assert.equal(statusResult.status, 1);

    const budgetPayload = JSON.parse(statusResult.stdout.trim()) as { decision: string; reasonCodes: string[] };

    const checkResult = runCliCommand(root, 'check', ['--json']);
    assert.equal(checkResult.status, 1);
    const checkPayload = parseCheckBudgetJson(checkResult.stdout);

    assert.equal(
      budgetPayload.reasonCodes.includes('CBS-NODE-TS-CONFIGURATION'),
      checkPayload.reasonCodes.includes('CBS-NODE-TS-CONFIGURATION'),
    );
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('check non-json output includes stack profile and per-rule status', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions": { "strict": true } }\n');
    runGit(root, ['add', 'tsconfig.json']);
    runGit(root, ['commit', '-m', 'seed tsconfig']);

    assert.equal(runCliCommand(root, 'init').status, 0);

    assert.equal(
      runCliCommand(root, 'start', [
        '--task',
        'Check stack summary',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'node-ts',
        '--disable-stack-rule',
        'node-ts/public-api',
        '--max-files',
        '10',
        '--max-changed-lines',
        '100',
      ]).status,
      0,
    );

    const checkResult = runCliCommand(root, 'check');
    assert.equal(checkResult.status, 0);
    assert.equal(checkResult.stdout.includes('Stack profile: node-ts'), true);
    assert.equal(checkResult.stdout.includes('Stack rule status:'), true);
    assert.equal(checkResult.stdout.includes('  - node-ts/configuration: active'), true);
    assert.equal(checkResult.stdout.includes('  - node-ts/dependencies: active'), true);
    assert.equal(checkResult.stdout.includes('  - node-ts/public-api: disabled'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('status --budget non-json output includes stack profile and per-rule status', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeFile(join(root, 'tsconfig.json'), '{"compilerOptions": { "strict": true } }\n');
    runGit(root, ['add', 'tsconfig.json']);
    runGit(root, ['commit', '-m', 'seed tsconfig']);

    assert.equal(runCliCommand(root, 'init').status, 0);

    await mkdir(join(root, '.changebudget'), { recursive: true });
    await writeFile(
      join(root, '.changebudget', 'stack-policy-overrides.json'),
      JSON.stringify(
        {
          profiles: {
            'node-ts': {
              disable_rule_ids: ['node-ts/public-api'],
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
        'Status stack summary',
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

    const statusResult = runCliCommand(root, 'status', ['--budget']);
    assert.equal(statusResult.status, 0);
    assert.equal(statusResult.stdout.includes('Budget report for active contract:'), true);
    assert.equal(statusResult.stdout.includes('Stack profile: node-ts'), true);
    assert.equal(statusResult.stdout.includes('Stack rule status:'), true);
    assert.equal(statusResult.stdout.includes('  - node-ts/configuration: active'), true);
    assert.equal(statusResult.stdout.includes('  - node-ts/dependencies: active'), true);
    assert.equal(statusResult.stdout.includes('  - node-ts/public-api: overridden'), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

function writeOrphanContractFile(root: string, contractId: string): string {
  const orphanPath = join(root, '.changebudget', 'contracts', `${contractId}.json`);
  const content = JSON.stringify({
    schema_version: '1.0.0',
    id: contractId,
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
  });
  writeFileSync(orphanPath, content);
  return orphanPath;
}

test('F-M01: next start removes an orphaned active contract left by a failed start', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const orphanPath = writeOrphanContractFile(root, 'contract-orphan');
    assert.equal(existsSync(orphanPath), true);

    const startResult = runCliCommand(root, 'start', ['--task', 'fresh start', '--base-revision', 'HEAD']);
    assert.equal(startResult.status, 0);
    assert.equal(startResult.stdout.includes('Started new contract.'), true);

    assert.equal(existsSync(orphanPath), false);
    const statusOut = runCliCommand(root, 'status');
    assert.equal(statusOut.status, 0);
    assert.equal(statusOut.stdout.includes('Active contract: contract-orphan'), false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('F-M01: closed-contract/active-state mismatch is reported and re-running close reconciles', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);
    assert.equal(runCliCommand(root, 'start', ['--task', 'mismatch', '--base-revision', 'HEAD']).status, 0);

    const statusOut = runCliCommand(root, 'status');
    const activeId = parseActiveContractIdFromStatus(statusOut.stdout);
    assert.equal(activeId !== null, true);

    const statePath = join(root, '.changebudget', 'state.json');
    const stateBefore = await readFile(statePath, 'utf8');

    const contractPath = join(root, '.changebudget', 'contracts', `${activeId}.json`);
    const contract = JSON.parse(await readFile(contractPath, 'utf8')) as { status: string };
    contract.status = 'closed';
    await writeFile(contractPath, JSON.stringify(contract));

    assert.equal(await readFile(statePath, 'utf8'), stateBefore);

    const status = runCliCommand(root, 'status');
    assert.equal(status.status, 4);
    assert.equal(status.stdout, '');
    assert.equal(status.stderr.includes('StateCorruptionError'), true);
    assert.equal(status.stderr.includes('re-run `changebudget close`'), true);

    const closeResult = runCliCommand(root, 'close', ['--actor', 'ci-bot', '--reason', 'reconcile']);
    assert.equal(closeResult.status, 0);

    const state = JSON.parse(await readFile(statePath, 'utf8')) as {
      lifecycle_state: string;
      active_contract_id: string | null;
      last_closed_contract_id: string | null;
    };
    assert.equal(state.lifecycle_state, 'closed');
    assert.equal(state.active_contract_id, null);
    assert.equal(state.last_closed_contract_id, activeId);

    const afterCloseStatus = runCliCommand(root, 'status');
    assert.equal(afterCloseStatus.status, 0);
    assert.equal(afterCloseStatus.stdout.includes('Active contract: none'), true);
    assert.equal(afterCloseStatus.stdout.includes(`Last closed contract: ${activeId}`), true);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
