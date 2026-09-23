import { readdir, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { IOStateError } from '../../models/errors.js';

import { detectOwnershipForRemoval } from './opencode-ownership.js';
import { MANAGED_RESOURCES, WRAPPER_MARKER } from './opencode-types.js';
import type { IntegrationResult, ResourceAction } from './opencode-types.js';

async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    return (await readdir(dirPath)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

async function removeEmptyDir(dirPath: string): Promise<void> {
  if (await isDirectoryEmpty(dirPath)) {
    await rm(dirPath, { recursive: true, force: true });
  }
}

/** Remove only the ChangeBudget-owned OpenCode V2 plugin loader. */
export async function removeIntegration(projectRoot: string): Promise<IntegrationResult> {
  const wrapperPath = join(projectRoot, MANAGED_RESOURCES.pluginWrapper);
  const ownership = await detectOwnershipForRemoval(wrapperPath, WRAPPER_MARKER);
  const wrapperAction: ResourceAction = ownership === 'MISSING'
    ? 'ABSENT'
    : ownership === 'CONFLICT'
      ? 'CONFLICT'
      : 'REMOVE';

  if (wrapperAction === 'CONFLICT') {
    return {
      operation: 'remove',
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

  if (wrapperAction === 'REMOVE') {
    try {
      await unlink(wrapperPath);
      await removeEmptyDir(dirname(wrapperPath));
    } catch (error) {
      throw new IOStateError(
        `failed to remove ${MANAGED_RESOURCES.pluginWrapper}: ${error instanceof Error ? error.message : String(error)}`,
        { path: MANAGED_RESOURCES.pluginWrapper },
      );
    }
  }

  return {
    operation: 'remove',
    resources: {
      pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: wrapperAction },
    },
    runtimeGuardTargetExists: true,
    baselineWarning: null,
    readiness: 'READY',
  };
}
