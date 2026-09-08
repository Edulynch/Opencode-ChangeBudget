import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';
import { formatSemVer, parseSemVer } from './version.js';
export const NPM_REGISTRY = 'https://registry.npmjs.org/';
const NPM_PACKAGE_NAME = 'changebudget';
const NPM_TIMEOUT_MS = 15_000;
function npmRequest(args, currentPlatform) {
    if (currentPlatform === 'win32') {
        return request(process.execPath, [
            join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
            ...args,
        ]);
    }
    return request('npm', args);
}
function request(command, args, cwd) {
    const base = { command, args, shell: false, timeoutMs: NPM_TIMEOUT_MS };
    return cwd === undefined ? base : { ...base, cwd };
}
const executeNpm = (command) => new Promise((resolve) => {
    execFile(command.command, [...command.args], {
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
        shell: command.shell,
        timeout: command.timeoutMs,
        windowsHide: true,
    }, (error, stdout, stderr) => {
        if (error === null) {
            resolve({ kind: 'success', stdout, stderr });
            return;
        }
        resolve({
            kind: 'failure',
            stdout,
            stderr,
            errorMessage: error.message,
        });
    });
});
export function createVerifiedNpmCliRunner(executor) {
    return async ({ update, args, cwd }) => executor(request(process.execPath, [update.entry, ...args], cwd));
}
export const runVerifiedNpmCli = createVerifiedNpmCliRunner(executeNpm);
function isRegistryDocument(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function parseNpmVersions(output) {
    let parsed;
    try {
        parsed = JSON.parse(output);
    }
    catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error('Invalid npm registry version output');
        }
        throw error;
    }
    if (!isRegistryDocument(parsed)) {
        throw new Error('Invalid npm registry version output');
    }
    const versions = parsed.versions;
    if (versions === null || typeof versions !== 'object' || Array.isArray(versions)) {
        throw new Error('Invalid npm registry version output');
    }
    const values = Object.keys(versions);
    return values.flatMap((value) => {
        const version = parseSemVer(`v${value}`);
        return version === null ? [] : [version];
    });
}
export async function discoverNpmVersions(fetcher = fetch) {
    let response;
    try {
        response = await fetcher(new URL(NPM_PACKAGE_NAME, NPM_REGISTRY).toString(), {
            signal: AbortSignal.timeout(NPM_TIMEOUT_MS),
        });
    }
    catch (error) {
        throw new Error(`npm registry discovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!response.ok) {
        throw new Error(`npm registry discovery failed: HTTP ${response.status}`);
    }
    return parseNpmVersions(await response.text());
}
function failedUpdate(result) {
    if (result.kind === 'success') {
        return {
            success: false,
            exitCode: 0,
            stderr: result.stderr,
            stdout: result.stdout,
            errorMessage: 'npm command failed unexpectedly',
            interrupted: false,
            signal: null,
        };
    }
    return {
        success: false,
        exitCode: null,
        stderr: result.stderr,
        stdout: result.stdout,
        errorMessage: result.errorMessage,
        interrupted: false,
        signal: null,
    };
}
function verificationFailure(message) {
    return {
        success: false,
        exitCode: null,
        stderr: '',
        stdout: '',
        errorMessage: message,
        interrupted: false,
        signal: null,
    };
}
export async function runSelfUpdate(version, executor = executeNpm, currentPlatform = platform(), entryExists = async (entry) => {
    try {
        await access(entry);
        return true;
    }
    catch {
        return false;
    }
}) {
    const expectedVersion = formatSemVer(version);
    const installation = await executor(npmRequest([
        'install',
        '--global',
        `${NPM_PACKAGE_NAME}@${expectedVersion}`,
        `--registry=${NPM_REGISTRY}`,
    ], currentPlatform));
    if (installation.kind === 'failure')
        return failedUpdate(installation);
    const globalRoot = await executor(npmRequest(['root', '--global'], currentPlatform));
    if (globalRoot.kind === 'failure')
        return failedUpdate(globalRoot);
    const entry = join(globalRoot.stdout.trim(), NPM_PACKAGE_NAME, 'dist', 'src', 'cli', 'index.js');
    if (!(await entryExists(entry))) {
        return verificationFailure(`Installed ChangeBudget entry was not found: ${entry}`);
    }
    const verification = await executor(request(process.execPath, [entry, '--version']));
    if (verification.kind === 'failure')
        return failedUpdate(verification);
    if (verification.stdout.trim() !== expectedVersion) {
        return verificationFailure(`Installed ChangeBudget reported ${verification.stdout.trim() || 'no version'} instead of ${expectedVersion}`);
    }
    return {
        success: true,
        exitCode: 0,
        stderr: installation.stderr,
        stdout: installation.stdout,
        errorMessage: null,
        interrupted: false,
        signal: null,
        entry,
    };
}
//# sourceMappingURL=npm.js.map