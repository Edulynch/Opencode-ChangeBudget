import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readJsonFile,
  readJsonFileOptional,
  writeJsonFileAtomic,
} from '../../src/core/state/state.js';
import { IOStateError } from '../../src/models/errors.js';

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

const ATOMIC_ORIGINAL = {
  schema_version: '1.0.0',
  lifecycle_state: 'closed',
  active_contract_id: null,
  last_closed_contract_id: 'contract-prev',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const ATOMIC_REPLACEMENT = {
  schema_version: '1.0.0',
  lifecycle_state: 'initialized',
  active_contract_id: null,
  last_closed_contract_id: null,
  updated_at: '2026-02-01T00:00:00.000Z',
};

type SimulatedRenameFailure = 'EPERM' | 'EEXIST' | 'EACCES' | null;

interface AtomicWriteCase {
  name: string;
  failures: SimulatedRenameFailure[];
  expectsSuccess: boolean;
  expectedAttempts: number;
}

const ATOMIC_WRITE_CASES: AtomicWriteCase[] = [
  { name: 'first-try success', failures: [null], expectsSuccess: true, expectedAttempts: 1 },
  { name: 'transient EPERM succeeds on retry', failures: ['EPERM', null], expectsSuccess: true, expectedAttempts: 2 },
  { name: 'transient EEXIST succeeds on retry', failures: ['EEXIST', null], expectsSuccess: true, expectedAttempts: 2 },
  { name: 'persistent EPERM fails cleanly', failures: ['EPERM'], expectsSuccess: false, expectedAttempts: 3 },
  { name: 'persistent EEXIST fails cleanly', failures: ['EEXIST'], expectsSuccess: false, expectedAttempts: 3 },
  { name: 'non-retryable error fails cleanly', failures: ['EACCES'], expectsSuccess: false, expectedAttempts: 1 },
];

test('writeJsonFileAtomic is non-destructive and retries transient lock errors', async () => {
  for (const tc of ATOMIC_WRITE_CASES) {
    const root = await mkdtemp(join(tmpdir(), 'cb-state-'));
    const target = join(root, 'state.json');

    try {
      await writeFile(target, `${JSON.stringify(ATOMIC_ORIGINAL, null, 2)}\n`);
      const originalBytes = await readFile(target, 'utf8');

      const attempts: Array<{ to: string; destinationExists: boolean }> = [];
      const renameImpl = async (from: string, to: string): Promise<void> => {
        attempts.push({ to, destinationExists: existsSync(to) });
        const failure = tc.failures[Math.min(attempts.length - 1, tc.failures.length - 1)];
        if (failure) {
          const error = new Error(`simulated rename failure ${failure}`) as NodeJS.ErrnoException;
          error.code = failure;
          throw error;
        }

        await rename(from, to);
      };

      const options = { renameImpl, retryDelayMs: () => 0, maxRenameAttempts: 3 };

      if (tc.expectsSuccess) {
        await writeJsonFileAtomic(target, ATOMIC_REPLACEMENT, options);
        assert.equal(attempts.length, tc.expectedAttempts, `${tc.name}: rename attempt count`);
        const after = await readFile(target, 'utf8');
        assert.deepEqual(JSON.parse(after), ATOMIC_REPLACEMENT, `${tc.name}: replaced content`);
      } else {
        await assert.rejects(
          () => writeJsonFileAtomic(target, ATOMIC_REPLACEMENT, options),
          (error: unknown) => {
            assert.equal(error instanceof IOStateError, true, `${tc.name}: IOStateError type`);
            return true;
          },
        );
        assert.equal(attempts.length, tc.expectedAttempts, `${tc.name}: rename attempt count`);
        assert.equal(await readFile(target, 'utf8'), originalBytes, `${tc.name}: previous file byte-identical`);
      }

      assert.equal(
        attempts.every((attempt) => attempt.destinationExists),
        true,
        `${tc.name}: destination existed before every rename attempt (no delete-before-rename)`,
      );

      const tempLeftovers = (await readdir(root)).filter((entry) => entry.endsWith('.tmp'));
      assert.deepEqual(tempLeftovers, [], `${tc.name}: temporary artifact cleaned up`);
    } finally {
      await cleanupRoot(root);
    }
  }
});
