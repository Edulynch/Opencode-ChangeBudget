import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { captureBaseline } from '../../../../src/core/baseline/capture.js';
import { createEvidenceDescriptor, verifyEvidenceDescriptor } from '../../../../src/core/baseline/integrity.js';
import { validateBaselineEvidence } from '../../../../src/core/baseline/validation.js';
import type { ChangeContract } from '../../../../src/models/change-contract.js';

function contract(): ChangeContract {
  return {
    schema_version: '1.1.7', id: 'contract-baseline', task_description: 'baseline', task_id: null,
    task_title: null, task_source_feature: null, task_source_path: null, base_revision: 'HEAD',
    allow_paths: [], deny_paths: [], max_files: null, max_changed_lines: null, allow_new_files: false,
    allow_new_dependencies: false, allow_migrations: false, allow_config_changes: false,
    allow_public_api_changes: false, preset: null, stack_profile: null, disabled_stack_rules: [],
    status: 'active', created_at: '2026-08-24T00:00:00.000Z', updated_at: '2026-08-24T00:00:00.000Z',
    closed_at: null, comparison_mode: 'baseline', baseline_ref: 'baselines/contract-baseline.json',
    activation_head: '0123456789012345678901234567890123456789',
  };
}

test('captureBaseline retries a changed observation and rejects exhausted TOCTOU capture', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-baseline-capture-'));
  try {
    await writeFile(join(root, 'dirty.txt'), 'before\n');
    let readCount = 0;
    const result = await captureBaseline({
      repositoryRoot: root,
      contractId: 'contract-baseline',
      activationHead: '0123456789012345678901234567890123456789',
      maxAttempts: 2,
      observe: async () => [{ path: 'dirty.txt', tracked: false, staged: false, unstaged: false, untracked: true, deleted: false, renamed: false, copied: false, isBinary: false, mode: null, objectType: 'file' }],
      afterCapture: async () => [{ path: 'dirty.txt', tracked: false, staged: false, unstaged: false, untracked: true, deleted: false, renamed: false, copied: false, isBinary: false, mode: null, objectType: 'file' }],
      readValue: async () => {
        readCount += 1;
        return { type: 'file', bytes: Buffer.from(readCount % 2 === 0 ? 'different\n' : 'before\n'), mode: null };
      },
    });

    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.reasonCode, 'BASELINE_UNSTABLE_CAPTURE');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validation and integrity reject baseline evidence tampering without legacy fallback', () => {
  const descriptor = createEvidenceDescriptor({
    schemaVersion: 1,
    contractId: 'contract-baseline',
    activationHead: '0123456789012345678901234567890123456789',
    entries: [{ path: 'dirty.txt', objectType: 'file', mode: null, size: 6, contentDigest: 'digest', payload: 'before\n', observation: { tracked: false, staged: false, unstaged: false, untracked: true, deleted: false, renamed: false, copied: false, isBinary: false } }],
  });
  const tampered = { ...descriptor, entries: [{ ...descriptor.entries[0]!, payload: 'after\n' }] };

  assert.equal(verifyEvidenceDescriptor(tampered).evidenceState, 'corrupt');
  const validation = validateBaselineEvidence(contract(), tampered, { repositoryCase: 'sensitive', platformCase: 'sensitive' });
  assert.equal(validation.decision, 'HUMAN_REVIEW');
  assert.equal(validation.comparisonMode, 'baseline');
  assert.equal(validation.reasonCodes[0], 'BASELINE_CORRUPT');
});
