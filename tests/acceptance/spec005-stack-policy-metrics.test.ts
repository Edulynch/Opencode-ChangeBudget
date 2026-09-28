import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { test, after } from 'node:test';
import { runInProcessCliCommand } from '../utils/in-process-cli.js';
import type { LifecycleAuditRecord, LifecycleStateRecord } from '../../src/models/lifecycle-state.js';

type StackProfile = 'android' | 'flutter' | 'spring-boot' | 'node-ts';

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface SeedFile {
  path: string;
  content: string;
}

interface SensitiveScenario {
  label: string;
  path: string;
  reasonCode: string;
}

interface OverrideScenario {
  disabledRuleId: string;
  noisyPath: string;
  noisyReasonCode: string;
  highImpactPath: string;
  highImpactReasonCode: string;
}

interface ProfileFixture {
  seedFiles: SeedFile[];
  sensitiveScenarios: SensitiveScenario[];
  neutralPath: string;
  override: OverrideScenario;
}

interface CheckViolation {
  rule: string;
  reason_code?: string;
}

interface StackPolicySummary {
  profile_id: string;
  effectiveRuleIds: string[];
  overriddenRuleIds: string[];
  disabledRuleIds: string[];
  statusByRuleId: { ruleId: string; status: 'active' | 'overridden' | 'disabled' }[];
}

interface CheckJsonSummary {
  contractSource: 'active' | 'draft';
  contractId: string | null;
  baseRevision: string;
  decision: 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';
  status: 'PASS' | 'FAIL';
  changedFileCount: number;
  changedLinesCount: number;
  binaryChangeCount: number;
  newFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  limitResults: Array<{ limitName: string; expected: number | null; observed: number; status: 'pass' | 'fail' | 'skip' }>;
  pathRuleResults: Array<{ path: string; status: 'allow' | 'deny'; matchedAllow: boolean; matchedDeny: boolean }>;
  stackPolicySummary?: StackPolicySummary | null;
  violations: CheckViolation[];
  reasonCodes: string[];
  reason_codes: string[];
  asOf: string;
}

interface AcceptanceMetric {
  criterion: string;
  requirement: string;
  observed: string;
  result: 'PASS' | 'FAIL';
  evidence: string;
}

const ACCEPTANCE_METRICS_PATH = join(process.cwd(), 'specs', '005-personal-stack-policies', 'acceptance-metrics.md');

const PROFILE_FIXTURES: Record<StackProfile, ProfileFixture> = {
  android: {
    seedFiles: [
      { path: 'gradle.properties', content: 'org.gradle.jvmargs=-Xmx1024m\n' },
      { path: 'build.gradle', content: 'plugins { id "com.example" version "1.0" }\n' },
      { path: 'AndroidManifest.xml', content: '<manifest package="com.example" />\n' },
      { path: 'notes.md', content: 'base note\n' },
    ],
    sensitiveScenarios: [
      { label: 'android-configuration', path: 'gradle.properties', reasonCode: 'CBS-ANDROID-CONFIGURATION' },
      { label: 'android-dependencies', path: 'build.gradle', reasonCode: 'CBS-ANDROID-DEPENDENCIES' },
      { label: 'android-signing', path: 'AndroidManifest.xml', reasonCode: 'CBS-ANDROID-SIGNING' },
    ],
    neutralPath: 'notes.md',
    override: {
      disabledRuleId: 'android/configuration',
      noisyPath: 'gradle.properties',
      noisyReasonCode: 'CBS-ANDROID-CONFIGURATION',
      highImpactPath: 'AndroidManifest.xml',
      highImpactReasonCode: 'CBS-ANDROID-SIGNING',
    },
  },
  flutter: {
    seedFiles: [
      { path: 'analysis_options.yaml', content: 'include: package:flutter_lints/flutter.yaml\n' },
      { path: 'pubspec.yaml', content: 'name: spec005_flutter\ndescription: baseline\n' },
      { path: '.github/workflows/release.yml', content: 'name: release\n' },
      { path: 'notes.md', content: 'base note\n' },
    ],
    sensitiveScenarios: [
      { label: 'flutter-configuration', path: 'analysis_options.yaml', reasonCode: 'CBS-FLUTTER-CONFIGURATION' },
      { label: 'flutter-dependencies', path: 'pubspec.yaml', reasonCode: 'CBS-FLUTTER-DEPENDENCIES' },
      { label: 'flutter-release', path: '.github/workflows/release.yml', reasonCode: 'CBS-FLUTTER-RELEASE' },
    ],
    neutralPath: 'notes.md',
    override: {
      disabledRuleId: 'flutter/configuration',
      noisyPath: 'analysis_options.yaml',
      noisyReasonCode: 'CBS-FLUTTER-CONFIGURATION',
      highImpactPath: 'pubspec.yaml',
      highImpactReasonCode: 'CBS-FLUTTER-DEPENDENCIES',
    },
  },
  'spring-boot': {
    seedFiles: [
      {
        path: 'src/main/resources/application-dev.yml',
        content: 'app:\n  name: baseline\n',
      },
      { path: 'pom.xml', content: '<project></project>\n' },
      { path: 'src/main/resources/db/migration/V1__init.sql', content: 'create table if not exists baseline(id int);\n' },
      { path: 'notes.md', content: 'base note\n' },
    ],
    sensitiveScenarios: [
      { label: 'spring-config', path: 'src/main/resources/application-dev.yml', reasonCode: 'CBS-SPRING-BOOT-CONFIGURATION' },
      { label: 'spring-dependencies', path: 'pom.xml', reasonCode: 'CBS-SPRING-BOOT-DEPENDENCIES' },
      { label: 'spring-migrations', path: 'src/main/resources/db/migration/V1__init.sql', reasonCode: 'CBS-SPRING-BOOT-MIGRATIONS' },
    ],
    neutralPath: 'notes.md',
    override: {
      disabledRuleId: 'spring-boot/configuration',
      noisyPath: 'src/main/resources/application-dev.yml',
      noisyReasonCode: 'CBS-SPRING-BOOT-CONFIGURATION',
      highImpactPath: 'pom.xml',
      highImpactReasonCode: 'CBS-SPRING-BOOT-DEPENDENCIES',
    },
  },
  'node-ts': {
    seedFiles: [
      { path: 'tsconfig.json', content: '{"compilerOptions": {"strict": true}}\n' },
      { path: 'package-lock.json', content: '{"lockfileVersion": 3}\n' },
      { path: 'src/index.ts', content: 'export const baseline = true;\n' },
      { path: 'notes.md', content: 'base note\n' },
    ],
    sensitiveScenarios: [
      { label: 'node-config', path: 'tsconfig.json', reasonCode: 'CBS-NODE-TS-CONFIGURATION' },
      { label: 'node-dependencies', path: 'package-lock.json', reasonCode: 'CBS-NODE-TS-DEPENDENCIES' },
      { label: 'node-public-api', path: 'src/index.ts', reasonCode: 'CBS-NODE-TS-PUBLIC-API' },
    ],
    neutralPath: 'notes.md',
    override: {
      disabledRuleId: 'node-ts/configuration',
      noisyPath: 'tsconfig.json',
      noisyReasonCode: 'CBS-NODE-TS-CONFIGURATION',
      highImpactPath: 'src/index.ts',
      highImpactReasonCode: 'CBS-NODE-TS-PUBLIC-API',
    },
  },
};

const STACK_PROFILES: StackProfile[] = ['android', 'flutter', 'spring-boot', 'node-ts'];

let acceptanceMetrics: AcceptanceMetric[] = [];

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function createRepositoryWithCommit(seedFiles: SeedFile[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-spec005-'));
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

async function runCliCommand(
  repositoryRoot: string,
  command: string,
  args: string[] = [],
  processBacked = false,
): Promise<CliResult> {
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

async function resetFixtureToSeed(repositoryRoot: string, fixture: ProfileFixture): Promise<void> {
  for (const seed of fixture.seedFiles) {
    await writeSourceFile(repositoryRoot, seed.path, seed.content);
  }
}

async function cleanupRoot(root: string): Promise<void> {
  if (!existsSync(root)) {
    return;
  }

  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
}

interface ChangeBudgetSnapshot {
  readonly files: readonly string[];
  readonly nonStateEntries: readonly string[];
  readonly contractIds: readonly string[];
  readonly state: LifecycleStateRecord;
}

async function snapshotChangeBudget(root: string): Promise<ChangeBudgetSnapshot> {
  const stateRoot = join(root, '.changebudget');
  const files: string[] = [];
  const nonStateEntries: string[] = [];
  const contractIds: string[] = [];
  let state: LifecycleStateRecord | undefined;

  async function walk(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
        continue;
      }

      const relative = path.slice(stateRoot.length + 1);
      const comparableRelative = relative.replace(/contract-[0-9a-f-]{36}/g, '<contract>');
      files.push(comparableRelative);
      const contractMatch = /^contracts[\\/]((?:contract)-[0-9a-f-]{36})\.json$/i.exec(relative);
      if (contractMatch?.[1]) {
        contractIds.push(contractMatch[1]);
      }

      if (relative === 'state.json') {
        state = JSON.parse(await readFile(path, 'utf8')) as LifecycleStateRecord;
        continue;
      }

      const content = (await readFile(path, 'utf8'))
        .replace(/contract-[0-9a-f-]{36}/g, '<contract>')
        .replace(/"activationHead": "[^"]+"/g, '"activationHead": "<head>"')
        .replace(/"activation_head": "[^"]+"/g, '"activation_head": "<head>"')
        .replace(/"integrity": "[^"]+"/g, '"integrity": "<integrity>"')
        .replace(/20\d{2}-\d{2}-\d{2}T[^"\n]+Z/g, '<timestamp>');
      nonStateEntries.push(`${comparableRelative}:${content}`);
    }
  }

  await walk(stateRoot);
  assert.ok(state, `missing structured lifecycle state in ${root}`);
  return {
    files: files.sort(),
    nonStateEntries: nonStateEntries.sort(),
    contractIds: contractIds.sort(),
    state,
  };
}

function assertExactKeys(value: object, expected: readonly string[]): void {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function assertAuditRecordShape(record: LifecycleAuditRecord): void {
  assertExactKeys(record, [
    'audit_schema_version', 'event_id', 'operation', 'contract_id', 'recorded_at', 'authority', 'repository',
    'work', 'version', 'lifecycle', 'scope', 'minimum_delta', 'boundary', 'rationale', 'outcome',
  ]);
  assertExactKeys(record.authority, ['classification', 'provenance', 'human_premise', 'canonical_grant']);
  assertExactKeys(record.repository, ['observed_root', 'verified_binding']);
  assertExactKeys(record.work, ['task_id', 'verified_binding']);
  assertExactKeys(record.version, ['state_schema_version', 'contract_schema_version', 'authority_schema_version']);
  assertExactKeys(record.lifecycle, ['before', 'after']);
  assertExactKeys(record.scope, ['paths', 'capabilities', 'ceilings']);
  assertExactKeys(record.scope.paths, ['allow', 'deny']);
  assertExactKeys(record.scope.capabilities, [
    'new_files', 'dependencies', 'migrations', 'configuration', 'public_api',
  ]);
  assertExactKeys(record.scope.ceilings, ['max_files', 'max_changed_lines']);
  assertExactKeys(record.scope.ceilings.max_files, ['value', 'provenance']);
  assertExactKeys(record.scope.ceilings.max_changed_lines, ['value', 'provenance']);
  assertExactKeys(record.minimum_delta, ['classification', 'changes']);
  for (const change of record.minimum_delta.changes) {
    assertExactKeys(change, ['field', 'before', 'after']);
  }
  assertExactKeys(record.boundary, ['subset_check', 'authority_comparison']);
  assertExactKeys(record.rationale, [
    'source', 'statement', 'reason_provided', 'actor_provided', 'force_requested', 'metadata_is_authority',
  ]);
  assertExactKeys(record.outcome, ['status', 'confirmation']);
}

function normalizedAuditIdentity(record: LifecycleAuditRecord): LifecycleAuditRecord {
  return {
    ...record,
    event_id: '<event-id>',
    repository: { ...record.repository, observed_root: '<observed-root>' },
  };
}

function assertAuditRecordParity(
  left: LifecycleAuditRecord,
  right: LifecycleAuditRecord,
  leftRoot: string,
  rightRoot: string,
  leftState: LifecycleStateRecord,
  rightState: LifecycleStateRecord,
  leftContractIds: readonly string[],
  rightContractIds: readonly string[],
): void {
  assertAuditRecordShape(left);
  assertAuditRecordShape(right);
  const normalizedLeft = normalizedAuditIdentity(left);
  const normalizedRight = normalizedAuditIdentity(right);
  assert.equal(normalizedLeft.event_id, normalizedRight.event_id);
  assert.equal(normalizedLeft.repository.observed_root, normalizedRight.repository.observed_root);
  assert.match(left.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.match(right.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  assert.equal(left.repository.observed_root, resolve(leftRoot));
  assert.equal(right.repository.observed_root, resolve(rightRoot));
  assert.equal(Number.isNaN(Date.parse(left.recorded_at)), false);
  assert.equal(Number.isNaN(Date.parse(right.recorded_at)), false);
  assert.equal(left.audit_schema_version, right.audit_schema_version);
  assert.equal(left.operation, right.operation);
  assert.deepEqual(left.authority, {
    classification: 'UNRESOLVED',
    provenance: 'unavailable',
    human_premise: 'unavailable',
    canonical_grant: 'unavailable',
  });
  assert.equal(left.repository.verified_binding, 'unavailable');
  assert.equal(left.work.verified_binding, 'unavailable');
  assert.equal(left.work.task_id, null);
  assert.deepEqual(left.boundary, {
    subset_check: 'not_evaluated',
    authority_comparison: 'not_evaluated_phase_b_d',
  });
  assert.equal(left.minimum_delta.classification, 'mechanical-delta-only');
  assert.deepEqual(left.outcome, {
    status: 'committed',
    confirmation: 'operation_write_returned',
  });

  const lifecycleByOperation: Record<LifecycleAuditRecord['operation'], LifecycleAuditRecord['lifecycle']> = {
    init: { before: 'uninitialized', after: 'initialized' },
    start: { before: 'initialized', after: 'active' },
    amend: { before: 'active', after: 'active' },
    close: { before: 'active', after: 'closed' },
    native_grant_admin: { before: 'active', after: 'active' },
  };
  assert.deepEqual(left.lifecycle, lifecycleByOperation[left.operation]);
  assert.deepEqual(right.lifecycle, lifecycleByOperation[right.operation]);
  assert.deepEqual(left.version, {
    state_schema_version: '1.0.0',
    contract_schema_version: left.operation === 'init' ? null : '1.0.0',
    authority_schema_version: 'unavailable',
  });
  assert.deepEqual(left.scope.capabilities, {
    new_files: false,
    dependencies: false,
    migrations: false,
    configuration: false,
    public_api: false,
  });

  if (left.operation === 'init') {
    assert.equal(left.version.contract_schema_version, null);
    assert.deepEqual(left.scope, {
      paths: { allow: [], deny: [] },
      capabilities: {
        new_files: false,
        dependencies: false,
        migrations: false,
        configuration: false,
        public_api: false,
      },
      ceilings: {
        max_files: { value: null, provenance: 'not_applicable' },
        max_changed_lines: { value: null, provenance: 'not_applicable' },
      },
    });
    assert.deepEqual(left.minimum_delta.changes.map((change) => change.field), ['lifecycle_state']);
  } else {
    assert.equal(left.version.contract_schema_version, '1.0.0');
    assert.deepEqual(left.scope.paths, { allow: [], deny: [] });
    assert.deepEqual(left.scope.ceilings, {
      max_files: { value: 20, provenance: 'UNRESOLVED' },
      max_changed_lines: { value: 200, provenance: 'UNRESOLVED' },
    });
    if (left.operation === 'close') {
      assert.deepEqual(left.minimum_delta.changes.map((change) => change.field), ['lifecycle_state', 'status']);
      assert.deepEqual(left.minimum_delta.changes[0], {
        field: 'lifecycle_state', before: 'active', after: 'closed',
      });
      assert.deepEqual(left.minimum_delta.changes[1], { field: 'status', before: 'active', after: 'closed' });
    } else if (left.operation === 'start') {
      assert.equal(left.minimum_delta.changes[0]?.field, 'lifecycle_state');
      assert.deepEqual(left.minimum_delta.changes[0], {
        field: 'lifecycle_state', before: 'initialized', after: 'active',
      });
    }
  }
  assert.deepEqual(left.rationale, {
    source: 'cli_lifecycle_request',
    statement: 'no_verified_authority_provider; cli_metadata_is_not_approval',
    reason_provided: left.operation === 'close',
    actor_provided: left.operation === 'close',
    force_requested: false,
    metadata_is_authority: false,
  });
  assert.deepEqual(right.rationale, left.rationale);

  const expectedLeftContract = left.operation === 'init'
    ? null
    : leftState.active_contract_id ?? leftState.last_closed_contract_id;
  const expectedRightContract = right.operation === 'init'
    ? null
    : rightState.active_contract_id ?? rightState.last_closed_contract_id;
  assert.equal(left.contract_id, expectedLeftContract);
  assert.equal(right.contract_id, expectedRightContract);
  if (left.contract_id !== null) {
    assert.ok(leftContractIds.includes(left.contract_id), `missing contract file ${left.contract_id} in ${leftRoot}`);
    assert.ok(right.contract_id !== null && rightContractIds.includes(right.contract_id), `missing contract file in ${rightRoot}`);
  }

  assert.deepEqual(left.authority, right.authority);
  assertExactKeys(left.repository, ['observed_root', 'verified_binding']);
  assertExactKeys(right.repository, ['observed_root', 'verified_binding']);
  assert.equal(left.repository.verified_binding, right.repository.verified_binding);
  assert.deepEqual(left.work, right.work);
  assert.deepEqual(left.version, right.version);
  assert.deepEqual(left.lifecycle, right.lifecycle);
  assert.deepEqual(left.scope, right.scope);
  assert.deepEqual(left.boundary, right.boundary);
  assert.deepEqual(left.rationale, right.rationale);
  assert.deepEqual(left.outcome, right.outcome);

  assertExactKeys(left.minimum_delta, ['classification', 'changes']);
  assertExactKeys(right.minimum_delta, ['classification', 'changes']);
  assert.equal(left.minimum_delta.classification, right.minimum_delta.classification);
  assert.equal(left.minimum_delta.changes.length, right.minimum_delta.changes.length);
  assert.deepEqual(
    left.minimum_delta.changes.map((change) => change.field),
    right.minimum_delta.changes.map((change) => change.field),
  );
  left.minimum_delta.changes.forEach((leftChange, index) => {
    const rightChange = right.minimum_delta.changes[index]!;
    assertExactKeys(leftChange, ['field', 'before', 'after']);
    assertExactKeys(rightChange, ['field', 'before', 'after']);
    if (leftChange.field === 'contract_id') {
      assert.equal(leftChange.before, null);
      assert.equal(rightChange.before, null);
      assert.equal(leftChange.after, left.contract_id);
      assert.equal(rightChange.after, right.contract_id);
    } else {
      assert.deepEqual(leftChange.before, rightChange.before);
      assert.deepEqual(leftChange.after, rightChange.after);
    }
  });
}

function assertChangeBudgetParity(
  left: ChangeBudgetSnapshot,
  right: ChangeBudgetSnapshot,
  leftRoot: string,
  rightRoot: string,
  expectedOperations: readonly LifecycleAuditRecord['operation'][],
): void {
  // Compare every file, including unknown files; only known per-fixture values outside state.json use the
  // established non-state canonicalization above. Lifecycle audit JSON is validated field by field below.
  assert.deepEqual(left.files, right.files);
  assert.deepEqual(left.nonStateEntries, right.nonStateEntries);
  assert.deepEqual(left.state.schema_version, right.state.schema_version);
  assert.equal(left.state.lifecycle_state, right.state.lifecycle_state);
  assert.equal(Number.isNaN(Date.parse(left.state.updated_at)), false);
  assert.equal(Number.isNaN(Date.parse(right.state.updated_at)), false);
  assertExactKeys(left.state, [
    'schema_version', 'lifecycle_state', 'active_contract_id', 'last_closed_contract_id', 'updated_at', 'audit_history',
  ]);
  assertExactKeys(right.state, [
    'schema_version', 'lifecycle_state', 'active_contract_id', 'last_closed_contract_id', 'updated_at', 'audit_history',
  ]);

  const leftHistory = left.state.audit_history;
  const rightHistory = right.state.audit_history;
  assert.ok(leftHistory, `missing audit history in ${leftRoot}`);
  assert.ok(rightHistory, `missing audit history in ${rightRoot}`);
  assert.equal(leftHistory.length, rightHistory.length);
  assert.deepEqual(leftHistory.map((record) => record.operation), expectedOperations);
  assert.deepEqual(rightHistory.map((record) => record.operation), expectedOperations);
  assert.equal(new Set(leftHistory.map((record) => record.event_id)).size, leftHistory.length);
  assert.equal(new Set(rightHistory.map((record) => record.event_id)).size, rightHistory.length);

  if (left.state.lifecycle_state === 'active') {
    assert.equal(typeof left.state.active_contract_id, 'string');
    assert.equal(typeof right.state.active_contract_id, 'string');
    assert.ok(left.state.active_contract_id && left.contractIds.includes(left.state.active_contract_id));
    assert.ok(right.state.active_contract_id && right.contractIds.includes(right.state.active_contract_id));
    assert.equal(left.state.last_closed_contract_id, null);
    assert.equal(right.state.last_closed_contract_id, null);
  } else if (left.state.lifecycle_state === 'closed') {
    assert.equal(left.state.active_contract_id, null);
    assert.equal(right.state.active_contract_id, null);
    assert.ok(left.state.last_closed_contract_id && left.contractIds.includes(left.state.last_closed_contract_id));
    assert.ok(right.state.last_closed_contract_id && right.contractIds.includes(right.state.last_closed_contract_id));
  }

  leftHistory.forEach((record, index) => {
    assertAuditRecordParity(
      record,
      rightHistory[index]!,
      leftRoot,
      rightRoot,
      left.state,
      right.state,
      left.contractIds,
      right.contractIds,
    );
  });
}

function gitStatus(root: string): string {
  const result = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0);
  return result.stdout ?? '';
}

function buildStartArgs(profile: StackProfile, disabledRules: string[], taskSuffix: string): string[] {
  const args = [
    '--task',
    `spec005-${profile}-${taskSuffix}`,
    '--base-revision',
    'HEAD',
    '--stack-profile',
    profile,
    '--max-files',
    '20',
    '--max-changed-lines',
    '200',
  ];

  for (const disabledRule of disabledRules) {
    args.push('--disable-stack-rule', disabledRule);
  }

  return args;
}

function parseCheckPayload(stdout: string): CheckJsonSummary {
  return JSON.parse(stdout) as CheckJsonSummary;
}

function canonicalizeCheckPayload(payload: CheckJsonSummary): string {
  const copy = JSON.parse(JSON.stringify(payload)) as CheckJsonSummary;
  delete (copy as { asOf?: string }).asOf;

  if (copy.stackPolicySummary) {
    copy.stackPolicySummary.statusByRuleId = [...copy.stackPolicySummary.statusByRuleId].sort((left, right) =>
      left.ruleId.localeCompare(right.ruleId),
    );
  }

  copy.violations = [...copy.violations].sort((left, right) => {
    const rule = left.rule.localeCompare(right.rule);
    if (rule !== 0) {
      return rule;
    }

    return (left.reason_code ?? '').localeCompare(right.reason_code ?? '');
  });

  return JSON.stringify(copy, Object.keys(copy).sort());
}

function buildScenariosForMix(profile: StackProfile): Array<{ path: string; expectedReason: string | null }> {
  const fixture = PROFILE_FIXTURES[profile];
  return [
    { path: fixture.sensitiveScenarios[0].path, expectedReason: fixture.sensitiveScenarios[0].reasonCode },
    { path: fixture.sensitiveScenarios[1].path, expectedReason: fixture.sensitiveScenarios[1].reasonCode },
    { path: fixture.sensitiveScenarios[2].path, expectedReason: fixture.sensitiveScenarios[2].reasonCode },
    { path: fixture.neutralPath, expectedReason: null },
  ];
}

function buildScenarioContent(profile: StackProfile, path: string, iteration: number): string {
  return `scenario=${profile}|path=${path}|iteration=${iteration}\n`;
}

function recordMetric(metric: AcceptanceMetric): void {
  acceptanceMetrics = [...acceptanceMetrics, metric];
}

function buildAcceptanceMetricsMarkdown(metrics: AcceptanceMetric[]): string {
  const header = [
    '# SPEC-005 Acceptance Metrics',
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

test('SPEC-005 SC-001: stack policy produces stable rule IDs across at least 100 mixed scenarios', async () => {
  const requirement =
    'For each supported stack, at least one deterministic sensitive category is resolved in at least 100 mixed checks/decisions';
  let totalScenarios = 0;
  let repairScenarios = 0;
  let passScenarios = 0;
  let matchedRuleScenarios = 0;
  const observedReasonIds = new Set<string>();

  try {
    for (const profile of STACK_PROFILES) {
      const fixture = PROFILE_FIXTURES[profile];
      const root = await createRepositoryWithCommit(fixture.seedFiles);
      const processSmoke = profile === STACK_PROFILES[0];

      try {
        assert.equal((await runCliCommand(root, 'init', [], processSmoke)).status, 0);
        assert.equal((await runCliCommand(root, 'start', buildStartArgs(profile, [], 'sc1'), processSmoke)).status, 0);

        const scenarioPattern = buildScenariosForMix(profile);
        for (let iteration = 0; iteration < 25; iteration += 1) {
          const expected = scenarioPattern[iteration % scenarioPattern.length];

          await resetFixtureToSeed(root, fixture);
          const content = buildScenarioContent(profile, expected.path, iteration);
          await writeSourceFile(root, expected.path, content);

          const payload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'], processSmoke && iteration === 0)).stdout);
          totalScenarios += 1;

          if (expected.expectedReason === null) {
            passScenarios += 1;
            assert.equal(payload.decision, 'PASS');
            assert.equal(payload.reasonCodes.length, 0);
            continue;
          }

          repairScenarios += 1;
          assert.equal(payload.decision, 'REPAIR');
          assert.equal(payload.reasonCodes.includes(expected.expectedReason), true);
          observedReasonIds.add(expected.expectedReason);
          matchedRuleScenarios += 1;
        }
      } finally {
        assert.equal((await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc1 cleanup'], processSmoke)).status, 0);
        await cleanupRoot(root);
      }
    }

    assert.equal(totalScenarios, 100);
    assert.equal(matchedRuleScenarios, repairScenarios);
    assert.equal(observedReasonIds.size, 12);
    assert.equal(repairScenarios > 0 && passScenarios > 0, true);

    const evidence = `100 scenarios (repair=${repairScenarios}, pass=${passScenarios}), reason IDs observed=${Array.from(observedReasonIds).sort().join(', ')}`;
    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `${totalScenarios} mixed check scenarios`,
      result: 'PASS',
      evidence,
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-001',
      requirement,
      observed: `${totalScenarios} scenarios checked`,
      result: 'FAIL',
      evidence: 'At least one mixed scenario failed expected stack reason stability checks.',
    });

    throw error;
  }
});

test('SPEC-005 SC-002: repeated evaluations on the same repo/contract/file set remain byte-stable', async () => {
  const requirement =
    'Repeated evaluation of the same repository, same contract, and same file set yields byte-stable output in at least 20 runs';
  const iterations = 20;
  let stableRuns = 0;
  let observedSample: string | null = null;
  const profile = 'node-ts';
  const fixture = PROFILE_FIXTURES[profile];
  const root = await createRepositoryWithCommit(fixture.seedFiles);

  try {
    assert.equal((await runCliCommand(root, 'init')).status, 0);
    assert.equal(
      (await runCliCommand(root, 'start', buildStartArgs(profile, [], 'sc2'))).status,
      0,
    );

    await resetFixtureToSeed(root, fixture);
    await writeSourceFile(root, fixture.sensitiveScenarios[0].path, 'scenario=sc2-initial\n');

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const payload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'])).stdout);
      const canonical = canonicalizeCheckPayload(payload);

      stableRuns += 1;
      assert.equal(payload.decision, 'REPAIR');

      if (observedSample === null) {
        observedSample = canonical;
        continue;
      }

      assert.equal(canonical, observedSample);
    }

    assert.equal(stableRuns, iterations);
    assert.equal(observedSample?.length, observedSample?.length);

    await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc2 cleanup']);

    const evidence = `20 runs compared after removing asOf; stable string length ${observedSample?.length ?? 0}`;
    recordMetric({
      criterion: 'SC-002',
      requirement,
      observed: `${iterations} repeated runs`,
      result: 'PASS',
      evidence,
    });
  } catch (error) {
    await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc2 cleanup']);
    recordMetric({
      criterion: 'SC-002',
      requirement,
      observed: `${stableRuns} runs observed`,
      result: 'FAIL',
      evidence: 'Byte-stable comparison failed across repeated runs.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});

test('SPEC-005 SC-003: default-only stack profile edits always emit configured stack reason codes', async () => {
  const requirement =
    'With only stack profile defaults, every edit matching a review rule emits the corresponding stack reason code';
  let totalExpected = 0;
  let totalMatched = 0;

  try {
    for (const profile of STACK_PROFILES) {
      const fixture = PROFILE_FIXTURES[profile];
      const root = await createRepositoryWithCommit(fixture.seedFiles);

      try {
        assert.equal((await runCliCommand(root, 'init')).status, 0);
        assert.equal((await runCliCommand(root, 'start', buildStartArgs(profile, [], 'sc3'))).status, 0);

        for (const scenario of fixture.sensitiveScenarios) {
          totalExpected += 1;
          await resetFixtureToSeed(root, fixture);
          await writeSourceFile(root, scenario.path, `sc3-${scenario.label}\n`);

          const payload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'])).stdout);
          assert.equal(payload.decision, 'REPAIR');
          assert.equal(payload.reasonCodes.includes(scenario.reasonCode), true);
          totalMatched += 1;
        }
      } finally {
        assert.equal((await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc3 cleanup'])).status, 0);
        await cleanupRoot(root);
      }
    }

    assert.equal(totalMatched, totalExpected);
    assert.equal(totalExpected, 12);

    recordMetric({
      criterion: 'SC-003',
      requirement,
      observed: `${totalMatched}/${totalExpected} matching edits emitted expected stack code`,
      result: 'PASS',
      evidence: 'Coverage includes all 12 built-in deterministic stack rules.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-003',
      requirement,
      observed: `${totalMatched}/${totalExpected} matching edits emitted expected stack code`,
      result: 'FAIL',
      evidence: 'One or more default-stack sensitive edits did not emit expected reason code.',
    });

    throw error;
  }
});

test('SPEC-005 SC-004: repository overrides reduce false positives while preserving high-impact detection', async () => {
  const requirement =
    'In at least 90% of stack-sensitive scenarios, repository overrides lower false positives without reducing detection of high-impact changes';
  const scenarios = 20;
  const minPasses = Math.ceil(scenarios * 0.9);
  let overrideSuppressed = 0;
  let highImpactPreserved = 0;

  for (let index = 0; index < scenarios; index += 1) {
    const profile = STACK_PROFILES[index % STACK_PROFILES.length];
    const fixture = PROFILE_FIXTURES[profile];
    const root = await createRepositoryWithCommit(fixture.seedFiles);

    try {
      assert.equal((await runCliCommand(root, 'init')).status, 0);

      assert.equal(
        (await runCliCommand(root, 'start', buildStartArgs(profile, [], `sc4-baseline-${index}`))).status,
        0,
      );

      await resetFixtureToSeed(root, fixture);
      await writeSourceFile(root, fixture.override.noisyPath, `sc4-noisy-${index}\n`);

      const baselinePayload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'])).stdout);
      assert.equal(baselinePayload.decision, 'REPAIR');
      assert.equal(baselinePayload.reasonCodes.includes(fixture.override.noisyReasonCode), true);

      assert.equal((await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc4 baseline'])).status, 0);

      const overrideFilePath = join(root, '.changebudget', 'stack-policy-overrides.json');
      await mkdir(dirname(overrideFilePath), { recursive: true });
      await writeFile(
        overrideFilePath,
        JSON.stringify({
          profiles: {
            [profile]: {
              disable_rule_ids: [fixture.override.disabledRuleId],
            },
          },
        }, null, 2),
      );

      assert.equal(
        (await runCliCommand(root, 'start', buildStartArgs(profile, [fixture.override.disabledRuleId], `sc4-override-${index}`))).status,
        0,
      );

      const overridePayload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'])).stdout);
      if (!overridePayload.reasonCodes.includes(fixture.override.noisyReasonCode)) {
        overrideSuppressed += 1;
      }

      assert.equal(overridePayload.decision === 'PASS' || overridePayload.decision === 'REPAIR', true);

      await writeSourceFile(root, fixture.override.highImpactPath, `sc4-high-${index}\n`);
      const highPayload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'])).stdout);
      if (highPayload.reasonCodes.includes(fixture.override.highImpactReasonCode)) {
        highImpactPreserved += 1;
      }

      assert.equal(highPayload.reasonCodes.includes(fixture.override.highImpactReasonCode), true);

      assert.equal((await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc4 cleanup'])).status, 0);
    } finally {
      await cleanupRoot(root);
    }
  }

  const passed = overrideSuppressed >= minPasses && highImpactPreserved >= minPasses;
  if (passed) {
    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `${overrideSuppressed}/${scenarios} false positives suppressed, ${highImpactPreserved}/${scenarios} high-impact preserved`,
      result: 'PASS',
      evidence: 'Repository-level disablement repeatedly removes the intended noisy rule and keeps high-impact rules active.',
    });
  } else {
    recordMetric({
      criterion: 'SC-004',
      requirement,
      observed: `${overrideSuppressed}/${scenarios} false positives suppressed, ${highImpactPreserved}/${scenarios} high-impact preserved`,
      result: 'FAIL',
      evidence: 'Override-only scenarios did not meet 90% suppression and detection preservation threshold.',
    });
  }

  assert.equal(passed, true);
});

test('SPEC-005 SC-005: contract-level disablements do not leak across adjacent contracts', async () => {
  const requirement =
    'Contract-level rule disabling affects only the current contract in at least 20 independent contract cycles';
  const cycles = 20;
  const profile = 'flutter';
  const fixture = PROFILE_FIXTURES[profile];
  let cycleLeakSatisfied = 0;
  let cycleSuppressionSatisfied = 0;
  const root = await createRepositoryWithCommit(fixture.seedFiles);

  try {
    assert.equal((await runCliCommand(root, 'init')).status, 0);

    for (let cycle = 0; cycle < cycles; cycle += 1) {
      await writeSourceFile(root, fixture.override.noisyPath, 'analyze: false\n');

      assert.equal(
        (await runCliCommand(
          root,
          'start',
          buildStartArgs(profile, [fixture.override.disabledRuleId], `sc5-disable-${cycle}`),
        )).status,
        0,
      );

      await writeSourceFile(root, fixture.override.noisyPath, `analyze: true # cycle ${cycle}\n`);
      const disabledPayload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'])).stdout);
      if (!disabledPayload.reasonCodes.includes(fixture.override.noisyReasonCode)) {
        cycleSuppressionSatisfied += 1;
      }

      assert.equal((await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc5 first'])).status, 0);

      assert.equal((await runCliCommand(root, 'start', buildStartArgs(profile, [], `sc5-adjacent-${cycle}`))).status, 0);
      await writeSourceFile(root, fixture.override.noisyPath, `analyze: false # adjacent ${cycle}\n`);
      const adjacentPayload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'])).stdout);
      if (adjacentPayload.reasonCodes.includes(fixture.override.noisyReasonCode)) {
        cycleLeakSatisfied += 1;
      }

      assert.equal((await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc5 second'])).status, 0);
    }

    assert.equal(cycleSuppressionSatisfied, cycles);
    assert.equal(cycleLeakSatisfied, cycles);

    recordMetric({
      criterion: 'SC-005',
      requirement,
      observed: `${cycleSuppressionSatisfied}/${cycles} cycles suppressed, ${cycleLeakSatisfied}/${cycles} adjacent contracts preserved`,
      result: 'PASS',
      evidence: 'Each 2-contract cycle confirmed disabled-rule scope is contract-local.',
    });
  } catch (error) {
    recordMetric({
      criterion: 'SC-005',
      requirement,
      observed: `${cycleSuppressionSatisfied}/${cycles} suppressions, ${cycleLeakSatisfied}/${cycles} adjacent re-enablement checks`,
      result: 'FAIL',
      evidence: 'A contract-locality expectation failed across adjacent contract cycles.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});

test('SPEC-005 SC-006: contract operations remain performant in non-interactive mode', async () => {
  const requirement =
    'Stack profile selection and override resolution complete within existing command timeout in non-interactive mode';
  const profile = 'node-ts';
  const fixture = PROFILE_FIXTURES[profile];
  const iterations = 20;
  const startMaxMs = 3000;
  const checkMaxMs = 3000;
  const startSamples: number[] = [];
  const checkSamples: number[] = [];

  const root = await createRepositoryWithCommit(fixture.seedFiles);

  try {
    assert.equal((await runCliCommand(root, 'init')).status, 0);

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      await resetFixtureToSeed(root, fixture);
      const startAt = performance.now();
      assert.equal(
        (await runCliCommand(root, 'start', buildStartArgs(profile, [], `sc6-${iteration}`))).status,
        0,
      );
      const startDuration = performance.now() - startAt;
      startSamples.push(startDuration);

      await writeSourceFile(root, fixture.sensitiveScenarios[0].path, `sc6-cycle-${iteration}\n`);
      const checkAt = performance.now();
      const checkPayload = parseCheckPayload((await runCliCommand(root, 'check', ['--json'])).stdout);
      const checkDuration = performance.now() - checkAt;
      checkSamples.push(checkDuration);

      assert.equal(checkPayload.decision, 'REPAIR');
      assert.equal((await runCliCommand(root, 'close', ['--actor', 'spec005', '--reason', 'sc6 cleanup'])).status, 0);
    }

    const maxStart = Math.max(...startSamples);
    const maxCheck = Math.max(...checkSamples);
    const avgStart = startSamples.reduce((value, entry) => value + entry, 0) / startSamples.length;
    const avgCheck = checkSamples.reduce((value, entry) => value + entry, 0) / checkSamples.length;

    const passed = maxStart <= startMaxMs && maxCheck <= checkMaxMs;
    if (passed) {
      recordMetric({
        criterion: 'SC-006',
        requirement,
        observed: `start max=${maxStart.toFixed(2)}ms avg=${avgStart.toFixed(2)}ms, check max=${maxCheck.toFixed(2)}ms avg=${avgCheck.toFixed(2)}ms`,
        result: 'PASS',
        evidence: 'All start and check commands stayed below 3000ms threshold in local runs.',
      });
    } else {
      recordMetric({
        criterion: 'SC-006',
        requirement,
        observed: `start max=${maxStart.toFixed(2)}ms avg=${avgStart.toFixed(2)}ms, check max=${maxCheck.toFixed(2)}ms avg=${avgCheck.toFixed(2)}ms`,
        result: 'FAIL',
        evidence: 'One or more contract operations exceeded the 3000ms threshold.',
      });
    }

    assert.equal(passed, true);
  } catch (error) {
    recordMetric({
      criterion: 'SC-006',
      requirement,
      observed: `start checks: ${startSamples.length}, stack checks: ${checkSamples.length}`,
      result: 'FAIL',
      evidence: 'Performance assertions failed for one or more non-interactive operations.',
    });

    await cleanupRoot(root);
    throw error;
  }

  await cleanupRoot(root);
});

test('SPEC-005 CLI harness parity preserves command, JSON, state, and Git behavior', async () => {
  const subprocessRoot = await createRepositoryWithCommit(PROFILE_FIXTURES['node-ts'].seedFiles);
  const inProcessRoot = await createRepositoryWithCommit(PROFILE_FIXTURES['node-ts'].seedFiles);
  const startArgs = buildStartArgs('node-ts', [], 'parity');

  try {
    const subprocessInit = runCliSubprocess(subprocessRoot, 'init');
    const inProcessInit = await runInProcessCliCommand(inProcessRoot, 'init');
    assert.deepEqual(inProcessInit, subprocessInit);
    assertChangeBudgetParity(
      await snapshotChangeBudget(inProcessRoot),
      await snapshotChangeBudget(subprocessRoot),
      inProcessRoot,
      subprocessRoot,
      ['init'],
    );

    const subprocessInvalid = runCliSubprocess(subprocessRoot, 'start', ['--stack-profile', 'invalid-profile']);
    const inProcessInvalid = await runInProcessCliCommand(inProcessRoot, 'start', ['--stack-profile', 'invalid-profile']);
    assert.deepEqual(inProcessInvalid, subprocessInvalid);
    assertChangeBudgetParity(
      await snapshotChangeBudget(inProcessRoot),
      await snapshotChangeBudget(subprocessRoot),
      inProcessRoot,
      subprocessRoot,
      ['init'],
    );

    const subprocessStart = runCliSubprocess(subprocessRoot, 'start', startArgs);
    const inProcessStart = await runInProcessCliCommand(inProcessRoot, 'start', startArgs);
    assert.equal(inProcessStart.status, subprocessStart.status);
    assert.equal(inProcessStart.stdout, subprocessStart.stdout);
    assert.equal(inProcessStart.stderr, subprocessStart.stderr);

    await writeSourceFile(subprocessRoot, 'src/index.ts', 'export const parity = true;\n');
    await writeSourceFile(inProcessRoot, 'src/index.ts', 'export const parity = true;\n');

    const subprocessCheck = runCliSubprocess(subprocessRoot, 'check', ['--json']);
    const inProcessCheck = await runInProcessCliCommand(inProcessRoot, 'check', ['--json']);
    const subprocessPayload = JSON.parse(subprocessCheck.stdout) as { decision: string; reasonCodes: string[] };
    const inProcessPayload = JSON.parse(inProcessCheck.stdout) as { decision: string; reasonCodes: string[] };
    assert.equal(inProcessCheck.status, subprocessCheck.status);
    assert.equal(inProcessPayload.decision, subprocessPayload.decision);
    assert.deepEqual(inProcessPayload.reasonCodes, subprocessPayload.reasonCodes);
    assert.equal(inProcessCheck.stderr, subprocessCheck.stderr);
    assert.equal(gitStatus(inProcessRoot), gitStatus(subprocessRoot));
    assertChangeBudgetParity(
      await snapshotChangeBudget(inProcessRoot),
      await snapshotChangeBudget(subprocessRoot),
      inProcessRoot,
      subprocessRoot,
      ['init', 'start'],
    );

    const subprocessClose = runCliSubprocess(subprocessRoot, 'close', ['--actor', 'spec005', '--reason', 'parity']);
    const inProcessClose = await runInProcessCliCommand(inProcessRoot, 'close', ['--actor', 'spec005', '--reason', 'parity']);
    assert.deepEqual(inProcessClose, subprocessClose);
    assert.equal(gitStatus(inProcessRoot), gitStatus(subprocessRoot));
    assertChangeBudgetParity(
      await snapshotChangeBudget(inProcessRoot),
      await snapshotChangeBudget(subprocessRoot),
      inProcessRoot,
      subprocessRoot,
      ['init', 'start', 'close'],
    );
  } finally {
    await cleanupRoot(subprocessRoot);
    await cleanupRoot(inProcessRoot);
  }
});
