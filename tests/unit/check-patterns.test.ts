import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { compilePathPattern, compilePathPatterns } from '../../src/core/check/patterns.js';
import { InputValidationError } from '../../src/models/errors.js';

test('compilePathPattern rejects empty and root-only patterns', () => {
  assert.throws(() => compilePathPattern(''), { name: InputValidationError.name });
  assert.throws(() => compilePathPattern('   '), { name: InputValidationError.name });
  assert.throws(() => compilePathPattern('/'), { name: InputValidationError.name });
});

test('compilePathPattern rejects malformed character classes', () => {
  assert.throws(() => compilePathPattern('src/['), { name: InputValidationError.name });
  assert.throws(() => compilePathPattern('src/[a\n]'), { name: InputValidationError.name });
});

test('compilePathPatterns propagates malformed pattern failures', () => {
  assert.throws(() => compilePathPatterns(['src/**/*.ts', 'src/[']), { name: InputValidationError.name });
});
