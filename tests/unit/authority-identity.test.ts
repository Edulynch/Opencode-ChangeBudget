import * as assert from 'node:assert/strict';
import { cp, lstat, mkdir, rename, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import { createTestFixtureDirectory, removeTestRepository } from '../utils/disposable-repository.js';
import { runGit } from '../../src/core/git/repo.js';
import {
  physicalIdentityFromStats,
  resolvePhysicalObjectIdentity,
  samePhysicalIdentity,
} from '../../src/core/authority/physical-identity.js';
import { resolveRepositoryBindingCandidate } from '../../src/core/authority/repository-binding.js';

function approvedTempBase(): string {
  return process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : tmpdir();
}

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function initRepository(root: string): Promise<void> {
  await mkdir(root, { recursive: true });
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'authority identity fixture']);
  git(root, ['config', 'user.email', 'authority-identity@test.invalid']);
  await writeFile(join(root, 'README.md'), 'seed\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '--quiet', '-m', 'seed']);
}

async function commonDirectory(root: string): Promise<string> {
  const commonDirectory = await runGit(root, ['rev-parse', '--git-common-dir']);
  return resolve(root, commonDirectory);
}

async function physicalIdentity(path: string): Promise<readonly [string, string]> {
  const stats = await lstat(path, { bigint: true });
  assert.equal(stats.isSymbolicLink(), false, 'candidate common directory must not be a symlink/reparse path');
  assert.equal(stats.isDirectory(), true);
  assert.notEqual(stats.dev, 0n, 'provider must expose a volume/device identity');
  assert.notEqual(stats.ino, 0n, 'provider must expose a stable file-object identity');
  return [stats.dev.toString(), stats.ino.toString()];
}

test('T005: actual Git common-dir object identity is observable across linked worktrees and ordinary changes', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-identity-');
  const main = join(root, 'main');
  const linked = join(root, 'linked');
  const copied = join(root, 'copied');
  const replacement = join(root, 'replacement.git');
  const displaced = join(root, 'displaced.git');

  try {
    await initRepository(main);
    git(main, ['worktree', 'add', '--quiet', '-b', 'authority-identity-worktree', linked]);

    const mainCommon = await commonDirectory(main);
    const linkedCommon = await commonDirectory(linked);
    const mainIdentity = await physicalIdentity(mainCommon);
    assert.deepEqual(await physicalIdentity(linkedCommon), mainIdentity,
      'linked worktrees must resolve to one physical Git common-dir object');

    await writeFile(join(main, 'README.md'), 'content changed\n', 'utf8');
    git(main, ['add', 'README.md']);
    git(main, ['commit', '--quiet', '-m', 'content change']);
    assert.deepEqual(await physicalIdentity(mainCommon), mainIdentity,
      'ordinary content and HEAD changes must not change the common-dir object identity');

    await cp(main, copied, { recursive: true, errorOnExist: true });
    assert.notDeepEqual(await physicalIdentity(await commonDirectory(copied)), mainIdentity,
      'a full repository copy must have a different physical common-dir identity');

    const beforeMoveRoot = join(root, 'movable-before');
    const afterMoveRoot = join(root, 'movable-after');
    await initRepository(beforeMoveRoot);
    const beforeMoveIdentity = await physicalIdentity(await commonDirectory(beforeMoveRoot));
    await rename(beforeMoveRoot, afterMoveRoot);
    assert.deepEqual(await physicalIdentity(await commonDirectory(afterMoveRoot)), beforeMoveIdentity,
      'a same-volume directory move must preserve the OS object identity');

    await cp(mainCommon, replacement, { recursive: true, errorOnExist: true });
    await rename(mainCommon, displaced);
    await rename(replacement, mainCommon);
    assert.notDeepEqual(await physicalIdentity(mainCommon), mainIdentity,
      'same-path replacement must not inherit the displaced directory object identity');
  } finally {
    await removeTestRepository(root);
  }
});

test('T007: repository candidate binds the physical Git common-dir object across worktrees and same-object moves only', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-g1-identity-');
  const main = join(root, 'main');
  const linked = join(root, 'linked');
  const copied = join(root, 'copied');
  const cloned = join(root, 'cloned');
  const movedBefore = join(root, 'move-before');
  const movedAfter = join(root, 'move-after');
  const displaced = join(root, 'displaced-common');
  const replacement = join(root, 'replacement-common');
  try {
    await initRepository(main);
    git(main, ['worktree', 'add', '--quiet', '-b', 'authority-g1-linked', linked]);

    const mainBinding = await resolveRepositoryBindingCandidate(main);
    const linkedBinding = await resolveRepositoryBindingCandidate(linked);
    assert.equal(mainBinding.binding_status, 'candidate-not-persisted');
    assert.equal(mainBinding.anchor_kind, 'git-common-directory-object-v1');
    assert.ok(samePhysicalIdentity(mainBinding.physical_identity, linkedBinding.physical_identity),
      'linked worktrees resolve the same physical common-directory object');

    const stable = mainBinding.physical_identity;
    await writeFile(join(main, 'README.md'), 'new ordinary content\n', 'utf8');
    git(main, ['add', 'README.md']);
    git(main, ['commit', '--quiet', '-m', 'ordinary content change']);
    assert.ok(samePhysicalIdentity(stable, (await resolveRepositoryBindingCandidate(main)).physical_identity),
      'ordinary content and HEAD changes do not change object identity');

    await cp(main, copied, { recursive: true, errorOnExist: true });
    assert.equal(samePhysicalIdentity(stable, (await resolveRepositoryBindingCandidate(copied)).physical_identity), false,
      'a copied repository and any copied locator do not inherit the original physical object identity');
    git(root, ['clone', '--quiet', main, cloned]);
    assert.equal(samePhysicalIdentity(stable, (await resolveRepositoryBindingCandidate(cloned)).physical_identity), false,
      'a Git clone has a distinct common-directory object even when its remote and contents match');

    await initRepository(movedBefore);
    const beforeMove = await resolveRepositoryBindingCandidate(movedBefore);
    await rename(movedBefore, movedAfter);
    const afterMove = await resolveRepositoryBindingCandidate(movedAfter);
    assert.ok(samePhysicalIdentity(beforeMove.physical_identity, afterMove.physical_identity),
      'a same-volume move retains the observed physical object identity');

    const commonDirectory = mainBinding.observed_common_directory;
    await cp(commonDirectory, replacement, { recursive: true, errorOnExist: true });
    await rename(commonDirectory, displaced);
    await rename(replacement, commonDirectory);
    assert.equal(samePhysicalIdentity(stable, (await resolveRepositoryBindingCandidate(main)).physical_identity), false,
      'same-path replacement has a different physical identity');
  } finally {
    await removeTestRepository(root);
  }
});

test('T007: missing objects, unreliable volume/file/generation IDs, and symlink aliases fail closed', async (context) => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-authority-g1-unreliable-');
  const repository = join(root, 'repo');
  try {
    await initRepository(repository);
    const common = await commonDirectory(repository);
    const stats = await lstat(common, { bigint: true });
    const validSample = {
      dev: stats.dev,
      ino: stats.ino,
      birthtimeNs: stats.birthtimeNs,
      is_directory: true,
      is_symbolic_link: false,
    } as const;
    assert.throws(() => physicalIdentityFromStats({ ...validSample, dev: 0n }), /volume identity/i);
    assert.throws(() => physicalIdentityFromStats({ ...validSample, ino: 0n }), /file-object identity/i);
    assert.throws(() => physicalIdentityFromStats({ ...validSample, birthtimeNs: 0n }), /generation discriminator/i);
    assert.throws(() => physicalIdentityFromStats({ ...validSample, is_symbolic_link: true }), /non-link directory/i);
    await assert.rejects(resolvePhysicalObjectIdentity(join(root, 'missing-common-dir')), /usable physical anchor identity/i);

    const alias = join(root, 'common-dir-alias');
    try {
      await symlink(common, alias, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      context.skip(`this account/filesystem cannot create a disposable symlink/reparse fixture: ${String(error)}`);
      return;
    }
    await assert.rejects(resolvePhysicalObjectIdentity(alias), /symbolic-link|reparse|ambiguous/i);
  } finally {
    await removeTestRepository(root);
  }
});
