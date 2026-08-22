import * as assert from 'node:assert/strict';
import { test, afterEach, beforeEach } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { InputValidationError } from '../../src/models/errors.js';
import { getChangeBudgetRoot, getPackageJsonPath, getInstalledVersion, readPackageMetadata } from '../../src/core/package-root.js';

test('package-root module', async (t) => {
  let testDir: string;
  let originalCwd: string;

  await t.beforeEach(() => {
    originalCwd = process.cwd();
    testDir = mkdtempSync(join(tmpdir(), 'cb-pkg-root-test-'));
    process.chdir(testDir);
  });

  await t.afterEach(() => {
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
  });

  await t.test('getChangeBudgetRoot resolves to the ChangeBudget package root', () => {
    const root = getChangeBudgetRoot();
    assert.ok(root);
    assert.equal(typeof root, 'string');
  });

  await t.test('getChangeBudgetRoot is independent of current working directory', () => {
    const root1 = getChangeBudgetRoot();
    process.chdir(tmpdir());
    const root2 = getChangeBudgetRoot();
    assert.equal(root1, root2);
  });

  await t.test('getChangeBudgetRoot works with paths containing spaces', () => {
    const root = getChangeBudgetRoot();
    assert.ok(!root.includes(' '));
  });

  await t.test('getChangeBudgetRoot does not require .git directory', () => {
    const root = getChangeBudgetRoot();
    assert.ok(root);
  });

  await t.test('getPackageJsonPath returns correct path to package.json', () => {
    const path = getPackageJsonPath();
    assert.equal(path, `${getChangeBudgetRoot()}/package.json`);
  });

  await t.test('getInstalledVersion returns a valid semver-like version string', () => {
    const version = getInstalledVersion();
    assert.match(version, /^\d+\.\d+\.\d+/);
  });
});

test('readPackageMetadata failure scenarios', async (t) => {
  let fakePackageRoot: string;

  await t.beforeEach(() => {
    fakePackageRoot = mkdtempSync(join(tmpdir(), 'cb fake pkg-'));
  });

  await t.afterEach(() => {
    rmSync(fakePackageRoot, { recursive: true, force: true });
  });

  await t.test('throws InputValidationError when package.json is missing', () => {
    assert.throws(() => readPackageMetadata(fakePackageRoot), InputValidationError);
  });

  await t.test('throws InputValidationError when package.json contains invalid JSON', () => {
    writeFileSync(join(fakePackageRoot, 'package.json'), '{ not valid json }');
    assert.throws(() => readPackageMetadata(fakePackageRoot), InputValidationError);
  });

  await t.test('throws InputValidationError when version field is missing', () => {
    writeFileSync(join(fakePackageRoot, 'package.json'), JSON.stringify({ name: 'test' }));
    assert.throws(() => readPackageMetadata(fakePackageRoot), InputValidationError);
  });

  await t.test('throws InputValidationError when version field is null', () => {
    writeFileSync(join(fakePackageRoot, 'package.json'), JSON.stringify({ version: null }));
    assert.throws(() => readPackageMetadata(fakePackageRoot), InputValidationError);
  });

  await t.test('throws InputValidationError when version field is not a string', () => {
    writeFileSync(join(fakePackageRoot, 'package.json'), JSON.stringify({ version: 123 }));
    assert.throws(() => readPackageMetadata(fakePackageRoot), InputValidationError);
  });

  await t.test('throws InputValidationError when version field is empty string', () => {
    writeFileSync(join(fakePackageRoot, 'package.json'), JSON.stringify({ version: '' }));
    assert.throws(() => readPackageMetadata(fakePackageRoot), InputValidationError);
  });

  await t.test('throws InputValidationError when version field is whitespace only', () => {
    writeFileSync(join(fakePackageRoot, 'package.json'), JSON.stringify({ version: ' ' }));
    assert.throws(() => readPackageMetadata(fakePackageRoot), InputValidationError);
  });

  await t.test('returns valid version string when package.json is correct', () => {
    writeFileSync(join(fakePackageRoot, 'package.json'), JSON.stringify({ version: '2.5.1' }));
    const version = readPackageMetadata(fakePackageRoot);
    assert.equal(version, '2.5.1');
  });

  await t.test('returns valid version string with prerelease/build metadata', () => {
    writeFileSync(join(fakePackageRoot, 'package.json'), JSON.stringify({ version: '1.0.0-alpha.1+build.42' }));
    const version = readPackageMetadata(fakePackageRoot);
    assert.equal(version, '1.0.0-alpha.1+build.42');
  });
});

test('User-project package.json isolation', async (t) => {
  let userProjectDir: string;

  await t.beforeEach(() => {
    userProjectDir = mkdtempSync(join(tmpdir(), 'cb-user-project-'));
  });

  await t.afterEach(() => {
    process.chdir(tmpdir());
    rmSync(userProjectDir, { recursive: true, force: true });
  });

  await t.test('getInstalledVersion never reads user project package.json', () => {
    mkdirSync(userProjectDir, { recursive: true });
    writeFileSync(join(userProjectDir, 'package.json'), JSON.stringify({ version: '99.99.99' }));

    process.chdir(userProjectDir);
    const version = getInstalledVersion();
    assert.notEqual(version, '99.99.99');
    assert.match(version, /^\d+\.\d+\.\d+/);
  });

  await t.test('getInstalledVersion is deterministic regardless of cwd', () => {
    const v1 = getInstalledVersion();
    process.chdir(userProjectDir);
    const v2 = getInstalledVersion();
    process.chdir(tmpdir());
    const v3 = getInstalledVersion();

    assert.equal(v1, v2);
    assert.equal(v2, v3);
  });
});
