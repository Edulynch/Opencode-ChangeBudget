import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { MANAGED_RESOURCES } from '../../src/core/integration/opencode.js';
import { withDisposableNpm } from '../utils/disposable-npm.js';

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function cli(root: string, args: string[]) {
  return spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), ...args],
    { cwd: root, encoding: 'utf8' },
  );
}

test('T031: quick-start sequence works in a disposable project without network', async () => {
  const quickstart = await readFile(
    join(process.cwd(), 'specs', '010-tagged-install', 'quickstart.md'),
    'utf8',
  );
  assert.match(quickstart, /npm install -g github:Edulynch\/Opencode-ChangeBudget#vX\.Y\.Z/);
  assert.match(quickstart, /changebudget init/);
  assert.match(quickstart, /changebudget integrate opencode/);
  assert.match(quickstart, /opencode/);
  assert.match(quickstart, /describe your coding work normally/i);
  assert.doesNotMatch(quickstart, /npmjs|curl|master|main|prerelease|PowerShell/i);

  await withDisposableNpm(async (npm) => {
    const root = await mkdtemp(join(tmpdir(), 'changebudget-quickstart-'));
    try {
      git(root, ['init']);
      git(root, ['config', 'user.name', 'quickstart test']);
      git(root, ['config', 'user.email', 'quickstart@example.test']);
      git(root, ['commit', '--allow-empty', '-m', 'seed']);

      const initialized = cli(root, ['init']);
      assert.equal(initialized.status, 0, initialized.stderr);
      const integrated = cli(root, ['integrate', 'opencode']);
      assert.equal(integrated.status, 0, integrated.stderr);
      assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), true);
      assert.equal(existsSync(join(root, MANAGED_RESOURCES.instructions)), true);
      assert.equal(existsSync(join(root, MANAGED_RESOURCES.opencodeConfig)), true);
      assert.equal(npm.env.npm_config_prefix, npm.prefix);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
