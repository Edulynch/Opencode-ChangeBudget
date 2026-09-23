import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  MANAGED_RESOURCES,
  OWNERSHIP_MARKER,
  WRAPPER_MARKER,
  detectOwnership,
  detectOwnershipForRemoval,
  generateWrapperContent,
  inspectIntegration,
  resolveChangeBudgetRoot,
  resolveRuntimeGuardEntry,
  runtimeGuardFileUrl,
  runtimeGuardTargetExists,
} from '../../src/core/integration/opencode.js';

async function tempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeRelative(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

test('the V2 integration manages exactly one project-local plugin wrapper', () => {
  assert.deepEqual(MANAGED_RESOURCES, { pluginWrapper: '.opencode/plugins/changebudget.js' });
  assert.equal(WRAPPER_MARKER.includes(OWNERSHIP_MARKER), true);
  assert.equal(WRAPPER_MARKER.includes('changebudget integrate opencode'), true);
});

test('generateWrapperContent is deterministic and exports the V2 plugin', () => {
  const content = generateWrapperContent('file:///D:/changebudget/index.js');
  assert.equal(content, `${WRAPPER_MARKER}\nexport { default } from "file:///D:/changebudget/index.js";\n`);
  assert.equal(generateWrapperContent('file:///D:/changebudget/index.js'), content);
});

test('ownership detection distinguishes missing, current, stale, and conflicting wrappers', async () => {
  const root = await tempRoot('cb-v2-ownership-');
  try {
    const path = join(root, 'wrapper.js');
    const expected = generateWrapperContent('file:///current.js');
    assert.equal(await detectOwnership(path, WRAPPER_MARKER, expected), 'MISSING');

    await writeFile(path, expected, 'utf8');
    assert.equal(await detectOwnership(path, WRAPPER_MARKER, expected), 'MANAGED_CURRENT');

    await writeFile(path, `${WRAPPER_MARKER}\nexport { default } from "file:///old.js";\n`, 'utf8');
    assert.equal(await detectOwnership(path, WRAPPER_MARKER, expected), 'MANAGED_STALE');

    await writeFile(path, '// user-owned\n', 'utf8');
    assert.equal(await detectOwnership(path, WRAPPER_MARKER, expected), 'CONFLICT');
    assert.equal(await detectOwnershipForRemoval(path, WRAPPER_MARKER), 'CONFLICT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('removal ownership accepts a stale marked wrapper', async () => {
  const root = await tempRoot('cb-v2-removal-');
  try {
    const path = join(root, 'wrapper.js');
    await writeFile(path, `${WRAPPER_MARKER}\n// stale\n`, 'utf8');
    assert.equal(await detectOwnershipForRemoval(path, WRAPPER_MARKER), 'MANAGED_CURRENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('runtime guard resolution points at the compiled V2 plugin entry', () => {
  const root = resolveChangeBudgetRoot();
  const entry = resolveRuntimeGuardEntry(root);
  assert.equal(entry, join(root, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js'));
  assert.equal(existsSync(join(root, 'package.json')), true);
  assert.equal(fileURLToPath(runtimeGuardFileUrl(root)), entry);
});

test('runtimeGuardTargetExists is deterministic for an existing and missing root', async () => {
  const root = resolveChangeBudgetRoot();
  assert.equal(await runtimeGuardTargetExists(root), existsSync(resolveRuntimeGuardEntry(root)));
  const missingRoot = join(tmpdir(), 'cb-v2-missing-runtime-guard');
  await rm(missingRoot, { recursive: true, force: true });
  assert.equal(await runtimeGuardTargetExists(missingRoot), false);
});

test('preflight is ready with a missing wrapper when the compiled plugin exists', async () => {
  const projectRoot = await tempRoot('cb-v2-preflight-');
  try {
    const plan = await inspectIntegration(projectRoot, resolveChangeBudgetRoot());
    assert.equal(plan.runtimeGuardTargetExists, true);
    assert.equal(plan.pluginWrapper, 'MISSING');
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.readyToWrite, true);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('preflight blocks a user-owned wrapper without writing anything', async () => {
  const projectRoot = await tempRoot('cb-v2-preflight-conflict-');
  try {
    await writeRelative(projectRoot, MANAGED_RESOURCES.pluginWrapper, '// user-owned\n');
    const plan = await inspectIntegration(projectRoot, resolveChangeBudgetRoot());
    assert.equal(plan.pluginWrapper, 'CONFLICT');
    assert.deepEqual(plan.conflicts, [MANAGED_RESOURCES.pluginWrapper]);
    assert.equal(plan.readyToWrite, false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('preflight reports a missing compiled plugin as not ready', async () => {
  const projectRoot = await tempRoot('cb-v2-preflight-missing-runtime-');
  try {
    const plan = await inspectIntegration(projectRoot, join(tmpdir(), 'cb-v2-no-runtime'));
    assert.equal(plan.runtimeGuardTargetExists, false);
    assert.equal(plan.readyToWrite, false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
