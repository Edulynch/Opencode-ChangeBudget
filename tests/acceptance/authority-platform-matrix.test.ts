import * as assert from 'node:assert/strict';
import { lstat, mkdtemp } from 'node:fs/promises';
import { join, parse } from 'node:path';
import { spawnSync } from 'node:child_process';
import { arch, release, tmpdir } from 'node:os';
import { test } from 'node:test';

import { removeTestRepository } from '../utils/disposable-repository.js';

function approvedTempBase(): string {
  return process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : tmpdir();
}

test('T005: feasibility output names the actual OS, runtime, and filesystem used by disposable fixtures', async () => {
  const root = await mkdtemp(join(approvedTempBase(), 'cb-authority-platform-'));
  try {
    const volumeRoot = parse(root).root;
    let filesystem = 'unknown';
    if (process.platform === 'win32') {
      const driveLetter = volumeRoot.match(/^([A-Za-z]):[\\/]$/)?.[1];
      assert.ok(driveLetter, `cannot identify the fixture volume from ${root}`);
      const result = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(Get-Volume -DriveLetter '${driveLetter}').FileSystem`],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stderr);
      filesystem = result.stdout.trim();
    } else {
      const stats = await lstat(root, { bigint: true });
      filesystem = `unresolved-${process.platform}-device-${stats.dev.toString()}`;
    }

    const first = await lstat(root, { bigint: true });
    const second = await lstat(root, { bigint: true });
    console.info(JSON.stringify({
      task: 'T005-feasibility-only',
      platform: process.platform,
      release: release(),
      architecture: arch(),
      node: process.version,
      fixtureRoot: root,
      volumeRoot,
      filesystem,
      device: first.dev.toString(),
      fileObjectId: first.ino.toString(),
      identityStableAcrossRead: first.dev === second.dev && first.ino === second.ino,
    }));
    assert.notEqual(filesystem, 'unknown');
    assert.equal(first.dev, second.dev);
    assert.equal(first.ino, second.ino);
  } finally {
    await removeTestRepository(root);
  }
});
