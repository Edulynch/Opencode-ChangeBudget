import { InputValidationError } from '../../models/errors.js';
import {
  STACK_PROFILES,
  StackProfile,
} from '../../models/change-contract.js';
import {
  getStackPolicyOverridesFilePath,
  readJsonFileOptional,
} from '../state/state.js';
import { compilePathPatterns } from './patterns.js';

export type StackRuleSeverity = 'review' | 'deny';

export type StackRuleCategory =
  | 'dependencies'
  | 'migrations'
  | 'configuration'
  | 'public_api'
  | 'release_artifacts'
  | 'runtime';

export interface StackPolicyRule {
  id: string;
  profile_id: StackProfile;
  category: StackRuleCategory;
  target_patterns: string[];
  message: string;
  severity: StackRuleSeverity;
}

export interface StackPolicySummary {
  profile_id: StackProfile;
  effectiveRuleIds: string[];
  overriddenRuleIds: string[];
  disabledRuleIds: string[];
  statusByRuleId: Array<{ ruleId: string; status: 'active' | 'overridden' | 'disabled' }>
;
}

interface StackPolicyOverrideFile {
  profiles?: Record<string, StackProfileOverride>;
}

interface StackProfileOverride {
  disable_rule_ids?: string[];
  added_rules?: StackPolicyRuleInput[];
}

interface StackPolicyRuleInput {
  id?: string;
  profile_id?: string;
  category?: string;
  target_patterns?: string[];
  message?: string;
  severity?: string;
}

const BUILTIN_RULES: Record<StackProfile, StackPolicyRule[]> = {
  android: [
    {
      id: 'android/configuration',
      profile_id: 'android',
      category: 'configuration',
      target_patterns: [
        'gradle.properties',
        '**/gradle.properties',
        'gradle-wrapper.properties',
        '**/gradle-wrapper.properties',
        'local.properties',
        '**/local.properties',
      ],
      message: 'Android configuration file sensitivity should be reviewed before change.',
      severity: 'review',
    },
    {
      id: 'android/dependencies',
      profile_id: 'android',
      category: 'dependencies',
      target_patterns: [
        'build.gradle',
        '**/build.gradle',
        'build.gradle.kts',
        '**/build.gradle.kts',
      ],
      message: 'Android dependency manifest updates should be checked for build chain safety.',
      severity: 'review',
    },
    {
      id: 'android/signing',
      profile_id: 'android',
      category: 'release_artifacts',
      target_patterns: [
        'AndroidManifest.xml',
        '**/AndroidManifest.xml',
        '.github/workflows/release.yml',
        '.github/workflows/release-*.yml',
      ],
      message: 'Android signing and release configuration changes require manual review.',
      severity: 'review',
    },
  ],
  flutter: [
    {
      id: 'flutter/configuration',
      profile_id: 'flutter',
      category: 'configuration',
      target_patterns: ['analysis_options.yaml', '.fvm/fvm_config.json'],
      message: 'Flutter configuration updates can alter build and analysis behavior.',
      severity: 'review',
    },
    {
      id: 'flutter/dependencies',
      profile_id: 'flutter',
      category: 'dependencies',
      target_patterns: ['pubspec.yaml', 'pubspec.lock'],
      message: 'Flutter dependency manifest changes need contract review.',
      severity: 'review',
    },
    {
      id: 'flutter/release',
      profile_id: 'flutter',
      category: 'release_artifacts',
      target_patterns: ['.github/workflows/release.yml', '.github/workflows/release-*.yml'],
      message: 'Flutter release pipeline updates are high-risk changes.',
      severity: 'review',
    },
  ],
  'spring-boot': [
    {
      id: 'spring-boot/configuration',
      profile_id: 'spring-boot',
      category: 'configuration',
      target_patterns: ['**/application*.yml', '**/application*.yaml', '**/application*.properties'],
      message: 'Spring Boot application configuration changes require review.',
      severity: 'review',
    },
    {
      id: 'spring-boot/dependencies',
      profile_id: 'spring-boot',
      category: 'dependencies',
      target_patterns: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'gradle.properties'],
      message: 'Spring Boot dependency manifest updates may affect runtime behavior.',
      severity: 'review',
    },
    {
      id: 'spring-boot/migrations',
      profile_id: 'spring-boot',
      category: 'migrations',
      target_patterns: [
        '**/db/migration/*.sql',
        '**/db/migration/**/*.sql',
        '**/migrations/**/*.sql',
      ],
      message: 'Database migration edits in Spring Boot projects need manual review.',
      severity: 'review',
    },
  ],
  'node-ts': [
    {
      id: 'node-ts/configuration',
      profile_id: 'node-ts',
      category: 'configuration',
      target_patterns: ['tsconfig.json', 'tsconfig.*.json', '.eslintrc*', 'package.json'],
      message: 'Node/TypeScript configuration edits should be reviewed.',
      severity: 'review',
    },
    {
      id: 'node-ts/dependencies',
      profile_id: 'node-ts',
      category: 'dependencies',
      target_patterns: ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'],
      message: 'Node dependency lock file changes require dependency review.',
      severity: 'review',
    },
    {
      id: 'node-ts/public-api',
      profile_id: 'node-ts',
      category: 'public_api',
      target_patterns: ['src/index.ts', 'src/main.ts', 'dist/index.d.ts'],
      message: 'Public API exports in Node/TypeScript projects are contract-sensitive.',
      severity: 'review',
    },
  ],
};

const STACK_RULE_CATEGORIES: StackRuleCategory[] = [
  'dependencies',
  'migrations',
  'configuration',
  'public_api',
  'release_artifacts',
  'runtime',
];

const STACK_RULE_SEVERITIES: StackRuleSeverity[] = ['review', 'deny'];

function isStackProfileValue(value: unknown): value is StackProfile {
  if (typeof value !== 'string') {
    return false;
  }

  return (STACK_PROFILES as readonly string[]).includes(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortByRuleId(rules: StackPolicyRule[]): StackPolicyRule[] {
  return [...rules].sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeRuleIdSet(value: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const raw of value) {
    const entry = raw.trim();
    if (!entry.length) {
      continue;
    }

    if (seen.has(entry)) {
      continue;
    }

    seen.add(entry);
    normalized.push(entry);
  }

  return normalized;
}

function parseStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new InputValidationError(`Expected ${field} to be an array`, field, {
      field,
      valueType: typeof value,
    });
  }

  const values = value.map((entry, index) => {
    if (typeof entry !== 'string') {
      throw new InputValidationError(`Invalid ${field}[${index}] value; expected string`, field, {
        field,
        index,
      });
    }

    const trimmed = entry.trim();
    if (!trimmed.length) {
      throw new InputValidationError(`Invalid ${field}[${index}] value; expected non-empty string`, field, {
        field,
        index,
      });
    }

    return trimmed;
  });

  return normalizeRuleIdSet(values);
}

function parseRuleArray(value: unknown, profileId: StackProfile): StackPolicyRule[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new InputValidationError('Invalid value for added_rules; expected an array', 'added_rules', {
      field: 'added_rules',
      profile: profileId,
    });
  }

  const parsed: StackPolicyRule[] = [];
  const usedRuleIds = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isObject(entry)) {
      throw new InputValidationError(`Invalid added_rules[${index}] value; expected an object`, 'added_rules', {
        field: 'added_rules',
        index,
      });
    }

    const candidate = entry as StackPolicyRuleInput;
    const rawId = candidate.id;
    if (typeof rawId !== 'string') {
      throw new InputValidationError(`Invalid added_rules[${index}].id value; expected string`, 'added_rules', {
        field: `added_rules[${index}].id`,
        index,
      });
    }

    const id = rawId.trim();
    if (!id.length) {
      throw new InputValidationError(`added_rules[${index}].id cannot be empty`, 'added_rules', {
        field: `added_rules[${index}].id`,
        index,
      });
    }

    if (usedRuleIds.has(id)) {
      throw new InputValidationError(`Duplicate added rule id '${id}'`, 'added_rules', {
        field: 'added_rules',
        id,
      });
    }

    usedRuleIds.add(id);

    const rawProfileId = candidate.profile_id;
    if (rawProfileId !== undefined) {
      const normalizedProfile = String(rawProfileId);
      if (!isStackProfileValue(normalizedProfile)) {
        throw new InputValidationError(
          `Invalid added_rules[${index}].profile_id '${normalizedProfile}'`,
          'added_rules',
          {
            field: `added_rules[${index}].profile_id`,
            value: normalizedProfile,
          },
        );
      }

      if (normalizedProfile !== profileId) {
        throw new InputValidationError(
          `added_rules[${index}].profile_id must match selected profile '${profileId}'`,
          'added_rules',
          {
            field: `added_rules[${index}].profile_id`,
            expected: profileId,
            actual: normalizedProfile,
          },
        );
      }
    }

    const rawCategory = candidate.category;
    if (typeof rawCategory !== 'string' || !STACK_RULE_CATEGORIES.includes(rawCategory as StackRuleCategory)) {
      throw new InputValidationError(
        `Invalid added_rules[${index}].category`,
        'added_rules',
        {
          field: `added_rules[${index}].category`,
          value: rawCategory,
        },
      );
    }

    const rawSeverity = candidate.severity;
    if (typeof rawSeverity !== 'string' || !STACK_RULE_SEVERITIES.includes(rawSeverity as StackRuleSeverity)) {
      throw new InputValidationError(
        `Invalid added_rules[${index}].severity`,
        'added_rules',
        {
          field: `added_rules[${index}].severity`,
          value: rawSeverity,
        },
      );
    }

    const message = typeof candidate.message === 'string' ? candidate.message.trim() : '';
    if (!message.length) {
      throw new InputValidationError(
        `added_rules[${index}].message must be a non-empty string`,
        'added_rules',
        {
          field: `added_rules[${index}].message`,
          index,
        },
      );
    }

    const targetPatterns = parseStringArray(candidate.target_patterns, `added_rules[${index}].target_patterns`);
    if (targetPatterns.length === 0) {
      throw new InputValidationError(
        `added_rules[${index}].target_patterns must include at least one pattern`,
        'added_rules',
        {
          field: `added_rules[${index}].target_patterns`,
          index,
        },
      );
    }

    parsed.push({
      id,
      profile_id: profileId,
      category: rawCategory as StackRuleCategory,
      target_patterns: targetPatterns,
      message,
      severity: rawSeverity as StackRuleSeverity,
    });
  }

  return parsed;
}

function parseProfileOverride(profileId: StackProfile, payload: unknown): { disableRuleIds: string[]; addedRules: StackPolicyRule[] } {
  if (!isObject(payload)) {
    if (payload === undefined) {
      return { disableRuleIds: [], addedRules: [] };
    }

    throw new InputValidationError('Profile override entry must be an object', 'stack-policy-overrides', {
      profile: profileId,
      valueType: typeof payload,
    });
  }

  const disableRuleIds = parseStringArray(payload.disable_rule_ids, 'disable_rule_ids');
  const addedRules = parseRuleArray(payload.added_rules, profileId);

  return {
    disableRuleIds,
    addedRules,
  };
}

function parseOverrideFile(payload: unknown): StackPolicyOverrideFile {
  if (!isObject(payload)) {
    throw new InputValidationError('Invalid stack policy override file; expected object', 'stack-policy-overrides', {
      valueType: typeof payload,
    });
  }

  const result: StackPolicyOverrideFile = {};

  if (payload.profiles === undefined) {
    return result;
  }

  if (!isObject(payload.profiles)) {
    throw new InputValidationError(
      'Invalid stack policy override file; profiles must be an object',
      'stack-policy-overrides',
      {
        field: 'profiles',
      },
    );
  }

  const profiles: Record<string, StackProfileOverride> = {};

  for (const [candidateProfileId, profilePayload] of Object.entries(payload.profiles)) {
    if (!isStackProfileValue(candidateProfileId)) {
      throw new InputValidationError(
        `Unsupported stack profile key '${candidateProfileId}' in profiles`,
        'stack-policy-overrides',
        {
          field: 'profiles',
          value: candidateProfileId,
        },
      );
    }

    profiles[candidateProfileId] = profilePayload as StackProfileOverride;
  }

  result.profiles = profiles;
  return result;
}

export function getBuiltInStackProfileRules(profileId: StackProfile): StackPolicyRule[] {
  return sortByRuleId(BUILTIN_RULES[profileId]);
}

function getOverrideForProfile(
  repositoryRoot: string,
  profileId: StackProfile,
): Promise<{ disableRuleIds: string[]; addedRules: StackPolicyRule[] }> {
  return readJsonFileOptional<unknown>(getStackPolicyOverridesFilePath(repositoryRoot)).then((payload) => {
    if (payload === null) {
      return {
        disableRuleIds: [],
        addedRules: [],
      };
    }

    const parsed = parseOverrideFile(payload);
    const selectedProfile = parsed.profiles?.[profileId];

    return parseProfileOverride(profileId, selectedProfile);
  });
}

function validateRulePatterns(profileId: StackProfile, rules: StackPolicyRule[]): void {
  for (const rule of rules) {
    const seenPatterns = new Set<string>();
    const normalizedPatterns: string[] = [];

    for (const pattern of rule.target_patterns) {
      const normalized = pattern.trim();
      if (!normalized.length) {
        throw new InputValidationError('Stack rule pattern cannot be empty', 'target_patterns', {
          profile: profileId,
          ruleId: rule.id,
        });
      }

      if (seenPatterns.has(normalized)) {
        continue;
      }

      seenPatterns.add(normalized);
      normalizedPatterns.push(normalized);
    }

    if (normalizedPatterns.length === 0) {
      throw new InputValidationError('Stack rule must have at least one target pattern', 'target_patterns', {
        profile: profileId,
        ruleId: rule.id,
      });
    }

    rule.target_patterns = normalizedPatterns;

    compilePathPatterns(normalizedPatterns);
  }
}

export interface StackPolicyResolution {
  profile_id: StackProfile;
  effectiveRules: StackPolicyRule[];
  summary: StackPolicySummary;
}

export async function resolveStackPolicy(
  repositoryRoot: string,
  profileId: StackProfile | null,
  contractDisabledRuleIds: readonly string[],
): Promise<StackPolicyResolution | null> {
  if (!profileId) {
    return null;
  }

  const normalizedProfileId = profileId as StackProfile;

  const builtinRules = getBuiltInStackProfileRules(normalizedProfileId).map((entry) => ({
    ...entry,
  }));

  const seenRuleIds = new Set<string>(builtinRules.map((entry) => entry.id));

  const overrides = await getOverrideForProfile(repositoryRoot, normalizedProfileId);
  const repositoryDisabledRuleIds = normalizeRuleIdSet(overrides.disableRuleIds);

  const repositoryAddedRules = sortByRuleId(overrides.addedRules.map((entry) => ({ ...entry })));

  for (const rule of repositoryAddedRules) {
    if (seenRuleIds.has(rule.id)) {
      throw new InputValidationError(
        `Repository override adds duplicate rule id '${rule.id}' already in profile '${normalizedProfileId}'`,
        'added_rules',
        {
          profile: normalizedProfileId,
          ruleId: rule.id,
        },
      );
    }

    seenRuleIds.add(rule.id);
  }

  const allRules = [...builtinRules, ...repositoryAddedRules];

  validateRulePatterns(normalizedProfileId, allRules);

  const allRuleIds = allRules.map((entry) => entry.id);
  const allRuleIdSet = new Set(allRuleIds);
  const repositoryDisabledSet = new Set(repositoryDisabledRuleIds);

  const unknownRepositoryDisabled = repositoryDisabledRuleIds.filter((entry) => !allRuleIdSet.has(entry));
  if (unknownRepositoryDisabled.length > 0) {
    throw new InputValidationError('Override disable list contains unknown rule IDs', 'disable_rule_ids', {
      profile: normalizedProfileId,
      unknownRuleIds: unknownRepositoryDisabled,
      availableRuleIds: allRuleIds,
    });
  }

  const normalizedContractDisabled = normalizeRuleIdSet(
    contractDisabledRuleIds.map((entry) => entry.trim()),
  );
  const contractDisabledSet = new Set(normalizedContractDisabled);

  const unknownContractDisabled = normalizedContractDisabled.filter((entry) => !allRuleIdSet.has(entry));
  if (unknownContractDisabled.length > 0) {
    throw new InputValidationError('Contract disables contain unknown rule IDs', 'disabled_stack_rules', {
      profile: normalizedProfileId,
      unknownRuleIds: unknownContractDisabled,
      availableRuleIds: allRuleIds,
    });
  }

  const statusByRuleId = allRules
    .map((rule): { ruleId: string; status: 'active' | 'overridden' | 'disabled' } => {
      if (contractDisabledSet.has(rule.id)) {
        return { ruleId: rule.id, status: 'disabled' };
      }

      if (repositoryDisabledSet.has(rule.id)) {
        return { ruleId: rule.id, status: 'overridden' };
      }

      return { ruleId: rule.id, status: 'active' };
    })
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));

  const effectiveRules = allRules.filter((rule) => !contractDisabledSet.has(rule.id) && !repositoryDisabledSet.has(rule.id));

  return {
    profile_id: normalizedProfileId,
    effectiveRules,
    summary: {
      profile_id: normalizedProfileId,
      effectiveRuleIds: effectiveRules.map((entry) => entry.id),
      overriddenRuleIds: allRules
        .map((entry) => entry.id)
        .filter((entry) => repositoryDisabledSet.has(entry))
        .sort(),
      disabledRuleIds: [...contractDisabledSet].sort(),
      statusByRuleId,
    },
  };
}

export function buildStackReasonCode(ruleId: string): `CBS-${string}` {
  const normalized = ruleId.trim();
  return `CBS-${normalized.toUpperCase().replace(/\//g, '-')}` as `CBS-${string}`;
}
