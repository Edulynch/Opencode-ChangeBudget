import * as assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, readdir, realpath, readlink, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import {
  createDisposableNpm,
  disposableGlobalCliExecutable,
  disposableGlobalPackageRoot,
} from '../utils/disposable-npm.js';
import { createGitFixture } from '../utils/git-fixture.js';

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

test('T037: tagged Git installation works from a disposable prefix and space-containing paths', async () => {
  const fixture = await createGitFixture(process.cwd());
  const npm = await createDisposableNpm();
  const userProject = await mkdtemp(join(tmpdir(), 'changebudget installed project '));
  const unrelatedCwd = await mkdtemp(join(tmpdir(), 'changebudget unrelated cwd '));
  const realPrefixBefore = spawnSync(npmCommand, ['prefix', '--global'], {
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  }).stdout?.trim() ?? '';

  try {
    const env = {
      ...npm.env,
      npm_config_cache: join(npm.root, 'cache'),
      NPM_CONFIG_CACHE: join(npm.root, 'cache'),
    };
    const install = spawnSync(
      npmCommand,
      [
        'install',
        '-g',
        '--prefix',
        `"${npm.prefix}"`,
        '--include=dev',
        '--install-links=true',
         fixture.getPackageSpec(fixture.tag),
      ],
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
    assert.equal(await readFile(join(packageRoot, 'dist', 'src', '.prepare-ran'), 'utf8'), 'yes');
    await mustExist(runtimeGuard);
     assert.equal(JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version, fixture.version);

    await writeFile(join(unrelatedCwd, 'package.json'), '{"name":"unrelated-project"}\n');
    const version = runInstalledCli(executable, unrelatedCwd, ['--version'], env);
    assert.equal(version.status, 0, version.stderr);
     assert.equal(version.stdout.trim(), fixture.version);

    const help = runInstalledCli(executable, unrelatedCwd, ['--help'], env);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /changebudget update \[--check\]/);
    assert.match(help.stdout, /--version/);

    runGit(userProject, ['init']);
    runGit(userProject, ['config', 'user.name', 'tagged install test']);
    runGit(userProject, ['config', 'user.email', 'tagged-install@example.test']);
    runGit(userProject, ['commit', '--allow-empty', '-m', 'seed']);
    await writeFile(join(userProject, 'AGENTS.md'), 'user-owned\n');
    await mkdir(join(userProject, 'project-files'), { recursive: true });
    await writeFile(join(userProject, 'opencode.json'), JSON.stringify({ theme: 'dark' }) + '\n');

    const init = runInstalledCli(executable, userProject, ['init'], env);
    assert.equal(init.status, 0, init.stderr);
    const integrate = runInstalledCli(executable, userProject, ['integrate', 'opencode'], env);
    assert.equal(integrate.status, 0, integrate.stderr);

    const wrapper = await readFile(join(userProject, '.opencode', 'plugins', 'changebudget.js'), 'utf8');
    assert.match(wrapper, new RegExp(pathToFileURL(runtimeGuard).href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(await readFile(join(userProject, 'AGENTS.md'), 'utf8'), 'user-owned\n');
    assert.equal(JSON.parse(await readFile(join(userProject, 'opencode.json'), 'utf8')).theme, 'dark');
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
    await rm(userProject, { recursive: true, force: true });
    await rm(unrelatedCwd, { recursive: true, force: true });
  }
});
