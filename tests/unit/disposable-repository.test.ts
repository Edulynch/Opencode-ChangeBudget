import * as assert from 'node:assert/strict';
import { access, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createTestFixtureDirectory, removeTestRepository } from '../utils/disposable-repository.js';

test('fixture creation creates a missing nested parent and isolates concurrent roots and cleanup', async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'cb-disposable-fixture-parent-'));
  const parent = join(testRoot, 'missing', 'nested', 'fixture-parent');
  let first: string | undefined;
  let second: string | undefined;
  try {
    await assert.rejects(access(parent), (error: unknown) =>
      (error as NodeJS.ErrnoException).code === 'ENOENT');

    [first, second] = await Promise.all([
      createTestFixtureDirectory(parent, 'fixture-a-').then((root) => { first = root; return root; }),
      createTestFixtureDirectory(parent, 'fixture-b-').then((root) => { second = root; return root; }),
    ]);
    assert.notEqual(first, second, 'each concurrent fixture receives an independent unique root');
    assert.deepEqual((await readdir(parent)).sort(), [basename(first), basename(second)].sort());

    const retainedFile = join(second, 'retained.txt');
    await writeFile(retainedFile, 'other fixture remains owned\n', 'utf8');
    await removeTestRepository(first);
    first = undefined;

    assert.deepEqual(await readdir(parent), [basename(second)], 'root cleanup leaves the shared fixture parent and sibling intact');
    assert.equal(await readFile(retainedFile, 'utf8'), 'other fixture remains owned\n');
  } finally {
    await Promise.all([first, second].filter((root): root is string => root !== undefined)
      .map((root) => removeTestRepository(root)));
    await removeTestRepository(testRoot);
  }
});

test('fixture creation propagates a file-as-parent failure without replacing the existing file', async () => {
  const testRoot = await mkdtemp(join(tmpdir(), 'cb-disposable-fixture-blocker-'));
  const blocker = join(testRoot, 'parent-is-file');
  try {
    await writeFile(blocker, 'keep this existing file\n', 'utf8');
    await assert.rejects(createTestFixtureDirectory(blocker, 'fixture-'), (error: unknown) => {
      const code = (error as NodeJS.ErrnoException).code;
      return code === 'EEXIST' || code === 'ENOTDIR';
    });
    assert.equal(await readFile(blocker, 'utf8'), 'keep this existing file\n');
  } finally {
    await removeTestRepository(testRoot);
  }
});
