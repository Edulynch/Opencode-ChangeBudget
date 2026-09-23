import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

import {
  MANAGED_RESOURCES,
  WRAPPER_MARKER,
  detectOwnership,
  detectOwnershipForRemoval,
  generateWrapperContent,
  resolveChangeBudgetRoot,
} from '../../src/core/integration/opencode.js';

test('the wrapper ownership check requires an exact first line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-v2-regression-'));
  try {
    const path = join(root, 'wrapper.js');
    const expected = generateWrapperContent('file:///runtime.js');
    await writeFile(path, `${WRAPPER_MARKER}x\n${expected.split('\n').slice(1).join('\n')}`, 'utf8');
    assert.equal(await detectOwnership(path, WRAPPER_MARKER, expected), 'CONFLICT');
    assert.equal(await detectOwnershipForRemoval(path, WRAPPER_MARKER), 'CONFLICT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the managed path remains project-local and singular', () => {
  assert.deepEqual(MANAGED_RESOURCES, { pluginWrapper: '.opencode/plugins/changebudget.js' });
  assert.equal(resolveChangeBudgetRoot().length > 0, true);
});

test('a marked stale wrapper remains removable without a compatibility state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-v2-regression-removal-'));
  try {
    const path = join(root, MANAGED_RESOURCES.pluginWrapper);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${WRAPPER_MARKER}\nexport default {};\n`, 'utf8');
    assert.equal(await detectOwnershipForRemoval(path, WRAPPER_MARKER), 'MANAGED_CURRENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
