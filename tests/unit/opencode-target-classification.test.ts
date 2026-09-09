import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { join, win32 } from 'node:path';

import { classifyTargetCreation, isContainedPath } from '../../opencode-plugin/src/target-classification.js';

test('isContainedPath rejects absolute relative results across Windows volumes', () => {
  assert.equal(isContainedPath('C:\\repo', 'C:\\repo\\src\\a.ts', win32), true);
  assert.equal(isContainedPath('C:\\repo', 'C:\\outside\\a.ts', win32), false);
  assert.equal(isContainedPath('C:\\repo', 'D:\\outside\\a.ts', win32), false);
});

test('classifyTargetCreation returns lexical and effective paths for a new target beneath an internal symlink', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-target-classification-'));

  try {
    await mkdir(join(root, 'real'), { recursive: true });
    await symlink(join(root, 'real'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');

    const result = await classifyTargetCreation({
      repositoryRoot: root,
      targetPath: 'alias/new.ts',
    });

    assert.equal(result.state, 'new-file');
    assert.equal(result.lexicalPath, 'alias/new.ts');
    assert.equal(result.effectivePath, 'real/new.ts');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
