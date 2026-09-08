import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { runUpdate, runUpdateCheck } from '../../../src/cli/commands/update.js';
import {
  INSTRUCTIONS_MARKER,
  INSTRUCTIONS_PROFILE_METADATA,
  MANAGED_RESOURCES,
  generateWrapperContent,
  resolveChangeBudgetRoot,
  runtimeGuardFileUrl,
} from '../../../src/core/integration/opencode.js';
import {
  discoverManagedIntegration,
  type ManagedIntegrationDiscovery,
} from '../../../src/core/integration/opencode-discovery.js';
import { NpmUpdateResult } from '../../../src/core/update/npm.js';

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

test('T032: update preserves absent, conflict, and unknown-profile project bytes and Git state', async () => {
  const scenarios = [
    {
      label: 'absent',
      discovery: { state: 'ABSENT' },
      prepare: async (_root: string) => undefined,
    },
    {
      label: 'conflict',
      discovery: { state: 'CONFLICT' },
      prepare: async (root: string) => writeFile(
        join(root, MANAGED_RESOURCES.instructions),
        `# user-owned instructions\n${INSTRUCTIONS_MARKER}\n`,
      ),
    },
    {
      label: 'unknown profile',
      discovery: { state: 'UNKNOWN_PROFILE', profileId: 'opencode-gpt-ultra' },
      prepare: async (root: string) => writeFile(
        join(root, MANAGED_RESOURCES.instructions),
        `${INSTRUCTIONS_MARKER}\n${INSTRUCTIONS_PROFILE_METADATA} opencode-gpt-ultra -->\n# legacy profile\n`,
      ),
    },
  ] as const satisfies readonly {
    readonly label: string;
    readonly discovery: ManagedIntegrationDiscovery;
    readonly prepare: (root: string) => Promise<void>;
  }[];

  for (const scenario of scenarios) {
    const root = await project();
    const output: string[] = [];
    let npmCalls = 0;
    let discoveryCalls = 0;
    let refreshCalls = 0;
    try {
      await scenario.prepare(root);
      const beforeFiles = await snapshot(root);
      const beforeHead = git(root, ['rev-parse', 'HEAD']);
      const beforeStatus = git(root, ['status', '--porcelain']);
      const deps = {
        getInstalledVersion: () => '1.2.0',
        discoverVersions: async () => [{ major: 1, minor: 3, patch: 0, tag: 'v1.3.0' }],
        runSelfUpdate: async () => {
          npmCalls += 1;
          return success;
        },
        getProjectRoot: () => root,
        getChangeBudgetRoot: () => '/global/node_modules/changebudget',
        discoverManagedIntegration: async () => {
          discoveryCalls += 1;
          return scenario.discovery;
        },
        executeUpdatedCli: async () => {
          refreshCalls += 1;
          return { kind: 'success' as const, stdout: '', stderr: '' };
        },
        writeOut: (message: string) => output.push(message),
        writeErr: (message: string) => output.push(message),
      };

      assert.equal(await runUpdateCheck(deps), 0, scenario.label);
      assert.equal(discoveryCalls, 0, `${scenario.label}: update check must not inspect projects`);
      assert.deepEqual(await snapshot(root), beforeFiles, scenario.label);
      assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead, scenario.label);
      assert.equal(git(root, ['status', '--porcelain']), beforeStatus, scenario.label);

      assert.equal(await runUpdate(deps), 0, scenario.label);
      assert.equal(npmCalls, 1, `${scenario.label}: package update must succeed`);
      assert.equal(discoveryCalls, 1, scenario.label);
      assert.equal(refreshCalls, 0, `${scenario.label}: refresh runner must not execute`);
      assert.deepEqual(await snapshot(root), beforeFiles, scenario.label);
      assert.equal(git(root, ['rev-parse', 'HEAD']), beforeHead, scenario.label);
      assert.equal(git(root, ['status', '--porcelain']), beforeStatus, scenario.label);
      assert.ok(output.some((line) => line.includes('updated to')), scenario.label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('update skips refresh without writing for mixed conflicts and malformed profile metadata', async () => {
  const changeBudgetRoot = resolveChangeBudgetRoot();
  const scenarios = [
    {
      label: 'legacy metadata with a conflicting wrapper',
      prepare: async (root: string) => {
        await writeFile(
          join(root, MANAGED_RESOURCES.instructions),
          `${INSTRUCTIONS_MARKER}\n# legacy instructions\n`,
        );
        await mkdir(join(root, '.opencode', 'plugins'), { recursive: true });
        await writeFile(join(root, MANAGED_RESOURCES.pluginWrapper), '// user-owned wrapper\n');
      },
    },
    {
      label: 'malformed profile metadata',
      prepare: async (root: string) => {
        await writeFile(
          join(root, MANAGED_RESOURCES.instructions),
          `${INSTRUCTIONS_MARKER}\n${INSTRUCTIONS_PROFILE_METADATA} -->\n# managed instructions\n`,
        );
        await mkdir(join(root, '.opencode', 'plugins'), { recursive: true });
        await writeFile(
          join(root, MANAGED_RESOURCES.pluginWrapper),
          generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
        );
        await writeFile(
          join(root, MANAGED_RESOURCES.opencodeConfig),
          '{"instructions":[".opencode/instructions/changebudget.md"]}\n',
        );
      },
    },
  ] as const;

  for (const scenario of scenarios) {
    const root = await project();
    let refreshCalls = 0;
    try {
      await scenario.prepare(root);
      const beforeFiles = await snapshot(root);
      const beforeStatus = git(root, ['status', '--porcelain']);

      const result = await runUpdate({
        getInstalledVersion: () => '1.2.0',
        discoverVersions: async () => [{ major: 1, minor: 3, patch: 0, tag: 'v1.3.0' }],
        runSelfUpdate: async () => success,
        getProjectRoot: () => root,
        getChangeBudgetRoot: () => changeBudgetRoot,
        discoverManagedIntegration,
        executeUpdatedCli: async () => {
          refreshCalls += 1;
          throw new Error('non-eligible integration state must not refresh');
        },
        writeOut: () => undefined,
        writeErr: () => undefined,
      });

      assert.equal(result, 0, scenario.label);
      assert.equal(refreshCalls, 0, scenario.label);
      assert.deepEqual(await snapshot(root), beforeFiles, scenario.label);
      assert.equal(git(root, ['status', '--porcelain']), beforeStatus, scenario.label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});
