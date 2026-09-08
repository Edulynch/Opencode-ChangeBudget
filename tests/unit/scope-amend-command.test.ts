import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

import { runAmend } from '../../src/cli/commands/amend.js';
import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { readContract } from '../../src/core/state/contracts.js';
import {
  getBaselineEvidencePath,
  getContractFilePath,
  getStateFilePath,
} from '../../src/core/state/state.js';
import { InputValidationError, StateCorruptionError } from '../../src/models/errors.js';

interface RuntimeContractSnapshot {
  readonly allow_paths: readonly string[];
}

interface RuntimeEvaluation {
  readonly contractId: string | null;
  readonly contract: RuntimeContractSnapshot | null;
}

interface RuntimeEvaluator {
  readonly evaluateRuntimeDecision: (repositoryRoot: string) => Promise<RuntimeEvaluation>;
}

function isRuntimeEvaluator(value: unknown): value is RuntimeEvaluator {
  return value !== null
    && typeof value === 'object'
    && typeof Reflect.get(value, 'evaluateRuntimeDecision') === 'function';
}

const runtimeEvaluatorPath = pathToFileURL(join(
  process.cwd(),
  'opencode-plugin',
  'dist',
  'opencode-plugin',
  'src',
  'evaluator.js',
)).href;
const runtimeEvaluatorModule: unknown = await import(runtimeEvaluatorPath);
if (!isRuntimeEvaluator(runtimeEvaluatorModule)) {
  throw new Error('Runtime evaluator module is invalid');
}

function runGit(root: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function createActiveContract(allowPath = 'src/existing.ts'): Promise<{
  readonly root: string;
  readonly contractId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'cb-scope-amend-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'scope amend test']);
  runGit(root, ['config', 'user.email', 'scope-amend@test']);
  runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
  await runInit(root);
  const started = await runStart(root, [
    '--task', 'amend scope',
    '--base-revision', 'HEAD',
    '--allow-path', allowPath,
    '--max-files', '2',
    '--max-changed-lines', '20',
  ]);
  return { root, contractId: started.contractId };
}

async function cleanupFixture(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 10 });
}

test('runAmend adds canonical literal paths in one scope audit entry', async () => {
  const fixture = await createActiveContract();
  try {
    // Given an active contract with baseline evidence and an existing narrow scope
    const before = await readContract(fixture.root, fixture.contractId);
    const stateBefore = await readFile(getStateFilePath(fixture.root), 'utf8');
    const baselineBefore = await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8');

    // When a developer supplies repeated and comma-separated allow paths with a reason
    const result = await runAmend(fixture.root, [
      '--allow-path', ' src\\feature.ts , src//test.ts ',
      '--allow-paths=docs/guide.md',
      '--reason', 'Add the exact implementation and documentation paths',
    ]);

    // Then only root-anchored literal paths are appended and recorded
    assert.deepEqual(result.contract.allow_paths, [
      'src/existing.ts',
      '/src/feature.ts',
      '/src/test.ts',
      '/docs/guide.md',
    ]);
    assert.deepEqual(result.contract.scope_amendments, [{
      sequence: 1,
      contract_id: fixture.contractId,
      amended_at: result.contract.updated_at,
      reason: 'Add the exact implementation and documentation paths',
      changes: { allow_paths_added: ['/src/feature.ts', '/src/test.ts', '/docs/guide.md'] },
    }]);
    assert.deepEqual(result.contract.budget_amendments, before.budget_amendments);
    assert.equal(result.contract.base_revision, before.base_revision);
    assert.equal(result.contract.comparison_mode, before.comparison_mode);
    assert.equal(result.contract.baseline_ref, before.baseline_ref);
    assert.equal(result.contract.activation_head, before.activation_head);
    assert.equal(result.contract.status, 'active');
    assert.equal(await readFile(getStateFilePath(fixture.root), 'utf8'), stateBefore);
    assert.equal(await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8'), baselineBefore);
  } finally {
    await cleanupFixture(fixture.root);
  }
});

test('runAmend records numeric and scope amendments atomically', async () => {
  const fixture = await createActiveContract();
  try {
    // Given an active contract
    const before = await readContract(fixture.root, fixture.contractId);

    // When numeric and scope changes are authorized together
    const result = await runAmend(fixture.root, [
      '--max-files', '4',
      '--allow-path', 'src/new.ts',
      '--reason', 'The implementation requires one additional file',
    ]);

    // Then both independent append-only ledgers describe the one resulting contract state
    assert.equal(result.contract.max_files, 4);
    assert.deepEqual(result.contract.allow_paths, [...before.allow_paths, '/src/new.ts']);
    assert.equal(result.contract.budget_amendments?.length, 1);
    assert.equal(result.contract.scope_amendments?.length, 1);
    assert.equal(result.contract.budget_amendments?.[0]?.amended_at, result.contract.updated_at);
    assert.equal(result.contract.scope_amendments?.[0]?.amended_at, result.contract.updated_at);
  } finally {
    await cleanupFixture(fixture.root);
  }
});

test('runAmend rejects unsafe, unauthorized, or redundant scope requests without writing', async (context) => {
  const cases: Array<{
    readonly name: string;
    readonly args: readonly string[];
    readonly setup?: (root: string, contractId: string) => Promise<void>;
  }> = [
    { name: 'missing reason', args: ['--allow-path', 'src/new.ts'] },
    { name: 'empty reason', args: ['--allow-path', 'src/new.ts', '--reason', '  '] },
    { name: 'empty path', args: ['--allow-path', '  ', '--reason', 'reason'] },
    { name: 'absolute path', args: ['--allow-path', '/src/new.ts', '--reason', 'reason'] },
    { name: 'drive path', args: ['--allow-path', 'C:\\src\\new.ts', '--reason', 'reason'] },
    { name: 'current component', args: ['--allow-path', 'src/./new.ts', '--reason', 'reason'] },
    { name: 'parent component', args: ['--allow-path', 'src/../new.ts', '--reason', 'reason'] },
    { name: 'glob', args: ['--allow-path', 'src/*.ts', '--reason', 'reason'] },
    { name: 'request duplicate after canonicalization', args: ['--allow-path', 'src\\new.ts,src//new.ts', '--reason', 'reason'] },
    { name: 'already covered by existing allow pattern', args: ['--allow-path', 'src/existing.ts', '--reason', 'reason'] },
    {
      name: 'empty existing allow paths permit all',
      args: ['--allow-path', 'src/new.ts', '--reason', 'reason'],
      setup: async (root, contractId) => {
        const path = getContractFilePath(root, contractId);
        const contract = await readContract(root, contractId);
        await writeFile(path, JSON.stringify({ ...contract, allow_paths: [] }), 'utf8');
      },
    },
    {
      name: 'changebudget descendant',
      args: ['--allow-path', '.changebudget/contracts/new.json', '--reason', 'reason'],
    },
    {
      name: 'deny match',
      args: ['--allow-path', 'src/blocked.ts', '--reason', 'reason'],
      setup: async (root, contractId) => {
        const path = getContractFilePath(root, contractId);
        const contract = await readContract(root, contractId);
        await writeFile(path, JSON.stringify({ ...contract, deny_paths: ['src/**'] }), 'utf8');
      },
    },
  ];

  for (const testCase of cases) {
    await context.test(testCase.name, async () => {
      const fixture = await createActiveContract();
      try {
        await testCase.setup?.(fixture.root, fixture.contractId);
        const path = getContractFilePath(fixture.root, fixture.contractId);
        const before = await readFile(path, 'utf8');

        await assert.rejects(
          () => runAmend(fixture.root, testCase.args),
          (error: unknown) => error instanceof InputValidationError,
        );

        assert.equal(await readFile(path, 'utf8'), before);
      } finally {
        await cleanupFixture(fixture.root);
      }
    });
  }
});

test('runAmend fails closed for malformed scope amendment history', async () => {
  const fixture = await createActiveContract();
  try {
    // Given an active contract with an invalid persisted scope history
    const path = getContractFilePath(fixture.root, fixture.contractId);
    const contract = await readContract(fixture.root, fixture.contractId);
    await writeFile(path, JSON.stringify({
      ...contract,
      allow_paths: [...contract.allow_paths, '/src/new.ts'],
      scope_amendments: [{
        sequence: 2,
        contract_id: fixture.contractId,
        amended_at: new Date().toISOString(),
        reason: 'Invalid sequence',
        changes: { allow_paths_added: ['/src/new.ts'] },
      }],
    }), 'utf8');

    // When another amendment is requested
    await assert.rejects(
      () => runAmend(fixture.root, ['--max-files', '3']),
      (error: unknown) => error instanceof StateCorruptionError,
    );
  } finally {
    await cleanupFixture(fixture.root);
  }
});

test('runAmend rejects persisted protected scope history even when final paths include it', async () => {
  const fixture = await createActiveContract();
  try {
    // Given persisted scope history that records a protected root-anchored literal
    const path = getContractFilePath(fixture.root, fixture.contractId);
    const contract = await readContract(fixture.root, fixture.contractId);
    await writeFile(path, JSON.stringify({
      ...contract,
      allow_paths: [...contract.allow_paths, '/.changebudget/contracts/new.json'],
      scope_amendments: [{
        sequence: 1,
        contract_id: fixture.contractId,
        amended_at: new Date().toISOString(),
        reason: 'Corrupt protected scope history',
        changes: { allow_paths_added: ['/.changebudget/contracts/new.json'] },
      }],
    }), 'utf8');

    // When a numeric amendment loads the active contract
    // Then malformed persisted history fails closed
    await assert.rejects(
      () => runAmend(fixture.root, ['--max-files', '3']),
      (error: unknown) => error instanceof StateCorruptionError,
    );
  } finally {
    await cleanupFixture(fixture.root);
  }
});

test('runAmend keeps every persisted artifact unchanged when a mixed amendment has a denied path', async () => {
  const fixture = await createActiveContract();
  try {
    // Given a numeric amendment combined with a path denied by the active contract
    const contractPath = getContractFilePath(fixture.root, fixture.contractId);
    const contract = await readContract(fixture.root, fixture.contractId);
    await writeFile(contractPath, JSON.stringify({ ...contract, deny_paths: ['src/denied.ts'] }), 'utf8');
    const contractBefore = await readFile(contractPath, 'utf8');
    const stateBefore = await readFile(getStateFilePath(fixture.root), 'utf8');
    const baselineBefore = await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8');

    // When one requested change is valid and the requested path is denied
    await assert.rejects(
      () => runAmend(fixture.root, [
        '--max-files', '4',
        '--allow-path', 'src/denied.ts',
        '--reason', 'Expand scope for a denied target',
      ]),
      (error: unknown) => error instanceof InputValidationError,
    );

    // Then no contract value, audit ledger, lifecycle state, or baseline evidence changed
    assert.equal(await readFile(contractPath, 'utf8'), contractBefore);
    assert.equal(await readFile(getStateFilePath(fixture.root), 'utf8'), stateBefore);
    assert.equal(await readFile(getBaselineEvidencePath(fixture.root, fixture.contractId), 'utf8'), baselineBefore);
    const after = await readContract(fixture.root, fixture.contractId);
    assert.equal(after.max_files, 2);
    assert.deepEqual(after.allow_paths, ['src/existing.ts']);
    assert.deepEqual(after.budget_amendments, []);
    assert.deepEqual(after.scope_amendments, []);
  } finally {
    await cleanupFixture(fixture.root);
  }
});

test('Runtime Guard reloads the active contract after a scope amendment', async () => {
  const fixture = await createActiveContract();
  try {
    // Given the Runtime Guard has observed the current active contract
    const before = await runtimeEvaluatorModule.evaluateRuntimeDecision(fixture.root);

    // When a developer-authorized literal path is appended
    await runAmend(fixture.root, [
      '--allow-path', 'src/reloaded.ts',
      '--reason', 'Authorize the exact Runtime Guard target',
    ]);
    const after = await runtimeEvaluatorModule.evaluateRuntimeDecision(fixture.root);

    // Then the next Runtime Guard evaluation uses the persisted amended scope
    assert.equal(before.contract?.allow_paths.includes('/src/reloaded.ts'), false);
    assert.equal(after.contract?.allow_paths.includes('/src/reloaded.ts'), true);
    assert.equal(after.contractId, fixture.contractId);
  } finally {
    await cleanupFixture(fixture.root);
  }
});
