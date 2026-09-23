import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  MANAGED_RESOURCES,
  WRAPPER_MARKER,
  discoverManagedIntegration,
  generateWrapperContent,
  resolveChangeBudgetRoot,
  runtimeGuardFileUrl,
} from '../../src/core/integration/opencode.js';

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cb-v2-discovery-'));
}

async function writeWrapper(root: string, content: string): Promise<void> {
  const path = join(root, MANAGED_RESOURCES.pluginWrapper);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, 'utf8');
}

test('discovery reports ABSENT when no managed V2 wrapper exists', async () => {
  const root = await fixture();
  try {
    assert.deepEqual(await discoverManagedIntegration(root, resolveChangeBudgetRoot()), { state: 'ABSENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovery reports MANAGED_CURRENT for the exact wrapper', async () => {
  const root = await fixture();
  try {
    await writeWrapper(root, generateWrapperContent(runtimeGuardFileUrl(resolveChangeBudgetRoot())));
    assert.deepEqual(await discoverManagedIntegration(root, resolveChangeBudgetRoot()), { state: 'MANAGED_CURRENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovery reports MANAGED_STALE for a marked wrapper with an old runtime URL', async () => {
  const root = await fixture();
  try {
    await writeWrapper(root, `${WRAPPER_MARKER}\nexport { default } from "file:///old/runtime.js";\n`);
    assert.deepEqual(await discoverManagedIntegration(root, resolveChangeBudgetRoot()), { state: 'MANAGED_STALE' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('discovery reports CONFLICT for a user-owned wrapper', async () => {
  const root = await fixture();
  try {
    await writeWrapper(root, '// user-owned\n');
    assert.deepEqual(await discoverManagedIntegration(root, resolveChangeBudgetRoot()), { state: 'CONFLICT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
