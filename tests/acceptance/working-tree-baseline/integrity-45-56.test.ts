import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEvidenceDescriptor } from '../../../src/core/baseline/integrity.js';
import { validateBaselineEvidence } from '../../../src/core/baseline/validation.js';

const head = '0123456789012345678901234567890123456789';
const contract = { id: 'contract', comparison_mode: 'baseline' as const, baseline_ref: 'baselines/contract.json', activation_head: head };
const entry = { path: 'file.txt', objectType: 'file' as const, mode: '100644', size: 5, contentDigest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', payload: 'aGVsbG8=', observation: { tracked: false, staged: false, unstaged: false, untracked: true, deleted: false, renamed: false, copied: false, isBinary: false } };
const valid = createEvidenceDescriptor({ schemaVersion: 1, contractId: contract.id, activationHead: head, entries: [entry] });

const cases = [
  [45, { ...contract, baseline_ref: null }, valid, 'BASELINE_REQUIRED_MISSING'],
  [46, contract, { ...valid, integrity: 'missing-artifact-simulated' }, 'BASELINE_CORRUPT'],
  [47, contract, createEvidenceDescriptor({ ...valid, contractId: 'other' }), 'BASELINE_MISMATCH'],
  [48, contract, createEvidenceDescriptor({ ...valid, entries: [{ ...entry, payload: null }] }), 'BASELINE_REQUIRED_MISSING'],
  [49, contract, { ...valid, integrity: 'tampered' }, 'BASELINE_CORRUPT'],
  [50, contract, createEvidenceDescriptor({ ...valid, entries: [entry, entry] }), 'BASELINE_PATH_AMBIGUITY'],
  [51, contract, createEvidenceDescriptor({ ...valid, entries: [{ ...entry, path: '../bad' }] }), 'BASELINE_PATH_AMBIGUITY'],
  [52, contract, createEvidenceDescriptor({ ...valid, activationHead: 'different' }), 'BASELINE_MISMATCH'],
  [53, contract, createEvidenceDescriptor({ ...valid, schemaVersion: 2 }), 'BASELINE_UNSUPPORTED'],
  [54, contract, createEvidenceDescriptor({ ...valid, entries: [{ ...entry, objectType: 'other' as const }] }), 'BASELINE_UNSUPPORTED'],
  [55, contract, { ...valid, integrity: '{broken' }, 'BASELINE_CORRUPT'],
  [56, contract, createEvidenceDescriptor({ ...valid, entries: [{ ...entry, payload: null }] }), 'BASELINE_REQUIRED_MISSING'],
] as const;

for (const [scenario, candidate, evidence, reason] of cases) {
  test(`T039: scenario ${scenario} remains baseline-mode human review`, () => {
    const result = validateBaselineEvidence(candidate, evidence, { repositoryCase: 'sensitive', platformCase: 'sensitive' });
    assert.equal(result.comparisonMode, 'baseline');
    assert.notEqual(result.baselineState, 'legacy');
    assert.equal(result.decision, 'HUMAN_REVIEW');
    assert.deepEqual(result.reasonCodes, [reason]);
  });
}
