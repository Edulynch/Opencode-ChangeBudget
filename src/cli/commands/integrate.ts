// SPEC-009 Phase 2 — CLI command for the `changebudget integrate opencode`
// workflow. Parses arguments (`opencode` target, `--dry-run`, `--remove`),
// delegates to the core orchestration functions in
// `src/core/integration/opencode.ts`, and renders a deterministic human
// summary. No JSON output in v1 — the spec intentionally ships a human-only
// surface.

import { stdout } from 'node:process';

import {
  dryRunIntegration,
  installIntegration,
  removeIntegration,
  resolveChangeBudgetRoot,
  type IntegrationResourceStatus,
  type IntegrationResult,
} from '../../core/integration/opencode.js';
import { getIntegrationProfile } from '../../core/integration/profiles.js';
import { InputValidationError } from '../../models/errors.js';

interface ParsedIntegrateArgs {
  dryRun: boolean;
  remove: boolean;
}

function parseIntegrateArgs(args: string[]): ParsedIntegrateArgs {
  let dryRun = false;
  let remove = false;

  for (const flag of args) {
    if (flag === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (flag === '--remove') {
      remove = true;
      continue;
    }
    throw new InputValidationError(`Unknown option: ${flag}`, flag);
  }

  if (dryRun && remove) {
    throw new InputValidationError('--dry-run and --remove cannot be combined', 'options');
  }

  return { dryRun, remove };
}

/**
 * Run the `changebudget integrate opencode` command.
 *
 * `repositoryRoot` is the target project (typically `process.cwd()`); the
 * ChangeBudget root is derived from `import.meta.url` via
 * `resolveChangeBudgetRoot` because the compiled Runtime Guard entrypoint
 * lives in the ChangeBudget install directory.
 */
export async function runIntegrate(repositoryRoot: string, args: string[]): Promise<IntegrationResult> {
  const target = args[0];
  if (target === undefined || getIntegrationProfile(target) === undefined) {
    throw new InputValidationError('integrate requires a target profile registered by ChangeBudget: changebudget integrate opencode', 'target');
  }

  const { dryRun, remove } = parseIntegrateArgs(args.slice(1));

  const changeBudgetRoot = resolveChangeBudgetRoot();

  if (dryRun) {
    return dryRunIntegration(repositoryRoot, changeBudgetRoot);
  }
  if (remove) {
    return removeIntegration(repositoryRoot);
  }
  return installIntegration(repositoryRoot, changeBudgetRoot);
}

function resourceLabel(status: IntegrationResourceStatus): string {
  return `${status.action}${status.detail ? ` (${status.detail})` : ''}`;
}

function printResource(name: string, status: IntegrationResourceStatus): void {
  stdout.write(`${name}: ${resourceLabel(status)} ${status.path}\n`);
}

/**
 * Render a deterministic human-readable summary of an `IntegrationResult`.
 *
 * No timestamps, no colors, no JSON. Spec does not define `--json` for v1.
 */
export function printIntegrationResult(result: IntegrationResult): void {
  printResource('Plugin wrapper', result.resources.pluginWrapper);
  printResource('Instructions', result.resources.instructions);
  printResource('OpenCode config', result.resources.opencodeConfig);

  stdout.write(`Runtime Guard: ${result.runtimeGuardTargetExists ? 'exists' : 'missing'}\n`);

  if (result.baselineWarning) {
    stdout.write(`\n${result.baselineWarning}\n`);
  }

  stdout.write(`\nIntegration: ${result.readiness}\n`);
}
