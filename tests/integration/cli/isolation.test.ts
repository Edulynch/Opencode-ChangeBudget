import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runUpdate } from '../../../src/cli/commands/update.js';
import type { ManagedIntegrationDiscovery } from '../../../src/core/integration/opencode-discovery.js';
import type { NpmUpdateResult } from '../../../src/core/update/npm.js';

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function snapshot(root: string, current = ''): Promise<string[]> {
  const directory = join(root, current);
  const entries = await readdir(directory, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    const relative = join(current, entry.name);
    if (entry.isDirectory()) result.push(...await snapshot(root, relative));
    else result.push(`${relative}\0${await readFile(join(root, relative), 'base64')}`);
  }
  return result;
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-v2-isolation-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), 'user-owned\n');
  await writeFile(join(root, 'opencode.json'), '{"permissions":[]}\n');
  await writeFile(join(root, 'src', 'app.ts'), 'export {}\n');
  git(root, ['init']);
  git(root, ['config', 'user.name', 'isolation test']);
  git(root, ['config', 'user.email', 'isolation@test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'seed']);
  return root;
}

const success: NpmUpdateResult = {
  success: true,
  exitCode: 0,
  stderr: '',
  stdout: '',
  errorMessage: null,
  interrupted: false,
  signal: null,
  entry: '/global/node_modules/changebudget/dist/src/cli/index.js',
};

test('update preserves project bytes when the V2 integration is absent, current, or conflicted', async () => {
  const scenarios = [
    { label: 'absent', discovery: { state: 'ABSENT' as const } },
    { label: 'current', discovery: { state: 'MANAGED_CURRENT' as const } },
    { label: 'conflict', discovery: { state: 'CONFLICT' as const } },
  ] satisfies readonly { label: string; discovery: ManagedIntegrationDiscovery }[];

  for (const scenario of scenarios) {
    const root = await project();
    try {
      const before = await snapshot(root);
      let refreshCalls = 0;
      const errors: string[] = [];
      const dependencies = {
        getInstalledVersion: () => '1.1.0',
        discoverVersions: async () => [{ major: 1, minor: 2, patch: 0, tag: 'v1.2.0' }],
        runSelfUpdate: async () => success,
        getProjectRoot: () => root,
        getChangeBudgetRoot: () => root,
        discoverManagedIntegration: async () => scenario.discovery,
        executeUpdatedCli: async () => {
          refreshCalls += 1;
          return { kind: 'success' as const, stdout: '', stderr: '' };
        },
        writeOut: () => undefined,
        writeErr: (message: string) => errors.push(message),
      };
      assert.equal(await runUpdate(dependencies), 0, scenario.label);
      assert.equal(refreshCalls, 0, scenario.label);
      assert.deepEqual(await snapshot(root), before, scenario.label);
      if (scenario.label === 'conflict') assert.match(errors.join(''), /conflict requires attention/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('update refreshes the native V2 integration only in the stale state', async () => {
  const root = await project();
  try {
    let refreshCalls = 0;
    const dependencies = {
      getInstalledVersion: () => '1.1.0',
      discoverVersions: async () => [{ major: 1, minor: 2, patch: 0, tag: 'v1.2.0' }],
      runSelfUpdate: async () => success,
      getProjectRoot: () => root,
      getChangeBudgetRoot: () => root,
      discoverManagedIntegration: async () => ({ state: 'MANAGED_STALE' as const }),
      executeUpdatedCli: async () => {
        refreshCalls += 1;
        return { kind: 'success' as const, stdout: '', stderr: '' };
      },
      writeOut: () => undefined,
      writeErr: () => undefined,
    };
    assert.equal(await runUpdate(dependencies), 0);
    assert.equal(refreshCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
