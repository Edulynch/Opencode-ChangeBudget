import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEvidenceDescriptor, verifyEvidenceDescriptor } from '../../../../src/core/baseline/integrity.js';

test('integrity digest is deterministic and rejects tampered descriptors', () => {
  const evidence = createEvidenceDescriptor({ schemaVersion: 1, contractId: 'contract', activationHead: '0123456789012345678901234567890123456789', entries: [] });
  assert.equal(verifyEvidenceDescriptor(evidence).evidenceState, 'valid');
  assert.equal(verifyEvidenceDescriptor({ ...evidence, contractId: 'other' }).evidenceState, 'corrupt');
});
