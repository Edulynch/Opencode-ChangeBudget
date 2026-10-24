import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  createDisposableNpm,
  disposableNpmExists,
  withDisposableNpm,
} from '../utils/disposable-npm.js';
import { createGitFixture } from '../utils/git-fixture.js';

test('T006: package installation contract is independent of lifecycle scripts', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
    bin?: Record<string, string>;
    files?: string[];
  };

  assert.equal(packageJson.scripts?.prepare, undefined);
  assert.equal(packageJson.scripts?.build, undefined);
  assert.equal(packageJson.scripts?.compile, 'tsc && tsc -p opencode-plugin/tsconfig.json');
  assert.equal(packageJson.scripts?.typecheck, 'tsc --noEmit && tsc --noEmit -p opencode-plugin/tsconfig.json');
  assert.equal(packageJson.scripts?.test, 'npm run compile && node --test "dist/tests/**/*.js"');
  assert.equal(packageJson.scripts?.start, 'node dist/src/cli/index.js');
  assert.deepEqual(packageJson.bin, { changebudget: 'dist/src/cli/index.js' });
  assert.deepEqual(packageJson.files, ['dist/src/**', 'opencode-plugin/dist/opencode-plugin/**']);
});

test('T034: disposable npm uses a temporary prefix with spaces and cleans up on success', async () => {
  const disposable = await createDisposableNpm();
  assert.match(disposable.prefix, / /);
  assert.notEqual(disposable.prefix, process.env.npm_config_prefix);
  assert.equal(disposable.env.npm_config_prefix, disposable.prefix);
  assert.notEqual(disposable.env.PATH, process.env.PATH);
  await disposable.cleanup();
  assert.equal(await disposableNpmExists(disposable), false);
});

test('T034: disposable npm cleans up after callback failure', async () => {
  let root = '';
  await assert.rejects(
    withDisposableNpm(async (disposable) => {
      root = disposable.root;
      throw new Error('expected test failure');
    }),
    /expected test failure/,
  );
  const disposable = { root };
  assert.equal(await disposableNpmExists(disposable as Parameters<typeof disposableNpmExists>[0]), false);
});

test('T035: local Git fixture is temporary, tagged, and cleaned up', async () => {
  const fixture = await createGitFixture();
  try {
    assert.match(fixture.getPackageSpec('v1.0.0'), /^git\+file:\/\/.*#v1\.0\.0$/);
    assert.throws(() => fixture.getPackageSpec('main'), /Invalid fixture tag/);
  } finally {
    await fixture.cleanup();
  }
  await assert.rejects(import('node:fs/promises').then(({ access }) => access(fixture.root)));
});

test('T013: source-root Git fixture tracks only the prebuilt release runtime', async () => {
  const fixture = await createGitFixture(process.cwd());
  try {
    const packageJson = JSON.parse(readFileSync(`${fixture.root}/package.json`, 'utf8')) as {
      version?: string;
    };
    const tracked = spawnSync('git', ['ls-files'], { cwd: fixture.root, encoding: 'utf8' });
    assert.equal(tracked.status, 0, tracked.stderr);
    assert.equal(fixture.tag, `v${fixture.version}`);
    assert.equal(packageJson.version, fixture.version);
    assert.match(tracked.stdout, /(^|\n)dist\/src\/cli\/index\.js(\n|$)/);
    assert.match(tracked.stdout, /(^|\n)opencode-plugin\/dist\/opencode-plugin\/src\/index\.js(\n|$)/);
    assert.doesNotMatch(tracked.stdout, /(^|\n)dist\/tests\//);
    assert.doesNotMatch(tracked.stdout, /(^|\n)opencode-plugin\/dist\/src\//);
    assert.doesNotMatch(tracked.stdout, /(^|\n)\.serena\//);
  } finally {
    await fixture.cleanup();
  }
});

test('T013: source-root fixture omits ignored non-runtime root dist artifacts before copying', async () => {
  const sourceRoot = await mkdtemp(join(tmpdir(), 'spec010-git-fixture-source-'));
  let fixture: Awaited<ReturnType<typeof createGitFixture>> | undefined;
  try {
    await mkdir(join(sourceRoot, 'dist', 'src', 'cli'), { recursive: true });
    await mkdir(join(sourceRoot, 'dist', 'ignored-build-artifacts'), { recursive: true });
    await mkdir(join(sourceRoot, 'opencode-plugin', 'dist', 'opencode-plugin', 'src'), { recursive: true });
    await mkdir(join(sourceRoot, 'opencode-plugin', 'dist', 'secondary-output'), { recursive: true });
    await writeFile(join(sourceRoot, 'package.json'), JSON.stringify({
      name: 'spec010-copy-fixture',
      version: '1.2.3',
      private: true,
      devDependencies: { typescript: '^5.9.2' },
    }));
    await writeFile(join(sourceRoot, '.gitignore'), '/dist/*\n!/dist/src/\n!/dist/src/**\n');
    await writeFile(join(sourceRoot, 'dist', 'src', 'cli', 'index.js'), 'required cli runtime\n');
    await writeFile(join(sourceRoot, 'dist', 'ignored-build-artifacts', 'sentinel.txt'), 'ignored root artifact\n');
    await writeFile(
      join(sourceRoot, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js'),
      'required plugin runtime\n',
    );
    await writeFile(
      join(sourceRoot, 'opencode-plugin', 'dist', 'secondary-output', 'sentinel.txt'),
      'nested dist is outside the root dist boundary\n',
    );

    fixture = await createGitFixture(sourceRoot);
    const ignoredArtifact = join(fixture.root, 'dist', 'ignored-build-artifacts', 'sentinel.txt');
    await assert.rejects(access(ignoredArtifact), { code: 'ENOENT' });
    assert.equal(await readFile(join(fixture.root, 'dist', 'src', 'cli', 'index.js'), 'utf8'), 'required cli runtime\n');
    assert.equal(
      await readFile(join(fixture.root, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js'), 'utf8'),
      'required plugin runtime\n',
    );
    assert.equal(
      await readFile(join(fixture.root, 'opencode-plugin', 'dist', 'secondary-output', 'sentinel.txt'), 'utf8'),
      'nested dist is outside the root dist boundary\n',
    );

    const tracked = spawnSync('git', ['ls-files'], { cwd: fixture.root, encoding: 'utf8' });
    assert.equal(tracked.status, 0, tracked.stderr);
    const trackedPaths = new Set(tracked.stdout.split(/\r?\n/u).filter(Boolean));
    assert.ok(trackedPaths.has('dist/src/cli/index.js'), 'required CLI runtime is staged in the Git fixture');
    assert.ok(
      trackedPaths.has('opencode-plugin/dist/opencode-plugin/src/index.js'),
      'required plugin runtime is staged in the Git fixture',
    );
    assert.equal(trackedPaths.has('dist/ignored-build-artifacts/sentinel.txt'), false);
    assert.ok(trackedPaths.has('opencode-plugin/dist/secondary-output/sentinel.txt'));
  } finally {
    try {
      if (fixture !== undefined) await fixture.cleanup();
    } finally {
      await rm(sourceRoot, { recursive: true, force: true });
    }
  }
});
