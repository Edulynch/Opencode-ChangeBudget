import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { InputValidationError } from '../../models/errors.js';

import { parseOpenCodeConfig } from './opencode-config.js';
import { generateInstructionsContent, generateWrapperContent } from './opencode-content.js';
import { detectOwnership } from './opencode-ownership.js';
import { runtimeGuardFileUrl, runtimeGuardTargetExists } from './opencode-runtime.js';
import {
  INSTRUCTION_ENTRY,
  INSTRUCTIONS_MARKER,
  MANAGED_RESOURCES,
  WRAPPER_MARKER,
} from './opencode-types.js';
import type { OwnershipState, PreflightPlan, ResourceAction } from './opencode-types.js';

/** Inspect every managed resource in the target project before any writes. */
export async function inspectIntegration(
  projectRoot: string,
  changeBudgetRoot: string,
): Promise<PreflightPlan> {
  const runtimeGuardExists = await runtimeGuardTargetExists(changeBudgetRoot);
  const wrapperPath = join(projectRoot, MANAGED_RESOURCES.pluginWrapper);
  const instructionsPath = join(projectRoot, MANAGED_RESOURCES.instructions);
  const configPath = join(projectRoot, MANAGED_RESOURCES.opencodeConfig);
  const expectedWrapper = generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot));
  const expectedInstructions = generateInstructionsContent();

  const [wrapperState, instructionsState] = await Promise.all([
    detectOwnership(wrapperPath, WRAPPER_MARKER, expectedWrapper),
    detectOwnership(instructionsPath, INSTRUCTIONS_MARKER, expectedInstructions),
  ]);

  let configExists = false;
  let configValid = false;
  let parseError: string | undefined;
  let hasInstructionsField = false;
  let instructionsIsArray = false;
  let entryPresent = false;

  try {
    const configContent = await readFile(configPath, 'utf8');
    configExists = true;
    try {
      const config = parseOpenCodeConfig(configContent);
      configValid = true;
      hasInstructionsField = config.instructions !== undefined;
      instructionsIsArray = Array.isArray(config.instructions);
      entryPresent = instructionsIsArray && config.instructions!.includes(INSTRUCTION_ENTRY);
    } catch (error) {
      parseError = error instanceof InputValidationError ? error.message : String(error);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const conflicts: string[] = [];
  if (wrapperState === 'CONFLICT') conflicts.push(MANAGED_RESOURCES.pluginWrapper);
  if (instructionsState === 'CONFLICT') conflicts.push(MANAGED_RESOURCES.instructions);
  if (configExists && !configValid) conflicts.push(MANAGED_RESOURCES.opencodeConfig);
  if (hasInstructionsField && !instructionsIsArray) {
    conflicts.push('opencode.json: instructions is not an array');
  }

  const readyToWrite = runtimeGuardExists
    && conflicts.length === 0
    && (configValid || !configExists)
    && (!hasInstructionsField || instructionsIsArray);

  return {
    runtimeGuardTargetExists: runtimeGuardExists,
    pluginWrapper: wrapperState,
    instructions: instructionsState,
    opencodeConfig: {
      exists: configExists,
      valid: configValid,
      parseError,
      hasInstructionsField,
      instructionsIsArray,
      entryPresent,
    },
    conflicts,
    readyToWrite,
  };
}

/** Map an ownership state to the corresponding install-side resource action. */
export function ownershipToAction(state: OwnershipState): ResourceAction {
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

/** Compute the install-side action for `opencode.json`. */
export function opencodeConfigActionForInstall(preflight: PreflightPlan): ResourceAction {
  if (preflight.opencodeConfig.exists && !preflight.opencodeConfig.valid) return 'CONFLICT';
  if (preflight.opencodeConfig.entryPresent) return 'UNCHANGED';
  return preflight.opencodeConfig.exists ? 'UPDATE' : 'CREATE';
}
