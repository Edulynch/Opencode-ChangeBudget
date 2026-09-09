import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { compilePathPattern, compilePathPatterns, matchPathPattern } from '../../src/core/check/patterns.js';
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

test('matchPathPattern preserves rooted, unrooted, wildcard, and literal character class matching', () => {
  const patterns = compilePathPatterns(['/src/**/file?.[jt]s', 'docs/**', 'files/[a-z].txt']);

  assert.equal(matchPathPattern('src/nested/file1.ts', patterns), true);
  assert.equal(matchPathPattern('vendor/docs/readme.md', patterns), true);
  assert.equal(matchPathPattern('files/-.txt', patterns), true);
  assert.equal(matchPathPattern('files/m.txt', patterns), false);
});

test('matchPathPattern evaluates overlapping globstars without executing the compiled regex', () => {
  const [compiled] = compilePathPatterns([`${'**a'.repeat(24)}!`]);
  assert.ok(compiled);
  Object.defineProperty(compiled.regex, 'test', {
    value: (): never => {
      throw new Error('matchPathPattern must not execute compiled regexes');
    },
  });

  assert.equal(matchPathPattern('a'.repeat(96), [compiled]), false);
});
