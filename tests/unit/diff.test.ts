import * as assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { collectChangedItems, parseNameStatusZOutput, parseNumstatZOutput } from '../../src/core/check/diff.js';
import { GitOutputError } from '../../src/models/errors.js';

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

test('collectChangedItems counts staged-then-modified files once against base', async () => {
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
    assert.equal(item.addedLines, 2);
    assert.equal(item.removedLines, 0);
    assert.equal(item.staged, true);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems counts a staged-only change once against base', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/only.ts', 'one\n');
    runGit(root, ['add', 'src/only.ts']);
    runGit(root, ['commit', '-m', 'seed staged-only']);

    await writeSourceFile(root, 'src/only.ts', 'one\ntwo\n');
    runGit(root, ['add', 'src/only.ts']);

    const changedItems = await collectChangedItems(root, 'HEAD');
    assert.equal(changedItems.length, 1);

    const item = changedItems[0];
    assert.equal(item.path, 'src/only.ts');
    assert.equal(item.type, 'modified');
    assert.equal(item.addedLines, 1);
    assert.equal(item.removedLines, 0);
    assert.equal(item.staged, true);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems counts a worktree-only change and leaves it unstaged', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/only.ts', 'one\n');
    runGit(root, ['add', 'src/only.ts']);
    runGit(root, ['commit', '-m', 'seed unstaged']);

    await writeSourceFile(root, 'src/only.ts', 'one\ntwo\n');

    const changedItems = await collectChangedItems(root, 'HEAD');
    assert.equal(changedItems.length, 1);

    const item = changedItems[0];
    assert.equal(item.path, 'src/only.ts');
    assert.equal(item.addedLines, 1);
    assert.equal(item.removedLines, 0);
    assert.equal(item.staged, false);
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

test('collectChangedItems represents a directory rename as per-file renames without phantom paths', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeSourceFile(root, 'src/old/inner.ts', 'inner\n');
    runGit(root, ['add', 'src/old/inner.ts']);
    runGit(root, ['commit', '-m', 'seed directory']);

    runGit(root, ['mv', 'src/old', 'src/new']);

    const changedItems = await collectChangedItems(root, 'HEAD');
    const renamed = changedItems.find((entry) => entry.path === 'src/new/inner.ts');
    const deleted = changedItems.find((entry) => entry.path === 'src/old/inner.ts');

    assert.equal(changedItems.length, 2);
    assert.ok(renamed);
    assert.equal(renamed.type, 'renamed');
    assert.equal(renamed.sourcePath, 'src/old/inner.ts');
    assert.equal(renamed.destinationPath, 'src/new/inner.ts');
    assert.equal(renamed.staged, true);
    assert.ok(deleted);
    assert.equal(deleted.type, 'deleted');
    assert.equal(deleted.path, 'src/old/inner.ts');
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems reports canonical line counts for a rename with modifications', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const seedLines = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n');
    await writeSourceFile(root, 'src/origin.ts', `${seedLines}\n`);
    runGit(root, ['add', 'src/origin.ts']);
    runGit(root, ['commit', '-m', 'seed rename source']);

    runGit(root, ['mv', 'src/origin.ts', 'src/target.ts']);
    await writeSourceFile(root, 'src/target.ts', `${seedLines}\nadded after rename\n`);

    const changedItems = await collectChangedItems(root, 'HEAD');
    const renamed = changedItems.find((entry) => entry.path === 'src/target.ts');
    const deleted = changedItems.find((entry) => entry.path === 'src/origin.ts');

    assert.equal(changedItems.length, 2);
    assert.ok(renamed);
    assert.equal(renamed.type, 'renamed');
    assert.equal(renamed.sourcePath, 'src/origin.ts');
    assert.equal(renamed.destinationPath, 'src/target.ts');
    assert.equal(renamed.addedLines, 1);
    assert.equal(renamed.removedLines, 0);
    assert.equal(renamed.staged, true);
    assert.ok(deleted);
    assert.equal(deleted.type, 'deleted');
    assert.equal(deleted.addedLines, 1);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems classifies a binary rename without line counts', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeBinaryFile(root, 'assets/old.bin', [0x89, 0x50, 0x4e, 0x47, 0x00, 0x1a]);
    runGit(root, ['add', 'assets/old.bin']);
    runGit(root, ['commit', '-m', 'seed binary']);

    runGit(root, ['mv', 'assets/old.bin', 'assets/new.bin']);

    const changedItems = await collectChangedItems(root, 'HEAD');
    const renamed = changedItems.find((entry) => entry.path === 'assets/new.bin');
    const deleted = changedItems.find((entry) => entry.path === 'assets/old.bin');

    assert.equal(changedItems.length, 2);
    assert.ok(renamed);
    assert.equal(renamed.type, 'renamed');
    assert.equal(renamed.isBinary, true);
    assert.equal(renamed.addedLines, 0);
    assert.equal(renamed.removedLines, 0);
    assert.ok(deleted);
    assert.equal(deleted.type, 'deleted');
    assert.equal(deleted.isBinary, true);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems detects untracked binary files from numstat columns across exit codes', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeBinaryFile(root, 'vendor/blob.bin', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00, 0x1a]);
    await writeSourceFile(root, 'src/text.txt', 'plain text with tabs\tand content\n');
    await writeFile(join(root, 'src/empty.txt'), '');

    const changedItems = await collectChangedItems(root, 'HEAD');
    const binary = changedItems.find((entry) => entry.path === 'vendor/blob.bin');
    const text = changedItems.find((entry) => entry.path === 'src/text.txt');
    const empty = changedItems.find((entry) => entry.path === 'src/empty.txt');

    assert.ok(binary);
    assert.equal(binary.isBinary, true);
    assert.equal(binary.type, 'added');
    assert.equal(binary.addedLines, 0);
    assert.equal(binary.removedLines, 0);
    assert.ok(text);
    assert.equal(text.isBinary, false);
    assert.ok(empty);
    assert.equal(empty.isBinary, false);
  } finally {
    await cleanupRoot(root);
  }
});

test('collectChangedItems orders non-ASCII paths by code units', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await Promise.all([
      writeSourceFile(root, 'src/ä.ts', 'ae\n'),
      writeSourceFile(root, 'src/z.ts', 'zed\n'),
      writeSourceFile(root, 'src/æ.ts', 'ash\n'),
    ]);

    const changedItems = await collectChangedItems(root, 'HEAD');
    const paths = changedItems.map((entry) => entry.path);

    assert.deepEqual(paths, ['src/z.ts', 'src/ä.ts', 'src/æ.ts']);
  } finally {
    await cleanupRoot(root);
  }
});

test('parseNameStatusZOutput parses ordinary and rename records strictly', () => {
  const records = parseNameStatusZOutput('M\0src/app.ts\0R100\0lib/old.txt\0lib/new.txt\0');

  assert.deepEqual(records, [
    { type: 'modified', path: 'src/app.ts' },
    {
      type: 'renamed',
      path: 'lib/new.txt',
      sourcePath: 'lib/old.txt',
      destinationPath: 'lib/new.txt',
    },
  ]);
});

test('parseNameStatusZOutput preserves literal newline, tab, and non-ASCII paths', () => {
  const records = parseNameStatusZOutput('A\0weird\nname.ts\0M\0src/café/naïve.ts\0D\0tab\tname.ts\0');

  assert.deepEqual(records, [
    { type: 'added', path: 'weird\nname.ts' },
    { type: 'modified', path: 'src/café/naïve.ts' },
    { type: 'deleted', path: 'tab\tname.ts' },
  ]);
});

test('parseNameStatusZOutput does not split literal => inside paths', () => {
  const records = parseNameStatusZOutput('M\0a => b.ts\0R100\0src/old => processed.ts\0src/new.ts\0');

  assert.deepEqual(records, [
    { type: 'modified', path: 'a => b.ts' },
    {
      type: 'renamed',
      path: 'src/new.ts',
      sourcePath: 'src/old => processed.ts',
      destinationPath: 'src/new.ts',
    },
  ]);
});

test('parseNameStatusZOutput raises GitOutputError for truncated ordinary records', () => {
  assert.throws(() => parseNameStatusZOutput('M\0'), (error: unknown) => {
    assert.ok(error instanceof GitOutputError);
    assert.equal((error as GitOutputError).category, 'GIT_ENVIRONMENT');
    return true;
  });
});

test('parseNameStatusZOutput raises GitOutputError for truncated rename records', () => {
  assert.throws(() => parseNameStatusZOutput('R100\0src/old.txt\0'), (error: unknown) => {
    assert.ok(error instanceof GitOutputError);
    return true;
  });
});

test('parseNameStatusZOutput raises GitOutputError for unknown status tokens', () => {
  assert.throws(() => parseNameStatusZOutput('Z100\0src/app.ts\0'), (error: unknown) => {
    assert.ok(error instanceof GitOutputError);
    return true;
  });
});

test('parseNumstatZOutput parses ordinary, binary, and rename records', () => {
  const lookup = parseNumstatZOutput('5\t3\tsrc/app.ts\0-\t-\tassets/img.bin\x002\t0\t\0lib/old.txt\0lib/new.txt\0');

  assert.deepEqual(lookup.byPath.get('src/app.ts'), {
    path: 'src/app.ts',
    added: 5,
    removed: 3,
    isBinary: false,
  });
  assert.deepEqual(lookup.byPath.get('assets/img.bin'), {
    path: 'assets/img.bin',
    added: 0,
    removed: 0,
    isBinary: true,
  });

  const renamed = lookup.byRenameDestination.get('lib/new.txt');
  assert.ok(renamed);
  assert.deepEqual(renamed, {
    path: 'lib/new.txt',
    sourcePath: 'lib/old.txt',
    destinationPath: 'lib/new.txt',
    added: 2,
    removed: 0,
    isBinary: false,
  });
  assert.equal(lookup.byRenameSource.get('lib/old.txt'), renamed);
});

test('parseNumstatZOutput preserves literal => and tab inside paths', () => {
  const lookup = parseNumstatZOutput('1\t1\tfoo => bar.txt\x001\t1\ttab\tname.ts\0');

  assert.deepEqual(lookup.byPath.get('foo => bar.txt'), {
    path: 'foo => bar.txt',
    added: 1,
    removed: 1,
    isBinary: false,
  });
  assert.deepEqual(lookup.byPath.get('tab\tname.ts'), {
    path: 'tab\tname.ts',
    added: 1,
    removed: 1,
    isBinary: false,
  });
});

test('parseNumstatZOutput handles binary rename columns', () => {
  const lookup = parseNumstatZOutput('-\t-\t\0lib/old.bin\0lib/new.bin\0');

  const record = lookup.byRenameDestination.get('lib/new.bin');
  assert.ok(record);
  assert.equal(record.sourcePath, 'lib/old.bin');
  assert.equal(record.destinationPath, 'lib/new.bin');
  assert.equal(record.isBinary, true);
  assert.equal(record.added, 0);
  assert.equal(record.removed, 0);
});

test('parseNumstatZOutput raises GitOutputError for truncated rename records', () => {
  assert.throws(() => parseNumstatZOutput('5\t3\t\0src/old.ts\0'), (error: unknown) => {
    assert.ok(error instanceof GitOutputError);
    return true;
  });
});

test('parseNumstatZOutput raises GitOutputError for non-numeric columns', () => {
  assert.throws(() => parseNumstatZOutput('abc\t2\tpath.ts\0'), (error: unknown) => {
    assert.ok(error instanceof GitOutputError);
    return true;
  });
});
