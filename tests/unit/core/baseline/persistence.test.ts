import * as assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { activateBaseline } from '../../../../src/core/baseline/activate.js';
import { createEvidenceDescriptor } from '../../../../src/core/baseline/integrity.js';
import { removeIncompleteBaselineActivation } from '../../../../src/core/state/contracts.js';
import { getContractFilePath, initializeLifecycleState, persistBaselineEvidence, readBaselineEvidence, readJsonFile, readLifecycleState } from '../../../../src/core/state/state.js';

test('activation rejects a stale lifecycle token before replacing the active pointer', async () => {
  const evidence = createEvidenceDescriptor({
    schemaVersion: 1,
    contractId: 'contract-next',
    activationHead: '0123456789012345678901234567890123456789',
    entries: [],
  });
  const expectedState = {
    schema_version: '1.1.7',
    lifecycle_state: 'initialized' as const,
    active_contract_id: null,
    last_closed_contract_id: null,
    updated_at: '2026-08-24T00:00:00.000Z',
  };
  const newerState = {
    ...expectedState,
    lifecycle_state: 'active' as const,
    active_contract_id: 'contract-newer',
    updated_at: '2026-08-24T00:00:01.000Z',
  };

  await assert.rejects(
    () => activateBaseline({
      expectedState,
      contractId: 'contract-next',
      evidence,
      readState: async () => newerState,
      writeState: async () => assert.fail('activation must not overwrite a newer pointer'),
      verify: async () => true,
    }),
    { name: 'StateConflictError' },
  );
});

test('activation cleanup removes persisted evidence and an inactive contract without activating state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-baseline-cleanup-'));
  const contractId = 'contract-incomplete';
  const evidence = createEvidenceDescriptor({
    schemaVersion: 1,
    contractId,
    activationHead: '0123456789012345678901234567890123456789',
    entries: [],
  });
  try {
    const state = await initializeLifecycleState(root);
    await writeFile(getContractFilePath(root, contractId), '{}', 'utf8');
    await persistBaselineEvidence(root, evidence);
    await removeIncompleteBaselineActivation(root, contractId);

    assert.equal((await readLifecycleState(root))?.active_contract_id, state.state.active_contract_id);
    assert.equal(await readBaselineEvidence(root, contractId), null);
    await assert.rejects(() => readJsonFile(getContractFilePath(root, contractId)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
