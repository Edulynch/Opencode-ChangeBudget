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
  INSTRUCTIONS_MARKER,
  MANAGED_RESOURCES,
  WRAPPER_MARKER,
  generateInstructionsContent,
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
  entry: '/global/node_modules/changebudget/dist/src/cli/index.js',
};

test('T033: update refreshes managed stale and legacy OpenCode projects through the verified runner', async () => {
  const changeBudgetRoot = resolveChangeBudgetRoot();
  const scenarios = [
    {
      label: 'managed stale wrapper',
      prepare: async (root: string) => {
        const installed = await installIntegration(root, changeBudgetRoot);
        assert.equal(installed.runtimeGuardTargetExists, true);
        await writeFile(
          join(root, MANAGED_RESOURCES.pluginWrapper),
          `${WRAPPER_MARKER}\nexport { default } from "file:///stale-runtime.js";\n`,
        );
      },
    },
    {
      label: 'legacy instructions',
      prepare: async (root: string) => writeFile(
        join(root, MANAGED_RESOURCES.instructions),
        `${INSTRUCTIONS_MARKER}\n# legacy instructions\n`,
      ),
    },
  ] as const;

  await access(resolveRuntimeGuardEntry(changeBudgetRoot));
  for (const scenario of scenarios) {
    const root = await mkdtemp(join(tmpdir(), 'changebudget-spec009-'));
    try {
      git(root, ['init']);
      git(root, ['config', 'user.name', 'spec009 test']);
      git(root, ['config', 'user.email', 'spec009@example.test']);
      git(root, ['commit', '--allow-empty', '-m', 'seed']);
      await mkdir(join(root, '.opencode', 'instructions'), { recursive: true });
      await mkdir(join(root, 'src'), { recursive: true });
      await mkdir(join(root, 'specs', '011-project'), { recursive: true });
      await writeFile(join(root, 'AGENTS.md'), 'must remain unchanged\n');
      await writeFile(join(root, '.opencode', 'instructions', 'user.md'), 'user-owned instructions\n');
      await writeFile(join(root, MANAGED_RESOURCES.opencodeConfig), `${JSON.stringify({
        model: 'user-selected-model',
        custom: { preserve: true },
        instructions: ['.opencode/instructions/user.md'],
      }, null, 2)}\n`);
      await writeFile(join(root, 'src', 'project.ts'), 'export const project = true;\n');
      await writeFile(join(root, 'specs', '011-project', 'tasks.md'), '- [ ] project-owned task\n');
      await scenario.prepare(root);

      const beforeAgents = await readFile(join(root, 'AGENTS.md'), 'utf8');
      const beforeProject = await readFile(join(root, 'src', 'project.ts'), 'utf8');
      const beforeTasks = await readFile(join(root, 'specs', '011-project', 'tasks.md'), 'utf8');
      const beforeUpdate = await projectSnapshot(root);
      const refreshRequests: Array<{
        readonly command: string;
        readonly args: readonly string[];
        readonly cwd: string;
        readonly shell: false;
      }> = [];
      const updateDependencies = {
        getInstalledVersion: () => '1.1.0',
        discoverVersions: async () => [{ major: 1, minor: 2, patch: 0, tag: 'v1.2.0' }],
        runSelfUpdate: async () => success,
        getProjectRoot: () => root,
        getChangeBudgetRoot: () => changeBudgetRoot,
        executeUpdatedCli: async (request: {
          readonly command: string;
          readonly args: readonly string[];
          readonly cwd: string;
          readonly shell: false;
        }) => {
          refreshRequests.push(request);
          await installIntegration(request.cwd, changeBudgetRoot);
          return { kind: 'success' as const, stdout: '', stderr: '' };
        },
        writeOut: () => undefined,
        writeErr: () => undefined,
      };

      assert.equal(await runUpdateCheck(updateDependencies), 0, scenario.label);
      assert.equal(await projectSnapshot(root), beforeUpdate, `${scenario.label}: update check must not write`);
      assert.equal(await runUpdate(updateDependencies), 0, scenario.label);
      assert.deepEqual(refreshRequests, [{
        command: process.execPath,
        args: [success.entry, 'integrate', 'opencode'],
        cwd: root,
        shell: false,
      }], scenario.label);
      assert.equal(
        await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'),
        generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
        scenario.label,
      );
      assert.equal(
        await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8'),
        generateInstructionsContent(),
        scenario.label,
      );
      assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), beforeAgents, scenario.label);
      assert.equal(await readFile(join(root, 'src', 'project.ts'), 'utf8'), beforeProject, scenario.label);
      assert.equal(await readFile(join(root, 'specs', '011-project', 'tasks.md'), 'utf8'), beforeTasks, scenario.label);
      const config = JSON.parse(await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8'));
      assert.equal(config.model, 'user-selected-model', scenario.label);
      assert.deepEqual(config.custom, { preserve: true }, scenario.label);
      assert.deepEqual(config.instructions, [
        '.opencode/instructions/user.md',
        INSTRUCTION_ENTRY,
      ], scenario.label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
