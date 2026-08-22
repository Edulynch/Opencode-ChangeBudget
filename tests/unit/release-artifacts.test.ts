import * as assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function checkIgnored(path: string): boolean {
  const result = spawnSync('git', ['check-ignore', '--quiet', '--', path], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.error, undefined, result.error?.message);
  return result.status === 0;
}

test('package and lockfile versions remain consistent', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { version?: string };
  const packageLock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    version?: string;
    packages?: { '': { version?: string } };
  };

  assert.match(packageJson.version ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  assert.equal(packageLock.version, packageJson.version);
  assert.equal(packageLock.packages?.[''].version, packageJson.version);
});

test('required release runtime paths are present and trackable', async () => {
  const required = [
    'dist/src/cli/index.js',
    'dist/src/core/package-root.js',
    'opencode-plugin/dist/opencode-plugin/src/index.js',
  ];

  for (const path of required) {
    await access(path);
    assert.equal(checkIgnored(path), false, `required runtime path is ignored: ${path}`);
  }
});

test('development and duplicate build output remains ignored', async () => {
  const ignored = [
    'dist/tests/acceptance/tagged-install.test.js',
    'opencode-plugin/dist/src/core/ordering.js',
    'node_modules/typescript/package.json',
  ];

  for (const path of ignored) {
    await access(path);
    assert.equal(checkIgnored(path), true, `development path is trackable: ${path}`);
  }
});

test('clean build output matches the release allowlist', async () => {
  const expected = [
    'dist/src/cli/index.js',
    'dist/tests/acceptance/tagged-install.test.js',
    'opencode-plugin/dist/opencode-plugin/src/index.js',
    'opencode-plugin/dist/src/core/ordering.js',
  ];

  for (const path of expected) {
    await access(path);
  }

  assert.equal(checkIgnored('dist/src/cli/index.js'), false);
  assert.equal(checkIgnored('dist/tests/acceptance/tagged-install.test.js'), true);
  assert.equal(checkIgnored('opencode-plugin/dist/opencode-plugin/src/index.js'), false);
  assert.equal(checkIgnored('opencode-plugin/dist/src/core/ordering.js'), true);
});
