import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { getChangeBudgetDirectory } from '../../../src/core/state/state.js';
import { removeTestRepository } from '../../utils/disposable-repository.js';

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const CLI_PATH = resolve(process.cwd(), 'dist', 'src', 'cli', 'index.js');

function approvedTempBase(): string {
  return process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : tmpdir();
}

function isolatedEnvironment(stateHome: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  if (process.platform === 'win32') environment.LOCALAPPDATA = stateHome;
  else environment.XDG_STATE_HOME = stateHome;
  return environment;
}

function runCli(root: string, stateHome: string, args: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: root,
    env: isolatedEnvironment(stateHome),
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runGit(root: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function draft(subject_label = 'CLI descriptive selection'): Record<string, unknown> {
  return {
    subject_label,
    operations: ['file.write'],
    capabilities: ['source.edit'],
    path_scope: ['/src/**'],
    ceilings: { max_files: 18, max_changed_lines: 240 },
    permissions: {
      allow_new_files: false,
      allow_dependencies: false,
      allow_migrations: false,
      allow_configuration: false,
      allow_public_api: false,
    },
    mode: 'REUSABLE',
    valid_from: new Date(Date.now() - 60_000).toISOString(),
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  };
}

async function repositoryFixture(prefix: string): Promise<{ root: string; stateHome: string }> {
  const root = await mkdtemp(join(approvedTempBase(), prefix));
  const stateHome = join(root, 'isolated-user-state');
  runGit(root, ['init', '--quiet']);
  runGit(root, ['config', 'user.name', 'authority CLI fixture']);
  runGit(root, ['config', 'user.email', 'authority-cli@test.invalid']);
  runGit(root, ['commit', '--allow-empty', '--quiet', '-m', 'seed']);
  const initialized = runCli(root, stateHome, ['init']);
  assert.equal(initialized.status, 0, initialized.stderr);
  return { root, stateHome };
}

function jsonOutput(result: CliResult): any {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return JSON.parse(result.stdout);
}

test('T016: compiled CLI creates, lists, inspects, and revokes with exact digest and no human-authentication claim', async () => {
  const fixture = await repositoryFixture('cb-authority-cli-flow-');
  try {
    const created = jsonOutput(runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'create', '--request-json', JSON.stringify(draft()),
    ]));
    assert.equal(created.status, 'SUCCESS');
    assert.equal(created.grant.lifecycle, 'ACTIVE');
    assert.equal(created.grant.ceilings.max_files, 18);
    assert.equal(created.grant.subject_label, 'CLI descriptive selection');
    assert.notEqual(created.grant.subject_id, created.grant.subject_label);
    assert.match(created.trust_boundary, /trust premise.*not proof of human identity/i);

    const listed = jsonOutput(runCli(fixture.root, fixture.stateHome, ['authority', 'grant', 'list']));
    assert.equal(listed.grants.length, 1);
    assert.equal(listed.grants[0].grant_id, created.grant.grant_id);

    const inspected = jsonOutput(runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'inspect', '--grant-id', created.grant.grant_id,
    ]));
    assert.equal(inspected.grant.grant_digest, created.grant.grant_digest);
    assert.equal(inspected.grant.work_id, created.grant.work_id);
    assert.equal(inspected.grant.subject_id, created.grant.subject_id);

    const stale = runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'revoke', '--grant-id', created.grant.grant_id, '--expected-digest', '0'.repeat(64),
    ]);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /digest|stale/i);

    const revoked = jsonOutput(runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'revoke', '--grant-id', created.grant.grant_id,
      '--expected-digest', created.grant.grant_digest,
    ]));
    assert.equal(revoked.grant.lifecycle, 'REVOKED');
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('T012/T016: CLI rejects caller-minted identities, duplicate/unknown fields, malformed refs, and reserved rebind', async () => {
  const fixture = await repositoryFixture('cb-authority-cli-strict-');
  try {
    const malicious = { ...draft(), work_id: 'caller-minted' };
    const minted = runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'create', '--request-json', JSON.stringify(malicious),
    ]);
    assert.notEqual(minted.status, 0);
    assert.match(minted.stderr, /unknown|field|identity/i);

    const duplicated = runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'create', '--request-json', '{"mode":"REUSABLE","mode":"ONE_SHOT"}',
    ]);
    assert.notEqual(duplicated.status, 0);
    assert.match(duplicated.stderr, /duplicate|JSON|invalid/i);

    const unknown = runCli(fixture.root, fixture.stateHome, ['authority', 'grant', 'list', '--actor', 'not-authentication']);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /unsupported|unexpected|option/i);

    const rebind = runCli(fixture.root, fixture.stateHome, ['authority', 'rebind']);
    assert.notEqual(rebind.status, 0);
    assert.match(rebind.stderr, /reserved|not implemented|blocked/i);

    const referencePath = join(getChangeBudgetDirectory(fixture.root), 'authority-reference.json');
    const absentList = runCli(fixture.root, fixture.stateHome, ['authority', 'grant', 'list']);
    assert.notEqual(absentList.status, 0);
    await assert.rejects(readFile(referencePath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');

    await writeFile(referencePath, '{broken\n', 'utf8');
    const malformedBytes = await readFile(referencePath);
    const malformedList = runCli(fixture.root, fixture.stateHome, ['authority', 'grant', 'list']);
    assert.notEqual(malformedList.status, 0);
    assert.match(malformedList.stderr, /reference|malformed|JSON/i);
    assert.deepEqual(await readFile(referencePath), malformedBytes);

    const cannotOverwrite = runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'create', '--request-json', JSON.stringify(draft()),
    ]);
    assert.notEqual(cannotOverwrite.status, 0);
    assert.deepEqual(await readFile(referencePath), malformedBytes, 'create never silently repairs a present malformed locator');
  } finally {
    await removeTestRepository(fixture.root);
  }
});

test('T016: compiled CLI rejects past/equality-boundary expiry before first writes and preserves existing authority state', async () => {
  const fixture = await repositoryFixture('cb-authority-cli-expired-');
  try {
    const referencePath = join(getChangeBudgetDirectory(fixture.root), 'authority-reference.json');
    const registryPath = join(fixture.stateHome, 'ChangeBudget-Authority', 'registry-v1.json');
    const draftWithExpiry = (expiresAt: string): Record<string, unknown> => ({
      ...draft(),
      valid_from: new Date(Date.now() - 60_000).toISOString(),
      expires_at: expiresAt,
    });

    const firstExpired = runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'create', '--request-json', JSON.stringify(draftWithExpiry(new Date(Date.now() - 1_000).toISOString())),
    ]);
    assert.notEqual(firstExpired.status, 0);
    assert.match(firstExpired.stderr, /expired/i);
    await assert.rejects(readFile(referencePath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
    await assert.rejects(readFile(registryPath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');

    const firstEqualExpiry = runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'create', '--request-json', JSON.stringify(draftWithExpiry(new Date().toISOString())),
    ]);
    assert.notEqual(firstEqualExpiry.status, 0);
    assert.match(firstEqualExpiry.stderr, /expired/i);
    await assert.rejects(readFile(referencePath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');
    await assert.rejects(readFile(registryPath), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT');

    const created = jsonOutput(runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'create', '--request-json', JSON.stringify(draft()),
    ]));
    const beforeRegistry = await readFile(registryPath);
    const beforeReference = await readFile(referencePath);
    const existingExpired = runCli(fixture.root, fixture.stateHome, [
      'authority', 'grant', 'create', '--request-json', JSON.stringify(draftWithExpiry(new Date().toISOString())),
    ]);
    assert.notEqual(existingExpired.status, 0);
    assert.match(existingExpired.stderr, /expired/i);
    assert.deepEqual(await readFile(registryPath), beforeRegistry);
    assert.deepEqual(await readFile(referencePath), beforeReference);

    const snapshot = JSON.parse(beforeRegistry.toString('utf8')) as {
      readonly revision: number;
      readonly grants: readonly { readonly grant_id: string }[];
      readonly audit: readonly { readonly event_type: string }[];
    };
    assert.equal(snapshot.revision, 1);
    assert.deepEqual(snapshot.grants.map((grant) => grant.grant_id), [created.grant.grant_id]);
    assert.deepEqual(snapshot.audit.map((event) => event.event_type), ['GRANT_CREATED']);
  } finally {
    await removeTestRepository(fixture.root);
  }
});
