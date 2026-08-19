// SPEC-009 Phase 1 — pure domain logic for the OpenCode project integration.
//
// This module owns the type system, path resolution, ownership detection,
// content generators, opencode.json parsing/merging, and pre-flight inspection
// for the `changebudget integrate opencode` command. It contains NO CLI
// surface, NO file writes, and NO side-effects beyond reading the filesystem
// to classify resource state. Phase 2 is responsible for orchestration
// (install/update/dry-run/remove) and the CLI command.

import { spawnSync } from 'node:child_process';
import {
  access,
  constants as fsConstants,
  mkdir,
  readdir,
  readFile,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { InputValidationError, IOStateError } from '../../models/errors.js';

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

// ---------------------------------------------------------------------------
// T008 / T009 — install / update orchestration (idempotent)
// ---------------------------------------------------------------------------

/** Map an `OwnershipState` to the corresponding install-side `ResourceAction`. */
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

/**
 * Compute the install-side action for `opencode.json`.
 *
 * - `!valid` (exists but malformed) → CONFLICT (refused)
 * - `entryPresent` → UNCHANGED (already registered)
 * - otherwise → CREATE if missing, UPDATE if existing valid
 */
function opencodeConfigActionForInstall(preflight: PreflightPlan): ResourceAction {
  if (preflight.opencodeConfig.exists && !preflight.opencodeConfig.valid) {
    return 'CONFLICT';
  }
  if (preflight.opencodeConfig.entryPresent) {
    return 'UNCHANGED';
  }
  return preflight.opencodeConfig.exists ? 'UPDATE' : 'CREATE';
}

async function writeFileSafe(projectRoot: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = join(projectRoot, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

async function readExistingConfig(projectRoot: string): Promise<OpenCodeConfig> {
  const configPath = join(projectRoot, MANAGED_RESOURCES.opencodeConfig);
  return parseOpenCodeConfig(await readFile(configPath, 'utf8'));
}

/**
 * Install or update the OpenCode integration into `projectRoot`.
 *
 * Reuses the Phase 1 `inspectIntegration` pre-flight. If the Runtime Guard
 * is missing or any resource is in CONFLICT, the function returns
 * `NEEDS_ATTENTION` without writing anything.
 *
 * Write order: wrapper → instructions → opencode.json. Any unexpected
 * filesystem error after pre-flight passes leaves the function in a
 * partially-installed state and returns `NEEDS_ATTENTION` with the per-
 * resource actions frozen at the point of failure.
 *
 * Idempotent re-runs:
 *   - MANAGED_CURRENT  → UNCHANGED (no write)
 *   - MANAGED_STALE    → UPDATE
 *   - MISSING          → CREATE
 *   - CONFLICT         → refused
 *
 * After successful writes, `checkGitBaseline` is invoked to produce the
 * informational Git-baseline warning (R-7). The function never invokes
 * `git add`, `git commit`, amend, or push.
 */
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

  const wrapperAction: ResourceAction = ownershipToAction(preflight.pluginWrapper);
  const instructionsAction: ResourceAction = ownershipToAction(preflight.instructions);
  const opencodeConfigAction: ResourceAction = opencodeConfigActionForInstall(preflight);

  // R-6 — write order: wrapper → instructions → opencode.json
  try {
    if (wrapperAction !== 'UNCHANGED') {
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.pluginWrapper, expectedWrapper);
    }
    if (instructionsAction !== 'UNCHANGED') {
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.instructions, expectedInstructions);
    }
    if (opencodeConfigAction === 'CREATE') {
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.opencodeConfig, generateMinimalConfigString());
    } else if (opencodeConfigAction === 'UPDATE') {
      const existing = await readExistingConfig(projectRoot);
      const merged = mergeInstructionEntry(existing, INSTRUCTION_ENTRY);
      await writeFileSafe(projectRoot, MANAGED_RESOURCES.opencodeConfig, serializeConfig(merged));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      operation: 'install',
      resources: {
        pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: wrapperAction, detail: wrapperAction !== 'UNCHANGED' ? `write failed: ${detail}` : undefined },
        instructions: { path: MANAGED_RESOURCES.instructions, action: instructionsAction, detail: instructionsAction !== 'UNCHANGED' ? `write failed: ${detail}` : undefined },
        opencodeConfig: { path: MANAGED_RESOURCES.opencodeConfig, action: opencodeConfigAction, detail: opencodeConfigAction !== 'UNCHANGED' ? `write failed: ${detail}` : undefined },
      },
      runtimeGuardTargetExists: true,
      baselineWarning: null,
      readiness: 'NEEDS_ATTENTION',
    };
  }

  // Successful install/update — return READY.
  const opencodeConfigDetail = opencodeConfigAction === 'UPDATE'
    ? 'instruction entry added'
    : undefined;

  const baselineWarning = await checkGitBaseline(projectRoot);

  return {
    operation: 'install',
    resources: {
      pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: wrapperAction },
      instructions: { path: MANAGED_RESOURCES.instructions, action: instructionsAction },
      opencodeConfig: { path: MANAGED_RESOURCES.opencodeConfig, action: opencodeConfigAction, detail: opencodeConfigDetail },
    },
    runtimeGuardTargetExists: true,
    baselineWarning,
    readiness: 'READY',
  };
}

// ---------------------------------------------------------------------------
// T010 — dry-run orchestration (no writes, no Git changes)
// ---------------------------------------------------------------------------

/**
 * Dry-run install/update. Reuses the Phase 1 `inspectIntegration` pre-flight
 * and reports CREATE / UPDATE / UNCHANGED / CONFLICT per resource without
 * touching the filesystem, `.changebudget/**`, or Git state.
 */
export async function dryRunIntegration(
  projectRoot: string,
  changeBudgetRoot: string,
): Promise<IntegrationResult> {
  const preflight = await inspectIntegration(projectRoot, changeBudgetRoot);

  const wrapperAction = preflight.runtimeGuardTargetExists ? ownershipToAction(preflight.pluginWrapper) : 'CONFLICT';
  const instructionsAction = preflight.runtimeGuardTargetExists ? ownershipToAction(preflight.instructions) : 'CONFLICT';
  const opencodeConfigAction = preflight.runtimeGuardTargetExists ? opencodeConfigActionForInstall(preflight) : 'CONFLICT';

  const readiness: 'READY' | 'NEEDS_ATTENTION' = preflight.readyToWrite ? 'READY' : 'NEEDS_ATTENTION';

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
      opencodeConfig: {
        path: MANAGED_RESOURCES.opencodeConfig,
        action: opencodeConfigAction,
        detail: opencodeConfigDetail,
      },
    },
    runtimeGuardTargetExists: preflight.runtimeGuardTargetExists,
    baselineWarning: null,
    readiness,
  };
}

// ---------------------------------------------------------------------------
// T011 — remove / uninstall orchestration
// ---------------------------------------------------------------------------

/**
 * Ownership check that does NOT compare content. Removal only needs to
 * distinguish MANAGED (marker present) from CONFLICT (no marker) from
 * MISSING — the existing `detectOwnership` always compares against an
 * expected content string, which would falsely flag stale managed files
 * as conflict during removal.
 */
export async function detectOwnershipForRemoval(filePath: string): Promise<OwnershipState> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'MISSING';
    }
    throw error;
  }
  return content.includes(OWNERSHIP_MARKER) ? 'MANAGED_CURRENT' : 'CONFLICT';
}

async function isDirectoryEmpty(dirPath: string): Promise<boolean> {
  try {
    const entries = await readdir(dirPath);
    return entries.length === 0;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return true;
    }
    throw error;
  }
}

async function removeEmptyDir(dirPath: string): Promise<void> {
  if (!(await isDirectoryEmpty(dirPath))) {
    return;
  }
  await rm(dirPath, { recursive: true, force: true });
}

/**
 * Compute the removal-side action for `opencode.json`.
 * - !valid (exists but malformed) → CONFLICT (refused)
 * - entryPresent → REMOVE (will remove the entry)
 * - otherwise → ABSENT (no entry to remove, file is not ours)
 */
function opencodeConfigActionForRemoval(preflight: PreflightPlan): ResourceAction {
  if (preflight.opencodeConfig.exists && !preflight.opencodeConfig.valid) {
    return 'CONFLICT';
  }
  if (preflight.opencodeConfig.entryPresent) {
    return 'REMOVE';
  }
  return 'ABSENT';
}

/**
 * Remove the OpenCode integration from `projectRoot`.
 *
 * - Inspects ownership of every managed resource via `detectOwnershipForRemoval`.
 * - If any resource is CONFLICT → refuses, reports, zero deletes.
 * - Otherwise deletes MANAGED files, removes the exact INSTRUCTION_ENTRY
 *   from `opencode.json`'s `instructions[]`, preserves all other fields,
 *   and reserializes with the same 2-space indent.
 * - Optionally removes now-empty `.opencode/plugins/` and
 *   `.opencode/instructions/` directories (R-10).
 * - Never deletes `opencode.json`, `AGENTS.md`, or `.opencode/` when it
 *   contains unrelated content.
 * - Idempotent: ABSENT for every resource → exits with `readiness: READY`.
 */
export async function removeIntegration(projectRoot: string): Promise<IntegrationResult> {
  const wrapperPath = join(projectRoot, MANAGED_RESOURCES.pluginWrapper);
  const instructionsPath = join(projectRoot, MANAGED_RESOURCES.instructions);
  const configPath = join(projectRoot, MANAGED_RESOURCES.opencodeConfig);

  const wrapperOwnership = await detectOwnershipForRemoval(wrapperPath);
  const instructionsOwnership = await detectOwnershipForRemoval(instructionsPath);

  // opencode.json preflight — reuse inspectIntegration but we need only the
  // opencodeConfig sub-shape. Calling inspectIntegration requires the
  // Runtime Guard entrypoint; remove does not, so we inline the config check.
  const configExists = await access(configPath, fsConstants.F_OK).then(
    () => true,
    () => false,
  );

  let configValid = false;
  let parseError: string | undefined;
  let entryPresent = false;

  if (configExists) {
    try {
      const parsed = parseOpenCodeConfig(await readFile(configPath, 'utf8'));
      configValid = true;
      entryPresent = Array.isArray(parsed.instructions) && parsed.instructions.includes(INSTRUCTION_ENTRY);
    } catch (error) {
      if (error instanceof InputValidationError) {
        parseError = error.message;
      } else {
        parseError = String(error);
      }
    }
  }

  const opencodeConfigAction: ResourceAction = (configExists && !configValid)
    ? 'CONFLICT'
    : (entryPresent ? 'REMOVE' : 'ABSENT');

  // Decide whether we will perform any deletes. Any CONFLICT refuses the
  // entire remove and forces every action to ABSENT (no action taken).
  const hasConflict = wrapperOwnership === 'CONFLICT' || instructionsOwnership === 'CONFLICT' || (configExists && !configValid);

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
        pluginWrapper: {
          path: MANAGED_RESOURCES.pluginWrapper,
          action: wrapperAction,
          detail: wrapperAction === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined,
        },
        instructions: {
          path: MANAGED_RESOURCES.instructions,
          action: instructionsAction,
          detail: instructionsAction === 'CONFLICT' ? 'File exists without ChangeBudget-managed marker' : undefined,
        },
        opencodeConfig: {
          path: MANAGED_RESOURCES.opencodeConfig,
          action: opencodeConfigAction,
          detail: opencodeConfigAction === 'CONFLICT' ? (parseError ?? 'opencode.json is not valid') : undefined,
        },
      },
      runtimeGuardTargetExists: true,
      baselineWarning: null,
      readiness: 'NEEDS_ATTENTION',
    };
  }

  // Perform removals in reverse install order so the most-recent
  // (opencode.json) is touched before the more-easily-recoverable wrapper.
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

  // R-10 — optional empty-directory cleanup.
  if (wrapperAction === 'REMOVE') {
    await removeEmptyDir(dirname(wrapperPath));
  }
  if (instructionsAction === 'REMOVE') {
    await removeEmptyDir(dirname(instructionsPath));
  }

  return {
    operation: 'remove',
    resources: {
      pluginWrapper: { path: MANAGED_RESOURCES.pluginWrapper, action: wrapperAction },
      instructions: { path: MANAGED_RESOURCES.instructions, action: instructionsAction },
      opencodeConfig: {
        path: MANAGED_RESOURCES.opencodeConfig,
        action: opencodeConfigAction,
        detail: opencodeConfigAction === 'REMOVE' ? 'instruction entry removed' : undefined,
      },
    },
    runtimeGuardTargetExists: true,
    baselineWarning: null,
    readiness: 'READY',
  };
}

// ---------------------------------------------------------------------------
// T012 — Git baseline warning (informational only)
// ---------------------------------------------------------------------------

/**
 * Run `git status --porcelain` on the 3 managed paths inside `projectRoot`
 * and return a warning string iff any of those files is currently
 * untracked / modified / staged.
 *
 * - Returns `null` silently when `projectRoot` is not a Git repository.
 * - Returns `null` when all 3 paths are clean (committed or absent).
 * - Never stages, commits, amends, or pushes.
 */
export async function checkGitBaseline(projectRoot: string): Promise<string | null> {
  const result = spawnSync(
    'git',
    [
      'status',
      '--porcelain',
      '--',
      MANAGED_RESOURCES.pluginWrapper,
      MANAGED_RESOURCES.instructions,
      MANAGED_RESOURCES.opencodeConfig,
    ],
    { cwd: projectRoot, encoding: 'utf8' },
  );

  // `git` not on PATH, or not a Git repo, or any other failure → silent skip.
  if (result.status !== 0) {
    return null;
  }

  const stdout = (result.stdout ?? '').toString();
  if (stdout.trim().length === 0) {
    return null;
  }

  return 'Integration installed. Commit/baseline the OpenCode integration files before starting a ChangeBudget contract.';
}
