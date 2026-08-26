/** Deterministic, project-isolated update orchestration for SPEC-010. */
import { stderr, stdout } from 'node:process';
import { InputValidationError } from '../../models/errors.js';
import { getInstalledVersion } from '../../core/package-root.js';
import { filterStableTags, determineUpdateCheckResult, } from '../../core/update/github.js';
import { discoverRemoteTags, UpdateGitError, validateTagIntegrity, } from '../../core/update/git.js';
import { compareSemVer, formatSemVer, parseSemVer, } from '../../core/update/version.js';
import { buildPackageSpec, runSelfUpdate, } from '../../core/update/npm.js';
class UpdateEnvironmentError extends Error {
}
function resolveDependencies(dependencies) {
    return {
        getInstalledVersion: dependencies.getInstalledVersion ?? getInstalledVersion,
        fetchTags: dependencies.fetchTags ??
            discoverRemoteTags,
        validateTagIntegrity: dependencies.validateTagIntegrity ??
            validateTagIntegrity,
        runSelfUpdate: dependencies.runSelfUpdate ?? runSelfUpdate,
        writeOut: dependencies.writeOut ?? ((message) => stdout.write(message)),
        writeErr: dependencies.writeErr ?? ((message) => stderr.write(message)),
    };
}
function asEnvironmentError(message, cause) {
    const error = new UpdateEnvironmentError(message);
    if (cause !== undefined) {
        error.cause = cause;
    }
    return error;
}
async function discoverValidatedTags(dependencies) {
    let rawTags;
    try {
        rawTags = await dependencies.fetchTags();
    }
    catch (error) {
        if (error instanceof UpdateGitError) {
            if (error.kind === 'no_stable_tags')
                throw error;
            throw asEnvironmentError(`GitHub tag discovery failed: ${error.message}`, error);
        }
        const message = error instanceof Error ? error.message : String(error);
        const actionable = message.includes('Timeout') || message.includes('timed out')
            ? 'Git operation timed out'
            : message.includes('fetch') ||
                message.includes('offline') ||
                message.includes('network')
                ? 'Cannot reach GitHub for tag discovery'
                : message.includes('Invalid') || message.includes('malformed')
                    ? 'Invalid Git tag discovery output'
                    : message;
        throw asEnvironmentError(`GitHub tag discovery failed: ${actionable}`, error);
    }
    const candidates = filterStableTags(rawTags)
        .map((tag) => parseSemVer(tag))
        .filter((tag) => tag !== null)
        .sort((left, right) => compareSemVer(right, left));
    if (candidates.length === 0) {
        throw new UpdateGitError('no_stable_tags', 'discovery');
    }
    const validated = [];
    for (const candidate of candidates) {
        try {
            if (await dependencies.validateTagIntegrity(candidate.tag)) {
                validated.push(candidate);
            }
        }
        catch (error) {
            if (error instanceof UpdateGitError)
                throw error;
            if (!(error instanceof Error))
                throw error;
        }
    }
    if (validated.length === 0) {
        throw new UpdateGitError('no_trustworthy_candidates', 'integrity');
    }
    return validated;
}
async function getUpdateResult(dependencies) {
    let installedVersion;
    try {
        installedVersion = dependencies.getInstalledVersion();
    }
    catch (error) {
        throw asEnvironmentError(`Cannot determine ChangeBudget version: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    const current = parseSemVer(`v${installedVersion.replace(/^v/, '')}`);
    if (!current) {
        throw new InputValidationError(`Installed ChangeBudget version '${installedVersion}' is not a valid semantic version`, 'VERSION_FORMAT', { version: installedVersion });
    }
    return determineUpdateCheckResult(current, await discoverValidatedTags(dependencies));
}
function printCheckResult(result, writeOut) {
    writeOut(`current version: ${result.currentVersionString}\n`);
    writeOut(`latest compatible: ${result.latestCompatibleString ?? 'none'}\n`);
    writeOut(`update available: ${result.updateAvailable ? 'yes' : 'no'}\n`);
    if (result.newerMajor) {
        writeOut(`newer major available: ${formatSemVer(result.newerMajor)}\n`);
        writeOut(`manual install: npm install -g --ignore-scripts --allow-git=all --install-links=true ${buildPackageSpec(result.newerMajor)}\n`);
    }
}
function printFailure(error, dependencies) {
    if (error instanceof UpdateEnvironmentError
        || error instanceof UpdateGitError
        || error instanceof InputValidationError) {
        dependencies.writeErr(`${error.message}\n`);
        return 4;
    }
    dependencies.writeErr(`Internal error: ${error instanceof Error ? error.message : String(error)}\n`);
    return 10;
}
/** Run `changebudget update --check`; returns the command exit code. */
export async function runUpdateCheck(dependencies = {}) {
    const resolved = resolveDependencies(dependencies);
    try {
        const result = await getUpdateResult(resolved);
        printCheckResult(result, resolved.writeOut);
        return 0;
    }
    catch (error) {
        return printFailure(error, resolved);
    }
}
/** Run `changebudget update`; returns the command exit code. */
export async function runUpdate(dependencies = {}) {
    const resolved = resolveDependencies(dependencies);
    try {
        const result = await getUpdateResult(resolved);
        printCheckResult(result, resolved.writeOut);
        if (!result.latestCompatible) {
            // A newer major is informational only; automatic major installation is forbidden.
            if (result.newerMajor) {
                resolved.writeOut('automatic major update refused\n');
            }
            else {
                resolved.writeOut('already current\n');
            }
            return 0;
        }
        resolved.writeOut(`updating to ${formatSemVer(result.latestCompatible)}\n`);
        let npmResult;
        try {
            npmResult = await resolved.runSelfUpdate(result.latestCompatible);
        }
        catch (error) {
            throw asEnvironmentError(`npm update failed: ${error instanceof Error ? error.message : String(error)}`, error);
        }
        if (!npmResult.success) {
            const errorMessage = npmResult.errorMessage?.includes('ENOENT')
                ? 'npm not found in PATH'
                : npmResult.errorMessage;
            const details = [errorMessage, npmResult.stderr, npmResult.stdout]
                .filter((value) => Boolean(value))
                .join('\n');
            throw asEnvironmentError(`npm update failed${details.length > 0 ? `: ${details}` : ''}`);
        }
        resolved.writeOut(`updated to ${formatSemVer(result.latestCompatible)}\n`);
        return 0;
    }
    catch (error) {
        return printFailure(error, resolved);
    }
}
//# sourceMappingURL=update.js.map