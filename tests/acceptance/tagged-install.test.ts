import * as assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, readlink, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import {
  createDisposableNpm,
  disposableNpmExists,
  disposableGlobalCliExecutable,
  disposableGlobalPackageRoot,
} from '../utils/disposable-npm.js';
import { createGitFixture } from '../utils/git-fixture.js';
import { buildNpmArgs } from '../../src/core/update/npm.js';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function runInstalledCli(
  executable: string,
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  if (process.platform === 'win32') {
    return spawnSync(`"${executable}"`, args, {
      cwd,
      env,
      encoding: 'utf8',
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  return spawnSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function mustExist(path: string): Promise<void> {
  await access(path);
}

async function mustNotExist(path: string): Promise<void> {
  await assert.rejects(access(path));
}

test('T037: tagged Git installation works from a disposable prefix and space-containing paths', async () => {
  const fixture = await createGitFixture(process.cwd());
  const npm = await createDisposableNpm();
  const userProject = await mkdtemp(join(tmpdir(), 'changebudget installed project '));
  const unrelatedCwd = await mkdtemp(join(tmpdir(), 'changebudget unrelated cwd '));
  runGit(userProject, ['init']);
  runGit(userProject, ['config', 'user.name', 'tagged install test']);
  runGit(userProject, ['config', 'user.email', 'tagged-install@example.test']);
  runGit(userProject, ['commit', '--allow-empty', '-m', 'seed']);
  await writeFile(join(userProject, 'AGENTS.md'), 'user-owned\n');
  await mkdir(join(userProject, 'project-files'), { recursive: true });
  const originalConfig = {
    $schema: 'https://example.test/schema.json',
    model: 'test-model',
    permissions: { read: 'allow' },
    theme: 'dark',
  };
  await writeFile(join(userProject, 'opencode.json'), `${JSON.stringify(originalConfig)}\n`);
  const beforeInstallAgents = await readFile(join(userProject, 'AGENTS.md'), 'utf8');
  const beforeInstallConfig = await readFile(join(userProject, 'opencode.json'), 'utf8');
  const realPrefixBefore = spawnSync(npmCommand, ['prefix', '--global'], {
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  }).stdout?.trim() ?? '';

  try {
    assert.equal(fixture.tag, `v${fixture.version}`);
    const env = {
      ...npm.env,
      npm_config_cache: join(npm.root, 'cache'),
      NPM_CONFIG_CACHE: join(npm.root, 'cache'),
    };
    const install = spawnSync(
      npmCommand,
      (() => {
        const packageSpec = fixture.getPackageSpec(fixture.tag);
        const canonicalArgs = [...buildNpmArgs(packageSpec)];
        const packageIndex = canonicalArgs.length - 1;
        return [
          ...canonicalArgs.slice(0, packageIndex),
          '--prefix',
          `"${npm.prefix}"`,
          canonicalArgs[packageIndex],
        ];
      })(),
      {
        cwd: unrelatedCwd,
        env,
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 240_000,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    assert.equal(
      install.status,
      0,
      `${install.error?.message ?? ''}\n${install.stdout ?? ''}\n${install.stderr ?? ''}`,
    );
    assert.equal(await readFile(join(userProject, 'AGENTS.md'), 'utf8'), beforeInstallAgents);
    assert.equal(await readFile(join(userProject, 'opencode.json'), 'utf8'), beforeInstallConfig);
    await mustNotExist(join(userProject, '.opencode'));
    await mustNotExist(join(userProject, '.changebudget'));

    const executable = disposableGlobalCliExecutable(npm, 'changebudget');
    await mustExist(executable);

    const packageRoot = disposableGlobalPackageRoot(npm, 'changebudget-cli');
    const runtimeGuard = join(packageRoot, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js');
    try {
      await mustExist(join(packageRoot, 'dist', 'src', 'cli', 'index.js'));
    } catch (error) {
      const topLevel = await readdir(npm.prefix, { recursive: true }).catch(() => []);
      const packageTarget = await realpath(packageRoot).catch(() => 'unresolved');
      const packageLink = await readlink(packageRoot).catch(() => 'not-a-link');
      throw new Error(`${String(error)}; installed prefix entries: ${topLevel.join(', ')}; package target: ${packageTarget}; package link: ${packageLink}`);
    }
    await mustExist(runtimeGuard);
    const installedPackage = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      version?: string;
      devDependencies?: Record<string, string>;
    };
    assert.equal(installedPackage.version, fixture.version);
    assert.equal(installedPackage.devDependencies, undefined);
    await mustNotExist(join(packageRoot, 'dist', 'src', '.prepare-ran'));
    await mustNotExist(join(packageRoot, 'node_modules', 'typescript'));
    const developmentRuntimeGuard = join(
      process.cwd(),
      'opencode-plugin',
      'dist',
      'opencode-plugin',
      'src',
      'index.js',
    );

    await writeFile(join(unrelatedCwd, 'package.json'), '{"name":"unrelated-project"}\n');
    const version = runInstalledCli(executable, unrelatedCwd, ['--version'], env);
    assert.equal(version.status, 0, version.stderr);
    assert.equal(version.stdout.trim(), fixture.version);

    const help = runInstalledCli(executable, unrelatedCwd, ['--help'], env);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /changebudget update \[--check\]/);
    assert.match(help.stdout, /--version/);

    const init = runInstalledCli(executable, userProject, ['init'], env);
    assert.equal(init.status, 0, init.stderr);
    const integrate = runInstalledCli(executable, userProject, ['integrate', 'opencode'], env);
    assert.equal(integrate.status, 0, integrate.stderr);

    const wrapper = await readFile(join(userProject, '.opencode', 'plugins', 'changebudget.js'), 'utf8');
    const runtimeGuardUrl = pathToFileURL(runtimeGuard).href;
    assert.match(wrapper, new RegExp(runtimeGuardUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(wrapper, new RegExp(pathToFileURL(developmentRuntimeGuard).href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const installedPlugin = (await import(pathToFileURL(runtimeGuard).href)) as {
      default: { server: (input: { directory: string; worktree: string }) => Promise<Record<string, unknown>> };
    };
    const installedWrapper = (await import(pathToFileURL(join(userProject, '.opencode', 'plugins', 'changebudget.js')).href)) as {
      default: typeof installedPlugin.default;
    };
    assert.equal(installedWrapper.default, installedPlugin.default);
    assert.equal(typeof (await installedWrapper.default.server({ directory: userProject, worktree: userProject }))['permission.ask'], 'function');
    assert.equal(await readFile(join(userProject, 'AGENTS.md'), 'utf8'), 'user-owned\n');
    assert.deepEqual(JSON.parse(await readFile(join(userProject, 'opencode.json'), 'utf8')), {
      ...originalConfig,
      instructions: ['.opencode/instructions/changebudget.md'],
    });
    const wrapperAfterFirstInstall = wrapper;
    const configAfterFirstInstall = await readFile(join(userProject, 'opencode.json'), 'utf8');
    const integrateAgain = runInstalledCli(executable, userProject, ['integrate', 'opencode'], env);
    assert.equal(integrateAgain.status, 0, integrateAgain.stderr);
    assert.equal(await readFile(join(userProject, '.opencode', 'plugins', 'changebudget.js'), 'utf8'), wrapperAfterFirstInstall);
    assert.equal(await readFile(join(userProject, 'opencode.json'), 'utf8'), configAfterFirstInstall);
    assert.match(wrapper, /ChangeBudget-managed/);
    assert.equal(spawnSync('git', ['status', '--porcelain'], { cwd: userProject, encoding: 'utf8' }).status, 0);
    assert.equal(
      realPrefixBefore,
      spawnSync(npmCommand, ['prefix', '--global'], {
        encoding: 'utf8',
        env: process.env,
        shell: process.platform === 'win32',
      }).stdout?.trim() ?? '',
    );
  } finally {
    await npm.cleanup();
    await fixture.cleanup();
    assert.equal(await disposableNpmExists(npm), false);
    await assert.rejects(access(fixture.root));
    await rm(userProject, { recursive: true, force: true });
    await rm(unrelatedCwd, { recursive: true, force: true });
  }
});
