import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createDisposableNpm,
  disposableNpmExists,
  withDisposableNpm,
} from '../utils/disposable-npm.js';
import { createGitFixture } from '../utils/git-fixture.js';

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
