import * as assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { removeTestRepository } from '../utils/disposable-repository.js';

import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runCheck } from '../../src/cli/commands/check.js';
import {
  createLifecycleAuditRecord,
  getContractFilePath,
  getContractsDirectoryPath,
  getStateFilePath,
  pathExists,
  persistLifecycleAudit,
  readJsonFileOptional,
  readLifecycleState,
  recoverPendingLifecycleAudits,
  setLifecycleAuditTestHooks,
  writeLifecycleState,
} from '../../src/core/state/state.js';
import { StateCorruptionError, InputValidationError, IOStateError, StateConflictError } from '../../src/models/errors.js';

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
  return mkdtemp(join(tmpdir(), 'cb-validation-')).then(async (root) => {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'validation test']);
    runGit(root, ['config', 'user.email', 'validation@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    return root;
  });
}

test('runStart reports deterministic input validation when required fields are empty', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    await assert.rejects(
      () => runStart(root, ['--task', '', '--base-revision', '']),
      (error: unknown) => {
        assert.equal(error instanceof InputValidationError, true);
        if (error instanceof InputValidationError) {
          assert.equal(error.message.includes('Contract input validation failed'), true);
          assert.equal(error.message.includes('task_description'), true);
          assert.equal(error.message.includes('base_revision'), true);
        }
        return true;
      },
    );
  } finally {
    await removeTestRepository(root);
  }
});

test('runCheck keeps malformed draft contract input as a fatal command error per SPEC-003 FR-004/FR-014', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    const draftPath = join(root, 'bad-check-contract.json');
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
        allow_new_files: true,
        allow_new_dependencies: false,
        allow_migrations: false,
        allow_config_changes: true,
        allow_public_api_changes: false,
        max_changed_lines: 0,
        status: 'draft',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        closed_at: null,
      }),
    );

    await assert.rejects(
      () => runCheck(root, ['--draft', draftPath]),
      (error: unknown) => error instanceof InputValidationError
        && error.message.includes('Contract validation failed'),
    );
  } finally {
    await removeTestRepository(root);
  }
});

test('invalid lifecycle file is treated as corruption', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);

    const statePath = getStateFilePath(root);
    await writeFile(statePath, '{"schema_version":"1.0.0"}', { encoding: 'utf8' });

    const loaded = readFileSync(statePath, 'utf8');
    assert.equal(loaded.includes('schema_version'), true);

    await assert.rejects(
      () => runCheck(root),
      (error: unknown) => {
        assert.equal(error instanceof StateCorruptionError, true);
        if (error instanceof StateCorruptionError) {
          assert.equal(error.message.includes('invalid structure'), true);
        }
        return true;
      },
    );
  } finally {
    await removeTestRepository(root);
  }
});

test('readJsonFileOptional distinguishes missing, corrupt, and other IO errors deterministically', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const changeBudgetDir = join(root, '.changebudget');
    await mkdir(changeBudgetDir, { recursive: true });

    const missingPath = join(changeBudgetDir, 'state.json');
    const missing = await readJsonFileOptional(missingPath);
    assert.equal(missing, null);

    await writeFile(missingPath, '{"schema_version":', 'utf8');
    await assert.rejects(
      () => readJsonFileOptional(missingPath),
      (error: unknown) => {
        assert.equal(error instanceof StateCorruptionError, true);
        return true;
      },
    );

    const directoryPath = join(changeBudgetDir, 'contracts');
    await mkdir(directoryPath, { recursive: true });
    await assert.rejects(
      () => readJsonFileOptional(directoryPath),
      (error: unknown) => {
        assert.equal(error instanceof IOStateError, true);
        if (error instanceof IOStateError) {
          assert.notEqual(error.context.code, 'ENOENT');
        }
        return true;
      },
    );
  } finally {
    await removeTestRepository(root);
  }
});

test('optional lifecycle audit history round-trips deterministically and remains backward-readable', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    const statePath = getStateFilePath(root);
    const state = await readLifecycleState(root);
    assert.notEqual(state, null);
    assert.equal(state?.audit_history?.length, 1);
    assert.equal(state?.audit_history?.[0]?.operation, 'init');
    assert.deepEqual(state?.audit_history?.[0]?.outcome, {
      status: 'committed',
      confirmation: 'operation_write_returned',
    });

    const serialized = readFileSync(statePath, 'utf8');
    await writeLifecycleState(root, state!);
    assert.equal(readFileSync(statePath, 'utf8'), serialized);

    const { audit_history: _auditHistory, ...historicalState } = state!;
    await writeFile(statePath, JSON.stringify(historicalState), 'utf8');
    const historical = await readLifecycleState(root);
    assert.equal(historical?.lifecycle_state, 'initialized');
    assert.equal(historical?.audit_history, undefined);
  } finally {
    await removeTestRepository(root);
  }
});

test('malformed optional lifecycle audit evidence is rejected as state corruption', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    const statePath = getStateFilePath(root);
    const state = await readLifecycleState(root);
    await writeFile(statePath, JSON.stringify({ ...state, audit_history: [{ event_id: 'partial' }] }), 'utf8');

    await assert.rejects(
      () => readLifecycleState(root),
      (error: unknown) => error instanceof StateCorruptionError
        && error.message.includes('invalid structure'),
    );
  } finally {
    await removeTestRepository(root);
  }
});

test('lifecycle audit append fails closed on lock contention without losing history', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    const statePath = getStateFilePath(root);
    const stateBefore = readFileSync(statePath, 'utf8');
    const record = createLifecycleAuditRecord({
      operation: 'amend',
      repositoryRoot: root,
      lifecycleBefore: 'initialized',
      lifecycleAfter: 'initialized',
    });
    const lockPath = `${statePath}.lock`;
    await writeFile(lockPath, 'test-held lifecycle state lock', 'utf8');
    await assert.rejects(
      () => persistLifecycleAudit(root, record),
      (error: unknown) => error instanceof StateConflictError
        && error.message.includes('recovery is required'),
    );
    assert.equal(readFileSync(statePath, 'utf8'), stateBefore);

    await rm(lockPath, { force: true });
    const stateAfter = await readLifecycleState(root);
    assert.deepEqual(stateAfter?.audit_history?.map((entry) => [entry.operation, entry.outcome.status]), [
      ['init', 'committed'],
    ]);
  } finally {
    await removeTestRepository(root);
  }
});

test('audit-write failure is a barrier before INIT and START lifecycle artifacts', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const restoreInitHook = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'init') {
          throw new Error('injected INIT audit failure');
        }
      },
    });
    try {
      await assert.rejects(() => runInit(root), /injected INIT audit failure/);
    } finally {
      restoreInitHook();
    }
    assert.equal(await readLifecycleState(root), null);
    assert.equal(await pathExists(getStateFilePath(root)), false);
    assert.deepEqual(await readdir(getContractsDirectoryPath(root)), []);
    assert.equal(await pathExists(join(root, '.changebudget', 'baselines')), false);

    await runInit(root);
    const stateBeforeStart = readFileSync(getStateFilePath(root), 'utf8');
    const restoreStartHook = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'start') {
          throw new Error('injected START audit failure');
        }
      },
    });
    try {
      await assert.rejects(
        () => runStart(root, ['--task', 'audit failure', '--base-revision', 'HEAD']),
        /injected START audit failure/,
      );
    } finally {
      restoreStartHook();
    }
    assert.equal(readFileSync(getStateFilePath(root), 'utf8'), stateBeforeStart);
    assert.deepEqual(await readdir(getContractsDirectoryPath(root)), []);
    assert.equal(await pathExists(join(root, '.changebudget', 'baselines')), false);
  } finally {
    await removeTestRepository(root);
  }
});

test('INIT completion-write failure is uncertain and replay reconciles the persisted initialization', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const restore = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'init' && record.outcome.status === 'committed') {
          throw new Error('injected INIT completion audit failure');
        }
      },
    });
    try {
      await assert.rejects(() => runInit(root), /injected INIT completion audit failure/);
    } finally {
      restore();
    }

    const pendingState = await readLifecycleState(root);
    assert.equal(pendingState?.lifecycle_state, 'initialized');
    assert.deepEqual(pendingState?.audit_history?.[0]?.outcome, {
      status: 'pending',
      confirmation: 'operation_outcome_uncertain',
    });

    const replay = await runInit(root);
    assert.equal(replay.changed, false);
    assert.deepEqual(replay.state.audit_history?.map((record) => [record.operation, record.outcome.status]), [
      ['init', 'reconciled'],
    ]);
  } finally {
    await removeTestRepository(root);
  }
});

test('START completion-write failure is uncertain and replay returns the verified active contract', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    const args = ['--task', 'start completion recovery', '--base-revision', 'HEAD', '--max-files', '2'];
    const restore = setLifecycleAuditTestHooks({
      beforeWrite: async (record) => {
        if (record.operation === 'start' && record.outcome.status === 'committed') {
          throw new Error('injected START completion audit failure');
        }
      },
    });
    try {
      await assert.rejects(() => runStart(root, args), /injected START completion audit failure/);
    } finally {
      restore();
    }

    const pendingState = await readLifecycleState(root);
    const contractId = pendingState?.active_contract_id;
    assert.equal(typeof contractId, 'string');
    assert.deepEqual(pendingState?.audit_history?.at(-1)?.outcome, {
      status: 'pending',
      confirmation: 'operation_outcome_uncertain',
    });

    const replay = await runStart(root, args);
    assert.equal(replay.contractId, contractId);
    assert.equal(replay.state.active_contract_id, contractId);
    assert.deepEqual(replay.state.audit_history?.map((record) => [record.operation, record.outcome.status]), [
      ['init', 'committed'],
      ['start', 'reconciled'],
    ]);
  } finally {
    await removeTestRepository(root);
  }
});

test('START recovery refuses an active pointer to a closed contract and preserves pending evidence', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    const started = await runStart(root, ['--task', 'contradictory start', '--base-revision', 'HEAD']);
    const statePath = getStateFilePath(root);
    const contractPath = getContractFilePath(root, started.contractId);
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
      audit_history: Array<{ operation: string; outcome: { status: string; confirmation: string } }>;
    };
    const startAudit = state.audit_history.find((entry) => entry.operation === 'start');
    assert.ok(startAudit);
    startAudit.outcome = { status: 'pending', confirmation: 'operation_outcome_uncertain' };
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as Record<string, unknown>;
    const closedContract = {
      ...contract,
      status: 'closed',
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await writeFile(statePath, JSON.stringify(state), 'utf8');
    await writeFile(contractPath, JSON.stringify(closedContract), 'utf8');
    const pendingStateBytes = readFileSync(statePath, 'utf8');
    const contradictoryContractBytes = readFileSync(contractPath, 'utf8');

    await assert.rejects(
      () => recoverPendingLifecycleAudits(root),
      (error: unknown) => error instanceof StateConflictError && error.message.includes('uncertain outcome'),
    );
    await assert.rejects(
      () => runStart(root, ['--task', 'must not adopt contradictory attempt', '--base-revision', 'HEAD']),
      (error: unknown) => error instanceof StateConflictError && error.message.includes('uncertain outcome'),
    );

    assert.equal(readFileSync(statePath, 'utf8'), pendingStateBytes);
    assert.equal(readFileSync(contractPath, 'utf8'), contradictoryContractBytes);
    assert.equal((await readLifecycleState(root))?.active_contract_id, started.contractId);
    assert.equal((await readLifecycleState(root))?.audit_history?.find((entry) => entry.operation === 'start')?.outcome.status, 'pending');
  } finally {
    await removeTestRepository(root);
  }
});

test('START recovery reconciles a progressed closed/closed postcondition only when both pointers agree', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await runInit(root);
    const started = await runStart(root, ['--task', 'progressed start', '--base-revision', 'HEAD']);
    const statePath = getStateFilePath(root);
    const contractPath = getContractFilePath(root, started.contractId);
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
      lifecycle_state: string;
      active_contract_id: string | null;
      last_closed_contract_id: string | null;
      audit_history: Array<{ operation: string; outcome: { status: string; confirmation: string } }>;
    };
    state.lifecycle_state = 'closed';
    state.active_contract_id = null;
    state.last_closed_contract_id = started.contractId;
    const startAudit = state.audit_history.find((entry) => entry.operation === 'start');
    assert.ok(startAudit);
    startAudit.outcome = { status: 'pending', confirmation: 'operation_outcome_uncertain' };
    const contract = JSON.parse(readFileSync(contractPath, 'utf8')) as Record<string, unknown>;
    await writeFile(statePath, JSON.stringify(state), 'utf8');
    await writeFile(contractPath, JSON.stringify({
      ...contract,
      status: 'closed',
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }), 'utf8');

    const recovered = await recoverPendingLifecycleAudits(root);
    assert.deepEqual(recovered.map((record) => [record.operation, record.outcome.status]), [['start', 'reconciled']]);
    const terminal = await readLifecycleState(root);
    assert.equal(terminal?.lifecycle_state, 'closed');
    assert.equal(terminal?.active_contract_id, null);
    assert.equal(terminal?.last_closed_contract_id, started.contractId);
    assert.equal(terminal?.audit_history?.find((entry) => entry.operation === 'start')?.outcome.status, 'reconciled');
  } finally {
    await removeTestRepository(root);
  }
});
