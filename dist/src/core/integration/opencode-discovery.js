import { join } from 'node:path';
import { generateWrapperContent } from './opencode-content.js';
import { detectOwnership } from './opencode-ownership.js';
import { runtimeGuardFileUrl } from './opencode-runtime.js';
import { MANAGED_RESOURCES, WRAPPER_MARKER } from './opencode-types.js';
/** Discover only the native V2 plugin loader owned by ChangeBudget. */
export async function discoverManagedIntegration(projectRoot, changeBudgetRoot) {
    const state = await detectOwnership(join(projectRoot, MANAGED_RESOURCES.pluginWrapper), WRAPPER_MARKER, generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)));
    switch (state) {
        case 'MISSING':
            return { state: 'ABSENT' };
        case 'CONFLICT':
            return { state: 'CONFLICT' };
        case 'MANAGED_CURRENT':
            return { state: 'MANAGED_CURRENT' };
        case 'MANAGED_STALE':
            return { state: 'MANAGED_STALE' };
    }
}
//# sourceMappingURL=opencode-discovery.js.map