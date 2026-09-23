import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IOStateError } from '../../models/errors.js';
import { checkGitBaseline } from './opencode-baseline.js';
import { generateWrapperContent } from './opencode-content.js';
import { inspectIntegration, ownershipToAction } from './opencode-preflight.js';
import { runtimeGuardFileUrl } from './opencode-runtime.js';
import { MANAGED_RESOURCES } from './opencode-types.js';
async function writeFileSafe(projectRoot, relativePath, content) {
    const absolutePath = join(projectRoot, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, 'utf8');
}
/** Install or update the native OpenCode V2 plugin loader in `projectRoot`. */
export async function installIntegration(projectRoot, changeBudgetRoot) {
    const preflight = await inspectIntegration(projectRoot, changeBudgetRoot);
    if (!preflight.runtimeGuardTargetExists) {
        return {
            operation: 'install',
            resources: {
                pluginWrapper: {
                    path: MANAGED_RESOURCES.pluginWrapper,
                    action: 'CONFLICT',
                    detail: 'Runtime Guard not found. Run `npm run compile` in the ChangeBudget repository.',
                },
            },
            runtimeGuardTargetExists: false,
            baselineWarning: null,
            readiness: 'NEEDS_ATTENTION',
        };
    }
    if (preflight.conflicts.length > 0) {
        return {
            operation: 'install',
            resources: {
                pluginWrapper: {
                    path: MANAGED_RESOURCES.pluginWrapper,
                    action: 'CONFLICT',
                    detail: 'File exists without ChangeBudget-managed marker',
                },
            },
            runtimeGuardTargetExists: true,
            baselineWarning: null,
            readiness: 'NEEDS_ATTENTION',
        };
    }
    const wrapperAction = ownershipToAction(preflight.pluginWrapper);
    const writtenResources = [];
    try {
        if (wrapperAction !== 'UNCHANGED') {
            await writeFileSafe(projectRoot, MANAGED_RESOURCES.pluginWrapper, generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)));
            writtenResources.push('pluginWrapper');
        }
    }
    catch (error) {
        const failedError = error instanceof Error ? error : new Error(String(error));
        throw new IOStateError(`Integration install failed: pluginWrapper write failed (${failedError.message}). Written: ${writtenResources.join(', ') || 'none'}.`, {
            writtenResources,
            failedResource: 'pluginWrapper',
            pendingResources: [],
            cause: failedError.message,
            wrapperDetail: `write failed: ${failedError.message}`,
        });
    }
    return {
        operation: 'install',
        resources: {
            pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: wrapperAction },
        },
        runtimeGuardTargetExists: true,
        baselineWarning: wrapperAction === 'UNCHANGED' ? null : await checkGitBaseline(projectRoot),
        readiness: 'READY',
    };
}
//# sourceMappingURL=opencode-install.js.map