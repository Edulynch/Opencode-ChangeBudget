/** npm-registry based self-update orchestration. */
import { stderr, stdout } from 'node:process';
import { resolveChangeBudgetRoot } from '../../core/integration/opencode.js';
import { discoverManagedIntegration, } from '../../core/integration/opencode-discovery.js';
import { getInstalledVersion } from '../../core/package-root.js';
import { discoverNpmVersions, runSelfUpdate, runVerifiedNpmCli, } from '../../core/update/npm.js';
import { determineUpdateCheckResult } from '../../core/update/selection.js';
import { formatSemVer, parseSemVer } from '../../core/update/version.js';
import { InputValidationError } from '../../models/errors.js';
class UpdateEnvironmentError extends Error {
}
function resolveDependencies(dependencies) {
    return {
        getInstalledVersion: dependencies.getInstalledVersion ?? getInstalledVersion,
        discoverVersions: dependencies.discoverVersions ?? discoverNpmVersions,
        runSelfUpdate: dependencies.runSelfUpdate ?? runSelfUpdate,
        getProjectRoot: dependencies.getProjectRoot ?? (() => process.cwd()),
        getChangeBudgetRoot: dependencies.getChangeBudgetRoot ?? resolveChangeBudgetRoot,
        discoverManagedIntegration: dependencies.discoverManagedIntegration ?? discoverManagedIntegration,
        executeUpdatedCli: dependencies.executeUpdatedCli,
        runVerifiedNpmCli: dependencies.runVerifiedNpmCli ?? runVerifiedNpmCli,
        writeOut: dependencies.writeOut ?? ((message) => stdout.write(message)),
        writeErr: dependencies.writeErr ?? ((message) => stderr.write(message)),
    };
}
function environmentError(message, cause) {
    const error = new UpdateEnvironmentError(message);
    if (cause !== undefined)
        error.cause = cause;
    return error;
}
async function getUpdateResult(dependencies) {
    let installedVersion;
    try {
        installedVersion = dependencies.getInstalledVersion();
    }
    catch (error) {
        throw environmentError(`Cannot determine ChangeBudget version: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    const current = parseSemVer(`v${installedVersion.replace(/^v/, '')}`);
    if (current === null) {
        throw new InputValidationError(`Installed ChangeBudget version '${installedVersion}' is not a valid semantic version`, 'VERSION_FORMAT', { version: installedVersion });
    }
    let versions;
    try {
        versions = await dependencies.discoverVersions();
    }
    catch (error) {
        throw environmentError(`npm registry discovery failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    return determineUpdateCheckResult(current, versions);
}
function printCheckResult(result, writeOut) {
    writeOut(`current version: ${result.currentVersionString}\n`);
    writeOut(`latest compatible: ${result.latestCompatibleString ?? 'none'}\n`);
    writeOut(`update available: ${result.updateAvailable ? 'yes' : 'no'}\n`);
    if (result.newerMajor !== null) {
        const version = formatSemVer(result.newerMajor);
        writeOut(`newer major available: ${version}\n`);
        writeOut(`manual install: npm install --global changebudget@${version} --registry=https://registry.npmjs.org/\n`);
    }
}
function printFailure(error, dependencies) {
    if (error instanceof UpdateEnvironmentError || error instanceof InputValidationError) {
        dependencies.writeErr(`${error.message}\n`);
        return 4;
    }
    dependencies.writeErr(`Internal error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 10;
}
function assertNever(value) {
    throw new Error(`Unexpected managed integration state: ${String(value)}`);
}
async function refreshManagedOpenCodeIntegration(update, dependencies) {
    let projectRoot;
    let discovery;
    try {
        projectRoot = dependencies.getProjectRoot();
        discovery = await dependencies.discoverManagedIntegration(projectRoot, dependencies.getChangeBudgetRoot());
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dependencies.writeErr(`Warning: managed OpenCode integration discovery skipped: ${message}\n`);
        return 0;
    }
    switch (discovery.state) {
        case 'MANAGED_CURRENT':
        case 'MANAGED_STALE':
        case 'LEGACY_MANAGED':
        case 'PARTIAL':
            if (discovery.profileId !== 'opencode')
                return 0;
            break;
        case 'ABSENT':
        case 'CONFLICT':
        case 'UNKNOWN_PROFILE':
            return 0;
        default:
            return assertNever(discovery);
    }
    let refreshResult;
    try {
        refreshResult = dependencies.executeUpdatedCli === undefined
            ? await dependencies.runVerifiedNpmCli({
                update,
                args: ['integrate', 'opencode'],
                cwd: projectRoot,
            })
            : await dependencies.executeUpdatedCli({
                command: process.execPath,
                args: [update.entry, 'integrate', 'opencode'],
                cwd: projectRoot,
                shell: false,
            });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dependencies.writeErr(`Package update completed, but managed OpenCode refresh failed: ${message}\n`);
        return 4;
    }
    if (refreshResult.kind === 'failure') {
        const diagnostics = [refreshResult.errorMessage, refreshResult.stderr, refreshResult.stdout]
            .filter((value) => Boolean(value))
            .join('\n');
        dependencies.writeErr(`Package update completed, but managed OpenCode refresh failed${diagnostics.length > 0 ? `: ${diagnostics}` : ''}\n`);
        return 4;
    }
    return 0;
}
export async function runUpdateCheck(dependencies = {}) {
    const resolved = resolveDependencies(dependencies);
    try {
        printCheckResult(await getUpdateResult(resolved), resolved.writeOut);
        return 0;
    }
    catch (error) {
        return printFailure(error, resolved);
    }
}
export async function runUpdate(dependencies = {}) {
    const resolved = resolveDependencies(dependencies);
    try {
        const result = await getUpdateResult(resolved);
        printCheckResult(result, resolved.writeOut);
        if (result.latestCompatible === null) {
            resolved.writeOut(result.newerMajor === null ? 'already current\n' : 'automatic major update refused\n');
            return 0;
        }
        resolved.writeOut(`updating to ${formatSemVer(result.latestCompatible)}\n`);
        let npmResult;
        try {
            npmResult = await resolved.runSelfUpdate(result.latestCompatible);
        }
        catch (error) {
            throw environmentError(`npm update failed: ${error instanceof Error ? error.message : String(error)}`, error);
        }
        if (!npmResult.success) {
            const details = [npmResult.errorMessage, npmResult.stderr, npmResult.stdout]
                .filter((value) => Boolean(value))
                .join('\n');
            throw environmentError(`npm update failed${details.length > 0 ? `: ${details}` : ''}`);
        }
        const update = npmResult;
        resolved.writeOut(`updated to ${formatSemVer(result.latestCompatible)}\n`);
        return refreshManagedOpenCodeIntegration(update, resolved);
    }
    catch (error) {
        return printFailure(error, resolved);
    }
}
//# sourceMappingURL=update.js.map