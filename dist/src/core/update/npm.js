/**
 * npm self-update process adapter for SPEC-010.
 *
 * Executes npm install -g with a validated package spec.
 * Cross-platform: macOS/Linux spawns npm directly, Windows uses cmd.exe.
 *
 * No new runtime dependencies. Uses Node built-in child_process.
 */
import { spawn } from 'node:child_process';
import { platform } from 'node:os';
const defaultSpawn = (command, args, options) => spawn(command, args, options);
/**
 * Build the npm package spec from a validated SemVer tag.
 *
 * @param version The validated SemVer (guaranteed to pass ^v\d+\.\d+\.\d+$)
 * @returns Package spec: git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z
 */
export function buildPackageSpec(version) {
    return `git+https://github.com/Edulynch/Opencode-ChangeBudget.git#${version.tag}`;
}
/**
 * Generate the npm argument array for macOS/Linux.
 *
 * Args: install -g --ignore-scripts --allow-git=all --install-links=true <package-spec>
 */
export function buildNpmArgs(packageSpec) {
    return [
        'install',
        '-g',
        '--ignore-scripts',
        '--allow-git=all',
        '--install-links=true',
        packageSpec,
    ];
}
/**
 * Run npm self-update on macOS/Linux.
 *
 * Uses direct spawn with npm executable, structured arguments, no shell.
 */
export function runSelfUpdateUnix(packageSpec, spawnProcess = defaultSpawn) {
    const args = buildNpmArgs(packageSpec);
    const options = {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    };
    let child;
    try {
        child = spawnProcess('npm', args, options);
    }
    catch (error) {
        return Promise.resolve({
            success: false,
            exitCode: null,
            stderr: '',
            stdout: '',
            errorMessage: error instanceof Error ? error.message : String(error),
            interrupted: false,
            signal: null,
        });
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    if (child.stdout) {
        child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    }
    if (child.stderr) {
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    }
    let closeError = null;
    let exitCode = null;
    let signal = null;
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        child.on('error', (err) => {
            closeError = err.message;
            finish({
                success: false,
                exitCode: null,
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                errorMessage: closeError,
                interrupted: false,
                signal: null,
            });
        });
        child.on('exit', (code, sig) => {
            exitCode = code;
            signal = sig;
            // Read final output
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');
            finish({
                success: exitCode === 0 && signal === null,
                exitCode: exitCode ?? null,
                stderr,
                stdout,
                errorMessage: closeError,
                interrupted: sig !== null,
                signal: sig ?? null,
            });
        });
    });
}
/**
 * Run npm self-update on Windows.
 *
 * Uses cmd.exe with /C flag, controlled argv with npm command string.
 * The package spec crosses into the shell via npm's own quoting.
 */
export function runSelfUpdateWindows(packageSpec, spawnProcess = defaultSpawn) {
    const args = buildNpmArgs(packageSpec);
    // Build the npm command string with proper quoting
    const npmCommand = `npm ${args.join(' ')}`;
    // Determine command processor
    const cmdProcessor = process.env.ComSpec || 'cmd.exe';
    const options = {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
    };
    let child;
    try {
        child = spawnProcess(cmdProcessor, ['/C', npmCommand], options);
    }
    catch (error) {
        return Promise.resolve({
            success: false,
            exitCode: null,
            stderr: '',
            stdout: '',
            errorMessage: error instanceof Error ? error.message : String(error),
            interrupted: false,
            signal: null,
        });
    }
    const stdoutChunks = [];
    const stderrChunks = [];
    if (child.stdout) {
        child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    }
    if (child.stderr) {
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    }
    let closeError = null;
    let exitCode = null;
    let signal = null;
    return new Promise((resolve) => {
        let settled = false;
        const finish = (result) => {
            if (!settled) {
                settled = true;
                resolve(result);
            }
        };
        child.on('error', (err) => {
            closeError = err.message;
            finish({
                success: false,
                exitCode: null,
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                errorMessage: closeError,
                interrupted: false,
                signal: null,
            });
        });
        child.on('exit', (code, sig) => {
            exitCode = code;
            signal = sig;
            const stdout = Buffer.concat(stdoutChunks).toString('utf8');
            const stderr = Buffer.concat(stderrChunks).toString('utf8');
            finish({
                success: exitCode === 0 && signal === null,
                exitCode: exitCode ?? null,
                stderr,
                stdout,
                errorMessage: closeError,
                interrupted: sig !== null,
                signal: sig ?? null,
            });
        });
    });
}
/**
 * Run self-update via npm.
 *
 * Cross-platform dispatcher that selects the appropriate strategy
 * based on the current operating system.
 *
 * @param version The validated SemVer tag to install
 * @returns Promise resolving to the update result
 */
export async function runSelfUpdate(version, spawnProcess = defaultSpawn, currentPlatform = platform()) {
    const packageSpec = buildPackageSpec(version);
    // Cross-platform dispatch
    if (currentPlatform === 'win32') {
        return runSelfUpdateWindows(packageSpec, spawnProcess);
    }
    // macOS/Linux
    return runSelfUpdateUnix(packageSpec, spawnProcess);
}
//# sourceMappingURL=npm.js.map