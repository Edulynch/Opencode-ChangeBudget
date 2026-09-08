/** npm-registry based self-update orchestration. */

import { stderr, stdout } from 'node:process';

import { installIntegration, resolveChangeBudgetRoot } from '../../core/integration/opencode.js';
import {
  discoverManagedIntegration,
  type ManagedIntegrationDiscovery,
} from '../../core/integration/opencode-discovery.js';
import { getInstalledVersion } from '../../core/package-root.js';
import {
  discoverNpmVersions,
  runSelfUpdate,
  runVerifiedNpmCli,
  type NpmExecutionResult,
  type NpmUpdateResult,
  type NpmUpdateSuccess,
  type VerifiedNpmCliRunner,
} from '../../core/update/npm.js';
import {
  createIntegrationRefreshProgress,
  createNpmUpdateProgress,
  type IntegrationRefreshProgress,
  type NpmUpdateProgress,
} from '../../core/update/progress.js';
import { determineUpdateCheckResult, type UpdateCheckResult } from '../../core/update/selection.js';
import { formatSemVer, parseSemVer, type SemVer } from '../../core/update/version.js';
import { InputValidationError } from '../../models/errors.js';
import {
  refreshManagedOpenCodeIntegration,
  type CurrentIntegrationRefreshRequest,
} from './update-refresh.js';

class UpdateEnvironmentError extends Error {}

interface UpdatedCliExecutionRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: false;
}

export interface UpdateDependencies {
  readonly getInstalledVersion?: () => string;
  readonly discoverVersions?: () => Promise<readonly SemVer[]>;
  readonly runSelfUpdate?: (version: SemVer) => Promise<NpmUpdateResult>;
  readonly getProjectRoot?: () => string;
  readonly getChangeBudgetRoot?: () => string;
  readonly discoverManagedIntegration?: (
    projectRoot: string,
    changeBudgetRoot: string,
  ) => Promise<ManagedIntegrationDiscovery>;
  readonly executeUpdatedCli?: (
    request: UpdatedCliExecutionRequest,
  ) => Promise<NpmExecutionResult>;
  readonly runVerifiedNpmCli?: VerifiedNpmCliRunner;
  readonly refreshCurrentIntegration?: (request: CurrentIntegrationRefreshRequest) => Promise<void>;
  readonly createProgress?: () => NpmUpdateProgress;
  readonly createRefreshProgress?: () => IntegrationRefreshProgress;
  readonly writeOut?: (message: string) => void;
  readonly writeErr?: (message: string) => void;
}

interface ResolvedUpdateDependencies {
  readonly getInstalledVersion: () => string;
  readonly discoverVersions: () => Promise<readonly SemVer[]>;
  readonly runSelfUpdate: (version: SemVer) => Promise<NpmUpdateResult>;
  readonly getProjectRoot: () => string;
  readonly getChangeBudgetRoot: () => string;
  readonly discoverManagedIntegration: (
    projectRoot: string,
    changeBudgetRoot: string,
  ) => Promise<ManagedIntegrationDiscovery>;
  readonly executeUpdatedCli?: (
    request: UpdatedCliExecutionRequest,
  ) => Promise<NpmExecutionResult>;
  readonly runVerifiedNpmCli: VerifiedNpmCliRunner;
  readonly refreshCurrentIntegration: (request: CurrentIntegrationRefreshRequest) => Promise<void>;
  readonly createProgress: () => NpmUpdateProgress;
  readonly createRefreshProgress: () => IntegrationRefreshProgress;
  readonly writeOut: (message: string) => void;
  readonly writeErr: (message: string) => void;
}

function resolveDependencies(dependencies: UpdateDependencies): ResolvedUpdateDependencies {
  return {
    getInstalledVersion: dependencies.getInstalledVersion ?? getInstalledVersion,
    discoverVersions: dependencies.discoverVersions ?? discoverNpmVersions,
    runSelfUpdate: dependencies.runSelfUpdate ?? runSelfUpdate,
    getProjectRoot: dependencies.getProjectRoot ?? (() => process.cwd()),
    getChangeBudgetRoot: dependencies.getChangeBudgetRoot ?? resolveChangeBudgetRoot,
    discoverManagedIntegration: dependencies.discoverManagedIntegration ?? discoverManagedIntegration,
    executeUpdatedCli: dependencies.executeUpdatedCli,
    runVerifiedNpmCli: dependencies.runVerifiedNpmCli ?? runVerifiedNpmCli,
    refreshCurrentIntegration: dependencies.refreshCurrentIntegration ?? (async ({ projectRoot, changeBudgetRoot }) => {
      await installIntegration(projectRoot, changeBudgetRoot);
    }),
    createProgress: dependencies.createProgress ?? createNpmUpdateProgress,
    createRefreshProgress: dependencies.createRefreshProgress ?? createIntegrationRefreshProgress,
    writeOut: dependencies.writeOut ?? ((message) => stdout.write(message)),
    writeErr: dependencies.writeErr ?? ((message) => stderr.write(message)),
  };
}

function environmentError(message: string, cause?: unknown): UpdateEnvironmentError {
  const error = new UpdateEnvironmentError(message);
  if (cause !== undefined) error.cause = cause;
  return error;
}

async function getUpdateResult(dependencies: ResolvedUpdateDependencies): Promise<UpdateCheckResult> {
  let installedVersion: string;
  try {
    installedVersion = dependencies.getInstalledVersion();
  } catch (error) {
    throw environmentError(
      `Cannot determine ChangeBudget version: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  const current = parseSemVer(`v${installedVersion.replace(/^v/, '')}`);
  if (current === null) {
    throw new InputValidationError(
      `Installed ChangeBudget version '${installedVersion}' is not a valid semantic version`,
      'VERSION_FORMAT',
      { version: installedVersion },
    );
  }

  let versions: readonly SemVer[];
  try {
    versions = await dependencies.discoverVersions();
  } catch (error) {
    throw environmentError(
      `npm registry discovery failed: ${error instanceof Error ? error.message : String(error)}`,
      error,
    );
  }
  return determineUpdateCheckResult(current, versions);
}

function printCheckResult(result: UpdateCheckResult, writeOut: (message: string) => void): void {
  writeOut(`current version: ${result.currentVersionString}\n`);
  writeOut(`latest compatible: ${result.latestCompatibleString ?? 'none'}\n`);
  writeOut(`update available: ${result.updateAvailable ? 'yes' : 'no'}\n`);
  if (result.newerMajor !== null) {
    const version = formatSemVer(result.newerMajor);
    writeOut(`newer major available: ${version}\n`);
    writeOut(`manual install: npm install --global changebudget@${version} --registry=https://registry.npmjs.org/\n`);
  }
}

function printFailure(error: unknown, dependencies: ResolvedUpdateDependencies): number {
  if (error instanceof UpdateEnvironmentError || error instanceof InputValidationError) {
    dependencies.writeErr(`${error.message}\n`);
    return 4;
  }
  dependencies.writeErr(`Internal error: ${error instanceof Error ? error.message : String(error)}\n`);
  return 10;
}

export async function runUpdateCheck(dependencies: UpdateDependencies = {}): Promise<number> {
  const resolved = resolveDependencies(dependencies);
  try {
    printCheckResult(await getUpdateResult(resolved), resolved.writeOut);
    return 0;
  } catch (error) {
    return printFailure(error, resolved);
  }
}

export async function runUpdate(dependencies: UpdateDependencies = {}): Promise<number> {
  const resolved = resolveDependencies(dependencies);
  try {
    const result = await getUpdateResult(resolved);
    printCheckResult(result, resolved.writeOut);
    if (result.latestCompatible === null) {
      resolved.writeOut(result.newerMajor === null ? 'already current\n' : 'automatic major update refused\n');
      return refreshManagedOpenCodeIntegration(undefined, resolved);
    }
    resolved.writeOut(`updating to ${formatSemVer(result.latestCompatible)}\n`);
    let npmResult: NpmUpdateResult;
    const progress = resolved.createProgress();
    const targetVersion = formatSemVer(result.latestCompatible);
    progress.start(targetVersion);
    try {
      npmResult = await resolved.runSelfUpdate(result.latestCompatible);
    } catch (error) {
      progress.stop(targetVersion, 'failure');
      throw environmentError(`npm update failed: ${error instanceof Error ? error.message : String(error)}`, error);
    }
    progress.stop(targetVersion, npmResult.success ? 'success' : 'failure');
    if (!npmResult.success) {
      const details = [npmResult.errorMessage, npmResult.stderr, npmResult.stdout]
        .filter((value): value is string => Boolean(value))
        .join('\n');
      throw environmentError(`npm update failed${details.length > 0 ? `: ${details}` : ''}`);
    }
    resolved.writeOut(`updated to ${formatSemVer(result.latestCompatible)}\n`);
    return refreshManagedOpenCodeIntegration(npmResult, resolved);
  } catch (error) {
    return printFailure(error, resolved);
  }
}
