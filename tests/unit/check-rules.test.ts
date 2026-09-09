import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateBudgetCheck } from '../../src/core/check/rules.js';
import { BudgetChangeItem } from '../../src/core/check/diff.js';
import { StackPolicyRule, getBuiltInStackProfileRules } from '../../src/core/check/stack-policy.js';
import { StackPolicySummary } from '../../src/models/check-result.js';

test('evaluateBudgetCheck passes when changes are allowed and budgets are within limits', () => {
  const changedItems: BudgetChangeItem[] = [
    {
      path: 'src/app.ts',
      type: 'modified',
      addedLines: 3,
      removedLines: 2,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-1',
      baseRevision: 'HEAD',
      allow_paths: ['src/**'],
      deny_paths: ['src/generated/**'],
      max_files: 2,
      max_changed_lines: 20,
      allow_new_files: true,
    },
    changedItems,
  );

  assert.equal(result.status, 'PASS');
  assert.equal(result.decision, 'PASS');
  assert.equal(result.reasonCodes.length, 0);
  assert.equal(result.changedFileCount, 1);
  assert.equal(result.changedLinesCount, 5);
  assert.equal(result.binaryChangeCount, 0);
  assert.equal(result.limitResults[0]?.status, 'pass');
  assert.equal(result.violations.length, 0);
  assert.equal(result.pathRuleResults[0]?.status, 'allow');
});

test('evaluateBudgetCheck fails for deny path even when it is also in allow paths', () => {
  const changedItems: BudgetChangeItem[] = [
    {
      path: 'src/generated/auto.ts',
      type: 'modified',
      addedLines: 1,
      removedLines: 1,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-1',
      baseRevision: 'HEAD',
      allow_paths: ['src/**'],
      deny_paths: ['src/generated/**'],
      max_files: 2,
      max_changed_lines: 20,
      allow_new_files: true,
    },
    changedItems,
  );

  assert.equal(result.status, 'FAIL');
  assert.equal(result.decision, 'REPAIR');
  assert.equal(result.reasonCodes.includes('CBV-PATH-DENIED'), true);
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]?.rule, 'deny_paths');
  assert.equal(result.violations[0]?.reasonCode, 'CBV-PATH-DENIED');
  assert.equal(result.pathRuleResults[0]?.status, 'deny');
});

test('evaluateBudgetCheck enforces file and line budgets when exceeded', () => {
  const changedItems: BudgetChangeItem[] = [
    {
      path: 'src/index.ts',
      type: 'added',
      addedLines: 12,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
    {
      path: 'src/other.ts',
      type: 'added',
      addedLines: 8,
      removedLines: 1,
      isBinary: true,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-2',
      baseRevision: 'HEAD',
      allow_paths: [],
      deny_paths: [],
      max_files: 1,
      max_changed_lines: 20,
      allow_new_files: true,
    },
    changedItems,
  );

  assert.equal(result.status, 'FAIL');
  assert.equal(result.decision, 'REPAIR');
  assert.equal(result.changedFileCount, 2);
  assert.equal(result.changedLinesCount, 12);
  assert.equal(result.binaryChangeCount, 1);
  assert.equal(result.newFileCount, 2);
  assert.equal(result.limitResults.length, 2);
  assert.equal(result.limitResults.find((entry) => entry.limitName === 'max_files')?.status, 'fail');
  assert.equal(result.limitResults.find((entry) => entry.limitName === 'max_changed_lines')?.status, 'pass');
  assert.equal(result.violations[0]?.reasonCode, 'CBV-LIMIT-FILES-EXCEEDED');
  assert.equal(result.reasonCodes.includes('CBV-LIMIT-FILES-EXCEEDED'), true);
});

test('evaluateBudgetCheck reports each added file when allow_new_files is false without suppressing other violations', () => {
  const changedItems: BudgetChangeItem[] = [
    {
      path: 'docs/new.md',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
    {
      path: 'src/secret/new.ts',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-new-files',
      baseRevision: 'HEAD',
      allow_paths: ['src/**'],
      deny_paths: ['src/secret/**'],
      max_files: 1,
      max_changed_lines: 1,
      allow_new_files: false,
    },
    changedItems,
  );

  assert.deepEqual(result.violations.map((entry) => ({
    rule: entry.rule,
    path: entry.path,
    reasonCode: entry.reasonCode,
    message: entry.message,
    action: entry.action,
  })), [
    {
      rule: 'allow_new_files',
      path: 'docs/new.md',
      reasonCode: 'CBV-NEW-FILE-NOT-ALLOWED',
      message: 'New file creation is not allowed by the active contract',
      action: 'repair',
    },
    {
      rule: 'allow_new_files',
      path: 'src/secret/new.ts',
      reasonCode: 'CBV-NEW-FILE-NOT-ALLOWED',
      message: 'New file creation is not allowed by the active contract',
      action: 'repair',
    },
    {
      rule: 'allow_paths',
      path: 'docs/new.md',
      reasonCode: 'CBV-PATH-NOT-ALLOWED',
      message: 'Path is not in allow_paths',
      action: 'repair',
    },
    {
      rule: 'deny_paths',
      path: 'src/secret/new.ts',
      reasonCode: 'CBV-PATH-DENIED',
      message: 'Path is blocked by deny_paths',
      action: 'review',
    },
    {
      rule: 'max_changed_lines',
      path: undefined,
      reasonCode: 'CBV-LIMIT-LINES-EXCEEDED',
      message: 'Changed lines budget exceeded',
      action: 'repair',
    },
    {
      rule: 'max_files',
      path: undefined,
      reasonCode: 'CBV-LIMIT-FILES-EXCEEDED',
      message: 'File budget exceeded',
      action: 'repair',
    },
  ]);
});

test('evaluateBudgetCheck sorts violations by rule, reason code, and path', () => {
  const changedItems: BudgetChangeItem[] = [
    {
      path: 'docs/readme.md',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
    {
      path: 'src/secret/z.ts',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
    {
      path: 'src/secret/a.ts',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-3',
      baseRevision: 'HEAD',
      allow_paths: ['src/**'],
      deny_paths: ['src/secret/**'],
      max_files: 10,
      max_changed_lines: 100,
      allow_new_files: true,
    },
    changedItems,
  );

  const violations = result.violations.map(
    (entry) => `${entry.rule}:${entry.reasonCode}:${entry.path}`,
  );

  assert.deepEqual(violations, [
    'allow_paths:CBV-PATH-NOT-ALLOWED:docs/readme.md',
    'deny_paths:CBV-PATH-DENIED:src/secret/a.ts',
    'deny_paths:CBV-PATH-DENIED:src/secret/z.ts',
  ]);
});

test('evaluateBudgetCheck orders non-ASCII violation paths by code units', () => {
  const changedItems: BudgetChangeItem[] = [
    {
      path: 'src/\u00E4/x.ts',
      type: 'modified',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
    {
      path: 'src/z/x.ts',
      type: 'modified',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-ordering',
      baseRevision: 'HEAD',
      allow_paths: [],
      deny_paths: ['src/**'],
      max_files: 10,
      max_changed_lines: 100,
      allow_new_files: true,
    },
    changedItems,
  );

  const violations = result.violations.map((entry) => `${entry.rule}:${entry.reasonCode}:${entry.path}`);

  assert.deepEqual(violations, [
    'deny_paths:CBV-PATH-DENIED:src/z/x.ts',
    'deny_paths:CBV-PATH-DENIED:src/\u00E4/x.ts',
  ]);
});

test('evaluateBudgetCheck emits stack policy violations with deterministic CBS reason codes', () => {
  const stackRule: StackPolicyRule = {
    id: 'android/signing',
    profile_id: 'android',
    category: 'release_artifacts',
    target_patterns: ['**/AndroidManifest.xml'],
    message: 'Android signing and release configuration changes require manual review.',
    severity: 'review',
  };

  const changedItems: BudgetChangeItem[] = [
    {
      path: 'app/AndroidManifest.xml',
      type: 'modified',
      addedLines: 2,
      removedLines: 1,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-android',
      baseRevision: 'HEAD',
      allow_paths: [],
      deny_paths: [],
      max_files: 10,
      max_changed_lines: 20,
      allow_new_files: true,
      stackPolicyRules: [stackRule],
      stackPolicySummary: {
        profile_id: 'android',
        effectiveRuleIds: ['android/signing'],
        overriddenRuleIds: [],
        disabledRuleIds: [],
        statusByRuleId: [{
          ruleId: 'android/signing',
          status: 'active',
        }],
      },
    },
    changedItems,
  );

  assert.equal(result.status, 'FAIL');
  assert.equal(result.decision, 'REPAIR');
  assert.equal(result.violations.length, 1);
  assert.equal(result.violations[0]?.rule, 'stack_profile_rule');
  assert.equal(result.violations[0]?.reasonCode, 'CBS-ANDROID-SIGNING');
  assert.equal(result.stackPolicySummary?.profile_id, 'android');
  assert.equal(result.stackPolicySummary?.statusByRuleId[0]?.status, 'active');
});

test('spring-boot/migrations builtin rule covers Flyway and Liquibase changelogs', () => {
  const migrationRules = getBuiltInStackProfileRules('spring-boot')
    .filter((entry) => entry.id === 'spring-boot/migrations');

  const changedItems: BudgetChangeItem[] = [
    {
      path: 'src/main/resources/db/migration/V1__example.sql',
      type: 'modified',
      addedLines: 1,
      removedLines: 1,
      isBinary: false,
      staged: false,
    },
    {
      path: 'src/main/resources/db/changelog/1.0.0/changelog-0001.sql',
      type: 'modified',
      addedLines: 2,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
    {
      path: 'src/main/java/com/example/App.java',
      type: 'modified',
      addedLines: 1,
      removedLines: 1,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-spring-boot',
      baseRevision: 'HEAD',
      allow_paths: [],
      deny_paths: [],
      max_files: 10,
      max_changed_lines: 100,
      allow_new_files: true,
      stackPolicyRules: migrationRules,
      stackPolicySummary: {
        profile_id: 'spring-boot',
        effectiveRuleIds: ['spring-boot/migrations'],
        overriddenRuleIds: [],
        disabledRuleIds: [],
        statusByRuleId: [{
          ruleId: 'spring-boot/migrations',
          status: 'active',
        }],
      },
    },
    changedItems,
  );

  const migrationPaths = result.violations
    .filter((entry) => entry.reasonCode === 'CBS-SPRING-BOOT-MIGRATIONS')
    .map((entry) => entry.path);

  assert.deepEqual(migrationPaths, [
    'src/main/resources/db/changelog/1.0.0/changelog-0001.sql',
    'src/main/resources/db/migration/V1__example.sql',
  ]);
  assert.equal(result.reasonCodes.includes('CBS-SPRING-BOOT-MIGRATIONS'), true);
  assert.equal(result.violations.some((entry) => entry.path === 'src/main/java/com/example/App.java'), false);
});

test('evaluateBudgetCheck keeps stack summary when stack rules do not match', () => {
  const summary: StackPolicySummary = {
    profile_id: 'node-ts',
    effectiveRuleIds: ['node-ts/configuration', 'node-ts/dependencies', 'node-ts/public-api'],
    overriddenRuleIds: [],
    disabledRuleIds: [],
    statusByRuleId: [
      { ruleId: 'node-ts/configuration', status: 'active' },
      { ruleId: 'node-ts/dependencies', status: 'active' },
      { ruleId: 'node-ts/public-api', status: 'active' },
    ],
  };

  const changedItems: BudgetChangeItem[] = [
    {
      path: 'app/readme.md',
      type: 'modified',
      addedLines: 2,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-node',
      baseRevision: 'HEAD',
      allow_paths: [],
      deny_paths: [],
      max_files: 10,
      max_changed_lines: 20,
      allow_new_files: true,
      stackPolicyRules: [
        {
          id: 'node-ts/configuration',
          profile_id: 'node-ts',
          category: 'configuration',
          target_patterns: ['tsconfig.json'],
          message: 'Node configuration edits should be reviewed.',
          severity: 'review',
        },
      ],
      stackPolicySummary: summary,
    },
    changedItems,
  );

  assert.equal(result.status, 'PASS');
  assert.equal(result.decision, 'PASS');
  assert.deepEqual(result.stackPolicySummary, summary);
});

test('evaluateBudgetCheck keeps generic budget limits independent of an active stack profile (FR-011)', () => {
  const stackRule: StackPolicyRule = {
    id: 'android/signing',
    profile_id: 'android',
    category: 'release_artifacts',
    target_patterns: ['**/AndroidManifest.xml'],
    message: 'Android signing and release configuration changes require manual review.',
    severity: 'review',
  };

  const changedItems: BudgetChangeItem[] = [
    {
      path: 'app/AndroidManifest.xml',
      type: 'modified',
      addedLines: 2,
      removedLines: 1,
      isBinary: false,
      staged: false,
    },
    {
      path: 'app/other.ts',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-budget-and-stack',
      baseRevision: 'HEAD',
      allow_paths: [],
      deny_paths: [],
      max_files: 1,
      max_changed_lines: 20,
      allow_new_files: true,
      stackPolicyRules: [stackRule],
      stackPolicySummary: {
        profile_id: 'android',
        effectiveRuleIds: ['android/signing'],
        overriddenRuleIds: [],
        disabledRuleIds: [],
        statusByRuleId: [{
          ruleId: 'android/signing',
          status: 'active',
        }],
      },
    },
    changedItems,
  );

  assert.equal(result.status, 'FAIL');
  assert.equal(result.decision, 'REPAIR');
  assert.equal(result.limitResults.find((entry) => entry.limitName === 'max_files')?.status, 'fail');
  assert.equal(result.reasonCodes.includes('CBV-LIMIT-FILES-EXCEEDED'), true);
  assert.equal(
    result.violations.some(
      (entry) => entry.rule === 'max_files' && entry.reasonCode === 'CBV-LIMIT-FILES-EXCEEDED',
    ),
    true,
  );
  assert.equal(
    result.violations.some(
      (entry) => entry.rule === 'stack_profile_rule' && entry.reasonCode === 'CBS-ANDROID-SIGNING',
    ),
    true,
  );
  assert.equal(result.stackPolicySummary?.profile_id, 'android');
});

test('evaluateBudgetCheck keeps stack and generic violation classifications distinguishable in one evaluation (FR-012)', () => {
  const stackRule: StackPolicyRule = {
    id: 'node-ts/dependencies',
    profile_id: 'node-ts',
    category: 'dependencies',
    target_patterns: ['package-lock.json'],
    message: 'Node dependency lock file changes require dependency review.',
    severity: 'review',
  };

  const changedItems: BudgetChangeItem[] = [
    {
      path: 'package-lock.json',
      type: 'modified',
      addedLines: 6,
      removedLines: 4,
      isBinary: false,
      staged: false,
    },
    {
      path: 'src/extra.ts',
      type: 'added',
      addedLines: 5,
      removedLines: 0,
      isBinary: false,
      staged: false,
    },
  ];

  const result = evaluateBudgetCheck(
    {
      source: 'active',
      contractId: 'contract-mixed-classification',
      baseRevision: 'HEAD',
      allow_paths: [],
      deny_paths: [],
      max_files: 10,
      max_changed_lines: 10,
      allow_new_files: true,
      stackPolicyRules: [stackRule],
      stackPolicySummary: {
        profile_id: 'node-ts',
        effectiveRuleIds: ['node-ts/dependencies'],
        overriddenRuleIds: [],
        disabledRuleIds: [],
        statusByRuleId: [{
          ruleId: 'node-ts/dependencies',
          status: 'active',
        }],
      },
    },
    changedItems,
  );

  const stackViolation = result.violations.find((entry) => entry.rule === 'stack_profile_rule');
  const limitViolation = result.violations.find((entry) => entry.rule === 'max_changed_lines');

  assert.equal(result.status, 'FAIL');
  assert.equal(result.decision, 'REPAIR');
  assert.ok(stackViolation !== undefined);
  assert.ok(limitViolation !== undefined);
  assert.equal(stackViolation.reasonCode?.startsWith('CBS-'), true);
  assert.equal(limitViolation.reasonCode, 'CBV-LIMIT-LINES-EXCEEDED');
  assert.equal(limitViolation.reasonCode?.startsWith('CBV-'), true);
  assert.equal(result.reasonCodes.includes('CBS-NODE-TS-DEPENDENCIES'), true);
  assert.equal(result.reasonCodes.includes('CBV-LIMIT-LINES-EXCEEDED'), true);
  assert.notEqual(stackViolation.reasonCode, limitViolation.reasonCode);
  assert.notEqual(stackViolation.rule, limitViolation.rule);
});
