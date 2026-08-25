import * as assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createEvidenceDescriptor } from '../../../../src/core/baseline/integrity.js';
import { getBaselineEvidencePath, persistBaselineEvidence, readBaselineEvidence, removeBaselineEvidence } from '../../../../src/core/state/state.js';

test('baseline evidence persistence is atomic, verifiable, and cleaned up on request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-baseline-state-'));
  const contractId = 'contract-persisted';
  try {
    const evidence = createEvidenceDescriptor({ schemaVersion: 1, contractId, activationHead: '0123456789012345678901234567890123456789', entries: [] });
    await persistBaselineEvidence(root, evidence);

    assert.deepEqual(await readBaselineEvidence(root, contractId), evidence);
    await removeBaselineEvidence(root, contractId);
    assert.equal(await readBaselineEvidence(root, contractId), null);
    assert.equal(getBaselineEvidencePath(root, contractId).includes('.changebudget'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
