import * as assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runUpdate, runUpdateCheck } from '../../../src/cli/commands/update.js';
import type { NpmUpdateResult } from '../../../src/core/update/npm.js';
import {
  MANAGED_RESOURCES,
  WRAPPER_MARKER,
  generateWrapperContent,
  installIntegration,
  resolveChangeBudgetRoot,
  runtimeGuardFileUrl,
} from '../../../src/core/integration/opencode.js';

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-v2-refresh-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'AGENTS.md'), 'user-owned\n');
  await writeFile(join(root, 'opencode.json'), '{"theme":"dark"}\n');
  await writeFile(join(root, 'src', 'app.ts'), 'export {}\n');
  git(root, ['init']);
  git(root, ['config', 'user.name', 'refresh test']);
  git(root, ['config', 'user.email', 'refresh@test']);
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

test('update refreshes only a stale native V2 wrapper', async () => {
  const root = await project();
  const changeBudgetRoot = resolveChangeBudgetRoot();
  try {
    await installIntegration(root, changeBudgetRoot);
    await writeFile(
      join(root, MANAGED_RESOURCES.pluginWrapper),
      `${WRAPPER_MARKER}\nexport { default } from "file:///old/runtime.js";\n`,
      'utf8',
    );
    const requests: unknown[] = [];
    const dependencies = {
      getInstalledVersion: () => '1.1.0',
      discoverVersions: async () => [{ major: 1, minor: 2, patch: 0, tag: 'v1.2.0' }],
      runSelfUpdate: async () => success,
      getProjectRoot: () => root,
      getChangeBudgetRoot: () => changeBudgetRoot,
      discoverManagedIntegration: async () => ({ state: 'MANAGED_STALE' as const }),
      executeUpdatedCli: async (request: unknown) => {
        requests.push(request);
        await installIntegration(root, changeBudgetRoot);
        return { kind: 'success' as const, stdout: '', stderr: '' };
      },
      writeOut: () => undefined,
      writeErr: () => undefined,
    };

    assert.equal(await runUpdateCheck(dependencies), 0);
    assert.equal(await runUpdate(dependencies), 0);
    assert.equal(requests.length, 1);
    assert.equal(
      await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'),
      generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
    );
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'user-owned\n');
    assert.equal(await readFile(join(root, 'opencode.json'), 'utf8'), '{"theme":"dark"}\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('update check never discovers or writes the project integration', async () => {
  const root = await project();
  try {
    let discovered = false;
    const dependencies = {
      getInstalledVersion: () => '1.1.0',
      discoverVersions: async () => [{ major: 1, minor: 2, patch: 0, tag: 'v1.2.0' }],
      runSelfUpdate: async () => success,
      getProjectRoot: () => root,
      getChangeBudgetRoot: () => resolveChangeBudgetRoot(),
      discoverManagedIntegration: async () => {
        discovered = true;
        return { state: 'MANAGED_CURRENT' as const };
      },
      executeUpdatedCli: async () => ({ kind: 'success' as const, stdout: '', stderr: '' }),
      writeOut: () => undefined,
      writeErr: () => undefined,
    };
    assert.equal(await runUpdateCheck(dependencies), 0);
    assert.equal(discovered, false);
    await access(join(root, 'opencode.json'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
