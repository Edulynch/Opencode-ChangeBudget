import * as assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { collectChangedItems } from '../../src/core/check/diff.js';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

async function removeDirectoryTree(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const next = join(root, entry.name);
    if (entry.isDirectory()) {
      await removeDirectoryTree(next);
      continue;
    }

    await rm(next, { force: true });
  }

  await rm(root, { recursive: true, force: true });
}

async function cleanupRoot(root: string): Promise<void> {
  try {
    await removeDirectoryTree(root);
  } catch (error) {
    if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }

    throw error;
  }
}

function createRepositoryWithCommit(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cb-diff-')).then(async (root) => {
    runGit(root, ['init']);
    runGit(root, ['config', 'user.name', 'diff test']);
    runGit(root, ['config', 'user.email', 'diff@test']);
    runGit(root, ['commit', '--allow-empty', '-m', 'seed']);

    return root;
  });
}

async function writeSourceFile(root: string, relativePath: string, content: string): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, content);
}

async function writeBinaryFile(root: string, relativePath: string, bytes: number[]): Promise<void> {
  const path = join(root, relativePath);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, Buffer.from(bytes));
}

test('collectChangedItems ignores .changebudget metadata paths but keeps user files', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/app.ts', 'export const value = 1;\n');
    runGit(root, ['add', 'src/app.ts']);
    runGit(root, ['commit', '-m', 'seed user file']);

    await writeSourceFile(root, '.changebudget/state.json', '{"lifecycle_state":"initialized"}\n');
    await mkdir(join(root, '.changebudget/contracts'), { recursive: true });
    await writeSourceFile(root, '.changebudget/contracts/contract-1.json', '{"id":"contract-1"}\n');
    await writeSourceFile(root, '.changebudget/contracts/untracked.json', '{"id":"contract-2"}\n');

    runGit(root, ['add', '.changebudget/state.json', '.changebudget/contracts/contract-1.json']);

    await writeSourceFile(root, 'src/app.ts', 'export const value = 2;\n');

    const changedItems = await collectChangedItems(root, 'HEAD');
    const paths = changedItems.map((entry) => entry.path);

    assert.equal(changedItems.length, 1);
    assert.equal(paths.includes('src/app.ts'), true);
    assert.equal(paths.includes('.changebudget/state.json'), false);
    assert.equal(paths.some((entry) => entry.startsWith('.changebudget/contracts/')), false);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems marks untracked binary files as binary', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/text.txt', 'simple text file\n');
    await writeBinaryFile(root, 'assets/binary.bin', [0, 1, 2, 0]);

    const changedItems = await collectChangedItems(root, 'HEAD');
    const textItem = changedItems.find((entry) => entry.path === 'src/text.txt');
    const binaryItem = changedItems.find((entry) => entry.path === 'assets/binary.bin');

    assert.equal(changedItems.length, 2);
    assert.ok(textItem);
    assert.ok(binaryItem);
    assert.equal(textItem.isBinary, false);
    assert.equal(binaryItem.isBinary, true);
    assert.equal(binaryItem.type, 'added');
    assert.equal(binaryItem.addedLines, 0);
    assert.equal(binaryItem.removedLines, 0);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems returns canonical path ordering', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await Promise.all([
      writeSourceFile(root, 'src/z.ts', 'zeta\n'),
      writeSourceFile(root, 'src/a.ts', 'alpha\n'),
      writeSourceFile(root, 'src/m.ts', 'mu\n'),
      writeSourceFile(root, 'src/staged.ts', 'staged\n'),
    ]);

    runGit(root, ['add', 'src/z.ts', 'src/a.ts', 'src/m.ts', 'src/staged.ts']);
    runGit(root, ['commit', '-m', 'seed canonical files']);

    await writeSourceFile(root, 'src/z.ts', 'zeta\nupdate\n');
    await writeSourceFile(root, 'src/a.ts', 'alpha\nupdate\n');
    runGit(root, ['add', 'src/z.ts', 'src/a.ts']);

    await writeSourceFile(root, 'src/m.ts', 'mu\nupdate\n');
    await writeSourceFile(root, 'src/b.txt', 'brand-new\n');

    const changedItems = await collectChangedItems(root, 'HEAD');
    const paths = changedItems.map((entry) => entry.path);
    const sorted = [...paths].sort();

    assert.deepEqual(paths, sorted);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems deduplicates same path across staged and unstaged diffs', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/dual.ts', 'one\n');
    runGit(root, ['add', 'src/dual.ts']);
    runGit(root, ['commit', '-m', 'seed dual file']);

    await writeSourceFile(root, 'src/dual.ts', 'one\nstaged\n');
    runGit(root, ['add', 'src/dual.ts']);
    await writeSourceFile(root, 'src/dual.ts', 'one\nstaged\nunstaged\n');

    const changedItems = await collectChangedItems(root, 'HEAD');
    assert.equal(changedItems.length, 1);

    const item = changedItems[0];
    assert.equal(item.path, 'src/dual.ts');
    assert.equal(item.type, 'modified');
    assert.equal(item.addedLines, 3);
    assert.equal(item.removedLines, 0);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems emits stable rename source and destination entries', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/old.ts', 'old\n');
    runGit(root, ['add', 'src/old.ts']);
    runGit(root, ['commit', '-m', 'seed rename source']);

    runGit(root, ['mv', 'src/old.ts', 'src/new.ts']);

    const changedItems = await collectChangedItems(root, 'HEAD');
    const byPath = new Map(changedItems.map((entry) => [entry.path, entry]));

    const renamed = byPath.get('src/new.ts');
    const deleted = byPath.get('src/old.ts');

    assert.equal(byPath.size, 2);
    assert.ok(renamed);
    assert.ok(deleted);

    assert.equal(renamed.type, 'renamed');
    assert.equal(renamed.sourcePath, 'src/old.ts');
    assert.equal(renamed.destinationPath, 'src/new.ts');

    assert.equal(deleted.type, 'deleted');
    assert.equal(deleted.path, 'src/old.ts');

    assert.equal(changedItems[0]?.path < changedItems[1]?.path, true);
  } finally {
    await cleanupRoot(root);
  }
});
