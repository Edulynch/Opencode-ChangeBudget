import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { createEvidenceDescriptor } from '../../../../src/core/baseline/integrity.js';
import { validateBaselineEvidence } from '../../../../src/core/baseline/validation.js';

test('validation rejects unsupported evidence without reclassifying baseline contracts as legacy', () => {
  const contract = { id: 'contract', comparison_mode: 'baseline' as const, baseline_ref: 'baselines/contract.json', activation_head: '0123456789012345678901234567890123456789' };
  const evidence = createEvidenceDescriptor({ schemaVersion: 2, contractId: 'contract', activationHead: '0123456789012345678901234567890123456789', entries: [] });
  assert.deepEqual(validateBaselineEvidence(contract, evidence, { repositoryCase: 'sensitive', platformCase: 'sensitive' }), { comparisonMode: 'baseline', baselineState: 'incompatible', decision: 'HUMAN_REVIEW', reasonCodes: ['BASELINE_UNSUPPORTED'] });
});

test('validation maps required baseline integrity failures to deterministic human review reasons', () => {
  const head = '0123456789012345678901234567890123456789';
  const contract = { id: 'contract', comparison_mode: 'baseline' as const, baseline_ref: 'baselines/contract.json', activation_head: head };
  const entry = { path: 'file.txt', objectType: 'file' as const, mode: null, size: 5, contentDigest: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', payload: 'aGVsbG8=', observation: { tracked: false, staged: false, unstaged: false, untracked: true, deleted: false, renamed: false, copied: false, isBinary: false } };
  const valid = createEvidenceDescriptor({ schemaVersion: 1, contractId: 'contract', activationHead: head, entries: [entry] });
  const cases = [
    { label: 'missing reference', contract: { ...contract, baseline_ref: null }, evidence: valid, reason: 'BASELINE_REQUIRED_MISSING' },
    { label: 'association mismatch', contract, evidence: createEvidenceDescriptor({ ...valid, contractId: 'other' }), reason: 'BASELINE_MISMATCH' },
    { label: 'duplicate path', contract, evidence: createEvidenceDescriptor({ schemaVersion: 1, contractId: 'contract', activationHead: head, entries: [entry, entry] }), reason: 'BASELINE_PATH_AMBIGUITY' },
    { label: 'invalid path', contract, evidence: createEvidenceDescriptor({ schemaVersion: 1, contractId: 'contract', activationHead: head, entries: [{ ...entry, path: '../invalid.txt' }] }), reason: 'BASELINE_PATH_AMBIGUITY' },
    { label: 'missing payload', contract, evidence: createEvidenceDescriptor({ schemaVersion: 1, contractId: 'contract', activationHead: head, entries: [{ ...entry, payload: null }] }), reason: 'BASELINE_REQUIRED_MISSING' },
    { label: 'unsupported type', contract, evidence: createEvidenceDescriptor({ schemaVersion: 1, contractId: 'contract', activationHead: head, entries: [{ ...entry, objectType: 'other' }] }), reason: 'BASELINE_UNSUPPORTED' },
  ];
  for (const entryCase of cases) {
    const result = validateBaselineEvidence(entryCase.contract, entryCase.evidence, { repositoryCase: 'sensitive', platformCase: 'sensitive' });
    assert.equal(result.comparisonMode, 'baseline', entryCase.label);
    assert.notEqual(result.baselineState, 'legacy', entryCase.label);
    assert.equal(result.decision, 'HUMAN_REVIEW', entryCase.label);
    assert.deepEqual(result.reasonCodes, [entryCase.reason], entryCase.label);
  }
});
