/** Deterministic, project-isolated update orchestration for SPEC-010. */

import { stderr, stdout } from 'node:process';

import { InputValidationError } from '../../models/errors.js';
import { getInstalledVersion } from '../../core/package-root.js';
import {
  deriveUpdateCandidateLanes,
  filterStableTags,
  determineUpdateCheckResult,
  type UpdateCheckResult,
} from '../../core/update/github.js';
import {
  discoverRemoteTags,
  UpdateGitError,
  validateTagIntegrity,
} from '../../core/update/git.js';
import { formatSemVer, parseSemVer, type SemVer } from '../../core/update/version.js';
import {
  buildPackageSpec,
  runSelfUpdate,
  type NpmUpdateResult,
} from '../../core/update/npm.js';

class UpdateEnvironmentError extends Error {}

export interface UpdateDependencies {
  getInstalledVersion?: () => string;
  fetchTags?: () => Promise<readonly string[]>;
  validateTagIntegrity?: (tag: string) => Promise<boolean>;
  runSelfUpdate?: (version: SemVer) => Promise<NpmUpdateResult>;
  writeOut?: (message: string) => void;
  writeErr?: (message: string) => void;
}

interface ResolvedUpdateDependencies {
  readonly getInstalledVersion: () => string;
  readonly fetchTags: () => Promise<readonly string[]>;
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
      discoverRemoteTags,
    validateTagIntegrity:
      dependencies.validateTagIntegrity ??
      validateTagIntegrity,
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
  current: SemVer,
  dependencies: ResolvedUpdateDependencies,
): Promise<SemVer[]> {
  let rawTags: readonly string[];
  try {
    rawTags = await dependencies.fetchTags();
  } catch (error) {
    if (error instanceof UpdateGitError) {
      if (error.kind === 'no_stable_tags') throw error;
      throw asEnvironmentError(
        `GitHub tag discovery failed: ${error.message}`,
        error,
      );
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
    throw asEnvironmentError(
      `GitHub tag discovery failed: ${actionable}`,
      error,
    );
  }

  const candidates = filterStableTags(rawTags)
    .map((tag) => parseSemVer(tag))
    .filter((tag): tag is SemVer => tag !== null);

  if (candidates.length === 0) {
    throw new UpdateGitError('no_stable_tags', 'discovery');
  }

  const lanes = deriveUpdateCandidateLanes(current, candidates);
  const compatible = await findFirstTrustedCandidate(
    lanes.compatible,
    dependencies,
  );
  const newerMajor = await findFirstTrustedCandidate(
    lanes.newerMajor,
    dependencies,
  );

  if (compatible !== null || newerMajor !== null) {
    return [compatible, newerMajor]
      .filter((candidate): candidate is SemVer => candidate !== null);
  }

  const fallback = await findFirstTrustedCandidate(lanes.fallback, dependencies);
  if (fallback !== null) return [fallback];

  throw new UpdateGitError('no_trustworthy_candidates', 'integrity');
}

async function findFirstTrustedCandidate(
  candidates: readonly SemVer[],
  dependencies: ResolvedUpdateDependencies,
): Promise<SemVer | null> {
  for (const candidate of candidates) {
    try {
      if (await dependencies.validateTagIntegrity(candidate.tag)) {
        return candidate;
      }
    } catch (error) {
      if (error instanceof UpdateGitError) throw error;
      throw asEnvironmentError(
        `GitHub tag integrity validation failed: ${error instanceof Error ? error.message : String(error)}`,
        error,
      );
    }
  }
  return null;
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
    await discoverValidatedTags(current, dependencies),
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
      `manual install: npm install -g --ignore-scripts --allow-git=all --install-links=true ${buildPackageSpec(result.newerMajor)}\n`,
    );
  }
}

function printFailure(
  error: unknown,
  dependencies: ResolvedUpdateDependencies,
): number {
  if (
    error instanceof UpdateEnvironmentError
    || error instanceof UpdateGitError
    || error instanceof InputValidationError
  ) {
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
