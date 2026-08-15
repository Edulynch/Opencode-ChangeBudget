import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { StateConflictError } from '../../src/models/errors.js';
import { LifecycleState } from '../../src/models/lifecycle-state.js';
import {
  transitionToActive,
  transitionToClosed,
  transitionToInitialized,
  isAllowedTransition,
} from '../../src/core/state/transitions.js';

function makeState(state: LifecycleState): {
  schema_version: string;
  lifecycle_state: LifecycleState;
  active_contract_id: string | null;
  last_closed_contract_id: string | null;
  updated_at: string;
} {
  return {
    schema_version: '1.0.0',
    lifecycle_state: state,
    active_contract_id: null,
    last_closed_contract_id: null,
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

test('transitionToActive updates lifecycle and active contract', () => {
  const started = transitionToActive(makeState('initialized'), 'contract-1');

  assert.equal(started.lifecycle_state, 'active');
  assert.equal(started.active_contract_id, 'contract-1');
  assert.equal(started.last_closed_contract_id, null);
});

test('transitionToActive rejects invalid source states', () => {
  assert.throws(
    () => transitionToActive(makeState('active'), 'contract-1'),
    {
      name: StateConflictError.name,
    },
  );
});

test('transitionToClosed stores last closed contract and clears active id', () => {
  const active = {
    ...makeState('active'),
    active_contract_id: 'contract-2',
  };

  const closed = transitionToClosed(active);

  assert.equal(closed.lifecycle_state, 'closed');
  assert.equal(closed.active_contract_id, null);
  assert.equal(closed.last_closed_contract_id, 'contract-2');
});

test('transitionToClosed rejects inactive states', () => {
  const state = makeState('initialized');
  assert.throws(() => transitionToClosed(state), {
    name: StateConflictError.name,
  });
});

test('transitionToInitialized can follow closed state', () => {
  const active = {
    ...makeState('active'),
    active_contract_id: 'contract-3',
  };

  const closed = transitionToClosed(active);
  const finished = transitionToInitialized(closed);

  assert.equal(finished.lifecycle_state, 'initialized');
  assert.equal(finished.last_closed_contract_id, 'contract-3');
  assert.equal(finished.active_contract_id, null);

  assert.equal(isAllowedTransition('initialized', 'active'), true);
  assert.equal(isAllowedTransition('active', 'closed'), true);
});
