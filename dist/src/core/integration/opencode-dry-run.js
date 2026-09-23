import { inspectIntegration, ownershipToAction } from './opencode-preflight.js';
import { MANAGED_RESOURCES } from './opencode-types.js';
/** Report planned installation actions without mutating the target project. */
export async function dryRunIntegration(projectRoot, changeBudgetRoot) {
    const preflight = await inspectIntegration(projectRoot, changeBudgetRoot);
    const wrapperAction = preflight.runtimeGuardTargetExists ? ownershipToAction(preflight.pluginWrapper) : 'CONFLICT';
    return {
        operation: 'dry-run',
        resources: {
            pluginWrapper: {
                path: MANAGED_RESOURCES.pluginWrapper,
                action: wrapperAction,
                detail: wrapperAction === 'CONFLICT' && preflight.pluginWrapper === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined,
            },
        },
        runtimeGuardTargetExists: preflight.runtimeGuardTargetExists,
        baselineWarning: null,
        readiness: preflight.readyToWrite ? 'READY' : 'NEEDS_ATTENTION',
    };
}
//# sourceMappingURL=opencode-dry-run.js.map