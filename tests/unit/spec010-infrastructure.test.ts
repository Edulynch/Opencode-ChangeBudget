import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
  assert.equal(packageJson.scripts?.build, 'tsc && tsc -p opencode-plugin/tsconfig.json');
  assert.equal(packageJson.scripts?.typecheck, 'tsc --noEmit && tsc --noEmit -p opencode-plugin/tsconfig.json');
  assert.equal(packageJson.scripts?.test, 'npm run build && node --test "dist/tests/**/*.js"');
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
  } finally {
    await fixture.cleanup();
  }
});
