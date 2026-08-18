import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  ensureGitRepository,
  getRepositoryRoot,
  isGitRepository,
  runGit,
  validateRevision,
} from '../../src/core/git/repo.js';
import { GitEnvironmentError } from '../../src/models/errors.js';

function runGitSync(root: string, args: string[]): string {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }

  return (result.stdout ?? '').trim();
}

async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

// F-M13: empty repository (no commits) is recognized as a git repo but HEAD cannot resolve.
test('F-M13: empty repository is a git repository but HEAD revision is invalid', async () => {
  const root = await createTempDir('cb-git-repo-empty-');

  try {
    runGitSync(root, ['init']);
    runGitSync(root, ['config', 'user.name', 'test']);
    runGitSync(root, ['config', 'user.email', 'test@test']);

    assert.equal(await isGitRepository(root), true);

    const repoRoot = await getRepositoryRoot(root);
    assert.ok(repoRoot.length > 0);

    // HEAD does not resolve to a commit in an empty repo.
    assert.equal(await validateRevision(root, 'HEAD'), false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

// F-M13: ensureGitRepository succeeds on an empty (but initialized) repo.
test('F-M13: ensureGitRepository succeeds for an initialized empty repository', async () => {
  const root = await createTempDir('cb-git-repo-ensure-');

  try {
    runGitSync(root, ['init']);

    const resolved = await ensureGitRepository(root);
    assert.ok(resolved.length > 0);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

// F-M13: detached HEAD with a valid base revision behaves identically to the branch case.
test('F-M13: detached HEAD with a valid commit resolves revision identically to branch case', async () => {
  const root = await createTempDir('cb-git-repo-detached-');

  try {
    runGitSync(root, ['init']);
    runGitSync(root, ['config', 'user.name', 'test']);
    runGitSync(root, ['config', 'user.email', 'test@test']);
    runGitSync(root, ['commit', '--allow-empty', '-m', 'seed']);

    const commitHash = runGitSync(root, ['rev-parse', 'HEAD']);

    // Checkout detached HEAD at the commit.
    runGitSync(root, ['checkout', '--detach', commitHash]);

    // HEAD resolves to a valid commit in detached state.
    assert.equal(await validateRevision(root, 'HEAD'), true);
    assert.equal(await validateRevision(root, commitHash), true);

    // runGit works in detached HEAD.
    const output = await runGit(root, ['rev-parse', 'HEAD']);
    assert.equal(output.trim(), commitHash);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

// F-M13: missing/invalid base revision is rejected deterministically.
test('F-M13: missing or invalid base revision is rejected deterministically', async () => {
  const root = await createTempDir('cb-git-repo-invalid-base-');

  try {
    runGitSync(root, ['init']);
    runGitSync(root, ['config', 'user.name', 'test']);
    runGitSync(root, ['config', 'user.email', 'test@test']);
    runGitSync(root, ['commit', '--allow-empty', '-m', 'seed']);

    assert.equal(await validateRevision(root, 'nonexistent-revision-xyz'), false);
    assert.equal(await validateRevision(root, ''), false);
    assert.equal(await validateRevision(root, '   '), false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

// F-M13: repository path containing spaces works correctly.
test('F-M13: repository path containing spaces works correctly', async () => {
  const parent = await createTempDir('cb-git-repo-spaces-parent-');
  const root = join(parent, 'dir with spaces');

  try {
    await mkdir(root, { recursive: true });
    runGitSync(root, ['init']);
    runGitSync(root, ['config', 'user.name', 'test']);
    runGitSync(root, ['config', 'user.email', 'test@test']);
    runGitSync(root, ['commit', '--allow-empty', '-m', 'seed']);

    assert.equal(await isGitRepository(root), true);

    const repoRoot = await getRepositoryRoot(root);
    assert.ok(repoRoot.includes('dir with spaces'));

    assert.equal(await validateRevision(root, 'HEAD'), true);

    const output = await runGit(root, ['rev-parse', '--short', 'HEAD']);
    assert.ok(output.trim().length > 0);
  } finally {
    if (existsSync(parent)) {
      await rm(parent, { recursive: true, force: true });
    }
  }
});

// F-M13: isGitRepository returns false for a non-git directory.
test('F-M13: isGitRepository returns false for a non-git directory', async () => {
  const root = await createTempDir('cb-git-repo-notgit-');

  try {
    assert.equal(await isGitRepository(root), false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

// F-M13: ensureGitRepository raises GitEnvironmentError for a non-git directory.
test('F-M13: ensureGitRepository raises GitEnvironmentError for a non-git directory', async () => {
  const root = await createTempDir('cb-git-repo-notgit-ensure-');

  try {
    await assert.rejects(
      () => ensureGitRepository(root),
      (error: unknown) => {
        assert.ok(error instanceof GitEnvironmentError);
        return true;
      },
    );
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

// F-M13: runGit raises GitEnvironmentError on a failing git command.
test('F-M13: runGit raises GitEnvironmentError on a failing command', async () => {
  const root = await createTempDir('cb-git-repo-fail-');

  try {
    runGitSync(root, ['init']);

    await assert.rejects(
      () => runGit(root, ['show', 'nonexistent']),
      (error: unknown) => {
        assert.ok(error instanceof GitEnvironmentError);
        return true;
      },
    );
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
