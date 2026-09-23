export { checkGitBaseline } from './opencode-baseline.js';
export { generateWrapperContent } from './opencode-content.js';
export { dryRunIntegration } from './opencode-dry-run.js';
export { installIntegration } from './opencode-install.js';
export { detectOwnership, detectOwnershipForRemoval } from './opencode-ownership.js';
export { inspectIntegration, ownershipToAction } from './opencode-preflight.js';
export { removeIntegration } from './opencode-remove.js';
export {
  resolveChangeBudgetRoot,
  resolveRuntimeGuardEntry,
  runtimeGuardFileUrl,
  runtimeGuardTargetExists,
} from './opencode-runtime.js';
export { MANAGED_RESOURCES, OWNERSHIP_MARKER, WRAPPER_MARKER } from './opencode-types.js';
export type {
  IntegrationResourceStatus,
  IntegrationResult,
  OwnershipState,
  PreflightPlan,
  ResourceAction,
} from './opencode-types.js';
export { discoverManagedIntegration } from './opencode-discovery.js';
export type { ManagedIntegrationDiscovery } from './opencode-discovery.js';
