import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createTestFixtureDirectory, removeTestRepository } from '../utils/disposable-repository.js';
import { resolveActiveContract } from '../../src/core/state/contracts.js';
import { withLifecycleStateLock } from '../../src/core/state/state.js';
import { resolveWorkContextCandidate } from '../../src/core/authority/work-context.js';

function approvedTempBase(): string {
  if (process.env.SPEC015_TEST_TEMP_ROOT) return resolve(process.env.SPEC015_TEST_TEMP_ROOT);
  return process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : tmpdir();
}

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function createRepository(root: string): Promise<void> {
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'authority context fixture']);
  git(root, ['config', 'user.email', 'authority-context@test.invalid']);
  await writeFile(join(root, 'README.md'), 'seed\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'seed']);
}

function runCli(root: string, args: string[]): void {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), ...args],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

async function snapshot(directory: string): Promise<readonly (readonly [string, string])[]> {
  const entries: Array<readonly [string, string]> = [];
  async function visit(current: string, relative: string): Promise<void> {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        entries.push([name, 'directory']);
        await visit(path, name);
      } else if (entry.isFile()) {
        entries.push([name, (await readFile(path)).toString('base64')]);
      }
    }
  }
  await visit(directory, '');
  return entries;
}

test('T005: existing state-before-contract source yields coherent active work without persisting authority bindings', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-context-active-');
  try {
    await createRepository(root);
    runCli(root, ['init']);
    runCli(root, ['start', '--task', 'T005 active context fixture', '--base-revision', 'HEAD']);

    const changeBudgetDirectory = join(root, '.changebudget');
    const before = await snapshot(changeBudgetDirectory);
    await withLifecycleStateLock(root, async (transaction) => {
      const state = await transaction.readState();
      assert.ok(state, 'state must be read while holding the existing lifecycle-state lock');
      assert.equal(state.lifecycle_state, 'active');

      // Existing lock ordering is state first, followed by the contract read.
      const contract = await resolveActiveContract(root, state);
      assert.ok(contract, 'the active-contract pointer must resolve');
      assert.equal(contract.id, state.active_contract_id);
      assert.equal(contract.status, 'active');
      assert.equal(contract.task_id, null, 'task metadata is not a canonical work identity');

      // This is only a feasibility representation in the T005 test. G1 source
      // modules are not implemented here and no binding is stored.
      const candidateBinding = {
        work_id: randomUUID(),
        subject_id: randomUUID(),
        contract_id: contract.id,
        work_activation_id: randomUUID(),
        work_activation_epoch: 1,
        scope_digest: 'fixture-only-scope-digest',
      };
      assert.match(candidateBinding.work_id, /^[0-9a-f-]{36}$/i);
      assert.match(candidateBinding.subject_id, /^[0-9a-f-]{36}$/i);
      assert.notEqual(candidateBinding.work_id, contract.id);
      assert.notEqual(candidateBinding.subject_id, contract.task_id);
      assert.equal(candidateBinding.work_activation_epoch, 1,
        'activation is represented as freshness, not as an administrator credential');
    });
    assert.deepEqual(await snapshot(changeBudgetDirectory), before,
      'G0/G1 feasibility must not create or persist a second authority binding store');
  } finally {
    await removeTestRepository(root);
  }
});

test('T005: a pre-contract subject label remains descriptive and separate from generated opaque identifiers', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-context-label-');
  try {
    await createRepository(root);
    runCli(root, ['init']);
    const changeBudgetDirectory = join(root, '.changebudget');
    const before = await snapshot(changeBudgetDirectory);

    const subjectLabel = 'selected descriptive beneficiary';
    const candidateBinding = {
      work_id: randomUUID(),
      subject_id: randomUUID(),
      subject_label: subjectLabel,
    };
    assert.notEqual(candidateBinding.subject_label, candidateBinding.subject_id);
    assert.match(candidateBinding.work_id, /^[0-9a-f-]{36}$/i);
    assert.match(candidateBinding.subject_id, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(await snapshot(changeBudgetDirectory), before,
      'a selected label and candidate identifiers do not create a G0/G1 registry');
  } finally {
    await removeTestRepository(root);
  }
});

test('T007: active-contract context is coherent, generated, descriptive, and not persisted', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-g1-active-context-');
  try {
    await createRepository(root);
    runCli(root, ['init']);
    runCli(root, ['start', '--task', 'ordinary task text', '--base-revision', 'HEAD']);
    const changeBudgetDirectory = join(root, '.changebudget');
    const before = await snapshot(changeBudgetDirectory);
    const candidate = await resolveWorkContextCandidate(root, { subjectLabel: 'selected beneficiary' });

    assert.equal(candidate.source, 'active-contract');
    assert.equal(candidate.binding_status, 'candidate-not-persisted');
    assert.equal(candidate.contract?.id, candidate.work.contract_id);
    assert.equal(candidate.contract?.status, 'active');
    assert.equal(candidate.work.task_id, candidate.contract?.task_id);
    assert.notEqual(candidate.work.work_id, candidate.work.contract_id);
    assert.notEqual(candidate.work.work_id, candidate.work.task_id);
    assert.notEqual(candidate.subject.subject_id, candidate.subject.subject_label);
    assert.equal(candidate.subject.subject_label, 'selected beneficiary');
    assert.match(candidate.work.scope_digest, /^[a-f0-9]{64}$/);
    assert.match(candidate.work.contract_revision_digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(await snapshot(changeBudgetDirectory), before,
      'G1 resolution creates no canonical binding, temp registry, or lifecycle change');

    await writeFile(join(root, 'head-only.txt'), 'ordinary HEAD movement\n', 'utf8');
    git(root, ['add', 'head-only.txt']);
    git(root, ['commit', '--quiet', '-m', 'HEAD-only change']);
    const afterHead = await resolveWorkContextCandidate(root, { subjectLabel: 'selected beneficiary' });
    assert.equal(afterHead.work.scope_digest, candidate.work.scope_digest);
    assert.equal(afterHead.work.contract_revision_digest, candidate.work.contract_revision_digest);
  } finally {
    await removeTestRepository(root);
  }
});

test('T007: a pre-contract subject label is never a canonical ID and no binding is persisted', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-g1-precontract-');
  try {
    await createRepository(root);
    runCli(root, ['init']);
    const changeBudgetDirectory = join(root, '.changebudget');
    const before = await snapshot(changeBudgetDirectory);
    const callerLabel = randomUUID();
    const spoofedInput = {
      subjectLabel: callerLabel,
      work_id: callerLabel,
      subject_id: callerLabel,
      task_id: callerLabel,
      agent: 'untrusted prose',
      sessionID: 'host-session-metadata',
    };
    const candidate = await resolveWorkContextCandidate(root, spoofedInput);

    assert.equal(candidate.source, 'pre-contract');
    assert.equal(candidate.subject.subject_label, callerLabel);
    assert.notEqual(candidate.subject.subject_id, callerLabel);
    assert.equal(candidate.work.task_id, null, 'caller task/session/agent metadata cannot replace ChangeBudget context');
    assert.match(candidate.work.work_id, /^[0-9a-f-]{36}$/i);
    assert.match(candidate.work.authority_id, /^[0-9a-f-]{36}$/i);
    assert.match(candidate.subject.subject_id, /^[0-9a-f-]{36}$/i);
    assert.equal(candidate.binding_status, 'candidate-not-persisted');
    assert.deepEqual(await snapshot(changeBudgetDirectory), before);
    await assert.rejects(resolveWorkContextCandidate(root), /requires a directly selected descriptive subject label/i);
  } finally {
    await removeTestRepository(root);
  }
});

test('T007: linked worktrees share the physical repository candidate but retain distinct work/subject candidates', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-g1-linked-context-');
  const main = join(root, 'main');
  const linked = join(root, 'linked');
  try {
    await mkdir(main);
    await createRepository(main);
    git(main, ['worktree', 'add', '--quiet', '-b', 'authority-context-linked', linked]);
    runCli(main, ['init']);
    runCli(main, ['start', '--task', 'main work', '--base-revision', 'HEAD']);
    runCli(linked, ['init']);
    runCli(linked, ['start', '--task', 'linked work', '--base-revision', 'HEAD']);

    const mainCandidate = await resolveWorkContextCandidate(main, { subjectLabel: 'main beneficiary' });
    const linkedCandidate = await resolveWorkContextCandidate(linked, { subjectLabel: 'linked beneficiary' });
    assert.deepEqual(mainCandidate.repository.physical_identity, linkedCandidate.repository.physical_identity);
    assert.notEqual(mainCandidate.work.work_id, linkedCandidate.work.work_id);
    assert.notEqual(mainCandidate.subject.subject_id, linkedCandidate.subject.subject_id);
    assert.notEqual(mainCandidate.work.work_activation_id, linkedCandidate.work.work_activation_id);
    assert.equal(mainCandidate.binding_status, 'candidate-not-persisted');
    assert.equal(linkedCandidate.binding_status, 'candidate-not-persisted');
  } finally {
    await removeTestRepository(root);
  }
});
