import { inspectIntegration, opencodeConfigActionForInstall, ownershipToAction } from './opencode-preflight.js';
import { MANAGED_RESOURCES } from './opencode-types.js';
/** Report planned installation actions without mutating the target project. */
export async function dryRunIntegration(projectRoot, changeBudgetRoot) {
    const preflight = await inspectIntegration(projectRoot, changeBudgetRoot);
    const wrapperAction = preflight.runtimeGuardTargetExists ? ownershipToAction(preflight.pluginWrapper) : 'CONFLICT';
    const instructionsAction = preflight.runtimeGuardTargetExists ? ownershipToAction(preflight.instructions) : 'CONFLICT';
    const opencodeConfigAction = preflight.runtimeGuardTargetExists ? opencodeConfigActionForInstall(preflight) : 'CONFLICT';
    const opencodeConfigDetail = !preflight.runtimeGuardTargetExists
        ? 'Runtime Guard not found.'
        : (opencodeConfigAction === 'UPDATE'
            ? 'instruction entry would be added'
            : (opencodeConfigAction === 'CONFLICT'
                ? (preflight.opencodeConfig.parseError ?? 'opencode.json is not valid')
                : undefined));
    return {
        operation: 'dry-run',
        resources: {
            pluginWrapper: {
                path: MANAGED_RESOURCES.pluginWrapper,
                action: wrapperAction,
                detail: wrapperAction === 'CONFLICT' && preflight.pluginWrapper === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined,
            },
            instructions: {
                path: MANAGED_RESOURCES.instructions,
                action: instructionsAction,
                detail: instructionsAction === 'CONFLICT' && preflight.instructions === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined,
            },
            opencodeConfig: { path: MANAGED_RESOURCES.opencodeConfig, action: opencodeConfigAction, detail: opencodeConfigDetail },
        },
        runtimeGuardTargetExists: preflight.runtimeGuardTargetExists,
        baselineWarning: null,
        readiness: preflight.readyToWrite ? 'READY' : 'NEEDS_ATTENTION',
    };
}
//# sourceMappingURL=opencode-dry-run.js.map