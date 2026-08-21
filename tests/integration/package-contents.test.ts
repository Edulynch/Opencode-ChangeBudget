import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function packJson(): Array<{ files?: Array<{ path: string }> }> {
  const result = spawnSync(npmCommand, ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
  assert.equal(result.status, 0, `${result.error?.message ?? ''}\n${result.stderr ?? ''}`);

  const output = result.stdout.trim();
  const jsonStart = output.indexOf('[');
  assert.notEqual(jsonStart, -1, `npm pack did not return JSON: ${output}`);
  return JSON.parse(output.slice(jsonStart)) as Array<{ files?: Array<{ path: string }> }>;
}

test('T036: package whitelist contains runtime files and excludes development content', () => {
  const entries = packJson().flatMap((pack) => pack.files ?? []).map((file) => file.path.replaceAll('\\', '/'));
  const entrySet = new Set(entries);

  const required = [
    'dist/src/cli/index.js',
    'dist/src/cli/commands/update.js',
    'dist/src/cli/commands/version.js',
    'dist/src/core/package-root.js',
    'dist/src/core/update/version.js',
    'dist/src/core/update/github.js',
    'dist/src/core/update/npm.js',
    'opencode-plugin/dist/opencode-plugin/src/index.js',
  ];
  for (const path of required) {
    assert.equal(entrySet.has(path), true, `missing packaged runtime file: ${path}`);
  }

  const forbidden = entries.filter((path) =>
    path.startsWith('dist/tests/') ||
    path.startsWith('tests/') ||
    path.startsWith('specs/') ||
    path.startsWith('src/') ||
    path.includes('/.git/') ||
    path.startsWith('node_modules/') ||
    path.endsWith('.ts'),
  );
  assert.deepEqual(forbidden, []);
});
