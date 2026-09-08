import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { IOStateError } from '../../models/errors.js';

import { checkGitBaseline } from './opencode-baseline.js';
import {
  generateMinimalConfigString,
  mergeInstructionEntry,
  parseOpenCodeConfig,
  serializeConfig,
} from './opencode-config.js';
import type { OpenCodeConfig } from './opencode-config.js';
import { generateInstructionsContent, generateWrapperContent } from './opencode-content.js';
import { inspectIntegration, opencodeConfigActionForInstall, ownershipToAction } from './opencode-preflight.js';
import { runtimeGuardFileUrl } from './opencode-runtime.js';
import { INSTRUCTION_ENTRY, MANAGED_RESOURCES } from './opencode-types.js';
import type { IntegrationResult, ResourceAction } from './opencode-types.js';

async function writeFileSafe(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function readExistingConfig(projectRoot: string): Promise<OpenCodeConfig> {
  const configPath = join(projectRoot, MANAGED_RESOURCES.opencodeConfig);
  return parseOpenCodeConfig(await readFile(configPath, 'utf8'));
}

/** Install or update the OpenCode integration into `projectRoot`. */
export async function installIntegration(
  projectRoot: string,
  changeBudgetRoot: string,
): Promise<IntegrationResult> {
  const preflight = await inspectIntegration(projectRoot, changeBudgetRoot);

  if (!preflight.runtimeGuardTargetExists) {
    return {
      operation: 'install',
      resources: {
        pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: 'CONFLICT', detail: 'Runtime Guard not found. Run `npm run build` in the ChangeBudget repository.' },
        instructions: { path: MANAGED_RESOURCES.instructions, action: 'CONFLICT', detail: 'Runtime Guard not found.' },
        opencodeConfig: { path: MANAGED_RESOURCES.opencodeConfig, action: 'CONFLICT', detail: 'Runtime Guard not found.' },
      },
      runtimeGuardTargetExists: false,
      baselineWarning: null,
      readiness: 'NEEDS_ATTENTION',
    };
  }

  if (preflight.conflicts.length > 0) {
    const pluginWrapperAction: ResourceAction = preflight.pluginWrapper === 'CONFLICT' ? 'CONFLICT' : ownershipToAction(preflight.pluginWrapper);
    const instructionsAction: ResourceAction = preflight.instructions === 'CONFLICT' ? 'CONFLICT' : ownershipToAction(preflight.instructions);
    const opencodeConfigAction: ResourceAction = opencodeConfigActionForInstall(preflight);
    return {
      operation: 'install',
      resources: {
        pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: pluginWrapperAction, detail: preflight.pluginWrapper === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined },
        instructions: { path: MANAGED_RESOURCES.instructions, action: instructionsAction, detail: preflight.instructions === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined },
        opencodeConfig: { path: MANAGED_RESOURCES.opencodeConfig, action: opencodeConfigAction, detail: opencodeConfigAction === 'CONFLICT' ? (preflight.opencodeConfig.parseError ?? 'opencode.json is not valid') : (opencodeConfigAction === 'UPDATE' ? 'instruction entry added' : undefined) },
      },
      runtimeGuardTargetExists: true,
      baselineWarning: null,
      readiness: 'NEEDS_ATTENTION',
    };
  }

  const expectedWrapper = generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot));
  const expectedInstructions = generateInstructionsContent();
  const wrapperAction = ownershipToAction(preflight.pluginWrapper);
  const instructionsAction = ownershipToAction(preflight.instructions);
  const opencodeConfigAction = opencodeConfigActionForInstall(preflight);
  const writtenResources: string[] = [];
  const pendingResources: string[] = [];

  try {
    if (wrapperAction !== 'UNCHANGED') {
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.pluginWrapper, expectedWrapper);
      writtenResources.push('pluginWrapper');
    }
    if (instructionsAction !== 'UNCHANGED') {
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.instructions, expectedInstructions);
      writtenResources.push('instructions');
    }
    if (opencodeConfigAction === 'CREATE') {
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.opencodeConfig, generateMinimalConfigString());
      writtenResources.push('opencodeConfig');
    } else if (opencodeConfigAction === 'UPDATE') {
      const existing = await readExistingConfig(projectRoot);
      const merged = mergeInstructionEntry(existing, INSTRUCTION_ENTRY);
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.opencodeConfig, serializeConfig(merged));
      writtenResources.push('opencodeConfig');
    }
  } catch (error) {
    const allWritable: string[] = [];
    if (wrapperAction !== 'UNCHANGED') allWritable.push('pluginWrapper');
    if (instructionsAction !== 'UNCHANGED') allWritable.push('instructions');
    if (opencodeConfigAction === 'CREATE' || opencodeConfigAction === 'UPDATE') {
      allWritable.push('opencodeConfig');
    }

    const lastWritten = writtenResources.length > 0
      ? writtenResources[writtenResources.length - 1]
      : null;
    const failedResource = lastWritten === null
      ? (allWritable[0] ?? 'unknown')
      : (allWritable[allWritable.indexOf(lastWritten) + 1] ?? 'unknown');
    const failedIndex = allWritable.indexOf(failedResource);
    for (let index = failedIndex + 1; index < allWritable.length; index += 1) {
      pendingResources.push(allWritable[index]);
    }

    const failedError = error instanceof Error ? error : new Error(String(error));
    const resourceDetail = (resourceKey: string): string | undefined => {
      if (writtenResources.includes(resourceKey)) return 'written successfully';
      if (resourceKey === failedResource) return `write failed: ${failedError.message}`;
      if (pendingResources.includes(resourceKey)) return 'pending (not attempted)';
      return undefined;
    };

    throw new IOStateError(
      `Integration install failed: ${failedResource} write failed (${failedError.message}). Written: ${writtenResources.join(', ') || 'none'}. Pending: ${pendingResources.join(', ') || 'none'}.`,
      {
        writtenResources,
        failedResource,
        pendingResources,
        cause: failedError.message,
        wrapperDetail: resourceDetail('pluginWrapper'),
        instructionsDetail: resourceDetail('instructions'),
        configDetail: resourceDetail('opencodeConfig'),
      },
    );
  }

  const baselineWarning = wrapperAction === 'UNCHANGED'
    && instructionsAction === 'UNCHANGED'
    && opencodeConfigAction === 'UNCHANGED'
    ? null
    : await checkGitBaseline(projectRoot);
  return {
    operation: 'install',
    resources: {
      pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: wrapperAction },
      instructions: { path: MANAGED_RESOURCES.instructions, action: instructionsAction },
      opencodeConfig: { path: MANAGED_RESOURCES.opencodeConfig, action: opencodeConfigAction, detail: opencodeConfigAction === 'UPDATE' ? 'instruction entry added' : undefined },
    },
    runtimeGuardTargetExists: true,
    baselineWarning,
    readiness: 'READY',
  };
}
