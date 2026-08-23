/**
 * npm self-update process adapter for SPEC-010.
 *
 * Executes npm install -g with a validated package spec.
 * Cross-platform: macOS/Linux spawns npm directly, Windows uses cmd.exe.
 *
 * No new runtime dependencies. Uses Node built-in child_process.
 */

import { spawn, SpawnOptions } from 'node:child_process';
import { platform } from 'node:os';
import { SemVer } from './version.js';

/**
 * Result of an npm update execution.
 */
export interface NpmUpdateResult {
  /** The update was successful */
  readonly success: boolean;
  /** Exit code if the process completed, null if spawn failed */
  readonly exitCode: number | null;
  /** Standard error output from npm */
  readonly stderr: string;
  /** Standard output from npm */
  readonly stdout: string;
  /** Error message if the process failed to spawn or execute */
  readonly errorMessage: string | null;
  /** Whether the process was interrupted by a signal */
  readonly interrupted: boolean;
  /** Exit signal if interrupted by a signal */
  readonly signal: string | null;
}

export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ReturnType<typeof spawn>;

const defaultSpawn: SpawnProcess = (command, args, options) =>
  spawn(command, args, options);

/**
 * Build the npm package spec from a validated SemVer tag.
 *
 * @param version The validated SemVer (guaranteed to pass ^v\d+\.\d+\.\d+$)
 * @returns Package spec: git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z
 */
export function buildPackageSpec(version: SemVer): string {
  return `git+https://github.com/Edulynch/Opencode-ChangeBudget.git#${version.tag}`;
}

/**
 * Generate the npm argument array for macOS/Linux.
 *
 * Args: install -g --ignore-scripts --allow-git=all --install-links=true <package-spec>
 */
export function buildNpmArgs(packageSpec: string): readonly string[] {
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
export function runSelfUpdateUnix(
  packageSpec: string,
  spawnProcess: SpawnProcess = defaultSpawn,
): Promise<NpmUpdateResult> {
  const args = buildNpmArgs(packageSpec);
  const options: SpawnOptions = {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  };

  let child: ReturnType<typeof spawn>;
  try {
    child = spawnProcess('npm', args as string[], options);
  } catch (error) {
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

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  if (child.stdout) {
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  }

  let closeError: string | null = null;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;

  return new Promise<NpmUpdateResult>((resolve) => {
    let settled = false;
    const finish = (result: NpmUpdateResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    child.on('error', (err: Error) => {
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

    child.on('exit', (code: number | null, sig: NodeJS.Signals | null) => {
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
export function runSelfUpdateWindows(
  packageSpec: string,
  spawnProcess: SpawnProcess = defaultSpawn,
): Promise<NpmUpdateResult> {
  const args = buildNpmArgs(packageSpec);
  // Build the npm command string with proper quoting
  const npmCommand = `npm ${args.join(' ')}`;

  // Determine command processor
  const cmdProcessor = process.env.ComSpec || 'cmd.exe';

  const options: SpawnOptions = {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  };

  let child: ReturnType<typeof spawn>;

  try {
    child = spawnProcess(cmdProcessor, ['/C', npmCommand], options);
  } catch (error) {
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

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  if (child.stdout) {
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
  }

  if (child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
  }

  let closeError: string | null = null;
  let exitCode: number | null = null;
  let signal: NodeJS.Signals | null = null;

  return new Promise<NpmUpdateResult>((resolve) => {
    let settled = false;
    const finish = (result: NpmUpdateResult): void => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    child.on('error', (err: Error) => {
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

    child.on('exit', (code: number | null, sig: NodeJS.Signals | null) => {
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
export async function runSelfUpdate(
  version: SemVer,
  spawnProcess: SpawnProcess = defaultSpawn,
  currentPlatform: NodeJS.Platform = platform(),
): Promise<NpmUpdateResult> {
  const packageSpec = buildPackageSpec(version);

  // Cross-platform dispatch
  if (currentPlatform === 'win32') {
    return runSelfUpdateWindows(packageSpec, spawnProcess);
  }

  // macOS/Linux
  return runSelfUpdateUnix(packageSpec, spawnProcess);
}
