export type RuntimePolicyDecision = 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';
export type MutationIntent = 'mutate' | 'read-only';
export type RuntimeAction = 'allow' | 'ask' | 'block';

export interface RuntimeSensitiveInput {
  dependencies: boolean;
  migrations: boolean;
  config: boolean;
  publicApi: boolean;
}

export interface RuntimeProjectionInput {
  policyDecision: RuntimePolicyDecision;
  mutationIntent: MutationIntent;
  targetPath: string | null;
  isInited: boolean;
  isPathDenied: boolean;
  isPathNotAllowed: boolean;
  isSensitive: RuntimeSensitiveInput;
  newFileDenied: boolean;
  targetInChangeBudget: boolean;
  isTargetResolved: boolean;
}

export interface RuntimeProjection {
  runtimeAction: RuntimeAction;
  rule: string;
  reasonCode: string;
  message: string;
}

export interface RuntimeRuleMetadata {
  rule: string;
  reasonCode: string;
}

export const RUNTIME_RULES = {
  PASSIVE_MODE: 'OCG-PASSIVE-MODE',
  REPAIR: 'OCG-REPAIR',
  HUMAN_REVIEW: 'OCG-HUMAN-REVIEW',
  PATH_DENY: 'OCG-PATH-DENY',
  CHANGEBUDGET: 'OCG-CHANGEBUDGET-PROTECT',
  OUT_SCOPE: 'OCG-PATH-OUT-SCOPE',
  DEPENDENCIES: 'OCG-SENSITIVE-DEPENDENCIES',
  MIGRATIONS: 'OCG-SENSITIVE-MIGRATIONS',
  CONFIG: 'OCG-SENSITIVE-CONFIG',
  PUBLIC_API: 'OCG-SENSITIVE-PUBLIC-API',
  NEW_FILE_NOT_ALLOWED: 'OCG-NEW-FILE-NOT-ALLOWED',
  ALLOW: 'OCG-ALLOW',
  UNRESOLVED_MUTATION: 'OCG-UNRESOLVED-MUTATION',
} as const;

function buildMessage(rule: string, reasonCode: string, targetPath: string | null): string {
  const pathHint = targetPath ? ` for ${targetPath}` : '';
  return `${rule} (${reasonCode})${pathHint}.`;
}

export function projectRuntimeDecision(input: RuntimeProjectionInput): RuntimeProjection {
  if (!input.isInited) {
    return {
      runtimeAction: 'allow',
      rule: RUNTIME_RULES.PASSIVE_MODE,
      reasonCode: RUNTIME_RULES.PASSIVE_MODE,
      message: buildMessage(RUNTIME_RULES.PASSIVE_MODE, RUNTIME_RULES.PASSIVE_MODE, input.targetPath),
    };
  }

  if (input.mutationIntent === 'read-only') {
    return {
      runtimeAction: 'allow',
      rule: RUNTIME_RULES.ALLOW,
      reasonCode: RUNTIME_RULES.ALLOW,
      message: buildMessage(RUNTIME_RULES.ALLOW, RUNTIME_RULES.ALLOW, input.targetPath),
    };
  }

  if (!input.isTargetResolved) {
    return {
      runtimeAction: 'block',
      rule: RUNTIME_RULES.UNRESOLVED_MUTATION,
      reasonCode: RUNTIME_RULES.UNRESOLVED_MUTATION,
      message: buildMessage(RUNTIME_RULES.UNRESOLVED_MUTATION, RUNTIME_RULES.UNRESOLVED_MUTATION, input.targetPath),
    };
  }

  if (input.targetInChangeBudget) {
    return {
      runtimeAction: 'block',
      rule: RUNTIME_RULES.CHANGEBUDGET,
      reasonCode: RUNTIME_RULES.CHANGEBUDGET,
      message: buildMessage(RUNTIME_RULES.CHANGEBUDGET, RUNTIME_RULES.CHANGEBUDGET, input.targetPath),
    };
  }

  if (input.isPathDenied) {
    return {
      runtimeAction: 'block',
      rule: RUNTIME_RULES.PATH_DENY,
      reasonCode: RUNTIME_RULES.PATH_DENY,
      message: buildMessage(RUNTIME_RULES.PATH_DENY, RUNTIME_RULES.PATH_DENY, input.targetPath),
    };
  }

  if (input.policyDecision === 'REPAIR') {
    return {
      runtimeAction: 'block',
      rule: RUNTIME_RULES.REPAIR,
      reasonCode: RUNTIME_RULES.REPAIR,
      message: buildMessage(RUNTIME_RULES.REPAIR, RUNTIME_RULES.REPAIR, input.targetPath),
    };
  }

  if (input.policyDecision === 'HUMAN_REVIEW') {
    return {
      runtimeAction: 'block',
      rule: RUNTIME_RULES.HUMAN_REVIEW,
      reasonCode: RUNTIME_RULES.HUMAN_REVIEW,
      message: buildMessage(RUNTIME_RULES.HUMAN_REVIEW, RUNTIME_RULES.HUMAN_REVIEW, input.targetPath),
    };
  }

  if (input.newFileDenied) {
    return {
      runtimeAction: 'block',
      rule: RUNTIME_RULES.NEW_FILE_NOT_ALLOWED,
      reasonCode: RUNTIME_RULES.NEW_FILE_NOT_ALLOWED,
      message: buildMessage(RUNTIME_RULES.NEW_FILE_NOT_ALLOWED, RUNTIME_RULES.NEW_FILE_NOT_ALLOWED, input.targetPath),
    };
  }

  if (input.isPathNotAllowed) {
    return {
      runtimeAction: 'ask',
      rule: RUNTIME_RULES.OUT_SCOPE,
      reasonCode: RUNTIME_RULES.OUT_SCOPE,
      message: buildMessage(RUNTIME_RULES.OUT_SCOPE, RUNTIME_RULES.OUT_SCOPE, input.targetPath),
    };
  }

  if (input.isSensitive.dependencies) {
    return {
      runtimeAction: 'ask',
      rule: RUNTIME_RULES.DEPENDENCIES,
      reasonCode: RUNTIME_RULES.DEPENDENCIES,
      message: buildMessage(RUNTIME_RULES.DEPENDENCIES, RUNTIME_RULES.DEPENDENCIES, input.targetPath),
    };
  }

  if (input.isSensitive.migrations) {
    return {
      runtimeAction: 'ask',
      rule: RUNTIME_RULES.MIGRATIONS,
      reasonCode: RUNTIME_RULES.MIGRATIONS,
      message: buildMessage(RUNTIME_RULES.MIGRATIONS, RUNTIME_RULES.MIGRATIONS, input.targetPath),
    };
  }

  if (input.isSensitive.config) {
    return {
      runtimeAction: 'ask',
      rule: RUNTIME_RULES.CONFIG,
      reasonCode: RUNTIME_RULES.CONFIG,
      message: buildMessage(RUNTIME_RULES.CONFIG, RUNTIME_RULES.CONFIG, input.targetPath),
    };
  }

  if (input.isSensitive.publicApi) {
    return {
      runtimeAction: 'ask',
      rule: RUNTIME_RULES.PUBLIC_API,
      reasonCode: RUNTIME_RULES.PUBLIC_API,
      message: buildMessage(RUNTIME_RULES.PUBLIC_API, RUNTIME_RULES.PUBLIC_API, input.targetPath),
    };
  }

  return {
    runtimeAction: 'allow',
    rule: RUNTIME_RULES.ALLOW,
    reasonCode: RUNTIME_RULES.ALLOW,
    message: buildMessage(RUNTIME_RULES.ALLOW, RUNTIME_RULES.ALLOW, input.targetPath),
  };
}

export function toRuntimePermissionStatus(runtimeAction: RuntimeAction): 'allow' | 'deny' | 'ask' {
  if (runtimeAction === 'allow') {
    return 'allow';
  }

  if (runtimeAction === 'ask') {
    return 'ask';
  }

  return 'deny';
}
