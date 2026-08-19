// SPEC-009 Phase 1 — pure domain logic for the OpenCode project integration.
//
// This module owns the type system, path resolution, ownership detection,
// content generators, opencode.json parsing/merging, and pre-flight inspection
// for the `changebudget integrate opencode` command. It contains NO CLI
// surface, NO file writes, and NO side-effects beyond reading the filesystem
// to classify resource state. Phase 2 is responsible for orchestration
// (install/update/dry-run/remove) and the CLI command.

import { access, constants as fsConstants, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { InputValidationError } from '../../models/errors.js';

// ---------------------------------------------------------------------------
// T001 — integration types and constants
// ---------------------------------------------------------------------------

/** Ownership state of a managed resource relative to ChangeBudget. */
export type OwnershipState = 'MISSING' | 'MANAGED_CURRENT' | 'MANAGED_STALE' | 'CONFLICT';

/** Action to take on a managed resource during install/remove orchestration. */
export type ResourceAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'REMOVE' | 'CONFLICT' | 'ABSENT';

/** Paths of the project-local files that ChangeBudget manages for OpenCode. */
export const MANAGED_RESOURCES = {
  pluginWrapper: '.opencode/plugins/changebudget.js',
  instructions: '.opencode/instructions/changebudget.md',
  opencodeConfig: 'opencode.json',
} as const;

/** The exact entry string that ChangeBudget appends to `opencode.json`'s `instructions[]`. */
export const INSTRUCTION_ENTRY = '.opencode/instructions/changebudget.md';

/** Marker used to detect that a managed file belongs to ChangeBudget. */
export const OWNERSHIP_MARKER = 'ChangeBudget-managed';

/** Line-1 marker for the `.js` plugin wrapper. */
export const WRAPPER_MARKER = '// ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode';

/** Line-1 marker for the `.md` instructions file. */
export const INSTRUCTIONS_MARKER = '<!-- ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode -->';

/** Status of one managed resource after pre-flight inspection. */
export interface IntegrationResourceStatus {
  path: string;
  action: ResourceAction;
  detail?: string;
}

/** Result of an install/update/dry-run/remove operation. */
export interface IntegrationResult {
  operation: 'install' | 'remove' | 'dry-run';
  resources: {
    pluginWrapper: IntegrationResourceStatus;
    instructions: IntegrationResourceStatus;
    opencodeConfig: IntegrationResourceStatus;
  };
  runtimeGuardTargetExists: boolean;
  baselineWarning: string | null;
  readiness: 'READY' | 'NEEDS_ATTENTION';
}

/** Pre-flight inspection of a target project before any writes. */
export interface PreflightPlan {
  runtimeGuardTargetExists: boolean;
  pluginWrapper: OwnershipState;
  instructions: OwnershipState;
  opencodeConfig: {
    exists: boolean;
    valid: boolean;
    parseError?: string;
    hasInstructionsField: boolean;
    instructionsIsArray: boolean;
    entryPresent: boolean;
  };
  conflicts: string[];
  readyToWrite: boolean;
}

// ---------------------------------------------------------------------------
// T002 — Runtime Guard path resolution + Windows-safe file URL
// ---------------------------------------------------------------------------

/**
 * Resolve the ChangeBudget repository root from `import.meta.url` of this
 * compiled module.
 *
 * The compiled module lives at `dist/src/core/integration/opencode.js`. Five
 * `dirname()` calls climb back to the repository root:
 *
 *   1. dist/src/core/integration/opencode.js → dist/src/core/integration
 *   2. dist/src/core/integration            → dist/src/core
 *   3. dist/src/core                        → dist/src
 *   4. dist/src                             → dist
 *   5. dist                                 → <repository root>
 */
export function resolveChangeBudgetRoot(): string {
  const modulePath = fileURLToPath(import.meta.url);
  return dirname(dirname(dirname(dirname(dirname(modulePath)))));
}

/** Absolute path to the compiled Runtime Guard entrypoint. */
export function resolveRuntimeGuardEntry(root: string): string {
  return join(root, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js');
}

/** `file://` URL for the compiled Runtime Guard entrypoint (Windows-safe). */
export function runtimeGuardFileUrl(root: string): string {
  return pathToFileURL(resolveRuntimeGuardEntry(root)).href;
}

/** Whether the compiled Runtime Guard entrypoint exists on disk. */
export async function runtimeGuardTargetExists(root: string): Promise<boolean> {
  try {
    await access(resolveRuntimeGuardEntry(root), fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// T003 — Ownership detection + wrapper generation
// ---------------------------------------------------------------------------

/**
 * Classify a file's ownership state relative to ChangeBudget.
 *
 * - `MISSING`        — file does not exist
 * - `CONFLICT`       — file exists but does not contain the ownership marker
 * - `MANAGED_CURRENT`— file exists, contains the marker, and is byte-identical to `expectedContent`
 * - `MANAGED_STALE`  — file exists, contains the marker, but differs from `expectedContent`
 */
export async function detectOwnership(filePath: string, expectedContent: string): Promise<OwnershipState> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'MISSING';
    }
    throw error;
  }

  if (!content.includes(OWNERSHIP_MARKER)) {
    return 'CONFLICT';
  }

  if (content === expectedContent) {
    return 'MANAGED_CURRENT';
  }

  return 'MANAGED_STALE';
}

/**
 * Generate the exact content of the plugin wrapper file (2 lines + trailing newline).
 *
 * Line 1: `WRAPPER_MARKER`
 * Line 2: `export { default } from "<file_url>";`
 * Trailing `\n`.
 *
 * Byte-identical for the same `fileUrl`.
 */
export function generateWrapperContent(fileUrl: string): string {
  return `${WRAPPER_MARKER}\nexport { default } from "${fileUrl}";\n`;
}

// ---------------------------------------------------------------------------
// T004 — Instructions generation
// ---------------------------------------------------------------------------

/**
 * Generate the exact content of the agent instructions file.
 *
 * The first line is the HTML-comment marker; the body is 11 generic OpenCode
 * behavioral instructions. No OMO-agent-specific text (no Sisyphus, Prometheus,
 * Atlas, Oracle, OMO). Byte-identical on every call.
 */
export function generateInstructionsContent(): string {
  return `${INSTRUCTIONS_MARKER}\n# ChangeBudget workflow instructions\n\nChangeBudget is the scope authority for the active implementation task.\n\n## Before implementation\n\n- Check whether a ChangeBudget contract is active: run \`changebudget status\`.\n- If no contract is active, start one before modifying files: run \`changebudget start\` with the appropriate allowed paths and budget.\n- For a Spec-Kit \`Txxx\` task with no explicitly chosen budget, run \`changebudget diagnose Txxx\` to get a deterministic budget recommendation.\n- Never widen a ChangeBudget contract automatically. If the work requires more scope than the contract allows, ask the developer.\n\n## During implementation\n\n- Stay within the allowed paths declared in the active contract.\n- Do not modify \`.changebudget/**\` files manually.\n- Do not modify denied or protected paths.\n\n## After implementation\n\n- Run targeted validation (build, typecheck, focused tests).\n- Run \`changebudget check\` to verify the implementation stays within the contract.\n- If the result is \`REPAIR\`, bring the changes back within the existing contract. Do not widen the contract.\n- If the result is \`PASS\`, the implementation satisfies the contract. Note: \`PASS\` does not automatically mean a Spec-Kit task is complete.\n- Close the contract only after implementation validation succeeds: run \`changebudget close\`.\n`;
}

// ---------------------------------------------------------------------------
// T005 — opencode.json parse / merge / validate / serialize
// ---------------------------------------------------------------------------

/** Shape of a parsed `opencode.json`. */
export interface OpenCodeConfig {
  [key: string]: unknown;
  instructions?: string[];
}

/**
 * Parse an `opencode.json` string into a typed object.
 *
 * - Syntax errors → `InputValidationError`
 * - Top-level not an object (null, array, primitive) → `InputValidationError`
 */
export function parseOpenCodeConfig(content: string): OpenCodeConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new InputValidationError(
      `opencode.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      'opencode.json',
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new InputValidationError('opencode.json must contain a JSON object', 'opencode.json');
  }

  return parsed as OpenCodeConfig;
}

/**
 * Return a new config with the given `entry` present in `instructions[]`.
 *
 * - Creates `instructions: [entry]` if the field is absent.
 * - If `instructions` is present but not an array → `InputValidationError`.
 * - If `entry` is already present, the array is returned unchanged (no duplicate).
 * - Otherwise the entry is appended at the end (V8 insertion order preserved).
 */
export function mergeInstructionEntry(config: OpenCodeConfig, entry: string): OpenCodeConfig {
  if (config.instructions === undefined) {
    return { ...config, instructions: [entry] };
  }

  if (!Array.isArray(config.instructions)) {
    throw new InputValidationError(
      'opencode.json "instructions" field must be an array',
      'instructions',
    );
  }

  if (config.instructions.includes(entry)) {
    return config;
  }

  return { ...config, instructions: [...config.instructions, entry] };
}

/** Serialize a config with deterministic 2-space indentation + trailing newline. */
export function serializeConfig(config: OpenCodeConfig): string {
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Smallest valid `opencode.json` with the managed instructions entry already present. */
export function generateMinimalConfig(): OpenCodeConfig {
  return {
    $schema: 'https://opencode.ai/config.json',
    instructions: [INSTRUCTION_ENTRY],
  };
}

/** String form of the minimal config, ready to be written to disk. */
export function generateMinimalConfigString(): string {
  return serializeConfig(generateMinimalConfig());
}

// ---------------------------------------------------------------------------
// T006 — Pre-flight inspection
// ---------------------------------------------------------------------------

/**
 * Inspect every managed resource in the target project and compute a
 * `PreflightPlan`. Read-only: never writes, never deletes, never modifies
 * `.changebudget/**` state.
 *
 * `readyToWrite` is `true` only when:
 *   - the compiled Runtime Guard entrypoint exists, AND
 *   - no ownership conflicts are present, AND
 *   - `opencode.json` either does not exist or is valid, AND
 *   - any present `instructions` field is an array.
 */
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
    detectOwnership(wrapperPath, expectedWrapper),
    detectOwnership(instructionsPath, expectedInstructions),
  ]);

  // opencode.json inspection
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
      if (error instanceof InputValidationError) {
        parseError = error.message;
      } else {
        parseError = String(error);
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      configExists = false;
    } else {
      throw error;
    }
  }

  const conflicts: string[] = [];
  if (wrapperState === 'CONFLICT') {
    conflicts.push(MANAGED_RESOURCES.pluginWrapper);
  }
  if (instructionsState === 'CONFLICT') {
    conflicts.push(MANAGED_RESOURCES.instructions);
  }
  if (configExists && !configValid) {
    conflicts.push(MANAGED_RESOURCES.opencodeConfig);
  }
  if (hasInstructionsField && !instructionsIsArray) {
    conflicts.push('opencode.json: instructions is not an array');
  }

  // `configValid` is `false` for the missing-file case, so we treat
  // `!configExists` as "nothing to validate, the install path will create a
  // valid minimal config" — this is the all-MISSING / clean-project case.
  const configOk = configValid || !configExists;

  const readyToWrite =
    runtimeGuardExists
    && conflicts.length === 0
    && configOk
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
