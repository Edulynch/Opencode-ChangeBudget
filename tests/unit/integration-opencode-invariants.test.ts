import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  MANAGED_RESOURCES,
  OWNERSHIP_MARKER,
  WRAPPER_MARKER,
  generateWrapperContent,
} from '../../src/core/integration/opencode.js';

test('V2 integration has no instruction-file or opencode.json resource', () => {
  assert.deepEqual(Object.keys(MANAGED_RESOURCES), ['pluginWrapper']);
  assert.equal('instructions' in MANAGED_RESOURCES, false);
  assert.equal('opencodeConfig' in MANAGED_RESOURCES, false);
});

test('the managed wrapper marker is the first and exact line', () => {
  const content = generateWrapperContent('file:///runtime.js');
  assert.equal(content.split('\n')[0], WRAPPER_MARKER);
  assert.equal(WRAPPER_MARKER.includes(OWNERSHIP_MARKER), true);
  assert.equal(content.includes('.opencode/instructions'), false);
  assert.equal(content.includes('opencode.json'), false);
});

test('the managed wrapper contains only the native plugin re-export', () => {
  const content = generateWrapperContent('file:///runtime.js');
  assert.equal(content.trim().split('\n').length, 2);
  assert.match(content, /export \{ default \} from "file:\/\/\/runtime\.js";/);
});
