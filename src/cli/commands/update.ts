/** Deterministic, project-isolated update orchestration for SPEC-010. */

import { stderr, stdout } from 'node:process';

import { InputValidationError } from '../../models/errors.js';
import { getInstalledVersion } from '../../core/package-root.js';
import {
  fetchAllTags,
  filterStableTags,
  determineUpdateCheckResult,
  validateTagIntegrity,
  UpdateCheckResult,
} from '../../core/update/github.js';
import {
  compareSemVer,
  formatSemVer,
  parseSemVer,
  SemVer,
} from '../../core/update/version.js';
import {
  NpmUpdateResult,
  runSelfUpdate,
} from '../../core/update/npm.js';

const OWNER = 'Edulynch';
const REPOSITORY = 'Opencode-ChangeBudget';

class UpdateEnvironmentError extends Error {}

export interface UpdateDependencies {
  getInstalledVersion?: () => string;
  fetchTags?: () => Promise<string[]>;
  validateTagIntegrity?: (tag: string) => Promise<boolean>;
  runSelfUpdate?: (version: SemVer) => Promise<NpmUpdateResult>;
  writeOut?: (message: string) => void;
  writeErr?: (message: string) => void;
}

interface ResolvedUpdateDependencies {
  readonly getInstalledVersion: () => string;
  readonly fetchTags: () => Promise<string[]>;
  readonly validateTagIntegrity: (tag: string) => Promise<boolean>;
  readonly runSelfUpdate: (version: SemVer) => Promise<NpmUpdateResult>;
  readonly writeOut: (message: string) => void;
  readonly writeErr: (message: string) => void;
}

function resolveDependencies(
  dependencies: UpdateDependencies,
): ResolvedUpdateDependencies {
  return {
    getInstalledVersion:
      dependencies.getInstalledVersion ?? getInstalledVersion,
    fetchTags:
      dependencies.fetchTags ??
      (() => fetchAllTags(OWNER, REPOSITORY)),
    validateTagIntegrity:
      dependencies.validateTagIntegrity ??
      ((tag) => validateTagIntegrity(OWNER, REPOSITORY, tag)),
    runSelfUpdate: dependencies.runSelfUpdate ?? runSelfUpdate,
    writeOut: dependencies.writeOut ?? ((message) => stdout.write(message)),
    writeErr: dependencies.writeErr ?? ((message) => stderr.write(message)),
  };
}

function asEnvironmentError(message: string, cause?: unknown): UpdateEnvironmentError {
  const error = new UpdateEnvironmentError(message);
  if (cause !== undefined) {
    error.cause = cause;
  }
  return error;
}

async function discoverValidatedTags(
  dependencies: ResolvedUpdateDependencies,
): Promise<SemVer[]> {
  let rawTags: string[];
  try {
    rawTags = await dependencies.fetchTags();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const actionable = message.includes('Timeout')
      ? 'Network timeout during GitHub API request'
      : message.includes('GitHub API request failed') ||
          message.includes('fetch') ||
          message.includes('offline') ||
          message.includes('network')
        ? 'Cannot reach GitHub for tag discovery'
        : message.includes('Invalid GitHub')
          ? 'Invalid GitHub API response'
          : message;
    throw asEnvironmentError(
      `GitHub tag discovery failed: ${actionable}`,
      error,
    );
  }

  const candidates = filterStableTags(rawTags)
    .map((tag) => parseSemVer(tag))
    .filter((tag): tag is SemVer => tag !== null)
    .sort((left, right) => compareSemVer(right, left));

  if (candidates.length === 0) {
    throw asEnvironmentError('No valid stable GitHub tags found');
  }

  const validated: SemVer[] = [];
  for (const candidate of candidates) {
    try {
      if (await dependencies.validateTagIntegrity(candidate.tag)) {
        validated.push(candidate);
      }
    } catch {
      // A bad candidate must not prevent a lower validated candidate from being used.
    }
  }

  if (validated.length === 0) {
    throw asEnvironmentError('No trustworthy validated GitHub tags found');
  }

  return validated;
}

async function getUpdateResult(
  dependencies: ResolvedUpdateDependencies,
): Promise<UpdateCheckResult> {
  let installedVersion: string;
  try {
    installedVersion = dependencies.getInstalledVersion();
  } catch (error) {
    throw asEnvironmentError(
      `Cannot determine ChangeBudget version: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }

  const current = parseSemVer(`v${installedVersion.replace(/^v/, '')}`);
  if (!current) {
    throw new InputValidationError(
      `Installed ChangeBudget version '${installedVersion}' is not a valid semantic version`,
      'VERSION_FORMAT',
      { version: installedVersion },
    );
  }

  return determineUpdateCheckResult(
    current,
    await discoverValidatedTags(dependencies),
  );
}

function printCheckResult(
  result: UpdateCheckResult,
  writeOut: (message: string) => void,
): void {
  writeOut(`current version: ${result.currentVersionString}\n`);
  writeOut(
    `latest compatible: ${result.latestCompatibleString ?? 'none'}\n`,
  );
  writeOut(`update available: ${result.updateAvailable ? 'yes' : 'no'}\n`);

  if (result.newerMajor) {
    writeOut(`newer major available: ${formatSemVer(result.newerMajor)}\n`);
    writeOut(
      `manual install: npm install -g github:${OWNER}/${REPOSITORY}#${result.newerMajor.tag}\n`,
    );
  }
}

function printFailure(
  error: unknown,
  dependencies: ResolvedUpdateDependencies,
): number {
  if (error instanceof UpdateEnvironmentError || error instanceof InputValidationError) {
    dependencies.writeErr(`${error.message}\n`);
    return 4;
  }

  dependencies.writeErr(
    `Internal error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  return 10;
}

/** Run `changebudget update --check`; returns the command exit code. */
export async function runUpdateCheck(
  dependencies: UpdateDependencies = {},
): Promise<number> {
  const resolved = resolveDependencies(dependencies);
  try {
    const result = await getUpdateResult(resolved);
    printCheckResult(result, resolved.writeOut);
    return 0;
  } catch (error) {
    return printFailure(error, resolved);
  }
}

/** Run `changebudget update`; returns the command exit code. */
export async function runUpdate(
  dependencies: UpdateDependencies = {},
): Promise<number> {
  const resolved = resolveDependencies(dependencies);
  try {
    const result = await getUpdateResult(resolved);
    printCheckResult(result, resolved.writeOut);

    if (!result.latestCompatible) {
      // A newer major is informational only; automatic major installation is forbidden.
      if (result.newerMajor) {
        resolved.writeOut('automatic major update refused\n');
      } else {
        resolved.writeOut('already current\n');
      }
      return 0;
    }

    resolved.writeOut(
      `updating to ${formatSemVer(result.latestCompatible)}\n`,
    );

    let npmResult: NpmUpdateResult;
    try {
      npmResult = await resolved.runSelfUpdate(result.latestCompatible);
    } catch (error) {
      throw asEnvironmentError(
        `npm update failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }

    if (!npmResult.success) {
      const errorMessage = npmResult.errorMessage?.includes('ENOENT')
        ? 'npm not found in PATH'
        : npmResult.errorMessage;
      const details = [errorMessage, npmResult.stderr, npmResult.stdout]
        .filter((value): value is string => Boolean(value))
        .join('\n');
      throw asEnvironmentError(
        `npm update failed${details.length > 0 ? `: ${details}` : ''}`,
      );
    }

    resolved.writeOut(`updated to ${formatSemVer(result.latestCompatible)}\n`);
    return 0;
  } catch (error) {
    return printFailure(error, resolved);
  }
}
