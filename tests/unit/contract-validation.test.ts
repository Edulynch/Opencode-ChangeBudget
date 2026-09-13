import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parseContractInput,
  parseContractInputBooleanDefaults,
} from '../../src/cli/parsers/contract-input.js';
import {
  normalizeValidatedContractInput,
  validateContractInput,
} from '../../src/core/validation/contract-validator.js';
import { InputValidationError } from '../../src/models/errors.js';
import { comparisonModeForContract } from '../../src/models/change-contract.js';

test('comparisonModeForContract recognizes legacy only without a discriminator and baseline reference', () => {
  const legacy = comparisonModeForContract({});
  const explicitBaseline = comparisonModeForContract({ comparison_mode: 'baseline' });
  const missingBaselineEvidence = comparisonModeForContract({ baseline_ref: null });
  const malformedDiscriminator = comparisonModeForContract({ comparison_mode: 'unexpected' });

  assert.equal(legacy, 'legacy');
  assert.equal(explicitBaseline, 'baseline');
  assert.equal(missingBaselineEvidence, 'baseline');
  assert.equal(malformedDiscriminator, 'baseline');
});

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

test('parseContractInput accepts semantically malformed execution envelope JSON objects from separate and inline flags', () => {
  const separate = parseContractInput([
    '--execution-envelope-json',
    '{"schema_version":"bad","criteria":[null],"nested":{"enabled":false}}',
  ]);
  const inline = parseContractInput([
    '--execution-envelope-json={"open":false,"ledger":[{"unexpected":true}]}',
  ]);

  assert.deepEqual(separate.execution_envelope, {
    schema_version: 'bad',
    criteria: [null],
    nested: { enabled: false },
  });
  assert.deepEqual(inline.execution_envelope, {
    open: false,
    ledger: [{ unexpected: true }],
  });
});

test('parseContractInput leaves the legacy shape unchanged without an execution envelope', () => {
  const parsed = parseContractInput(['--task', 'legacy', '--base-revision', 'HEAD']);
  const normalized = parseContractInputBooleanDefaults(parsed);

  assert.equal(parsed.execution_envelope, undefined);
  assert.equal(Object.hasOwn(normalized, 'execution_envelope'), false);
});

test('parseContractInput rejects duplicate execution envelope flags', () => {
  assert.throws(
    () =>
      parseContractInput([
        '--execution-envelope-json',
        '{}',
        '--execution-envelope-json={}',
      ]),
    { name: InputValidationError.name },
  );
});

test('parseContractInput rejects malformed and non-object execution envelope JSON', () => {
  const values = ['{', 'null', '[]', 'true', '1', '"value"'];

  for (const value of values) {
    assert.throws(
      () => parseContractInput(['--execution-envelope-json', value]),
      { name: InputValidationError.name },
      `expected rejection for ${value}`,
    );
  }
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

test('parseContractInput accepts a single task id positional and canonicalizes it', () => {
  const cases = [
    { args: ['T031'], expected: 'T031' },
    { args: ['t031'], expected: 'T031' },
    { args: ['T12345'], expected: 'T12345' },
    { args: ['t004', '--task', 'desc', '--base-revision', 'HEAD'], expected: 'T004' },
  ];

  for (const entry of cases) {
    const parsed = parseContractInput(entry.args);
    assert.equal(parsed.task_id, entry.expected);
  }
});

test('parseContractInput rejects malformed or repeated positionals', () => {
  const cases = [
    ['T31'],
    ['T031x'],
    ['file.txt'],
    ['specs/x/tasks.md'],
    ['src/foo.ts'],
    ['T031', 'T032'],
  ];

  for (const args of cases) {
    assert.throws(
      () => parseContractInput([...args, '--base-revision', 'HEAD']),
      { name: InputValidationError.name },
      `expected rejection for ${args.join(' ')}`,
    );
  }
});

test('parseContractInput maps budget shorthands to presets', () => {
  assert.equal(parseContractInput(['--tiny', '--base-revision', 'HEAD']).preset, 'tiny');
  assert.equal(parseContractInput(['--normal']).preset, 'normal');
  assert.equal(parseContractInput(['--free']).preset, 'free');
});

test('parseContractInput rejects combining --preset with a shorthand', () => {
  const cases = [
    ['--preset', 'tiny', '--tiny'],
    ['--tiny', '--preset', 'tiny'],
    ['--normal', '--preset=normal'],
    ['--preset', 'normal', '--free'],
  ];

  for (const args of cases) {
    assert.throws(
      () => parseContractInput([...args, '--base-revision', 'HEAD']),
      { name: InputValidationError.name },
      `expected rejection for ${args.join(' ')}`,
    );
  }
});

test('normalizeValidatedContractInput defaults absent task fields to null', () => {
  const parsed = parseContractInput(['--task', 'legacy', '--base-revision', 'HEAD']);
  const normalized = normalizeValidatedContractInput(parsed);

  assert.equal(normalized.task_id, null);
  assert.equal(normalized.task_title, null);
  assert.equal(normalized.task_source_feature, null);
  assert.equal(normalized.task_source_path, null);
});

test('normalizeValidatedContractInput keeps a parsed task id and defaults the rest', () => {
  const parsed = parseContractInput(['T031', '--task', 'desc', '--base-revision', 'HEAD']);
  const normalized = normalizeValidatedContractInput(parsed);

  assert.equal(normalized.task_id, 'T031');
  assert.equal(normalized.task_title, null);
  assert.equal(normalized.task_source_feature, null);
  assert.equal(normalized.task_source_path, null);
});

function contractWithEnvelope(envelope: object): Parameters<typeof validateContractInput>[0] {
  return { task_description: 'envelope task', base_revision: 'HEAD', allow_paths: [], deny_paths: [], max_files: null, max_changed_lines: null, allow_new_files: false, allow_new_dependencies: false, allow_migrations: false, allow_config_changes: false, allow_public_api_changes: false, preset: null, stack_profile: null, disabled_stack_rules: [], execution_envelope: envelope };
}

function validExecutionEnvelope(): object {
  return { goal: 'Deliver smoke validation', acceptance_criteria: [{ id: 'smoke', outcome: 'The smoke suite passes', required_evidence: ['smoke-output'] }], authority: { delegated_agent: { max: 1, constraint: 'HARD' }, verification_expansion: { allowed: ['validation.smoke'], constraint: 'SOFT', canonical_alternatives: { 'validation.full': { value: 'validation.smoke', required_for: ['smoke'] } } } } };
}

test('validateContractInput normalizes structural envelopes with zero-SOFT authority defaults', () => {
  const input = contractWithEnvelope(validExecutionEnvelope());
  const envelope = Reflect.get(normalizeValidatedContractInput(input), 'execution_envelope');

  assert.equal(validateContractInput(input).valid, true);
  assert.deepEqual(envelope, {
    goal: 'Deliver smoke validation',
    acceptance_criteria: [{ id: 'smoke', outcome: 'The smoke suite passes', required_evidence: ['smoke-output'] }],
    authority: { delegated_agent: { max: 1, constraint: 'HARD' }, concurrent_worker: { max: 0, constraint: 'SOFT' }, reasoning_escalation: { allowed: [], constraint: 'SOFT' }, research_expansion: { allowed: [], constraint: 'SOFT' }, architecture_review: { allowed: [], constraint: 'SOFT' }, verification_expansion: { allowed: ['validation.smoke'], constraint: 'SOFT', canonical_alternatives: { 'validation.full': { value: 'validation.smoke', required_for: ['smoke'] } } }, documentation_expansion: { allowed: [], constraint: 'SOFT' }, infrastructure_expansion: { allowed: [], constraint: 'SOFT' }, external_service: { allowed: [], constraint: 'SOFT' } }, satisfaction: { state: 'OPEN', evidence_by_criterion: {} }, ledger: [],
  });
});

test('validateContractInput rejects forbidden authority and invalid canonical references', () => {
  const input = contractWithEnvelope({ ...validExecutionEnvelope(), authority: { scope_expansion: {}, post_satisfaction_work: {}, delegated_agent: { max: 1.5, constraint: 'MAYBE' }, verification_expansion: { allowed: ['validation.smoke'], constraint: 'SOFT', canonical_alternatives: { 'validation.full': { value: 'validation.full', required_for: ['undeclared'] } } } } });
  const validation = validateContractInput(input);

  assert.equal(validation.valid, false);
  assert.equal(validation.errors.every((error) => error.field.startsWith('execution_envelope')), true);
});

test('validateContractInput accepts inputs with and without task fields', () => {
  const base: Parameters<typeof validateContractInput>[0] = {
    task_description: 'desc',
    base_revision: 'HEAD',
    allow_paths: [],
    deny_paths: [],
    max_files: null,
    max_changed_lines: null,
    allow_new_files: false,
    allow_new_dependencies: false,
    allow_migrations: false,
    allow_config_changes: false,
    allow_public_api_changes: false,
    preset: null,
    stack_profile: null,
    disabled_stack_rules: [],
  };

  const cases = [
    base,
    { ...base, task_id: 'T031' },
    { ...base, task_id: null },
  ];

  for (const input of cases) {
    const result = validateContractInput(input);
    assert.equal(result.valid, true);
    assert.equal(result.errors.length, 0);
  }
});
