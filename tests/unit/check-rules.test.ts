import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import { evaluateBudgetCheck } from '../../src/core/check/rules.js';
import { BudgetChangeItem } from '../../src/core/check/diff.js';

test('evaluateBudgetCheck passes when changes are allowed and budgets are within limits', () => {
  const changedItems: BudgetChangeItem[] = [
    {
      path: 'src/app.ts',
      type: 'modified',
      addedLines: 3,
      removedLines: 2,
      isBinary: false,
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
    },
    {
      path: 'src/other.ts',
      type: 'added',
      addedLines: 8,
      removedLines: 1,
      isBinary: true,
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

test('evaluateBudgetCheck sorts violations by rule, reason code, and path', () => {
  const changedItems: BudgetChangeItem[] = [
    {
      path: 'docs/readme.md',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
    },
    {
      path: 'src/secret/z.ts',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
    },
    {
      path: 'src/secret/a.ts',
      type: 'added',
      addedLines: 1,
      removedLines: 0,
      isBinary: false,
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
