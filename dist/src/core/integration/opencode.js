// Compatibility facade for the OpenCode project integration.
export { checkGitBaseline } from './opencode-baseline.js';
export { generateMinimalConfig, generateMinimalConfigString, mergeInstructionEntry, parseOpenCodeConfig, serializeConfig, } from './opencode-config.js';
export { generateInstructionsContent, generateWrapperContent } from './opencode-content.js';
export { dryRunIntegration } from './opencode-dry-run.js';
export { installIntegration } from './opencode-install.js';
export { detectOwnership, detectOwnershipForRemoval } from './opencode-ownership.js';
export { inspectIntegration, ownershipToAction } from './opencode-preflight.js';
export { removeIntegration } from './opencode-remove.js';
export { resolveChangeBudgetRoot, resolveRuntimeGuardEntry, runtimeGuardFileUrl, runtimeGuardTargetExists, } from './opencode-runtime.js';
export { INSTRUCTIONS_MARKER, INSTRUCTIONS_PROFILE_METADATA, INSTRUCTION_ENTRY, MANAGED_RESOURCES, OWNERSHIP_MARKER, WRAPPER_MARKER, } from './opencode-types.js';
export { INTEGRATION_PROFILES, getIntegrationProfile } from './profiles.js';
export { discoverManagedIntegration } from './opencode-discovery.js';
//# sourceMappingURL=opencode.js.map