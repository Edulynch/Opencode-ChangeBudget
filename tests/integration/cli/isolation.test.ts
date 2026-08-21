import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runUpdate, runUpdateCheck } from '../../../src/cli/commands/update.js';
import { NpmUpdateResult } from '../../../src/core/update/npm.js';

const success: NpmUpdateResult = {
  success: true,
  exitCode: 0,
  stderr: '',
  stdout: '',
  errorMessage: null,
  interrupted: false,
  signal: null,
};

async function snapshot(root: string, current = ''): Promise<string[]> {
  const directory = join(root, current);
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const relative = join(current, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await snapshot(root, relative)));
    } else {
      result.push(`${relative}\0${await readFile(join(root, relative), 'base64')}`);
    }
  }
  return result;
}

function git(root: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'changebudget-isolation-'));
  await mkdir(join(root, '.changebudget'), { recursive: true });
  await mkdir(join(root, '.opencode', 'instructions'), { recursive: true });
  await mkdir(join(root, 'specs', 'demo'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, '.changebudget', 'state.json'), '{"state":"initialized"}\n');
  await writeFile(join(root, '.opencode', 'instructions', 'user.md'), 'user instructions\n');
  await writeFile(join(root, 'opencode.json'), '{"instructions":[]}\n');
  await writeFile(join(root, 'AGENTS.md'), 'user-owned\n');
  await writeFile(join(root, 'specs', 'demo', 'spec.md'), 'project spec\n');
  await writeFile(join(root, 'src', 'app.ts'), 'export {}\n');
  git(root, ['init']);
  git(root, ['config', 'user.name', 'isolation test']);
  git(root, ['config', 'user.email', 'isolation@example.test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'seed']);
  return root;
}

test('T032: update check and update preserve project bytes and Git state', async () => {
  const root = await project();
  const output: string[] = [];
  let npmCalls = 0;
  try {
    const beforeFiles = await snapshot(root);
    const beforeHead = git(root, ['rev-parse', 'HEAD']);
    const beforeStatus = git(root, ['status', '--porcelain']);
    const deps = {
      getInstalledVersion: () => '1.2.0',
      fetchTags: async () => ['v1.3.0'],
      validateTagIntegrity: async () => true,
      runSelfUpdate: async () => {
        npmCalls += 1;
        return success;
      },
      writeOut: (message: string) => output.push(message),
      writeErr: (message: string) => output.push(message),
    };

    assert.equal(await runUpdateCheck(deps), 0);
    assert.deepEqual(await snapshot(root), beforeFiles);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['status', '--porcelain']), beforeStatus);

    assert.equal(await runUpdate(deps), 0);
    assert.equal(npmCalls, 1);
    assert.deepEqual(await snapshot(root), beforeFiles);
    assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead);
    assert.equal(git(root, ['status', '--porcelain']), beforeStatus);
    assert.ok(output.some((line) => line.includes('updated to')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
