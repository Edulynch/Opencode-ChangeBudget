import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseContractInput } from '../../src/cli/parsers/contract-input.js';
import { validateContractInput } from '../../src/core/validation/contract-validator.js';
import { InputValidationError } from '../../src/models/errors.js';

test('parseContractInput normalizes and parses command arguments', () => {
  const parsed = parseContractInput([
    '--task',
    'Refactor local helper',
    '--base-revision',
    'HEAD',
    '--allow-path',
    'src, lib',
    '--deny-paths',
    'dist',
    '--max-files',
    '10',
    '--max-changed-lines',
    '0',
    '--allow-new-files',
    '--no-allow-new-dependencies',
    '--allow-migrations=true',
    '--preset',
    'tiny',
  ]);

  assert.equal(parsed.task_description, 'Refactor local helper');
  assert.equal(parsed.base_revision, 'HEAD');
  assert.deepEqual(parsed.allow_paths, ['src', 'lib']);
  assert.deepEqual(parsed.deny_paths, ['dist']);
  assert.equal(parsed.max_files, 10);
  assert.equal(parsed.max_changed_lines, 0);
  assert.equal(parsed.allow_new_files, true);
  assert.equal(parsed.allow_new_dependencies, false);
  assert.equal(parsed.allow_migrations, true);
  assert.equal(parsed.preset, 'tiny');
  assert.equal(parsed.stack_profile, null);
  assert.deepEqual(parsed.disabled_stack_rules, []);
});

test('parseContractInput rejects unknown options', () => {
  assert.throws(() => parseContractInput(['--unknown', 'value']), {
    name: 'InputValidationError',
  });
});

test('parseContractInput rejects malformed max-files values', () => {
  assert.throws(() => parseContractInput(['--max-files', 'bad']), {
    name: InputValidationError.name,
  });
});

test('parseContractInput parses stack profile and disabled rule options', () => {
  const parsed = parseContractInput([
    '--task',
    'Refactor stack flags',
    '--base-revision',
    'HEAD',
    '--stack-profile',
    'android',
    '--disable-stack-rule',
    'android/signing',
    '--disable-stack-rules=flutter/configuration,node-ts/public-api',
  ]);

  assert.equal(parsed.stack_profile, 'android');
  assert.deepEqual(parsed.disabled_stack_rules, ['android/signing', 'flutter/configuration', 'node-ts/public-api']);
});

test('parseContractInput rejects unknown stack profile values', () => {
  assert.throws(
    () =>
      parseContractInput([
        '--task',
        'Invalid profile',
        '--base-revision',
        'HEAD',
        '--stack-profile',
        'unknown-stack',
      ]),
    {
      name: InputValidationError.name,
    },
  );
});

test('validateContractInput detects required field and field type failures', () => {
  const result = validateContractInput({
    task_description: '',
    base_revision: '   ',
    allow_paths: [''],
    deny_paths: ['valid/path', ''],
    max_files: -1,
    max_changed_lines: -2,
    allow_new_files: false,
    allow_new_dependencies: false,
    allow_migrations: false,
    allow_config_changes: false,
    allow_public_api_changes: false,
    preset: 'invalid' as never,
    stack_profile: null,
    disabled_stack_rules: [],
  });

  assert.equal(result.valid, false);
  const fields = result.errors.map((entry) => entry.field);
  assert.ok(fields.includes('task_description'));
  assert.ok(fields.includes('base_revision'));
  assert.ok(fields.includes('max_files'));
  assert.ok(fields.includes('max_changed_lines'));
  assert.ok(fields.includes('allow_paths'));
  assert.ok(fields.includes('deny_paths'));
  assert.ok(fields.includes('preset'));
});

test('validateContractInput accepts known stack profile and disabled rule ids', () => {
  const result = validateContractInput({
    task_description: 'stack-aware task',
    base_revision: 'HEAD',
    allow_paths: ['src/**'],
    deny_paths: [],
    max_files: 10,
    max_changed_lines: 100,
    allow_new_files: false,
    allow_new_dependencies: false,
    allow_migrations: false,
    allow_config_changes: false,
    allow_public_api_changes: false,
    preset: null,
    stack_profile: 'node-ts',
    disabled_stack_rules: ['node-ts/public-api', 'node-ts/configuration'],
  });

  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test('validateContractInput rejects unknown stack profile and duplicate disabled rules', () => {
  const result = validateContractInput({
    task_description: 'bad stack contract',
    base_revision: 'HEAD',
    allow_paths: ['src/**'],
    deny_paths: [],
    max_files: 10,
    max_changed_lines: 100,
    allow_new_files: false,
    allow_new_dependencies: false,
    allow_migrations: false,
    allow_config_changes: false,
    allow_public_api_changes: false,
    preset: null,
    stack_profile: 'java' as never,
    disabled_stack_rules: ['', 'node-ts/public-api', 'node-ts/public-api'],
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some((entry) => entry.field === 'stack_profile'));
  assert.equal(result.errors.filter((entry) => entry.field === 'disabled_stack_rules').length >= 2, true);
});
