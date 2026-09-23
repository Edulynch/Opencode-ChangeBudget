// CLI command for the native OpenCode V2 integration.
import { stdout } from 'node:process';
import { dryRunIntegration, installIntegration, removeIntegration, resolveChangeBudgetRoot, } from '../../core/integration/opencode.js';
import { InputValidationError } from '../../models/errors.js';
function parseIntegrateArgs(args) {
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
export async function runIntegrate(repositoryRoot, args) {
    const target = args[0];
    if (target !== 'opencode') {
        throw new InputValidationError('integrate requires the OpenCode V2 target: changebudget integrate opencode', 'target');
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
function resourceLabel(status) {
    return `${status.action}${status.detail ? ` (${status.detail})` : ''}`;
}
function printResource(name, status) {
    stdout.write(`${name}: ${resourceLabel(status)} ${status.path}\n`);
}
export function getIntegrationSummary(result) {
    if (result.operation !== 'install')
        return null;
    const actions = Object.values(result.resources).map((resource) => resource.action);
    if (actions.includes('CREATE'))
        return 'Integration installed.';
    if (actions.includes('UPDATE'))
        return 'Integration refreshed.';
    return 'Integration already current.';
}
/**
 * Render a deterministic human-readable summary of an `IntegrationResult`.
 *
 * No timestamps, colors, or JSON are emitted by this command.
 */
export function printIntegrationResult(result) {
    printResource('Plugin wrapper', result.resources.pluginWrapper);
    stdout.write(`Runtime Guard: ${result.runtimeGuardTargetExists ? 'exists' : 'missing'}\n`);
    if (result.baselineWarning) {
        stdout.write(`\n${result.baselineWarning}\n`);
    }
    const summary = getIntegrationSummary(result);
    if (summary !== null) {
        stdout.write(`\n${summary}\n`);
    }
    stdout.write(`\nIntegration: ${result.readiness}\n`);
}
//# sourceMappingURL=integrate.js.map