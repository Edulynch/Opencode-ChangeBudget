/** Ownership state of a managed resource relative to ChangeBudget. */
export type OwnershipState = 'MISSING' | 'MANAGED_CURRENT' | 'MANAGED_STALE' | 'CONFLICT';

/** Action to take on a managed resource during install/remove orchestration. */
export type ResourceAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'REMOVE' | 'CONFLICT' | 'ABSENT';

/** Paths of the project-local files that ChangeBudget manages for OpenCode. */
export const MANAGED_RESOURCES = {
  pluginWrapper: '.opencode/plugins/changebudget.js',
  instructions: '.opencode/instructions/changebudget.md',
  opencodeConfig: 'opencode.json',
} as const;

/** The exact entry string that ChangeBudget appends to `opencode.json`'s `instructions[]`. */
export const INSTRUCTION_ENTRY = '.opencode/instructions/changebudget.md';

/** Marker used to detect that a managed file belongs to ChangeBudget. */
export const OWNERSHIP_MARKER = 'ChangeBudget-managed';

/** Line-1 marker for the `.js` plugin wrapper. */
export const WRAPPER_MARKER = '// ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode';

/** Line-1 marker for the `.md` instructions file. */
export const INSTRUCTIONS_MARKER = '<!-- ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode -->';

export const INSTRUCTIONS_PROFILE_METADATA = '<!-- ChangeBudget-profile:';

/** Status of one managed resource after pre-flight inspection. */
export interface IntegrationResourceStatus {
  path: string;
  action: ResourceAction;
  detail?: string;
}

/** Result of an install/update/dry-run/remove operation. */
export interface IntegrationResult {
  operation: 'install' | 'remove' | 'dry-run';
  resources: {
    pluginWrapper: IntegrationResourceStatus;
    instructions: IntegrationResourceStatus;
    opencodeConfig: IntegrationResourceStatus;
  };
  runtimeGuardTargetExists: boolean;
  baselineWarning: string | null;
  readiness: 'READY' | 'NEEDS_ATTENTION';
}

/** Pre-flight inspection of a target project before any writes. */
export interface PreflightPlan {
  runtimeGuardTargetExists: boolean;
  pluginWrapper: OwnershipState;
  instructions: OwnershipState;
  opencodeConfig: {
    exists: boolean;
    valid: boolean;
    parseError?: string;
    hasInstructionsField: boolean;
    instructionsIsArray: boolean;
    entryPresent: boolean;
  };
  conflicts: string[];
  readyToWrite: boolean;
}
