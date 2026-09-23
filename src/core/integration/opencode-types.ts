/** Ownership state of a managed resource relative to ChangeBudget. */
export type OwnershipState = 'MISSING' | 'MANAGED_CURRENT' | 'MANAGED_STALE' | 'CONFLICT';

/** Action to take on a managed resource during install/remove orchestration. */
export type ResourceAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'REMOVE' | 'CONFLICT' | 'ABSENT';

/** The project-local OpenCode V2 resource managed by ChangeBudget. */
export const MANAGED_RESOURCES = {
  pluginWrapper: '.opencode/plugins/changebudget.js',
} as const;

/** Marker used to detect that a managed file belongs to ChangeBudget. */
export const OWNERSHIP_MARKER = 'ChangeBudget-managed';

/** Line-1 marker for the `.js` plugin wrapper. */
export const WRAPPER_MARKER = '// ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode';

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
  };
  runtimeGuardTargetExists: boolean;
  baselineWarning: string | null;
  readiness: 'READY' | 'NEEDS_ATTENTION';
}

/** Pre-flight inspection of a target project before any writes. */
export interface PreflightPlan {
  runtimeGuardTargetExists: boolean;
  pluginWrapper: OwnershipState;
  conflicts: string[];
  readyToWrite: boolean;
}
