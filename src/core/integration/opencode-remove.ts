import { access, constants as fsConstants, readdir, readFile, rm, unlink, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { IOStateError, InputValidationError } from '../../models/errors.js';

import { parseOpenCodeConfig, serializeConfig } from './opencode-config.js';
import type { OpenCodeConfig } from './opencode-config.js';
import { detectOwnershipForRemoval } from './opencode-ownership.js';
import { INSTRUCTION_ENTRY, INSTRUCTIONS_MARKER, MANAGED_RESOURCES, WRAPPER_MARKER } from './opencode-types.js';
import type { IntegrationResult, ResourceAction } from './opencode-types.js';

async function writeFileSafe(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function readExistingConfig(projectRoot: string): Promise<OpenCodeConfig> {
  return parseOpenCodeConfig(await readFile(join(projectRoot, MANAGED_RESOURCES.opencodeConfig), 'utf8'));
}

async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    return (await readdir(dirPath)).length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

async function removeEmptyDir(dirPath: string): Promise<void> {
  if (!(await isDirectoryEmpty(dirPath))) return;
  await rm(dirPath, { recursive: true, force: true });
}

/** Remove the OpenCode integration from `projectRoot`. */
export async function removeIntegration(projectRoot: string): Promise<IntegrationResult> {
  const wrapperPath = join(projectRoot, MANAGED_RESOURCES.pluginWrapper);
  const instructionsPath = join(projectRoot, MANAGED_RESOURCES.instructions);
  const configPath = join(projectRoot, MANAGED_RESOURCES.opencodeConfig);
  const wrapperOwnership = await detectOwnershipForRemoval(wrapperPath, WRAPPER_MARKER);
  const instructionsOwnership = await detectOwnershipForRemoval(instructionsPath, INSTRUCTIONS_MARKER);
  const configExists = await access(configPath, fsConstants.F_OK).then(() => true, () => false);

  let configValid = false;
  let parseError: string | undefined;
  let entryPresent = false;
  if (configExists) {
    try {
      const parsed = parseOpenCodeConfig(await readFile(configPath, 'utf8'));
      configValid = true;
      entryPresent = Array.isArray(parsed.instructions) && parsed.instructions.includes(INSTRUCTION_ENTRY);
    } catch (error) {
      parseError = error instanceof InputValidationError ? error.message : String(error);
    }
  }

  const opencodeConfigAction: ResourceAction = (configExists && !configValid)
    ? 'CONFLICT'
    : (entryPresent ? 'REMOVE' : 'ABSENT');
  const hasConflict = wrapperOwnership === 'CONFLICT'
    || instructionsOwnership === 'CONFLICT'
    || (configExists && !configValid);
  const wrapperAction: ResourceAction = hasConflict
    ? (wrapperOwnership === 'CONFLICT' ? 'CONFLICT' : 'ABSENT')
    : (wrapperOwnership === 'MISSING' ? 'ABSENT' : 'REMOVE');
  const instructionsAction: ResourceAction = hasConflict
    ? (instructionsOwnership === 'CONFLICT' ? 'CONFLICT' : 'ABSENT')
    : (instructionsOwnership === 'MISSING' ? 'ABSENT' : 'REMOVE');

  if (hasConflict) {
    return {
      operation: 'remove',
      resources: {
        pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: wrapperAction, detail: wrapperAction === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined },
        instructions: { path: MANAGED_RESOURCES.instructions, action: instructionsAction, detail: instructionsAction === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined },
        opencodeConfig: { path: MANAGED_RESOURCES.opencodeConfig, action: opencodeConfigAction, detail: opencodeConfigAction === 'CONFLICT' ? (parseError ?? 'opencode.json is not valid') : undefined },
      },
      runtimeGuardTargetExists: true,
      baselineWarning: null,
      readiness: 'NEEDS_ATTENTION',
    };
  }

  if (opencodeConfigAction === 'REMOVE') {
    try {
      const existing = await readExistingConfig(projectRoot);
      const nextInstructions = (existing.instructions ?? []).filter((entry) => entry !== INSTRUCTION_ENTRY);
      const nextConfig: OpenCodeConfig = { ...existing };
      if (nextInstructions.length > 0) {
        nextConfig.instructions = nextInstructions;
      } else {
        delete nextConfig.instructions;
      }
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.opencodeConfig, serializeConfig(nextConfig));
    } catch (error) {
      throw new IOStateError(
        `failed to update ${MANAGED_RESOURCES.opencodeConfig} during remove: ${error instanceof Error ? error.message : String(error)}`,
        { path: MANAGED_RESOURCES.opencodeConfig },
      );
    }
  }

  if (wrapperAction === 'REMOVE') {
    try {
      await unlink(wrapperPath);
    } catch (error) {
      throw new IOStateError(
        `failed to remove ${MANAGED_RESOURCES.pluginWrapper}: ${error instanceof Error ? error.message : String(error)}`,
        { path: MANAGED_RESOURCES.pluginWrapper },
      );
    }
  }
  if (instructionsAction === 'REMOVE') {
    try {
      await unlink(instructionsPath);
    } catch (error) {
      throw new IOStateError(
        `failed to remove ${MANAGED_RESOURCES.instructions}: ${error instanceof Error ? error.message : String(error)}`,
        { path: MANAGED_RESOURCES.instructions },
      );
    }
  }
  if (wrapperAction === 'REMOVE') await removeEmptyDir(dirname(wrapperPath));
  if (instructionsAction === 'REMOVE') await removeEmptyDir(dirname(instructionsPath));

  return {
    operation: 'remove',
    resources: {
      pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: wrapperAction },
      instructions: { path: MANAGED_RESOURCES.instructions, action: instructionsAction },
      opencodeConfig: { path: MANAGED_RESOURCES.opencodeConfig, action: opencodeConfigAction, detail: opencodeConfigAction === 'REMOVE' ? 'instruction entry removed' : undefined },
    },
    runtimeGuardTargetExists: true,
    baselineWarning: null,
    readiness: 'READY',
  };
}
