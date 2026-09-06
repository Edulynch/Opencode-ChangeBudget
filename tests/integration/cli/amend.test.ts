import * as assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

import { getContractFilePath } from '../../../src/core/state/state.js';

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const CLI_PATH = resolve(process.cwd(), 'dist', 'src', 'cli', 'index.js');

function runCli(root: string, args: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], { cwd: root, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function runGit(root: string, args: readonly string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function activeContractId(stdout: string): string {
  const match = /^Active contract: (contract-[\w-]+)$/m.exec(stdout);
  assert.ok(match);
  const identifier = match[1];
  assert.ok(identifier);
  return identifier;
}

test('amend CLI persists an audited numeric budget and changes the next check result', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-amend-cli-'));
  try {
    // Given a contract whose one-file budget is exceeded by a real working-tree change
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'amend cli']);
    runGit(root, ['config', 'user.email', 'amend-cli@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);
    assert.equal(runCli(root, ['init']).status, 0);
    assert.equal(runCli(root, ['start', '--task', 'CLI amendment', '--base-revision', 'HEAD', '--max-files', '1']).status, 0);
    await writeFile(join(root, 'first.txt'), 'one\n');
    await writeFile(join(root, 'second.txt'), 'two\n');
    assert.equal(runCli(root, ['check']).status, 1);

    // When the active numeric file budget is explicitly amended through the compiled CLI
    const amended = runCli(root, ['amend', '--max-files', '2', '--reason', 'Two focused files']);

    // Then the persisted audit is visible to the next evaluation without changing state or baseline files
    assert.equal(amended.status, 0, amended.stderr);
    assert.match(amended.stdout, /Contract budget amended/);
    const contractId = activeContractId(runCli(root, ['status']).stdout);
    const stored = JSON.parse(await readFile(getContractFilePath(root, contractId), 'utf8'));
    assert.equal(stored.max_files, 2);
    assert.deepEqual(stored.budget_amendments, [{
      sequence: 1,
      contract_id: contractId,
      amended_at: stored.updated_at,
      reason: 'Two focused files',
      changes: { max_files: { before: 1, after: 2 } },
    }]);
    assert.equal(runCli(root, ['check']).status, 0);

    // When persisted audit history becomes malformed after a successful amendment
    await writeFile(
      getContractFilePath(root, contractId),
      JSON.stringify({ ...stored, budget_amendments: [{ sequence: 2 }] }),
      'utf8',
    );

    // Then CLI enforcement fails closed instead of reporting PASS
    const corruptedCheck = runCli(root, ['check']);
    assert.equal(corruptedCheck.status, 4);
    assert.match(corruptedCheck.stderr, /StateCorruptionError/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
