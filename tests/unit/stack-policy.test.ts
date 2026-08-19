import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  buildStackReasonCode,
  getBuiltInStackProfileRules,
  resolveStackPolicy,
  StackPolicyRule,
} from '../../src/core/check/stack-policy.js';
import { StackProfile } from '../../src/models/change-contract.js';
import { ChangeBudgetError, InputValidationError } from '../../src/models/errors.js';

async function createTempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'cb-stack-policy-'));
}

async function writeOverrides(root: string, content: string): Promise<void> {
  const cbDir = join(root, '.changebudget');
  await mkdir(cbDir, { recursive: true });
  await writeFile(join(cbDir, 'stack-policy-overrides.json'), content, 'utf8');
}

function ruleIds(rules: StackPolicyRule[]): string[] {
  return rules.map((rule) => rule.id);
}

// T015: profile without built-in rules must raise InputValidationError, never an uncaught TypeError.
test('T015: getBuiltInStackProfileRules raises InputValidationError for a profile without built-in rules', () => {
  // Simulates a future profile added to STACK_PROFILES but missing from BUILTIN_RULES.
  // The double assertion is test-only: the defensive guard exists precisely for the
  // type-erased runtime path that static types cannot express.
  const futureProfile = 'custom' as unknown as StackProfile;

  assert.throws(
    () => getBuiltInStackProfileRules(futureProfile),
    (error: unknown) => {
      assert.ok(error instanceof InputValidationError);
      assert.ok(error instanceof ChangeBudgetError);
      assert.equal(error.category, 'INPUT_VALIDATION');
      assert.equal(error.field, 'stack_profile');
      assert.ok(error.message.includes('custom'));
      return true;
    },
  );
});

// T017: table-driven builtin rule determinism for every shipped profile.
test('T017: getBuiltInStackProfileRules returns deterministic sorted rules for every shipped profile', () => {
  const profiles: StackProfile[] = ['android', 'flutter', 'spring-boot', 'node-ts'];

  for (const profile of profiles) {
    const rules = getBuiltInStackProfileRules(profile);
    const ids = ruleIds(rules);

    // Sorted by rule id (code-unit order).
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    assert.deepEqual(ids, sorted);

    // Every rule belongs to the requested profile.
    for (const rule of rules) {
      assert.equal(rule.profile_id, profile);
    }
  }
});

// T017: Spring Boot Liquibase and Flyway paths are covered by builtin rules.
test('T017: spring-boot builtin rules cover Flyway and Liquibase migration paths', () => {
  const rules = getBuiltInStackProfileRules('spring-boot');
  const migrationRule = rules.find((rule) => rule.id === 'spring-boot/migrations');

  assert.ok(migrationRule);
  const patterns = migrationRule!.target_patterns.join('\n');

  // Flyway-style paths.
  assert.ok(patterns.includes('db/migration'));
  // Liquibase changelog paths.
  assert.ok(patterns.includes('db/changelog'));
});

// T017: resolveStackPolicy returns null when no profile is given.
test('T017: resolveStackPolicy returns null for a null profile', async () => {
  const root = await createTempRoot();
  try {
    const result = await resolveStackPolicy(root, null, []);
    assert.equal(result, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: resolveStackPolicy with no override file returns only builtin rules.
test('T017: resolveStackPolicy returns builtin rules when no override file exists', async () => {
  const root = await createTempRoot();
  try {
    const result = await resolveStackPolicy(root, 'node-ts', []);
    assert.ok(result);
    assert.equal(result!.profile_id, 'node-ts');
    assert.deepEqual(result!.summary.overriddenRuleIds, []);
    assert.deepEqual(result!.summary.disabledRuleIds, []);
    assert.ok(result!.effectiveRules.length > 0);
    assert.deepEqual(result!.summary.effectiveRuleIds, ruleIds(result!.effectiveRules));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: repository overrides can disable a builtin rule.
test('T017: repository overrides disable a builtin rule deterministically', async () => {
  const root = await createTempRoot();
  try {
    await writeOverrides(
      root,
      JSON.stringify({
        profiles: {
          'node-ts': {
            disable_rule_ids: ['node-ts/public-api'],
          },
        },
      }),
    );

    const result = await resolveStackPolicy(root, 'node-ts', []);
    assert.ok(result);
    assert.deepEqual(result!.summary.overriddenRuleIds, ['node-ts/public-api']);
    assert.ok(!result!.summary.effectiveRuleIds.includes('node-ts/public-api'));

    const overriddenStatus = result!.summary.statusByRuleId.find(
      (entry) => entry.ruleId === 'node-ts/public-api',
    );
    assert.ok(overriddenStatus);
    assert.equal(overriddenStatus!.status, 'overridden');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: repository overrides can add a new rule.
test('T017: repository overrides add a new rule deterministically', async () => {
  const root = await createTempRoot();
  try {
    await writeOverrides(
      root,
      JSON.stringify({
        profiles: {
          'spring-boot': {
            added_rules: [
              {
                id: 'spring-boot/custom-actuator',
                category: 'configuration',
                target_patterns: ['**/actuator*.yml'],
                message: 'Custom actuator config rule.',
                severity: 'review',
              },
            ],
          },
        },
      }),
    );

    const result = await resolveStackPolicy(root, 'spring-boot', []);
    assert.ok(result);
    assert.ok(result!.summary.effectiveRuleIds.includes('spring-boot/custom-actuator'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: contract-level disable removes a rule from the effective set.
test('T017: contract-level disable removes a rule from the effective set', async () => {
  const root = await createTempRoot();
  try {
    const result = await resolveStackPolicy(root, 'android', ['android/signing']);
    assert.ok(result);
    assert.deepEqual(result!.summary.disabledRuleIds, ['android/signing']);
    assert.ok(!result!.summary.effectiveRuleIds.includes('android/signing'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: malformed override JSON produces InputValidationError, never an internal crash.
test('T017: malformed override JSON yields InputValidationError with documented field', async () => {
  const root = await createTempRoot();
  try {
    await writeOverrides(root, '{ this is not valid json');

    await assert.rejects(
      () => resolveStackPolicy(root, 'node-ts', []),
      (error: unknown) => {
        assert.ok(error instanceof InputValidationError);
        assert.equal(error.field, 'stack-policy-overrides');
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: override file with a non-object top-level yields InputValidationError.
test('T017: non-object override file yields InputValidationError', async () => {
  const root = await createTempRoot();
  try {
    await writeOverrides(root, JSON.stringify([1, 2, 3]));

    await assert.rejects(
      () => resolveStackPolicy(root, 'node-ts', []),
      (error: unknown) => {
        assert.ok(error instanceof InputValidationError);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: disable list referencing an unknown rule ID yields InputValidationError.
test('T017: unknown rule ID in repository disable list yields InputValidationError', async () => {
  const root = await createTempRoot();
  try {
    await writeOverrides(
      root,
      JSON.stringify({
        profiles: {
          'node-ts': {
            disable_rule_ids: ['node-ts/nonexistent'],
          },
        },
      }),
    );

    await assert.rejects(
      () => resolveStackPolicy(root, 'node-ts', []),
      (error: unknown) => {
        assert.ok(error instanceof InputValidationError);
        assert.equal(error.field, 'disable_rule_ids');
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: contract disable referencing an unknown rule ID yields InputValidationError.
test('T017: unknown rule ID in contract disable yields InputValidationError', async () => {
  const root = await createTempRoot();
  try {
    await assert.rejects(
      () => resolveStackPolicy(root, 'node-ts', ['node-ts/does-not-exist']),
      (error: unknown) => {
        assert.ok(error instanceof InputValidationError);
        assert.equal(error.field, 'disabled_stack_rules');
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: duplicate rule ID in added_rules yields InputValidationError.
test('T017: duplicate added rule ID yields InputValidationError', async () => {
  const root = await createTempRoot();
  try {
    await writeOverrides(
      root,
      JSON.stringify({
        profiles: {
          'node-ts': {
            added_rules: [
              {
                id: 'node-ts/dup',
                category: 'configuration',
                target_patterns: ['**/dup.yml'],
                message: 'First.',
                severity: 'review',
              },
              {
                id: 'node-ts/dup',
                category: 'configuration',
                target_patterns: ['**/dup2.yml'],
                message: 'Second.',
                severity: 'review',
              },
            ],
          },
        },
      }),
    );

    await assert.rejects(
      () => resolveStackPolicy(root, 'node-ts', []),
      (error: unknown) => {
        assert.ok(error instanceof InputValidationError);
        assert.ok(error.message.includes('node-ts/dup'));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: added rule that collides with a builtin ID yields InputValidationError.
test('T017: added rule colliding with builtin ID yields InputValidationError', async () => {
  const root = await createTempRoot();
  try {
    await writeOverrides(
      root,
      JSON.stringify({
        profiles: {
          'node-ts': {
            added_rules: [
              {
                id: 'node-ts/configuration',
                category: 'configuration',
                target_patterns: ['**/extra.yml'],
                message: 'Collision.',
                severity: 'review',
              },
            ],
          },
        },
      }),
    );

    await assert.rejects(
      () => resolveStackPolicy(root, 'node-ts', []),
      (error: unknown) => {
        assert.ok(error instanceof InputValidationError);
        assert.ok(error.message.includes('node-ts/configuration'));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: unsupported profile key in override file yields InputValidationError.
test('T017: unsupported profile key in override file yields InputValidationError', async () => {
  const root = await createTempRoot();
  try {
    await writeOverrides(
      root,
      JSON.stringify({
        profiles: {
          'rust-lang': {
            disable_rule_ids: ['rust/cargo'],
          },
        },
      }),
    );

    await assert.rejects(
      () => resolveStackPolicy(root, 'node-ts', []),
      (error: unknown) => {
        assert.ok(error instanceof InputValidationError);
        assert.ok(error.message.includes('rust-lang'));
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// T017: buildStackReasonCode is deterministic.
test('T017: buildStackReasonCode produces deterministic CBS codes', () => {
  assert.equal(buildStackReasonCode('android/signing'), 'CBS-ANDROID-SIGNING');
  assert.equal(buildStackReasonCode('spring-boot/migrations'), 'CBS-SPRING-BOOT-MIGRATIONS');
  assert.equal(buildStackReasonCode('node-ts/public-api'), 'CBS-NODE-TS-PUBLIC-API');
});
