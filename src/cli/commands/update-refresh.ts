import { type ManagedIntegrationDiscovery } from '../../core/integration/opencode-discovery.js';
import { type NpmExecutionResult, type NpmUpdateSuccess, type VerifiedNpmCliRunner } from '../../core/update/npm.js';
import { type IntegrationRefreshProgress } from '../../core/update/progress.js';

interface UpdatedCliExecutionRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: false;
}

export interface CurrentIntegrationRefreshRequest {
  readonly projectRoot: string;
  readonly changeBudgetRoot: string;
}

export interface ManagedIntegrationRefreshDependencies {
  readonly getProjectRoot: () => string;
  readonly getChangeBudgetRoot: () => string;
  readonly discoverManagedIntegration: (
    projectRoot: string,
    changeBudgetRoot: string,
  ) => Promise<ManagedIntegrationDiscovery>;
  readonly refreshCurrentIntegration: (request: CurrentIntegrationRefreshRequest) => Promise<void>;
  readonly executeUpdatedCli?: (request: UpdatedCliExecutionRequest) => Promise<NpmExecutionResult>;
  readonly runVerifiedNpmCli: VerifiedNpmCliRunner;
  readonly createRefreshProgress: () => IntegrationRefreshProgress;
  readonly writeErr: (message: string) => void;
}

function assertNever(value: never): never {
  throw new Error(`Unexpected managed integration state: ${String(value)}`);
}

function shouldRefresh(discovery: ManagedIntegrationDiscovery): boolean {
  switch (discovery.state) {
    case 'MANAGED_STALE':
    case 'LEGACY_MANAGED':
    case 'PARTIAL':
      return discovery.profileId === 'opencode';
    case 'ABSENT':
    case 'MANAGED_CURRENT':
    case 'CONFLICT':
    case 'UNKNOWN_PROFILE':
      return false;
    default:
      return assertNever(discovery);
  }
}

export async function refreshManagedOpenCodeIntegration(
  update: NpmUpdateSuccess | undefined,
  dependencies: ManagedIntegrationRefreshDependencies,
): Promise<number> {
  let projectRoot: string;
  let changeBudgetRoot: string;
  let discovery: ManagedIntegrationDiscovery;
  try {
    projectRoot = dependencies.getProjectRoot();
    changeBudgetRoot = dependencies.getChangeBudgetRoot();
    discovery = await dependencies.discoverManagedIntegration(projectRoot, changeBudgetRoot);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    dependencies.writeErr(`Warning: managed OpenCode integration discovery skipped: ${message}\n`);
    return 0;
  }

  switch (discovery.state) {
    case 'CONFLICT':
      dependencies.writeErr('Integration refresh skipped: conflict requires attention.\n');
      return 0;
    case 'UNKNOWN_PROFILE':
      dependencies.writeErr(`Integration refresh skipped: unknown profile '${discovery.profileId}' requires attention.\n`);
      return 0;
    case 'ABSENT':
    case 'MANAGED_CURRENT':
      return 0;
    default:
      if (!shouldRefresh(discovery)) return 0;
  }

  const progress = dependencies.createRefreshProgress();
  progress.start('opencode');
  try {
    if (update === undefined) {
      await dependencies.refreshCurrentIntegration({ projectRoot, changeBudgetRoot });
      progress.stop('opencode', 'success');
      return 0;
    }
    const refreshResult = dependencies.executeUpdatedCli === undefined
      ? await dependencies.runVerifiedNpmCli({ update, args: ['integrate', 'opencode'], cwd: projectRoot })
      : await dependencies.executeUpdatedCli({
        command: process.execPath,
        args: [update.entry, 'integrate', 'opencode'],
        cwd: projectRoot,
        shell: false,
      });
    if (refreshResult.kind === 'success') {
      progress.stop('opencode', 'success');
      return 0;
    }
    progress.stop('opencode', 'failure');
    const diagnostics = [refreshResult.errorMessage, refreshResult.stderr, refreshResult.stdout]
      .filter((value): value is string => Boolean(value))
      .join('\n');
    dependencies.writeErr(
      `Package update completed, but managed OpenCode refresh failed${diagnostics.length > 0 ? `: ${diagnostics}` : ''}\n`,
    );
    return 4;
  } catch (error) {
    progress.stop('opencode', 'failure');
    const message = error instanceof Error ? error.message : String(error);
    const scope = update === undefined ? 'Managed OpenCode refresh' : 'Package update completed, but managed OpenCode refresh';
    dependencies.writeErr(`${scope} failed: ${message}\n`);
    return 4;
  }
}
