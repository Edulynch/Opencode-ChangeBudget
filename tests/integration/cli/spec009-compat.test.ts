import * as assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runUpdate, runUpdateCheck } from '../../../src/cli/commands/update.js';
import { NpmUpdateResult } from '../../../src/core/update/npm.js';
import {
  INSTRUCTION_ENTRY,
  MANAGED_RESOURCES,
  WRAPPER_MARKER,
  generateWrapperContent,
  installIntegration,
  resolveChangeBudgetRoot,
  resolveRuntimeGuardEntry,
  runtimeGuardFileUrl,
} from '../../../src/core/integration/opencode.js';

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function projectSnapshot(root: string): Promise<string> {
  const paths = [
    'AGENTS.md',
    'opencode.json',
    MANAGED_RESOURCES.pluginWrapper,
    MANAGED_RESOURCES.instructions,
    'src/project.ts',
    'specs/011-project/tasks.md',
    '.changebudget/state.json',
  ];
  const files = await Promise.all(paths.map(async (path) => {
    try {
      return [path, await readFile(join(root, path), 'utf8')] as const;
    } catch {
      return [path, null] as const;
    }
  }));
  return JSON.stringify({
    files,
    git: spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout,
  });
}

const success: NpmUpdateResult = {
  success: true,
  exitCode: 0,
  stderr: '',
  stdout: '',
  errorMessage: null,
  interrupted: false,
  signal: null,
};

test('T033: explicit integration resolves Runtime Guard and refreshes only on explicit request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'changebudget-spec009-'));
  const changeBudgetRoot = resolveChangeBudgetRoot();
  try {
    git(root, ['init']);
    git(root, ['config', 'user.name', 'spec009 test']);
    git(root, ['config', 'user.email', 'spec009@example.test']);
    git(root, ['commit', '--allow-empty', '-m', 'seed']);
    await writeFile(join(root, 'AGENTS.md'), 'must remain unchanged\n');

    const installed = await installIntegration(root, changeBudgetRoot);
    assert.equal(installed.runtimeGuardTargetExists, true);
    await access(resolveRuntimeGuardEntry(changeBudgetRoot));
    assert.equal(
      await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'),
      generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
    );
    assert.equal(
      JSON.parse(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8')).instructions[0],
      INSTRUCTION_ENTRY,
    );

    const beforeAgents = await readFile(join(root, 'AGENTS.md'), 'utf8');
    const beforeConfig = await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, 'specs', '011-project'), { recursive: true });
    await writeFile(join(root, 'src', 'project.ts'), 'export const project = true;\n');
    await writeFile(join(root, 'specs', '011-project', 'tasks.md'), '- [ ] project-owned task\n');
    await writeFile(
      join(root, MANAGED_RESOURCES.pluginWrapper),
      `${WRAPPER_MARKER}\nexport { default } from "file:///stale-runtime.js";\n`,
    );
    const stale = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const beforeUpdate = await projectSnapshot(root);

    const updateDependencies = {
      getInstalledVersion: () => '1.1.0',
      fetchTags: async () => ['v1.2.0'],
      validateTagIntegrity: async () => true,
      runSelfUpdate: async () => success,
      writeOut: () => undefined,
      writeErr: () => undefined,
    };
    assert.equal(await runUpdateCheck(updateDependencies), 0);
    const updateResult = await runUpdate(updateDependencies);
    assert.equal(updateResult, 0);
    assert.equal(await projectSnapshot(root), beforeUpdate);
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), stale);
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), beforeAgents);
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'), beforeConfig);

    const refreshed = await installIntegration(root, changeBudgetRoot);
    assert.equal(refreshed.resources.pluginWrapper.action, 'UPDATE');
    assert.equal(
      await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'),
      generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
