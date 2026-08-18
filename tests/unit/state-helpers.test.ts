import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readJsonFile,
  readJsonFileOptional,
  writeJsonFileAtomic,
} from '../../src/core/state/state.js';

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

test('readJsonFileOptional returns null when missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-state-'));
  const target = join(root, 'missing-state.json');

  try {
    const value = await readJsonFileOptional(target);

    assert.equal(value, null);
  } finally {
    await cleanupRoot(root);
  }
});

test('writeJsonFileAtomic persists readable JSON and readJsonFile returns same data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-state-'));
  const target = join(root, 'nested', 'state.json');

  const data = {
    schema_version: '1.0.0',
    lifecycle_state: 'initialized',
    active_contract_id: null,
    last_closed_contract_id: null,
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  try {
    await writeJsonFileAtomic(target, data);

    const parsed = await readJsonFile<typeof data>(target);
    assert.deepEqual(parsed, data);

    const raw = await readFile(target, 'utf8');
    assert.ok(raw.includes('"schema_version"'));
    assert.ok(raw.endsWith('}\n'));
  } finally {
    await cleanupRoot(root);
  }
});

test('readJsonFile throws when JSON is invalid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-state-'));
  const target = join(root, 'bad.json');

  try {
    await mkdir(root, { recursive: true });
    await writeFile(target, 'not-json', 'utf8');

    await assert.rejects(() => readJsonFile(target), {
      name: 'StateCorruptionError',
    });
  } finally {
    await cleanupRoot(root);
  }
});
