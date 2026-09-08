import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { platform } from 'node:os';
import { dirname, join } from 'node:path';

import { formatSemVer, parseSemVer, type SemVer } from './version.js';

export const NPM_REGISTRY = 'https://registry.npmjs.org/';
const NPM_PACKAGE_NAME = 'changebudget';
const NPM_TIMEOUT_MS = 15_000;

export interface NpmExecutionRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly shell: false;
  readonly timeoutMs: number;
}

export type NpmExecutionResult =
  | { readonly kind: 'success'; readonly stdout: string; readonly stderr: string }
  | { readonly kind: 'failure'; readonly stdout: string; readonly stderr: string; readonly errorMessage: string };

export type NpmExecutor = (request: NpmExecutionRequest) => Promise<NpmExecutionResult>;

export interface NpmRegistryResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type NpmRegistryFetcher = (url: string, init: RequestInit) => Promise<NpmRegistryResponse>;

export interface NpmUpdateSuccess {
  readonly success: true;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly errorMessage: string | null;
  readonly interrupted: boolean;
  readonly signal: string | null;
  readonly entry: string;
}

export interface NpmUpdateFailure {
  readonly success: false;
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly errorMessage: string | null;
  readonly interrupted: boolean;
  readonly signal: string | null;
  readonly entry?: never;
}

export type NpmUpdateResult = NpmUpdateSuccess | NpmUpdateFailure;

export interface VerifiedNpmCliRequest {
  readonly update: NpmUpdateSuccess;
  readonly args: readonly string[];
  readonly cwd: string;
}

export type VerifiedNpmCliRunner = (request: VerifiedNpmCliRequest) => Promise<NpmExecutionResult>;

function npmRequest(args: readonly string[], currentPlatform: NodeJS.Platform): NpmExecutionRequest {
  if (currentPlatform === 'win32') {
    return request(process.execPath, [
      join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ...args,
    ]);
  }
  return request('npm', args);
}

function request(command: string, args: readonly string[], cwd?: string): NpmExecutionRequest {
  const base = { command, args, shell: false, timeoutMs: NPM_TIMEOUT_MS } as const;
  return cwd === undefined ? base : { ...base, cwd };
}

const executeNpm: NpmExecutor = (command) => new Promise((resolve) => {
  execFile(
    command.command,
    [...command.args],
    {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      ...(command.cwd === undefined ? {} : { cwd: command.cwd }),
      shell: command.shell,
      timeout: command.timeoutMs,
      windowsHide: true,
    },
    (error, stdout, stderr) => {
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
    },
  );
});

export function createVerifiedNpmCliRunner(executor: NpmExecutor): VerifiedNpmCliRunner {
  return async ({ update, args, cwd }) => executor(request(process.execPath, [update.entry, ...args], cwd));
}

export const runVerifiedNpmCli = createVerifiedNpmCliRunner(executeNpm);

function isRegistryDocument(value: unknown): value is { readonly versions?: unknown } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseNpmVersions(output: string): readonly SemVer[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
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

export async function discoverNpmVersions(
  fetcher: NpmRegistryFetcher = fetch,
): Promise<readonly SemVer[]> {
  let response: NpmRegistryResponse;
  try {
    response = await fetcher(new URL(NPM_PACKAGE_NAME, NPM_REGISTRY).toString(), {
      signal: AbortSignal.timeout(NPM_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`npm registry discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    throw new Error(`npm registry discovery failed: HTTP ${response.status}`);
  }
  return parseNpmVersions(await response.text());
}

function failedUpdate(result: NpmExecutionResult): NpmUpdateFailure {
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

function verificationFailure(message: string): NpmUpdateFailure {
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

export async function runSelfUpdate(
  version: SemVer,
  executor: NpmExecutor = executeNpm,
  currentPlatform: NodeJS.Platform = platform(),
  entryExists: (entry: string) => Promise<boolean> = async (entry) => {
    try {
      await access(entry);
      return true;
    } catch {
      return false;
    }
  },
): Promise<NpmUpdateResult> {
  const expectedVersion = formatSemVer(version);
  const installation = await executor(npmRequest([
    'install',
    '--global',
    `${NPM_PACKAGE_NAME}@${expectedVersion}`,
    `--registry=${NPM_REGISTRY}`,
  ], currentPlatform));
  if (installation.kind === 'failure') return failedUpdate(installation);

  const globalRoot = await executor(npmRequest(['root', '--global'], currentPlatform));
  if (globalRoot.kind === 'failure') return failedUpdate(globalRoot);
  const entry = join(globalRoot.stdout.trim(), NPM_PACKAGE_NAME, 'dist', 'src', 'cli', 'index.js');
  if (!(await entryExists(entry))) {
    return verificationFailure(`Installed ChangeBudget entry was not found: ${entry}`);
  }

  const verification = await executor(request(process.execPath, [entry, '--version']));
  if (verification.kind === 'failure') return failedUpdate(verification);
  if (verification.stdout.trim() !== expectedVersion) {
    return verificationFailure(
      `Installed ChangeBudget reported ${verification.stdout.trim() || 'no version'} instead of ${expectedVersion}`,
    );
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
