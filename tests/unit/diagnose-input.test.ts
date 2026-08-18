import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseDiagnoseArgs } from '../../src/cli/parsers/diagnose-input.js';
import { DiagnoseInput } from '../../src/models/diagnose.js';
import { InputValidationError } from '../../src/models/errors.js';

const EMPTY: DiagnoseInput = {
  task_id: null,
  task_description: null,
  allow_paths: [],
  deny_paths: [],
  stack_profile: null,
  json: false,
};

test('T008: no arguments parse to all-defaults', () => {
  assert.deepEqual(parseDiagnoseArgs([]), EMPTY);
});

test('T008: flag surfaces and aliases are parsed deterministically', () => {
  assert.deepEqual(parseDiagnoseArgs(['--task', 'Refactor auth']), {
    ...EMPTY,
    task_description: 'Refactor auth',
  });
  assert.deepEqual(parseDiagnoseArgs(['--task-description', 'Refactor auth']), {
    ...EMPTY,
    task_description: 'Refactor auth',
  });
  assert.deepEqual(parseDiagnoseArgs(['--task=Refactor auth']), {
    ...EMPTY,
    task_description: 'Refactor auth',
  });

  assert.deepEqual(parseDiagnoseArgs(['--allow-path', 'src/ui/**']), {
    ...EMPTY,
    allow_paths: ['src/ui/**'],
  });
  assert.deepEqual(parseDiagnoseArgs(['--allow-paths', 'src/ui/**']), {
    ...EMPTY,
    allow_paths: ['src/ui/**'],
  });
  assert.deepEqual(parseDiagnoseArgs(['--allow-path', 'src/ui/**', '--allow-paths', 'tests/ui/**']), {
    ...EMPTY,
    allow_paths: ['src/ui/**', 'tests/ui/**'],
  });

  assert.deepEqual(parseDiagnoseArgs(['--deny-path', 'src/legacy/**']), {
    ...EMPTY,
    deny_paths: ['src/legacy/**'],
  });
  assert.deepEqual(parseDiagnoseArgs(['--deny-paths', 'src/legacy/**', '--deny-path', 'tmp/**']), {
    ...EMPTY,
    deny_paths: ['src/legacy/**', 'tmp/**'],
  });

  assert.deepEqual(parseDiagnoseArgs(['--allow-path=src/ui/**', '--deny-path=tmp/**']), {
    ...EMPTY,
    allow_paths: ['src/ui/**'],
    deny_paths: ['tmp/**'],
  });
});

test('T008: stack profiles are validated against SPEC-005 profiles', () => {
  for (const profile of ['android', 'flutter', 'spring-boot', 'node-ts']) {
    assert.deepEqual(parseDiagnoseArgs(['--stack-profile', profile]), {
      ...EMPTY,
      stack_profile: profile,
    });
  }

  assert.deepEqual(parseDiagnoseArgs(['--stack-profile', 'NODE-TS']), {
    ...EMPTY,
    stack_profile: 'node-ts',
  });

  for (const invalid of ['swift', 'react', 'unknown']) {
    assert.throws(
      () => parseDiagnoseArgs(['--stack-profile', invalid]),
      (error: unknown) => error instanceof InputValidationError,
      `expected rejection for --stack-profile ${invalid}`,
    );
  }
});

test('T008: --json forms are parsed', () => {
  assert.deepEqual(parseDiagnoseArgs(['--json']), { ...EMPTY, json: true });
  assert.deepEqual(parseDiagnoseArgs(['--json=true']), { ...EMPTY, json: true });
  assert.deepEqual(parseDiagnoseArgs(['--json=false']), { ...EMPTY, json: false });
});

test('T008: budget flags are rejected as advisory-only', () => {
  for (const flag of ['--preset', '--preset=tiny', '--tiny', '--normal', '--free', '--custom']) {
    assert.throws(
      () => parseDiagnoseArgs([flag]),
      (error: unknown) => error instanceof InputValidationError,
      `expected rejection for ${flag}`,
    );
  }
});

test('T008: unknown flags and unexpected positionals are rejected', () => {
  for (const args of [['--nope'], ['positional'], ['--task', 'x', 'extra'], ['--json', '--bogus']]) {
    assert.throws(
      () => parseDiagnoseArgs(args),
      (error: unknown) => error instanceof InputValidationError,
      `expected rejection for ${args.join(' ')}`,
    );
  }
});

test('T014: one optional positional TASK_ID is accepted and canonicalized to uppercase', () => {
  assert.deepEqual(parseDiagnoseArgs(['T031']), { ...EMPTY, task_id: 'T031' });
  assert.deepEqual(parseDiagnoseArgs(['t031']), { ...EMPTY, task_id: 'T031' });
  assert.deepEqual(parseDiagnoseArgs(['t004']), { ...EMPTY, task_id: 'T004' });
  assert.deepEqual(parseDiagnoseArgs(['T012345']), { ...EMPTY, task_id: 'T012345' });
});

test('T014: TASK_ID combines with flags without losing fields', () => {
  const result = parseDiagnoseArgs([
    't031',
    '--task',
    'Wire up auth',
    '--allow-path',
    'src/auth/**',
    '--stack-profile',
    'node-ts',
  ]);

  assert.deepEqual(result, {
    task_id: 'T031',
    task_description: 'Wire up auth',
    allow_paths: ['src/auth/**'],
    deny_paths: [],
    stack_profile: 'node-ts',
    json: false,
  });
});

test('T014: a second positional, a malformed positional, and task-id-looking words are rejected', () => {
  for (const args of [
    ['T031', 'T032'],
    ['T031', 'positional'],
    ['T031', '--allow-path', 'src/ui/**', 'extra'],
    ['abc'],
    ['T31'],
  ]) {
    assert.throws(
      () => parseDiagnoseArgs(args),
      (error: unknown) => error instanceof InputValidationError,
      `expected rejection for ${args.join(' ')}`,
    );
  }
});

test('T014: positional TASK_ID is stored separately from --task prose', () => {
  const result = parseDiagnoseArgs(['T031', '--task', 'Different prose']);
  assert.equal(result.task_id, 'T031');
  assert.equal(result.task_description, 'Different prose');
});

test('T008: missing values and empty inline values are rejected', () => {
  assert.throws(() => parseDiagnoseArgs(['--task']), (error: unknown) => error instanceof InputValidationError);
  assert.throws(() => parseDiagnoseArgs(['--allow-path']), (error: unknown) => error instanceof InputValidationError);
  assert.throws(() => parseDiagnoseArgs(['--task=', 'x']), (error: unknown) => error instanceof InputValidationError);
  assert.throws(() => parseDiagnoseArgs(['--stack-profile=']), (error: unknown) => error instanceof InputValidationError);
  assert.throws(() => parseDiagnoseArgs(['--json=maybe']), (error: unknown) => error instanceof InputValidationError);
});

test('T008: combined valid flags accumulate without losing fields', () => {
  const result = parseDiagnoseArgs([
    '--task',
    'Wire up auth',
    '--allow-path',
    'src/auth/**',
    '--allow-paths',
    'tests/auth/**',
    '--deny-path',
    'src/legacy/**',
    '--stack-profile',
    'node-ts',
    '--json',
  ]);

  assert.deepEqual(result, {
    task_id: null,
    task_description: 'Wire up auth',
    allow_paths: ['src/auth/**', 'tests/auth/**'],
    deny_paths: ['src/legacy/**'],
    stack_profile: 'node-ts',
    json: true,
  });
});

test('T008: parsing is a pure function with no side effects', () => {
  const before = ['--allow-path', 'src/ui/**'];
  const snapshot = [...before];
  parseDiagnoseArgs(before);
  assert.deepEqual(before, snapshot);
});
