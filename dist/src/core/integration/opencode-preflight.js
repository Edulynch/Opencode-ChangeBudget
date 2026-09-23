import { join } from 'node:path';
import { generateWrapperContent } from './opencode-content.js';
import { detectOwnership } from './opencode-ownership.js';
import { runtimeGuardFileUrl, runtimeGuardTargetExists } from './opencode-runtime.js';
import { MANAGED_RESOURCES, WRAPPER_MARKER } from './opencode-types.js';
/** Inspect the managed OpenCode V2 plugin wrapper before any writes. */
export async function inspectIntegration(projectRoot, changeBudgetRoot) {
    const runtimeGuardExists = await runtimeGuardTargetExists(changeBudgetRoot);
    const wrapperState = await detectOwnership(join(projectRoot, MANAGED_RESOURCES.pluginWrapper), WRAPPER_MARKER, generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)));
    const conflicts = wrapperState === 'CONFLICT' ? [MANAGED_RESOURCES.pluginWrapper] : [];
    return {
        runtimeGuardTargetExists: runtimeGuardExists,
        pluginWrapper: wrapperState,
        conflicts,
        readyToWrite: runtimeGuardExists && conflicts.length === 0,
    };
}
/** Map an ownership state to the corresponding install-side resource action. */
export function ownershipToAction(state) {
    switch (state) {
        case 'MISSING':
            return 'CREATE';
        case 'MANAGED_STALE':
            return 'UPDATE';
        case 'MANAGED_CURRENT':
            return 'UNCHANGED';
        case 'CONFLICT':
            return 'CONFLICT';
    }
}
//# sourceMappingURL=opencode-preflight.js.map