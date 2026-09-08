import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runUpdate, runUpdateCheck, type UpdateDependencies } from '../../../../src/cli/commands/update.js';
import type { ManagedIntegrationDiscovery } from '../../../../src/core/integration/opencode-discovery.js';
import type { NpmExecutionResult, NpmUpdateResult, NpmUpdateSuccess } from '../../../../src/core/update/npm.js';
import { parseSemVer, type SemVer } from '../../../../src/core/update/version.js';

const version = (tag: string): SemVer => {
  const parsed = parseSemVer(tag);
  if (parsed === null) throw new Error(`Invalid test version: ${tag}`);
  return parsed;
};

const success = (): NpmUpdateSuccess => ({
  success: true, exitCode: 0, stderr: '', stdout: '', errorMessage: null, interrupted: false, signal: null,
  entry: '/global/node_modules/changebudget/dist/src/cli/index.js',
});

type UpdatedCliRequest = {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: false;
};

type ManagedUpdateDependencies = UpdateDependencies & {
  readonly getProjectRoot: () => string;
  readonly discoverManagedIntegration: () => Promise<ManagedIntegrationDiscovery>;
  readonly executeUpdatedCli: (request: UpdatedCliRequest) => Promise<NpmExecutionResult>;
  readonly refreshCurrentIntegration: (request: {
    readonly projectRoot: string;
    readonly changeBudgetRoot: string;
  }) => Promise<void>;
  readonly createRefreshProgress: () => {
    start(profileId: string): void;
    stop(profileId: string, result: 'success' | 'failure'): void;
  };
};

type ManagedUpdateFixture = {
  readonly dependencies: ManagedUpdateDependencies;
  readonly entry: string;
  readonly events: string[];
  readonly requests: UpdatedCliRequest[];
  readonly currentRefreshRequests: Array<{
    readonly projectRoot: string;
    readonly changeBudgetRoot: string;
  }>;
  readonly output: string[];
  readonly errors: string[];
};

function managedUpdateFixture(
  discover: () => Promise<ManagedIntegrationDiscovery>,
  childResult: NpmExecutionResult = { kind: 'success', stdout: '', stderr: '' },
): ManagedUpdateFixture {
  const entry = '/global/node_modules/changebudget/dist/src/cli/index.js';
  const events: string[] = [];
  const requests: UpdatedCliRequest[] = [];
  const currentRefreshRequests: Array<{ readonly projectRoot: string; readonly changeBudgetRoot: string }> = [];
  const output: string[] = [];
  const errors: string[] = [];
  return {
    entry,
    events,
    requests,
    currentRefreshRequests,
    output,
    errors,
    dependencies: {
      getInstalledVersion: () => '1.2.0',
      discoverVersions: async () => [version('v1.2.3')],
      runSelfUpdate: async () => {
        events.push('npm');
        return { ...success(), entry };
      },
      getProjectRoot: () => '/workspace/project',
      getChangeBudgetRoot: () => entry,
      discoverManagedIntegration: async () => {
        events.push('discover');
        return discover();
      },
      executeUpdatedCli: async (request) => {
        events.push('refresh');
        requests.push(request);
        return childResult;
      },
      refreshCurrentIntegration: async (request) => {
        events.push('current-refresh');
        currentRefreshRequests.push(request);
      },
      createRefreshProgress: () => ({
        start: (profileId) => events.push(`refresh-start:${profileId}`),
        stop: (profileId, result) => events.push(`refresh-stop:${profileId}:${result}`),
      }),
      writeOut: (message) => output.push(message),
      writeErr: (message) => errors.push(message),
    },
  };
}

function dependencies(
  versions: readonly string[],
  installations: SemVer[],
  npmResult: NpmUpdateResult = success(),
  writeOut?: (message: string) => void,
  writeErr?: (message: string) => void,
): UpdateDependencies {
  return {
    getInstalledVersion: () => '1.2.0',
    discoverVersions: async () => versions.flatMap((tag) => {
      const parsed = parseSemVer(tag);
      return parsed === null ? [] : [parsed];
    }),
    runSelfUpdate: async (target) => {
      installations.push(target);
      return npmResult;
    },
    discoverManagedIntegration: async () => ({ state: 'ABSENT' }),
    executeUpdatedCli: async () => {
      throw new Error('Generic update-selection tests must not refresh OpenCode');
    },
    ...(writeOut === undefined ? {} : { writeOut }),
    ...(writeErr === undefined ? {} : { writeErr }),
  };
}

describe('npm update orchestration', () => {
  it('installs only the highest newer same-major version', async () => {
    const installations: SemVer[] = [];
    assert.equal(await runUpdate(dependencies(['v1.4.0', 'v1.10.0', 'v2.0.0'], installations)), 0);
    assert.deepEqual(installations.map((target) => target.tag), ['v1.10.0']);
  });

  it('checks without installing and reports newer majors only as informational', async () => {
    const installations: SemVer[] = [];
    const output: string[] = [];
    const deps = dependencies(['v1.4.0', 'v3.0.0'], installations, success(), (message) => output.push(message));

    assert.equal(await runUpdateCheck(deps), 0);
    assert.deepEqual(installations, []);
    assert.deepEqual(output, [
      'current version: 1.2.0\n',
      'latest compatible: 1.4.0\n',
      'update available: yes\n',
      'newer major available: 3.0.0\n',
      'manual install: npm install --global changebudget@3.0.0 --registry=https://registry.npmjs.org/\n',
    ]);
  });

  it('refuses automatic major updates', async () => {
    const installations: SemVer[] = [];
    const output: string[] = [];
    const deps = dependencies(['v2.0.0'], installations, success(), (message) => output.push(message));

    assert.equal(await runUpdate(deps), 0);
    assert.deepEqual(installations, []);
    assert.equal(output.at(-1), 'automatic major update refused\n');
  });

  it('maps npm discovery, install, and installed-version failures to exit 4', async () => {
    const discoveryErrors: string[] = [];
    assert.equal(await runUpdateCheck({
      getInstalledVersion: () => '1.2.0',
      discoverVersions: async () => { throw new Error('network offline'); },
      writeErr: (message) => discoveryErrors.push(message),
    }), 4);
    assert.match(discoveryErrors[0] ?? '', /npm registry discovery failed/);

    const installErrors: string[] = [];
    const failed: NpmUpdateResult = {
      success: false, exitCode: null, stderr: '', stdout: '', errorMessage: 'Installed ChangeBudget reported 1.2.4 instead of 1.2.3',
      interrupted: false, signal: null,
    };
    const deps = dependencies(['v1.2.3'], [], failed, undefined, (message) => installErrors.push(message));
    assert.equal(await runUpdate(deps), 4);
    assert.match(installErrors[0] ?? '', /reported 1.2.4/);
  });

  for (const updateCase of [
    { label: 'throws', runSelfUpdate: async (): Promise<NpmUpdateResult> => { throw new Error('npm unavailable'); } },
    {
      label: 'returns failure',
      runSelfUpdate: async (): Promise<NpmUpdateResult> => ({
        success: false, exitCode: 1, stderr: 'npm failed', stdout: '', errorMessage: 'exit 1', interrupted: false, signal: null,
      }),
    },
  ] as const) {
    it(`stops version-aware progress when npm ${updateCase.label}`, async () => {
      const progressEvents: string[] = [];
      const result = await runUpdate({
        getInstalledVersion: () => '1.2.0',
        discoverVersions: async () => [version('v1.2.3')],
        runSelfUpdate: updateCase.runSelfUpdate,
        createProgress: () => ({
          start: (target) => progressEvents.push(`start:${target}`),
          stop: (target, outcome) => progressEvents.push(`stop:${target}:${outcome}`),
        }),
        writeOut: () => undefined,
        writeErr: () => undefined,
      });

      assert.equal(result, 4);
      assert.deepEqual(progressEvents, ['start:1.2.3', 'stop:1.2.3:failure']);
    });
  }

  it('stops before discovery when the installed version is invalid', async () => {
    let discoveryCalls = 0;
    assert.equal(await runUpdateCheck({
      getInstalledVersion: () => 'invalid',
      discoverVersions: async () => {
        discoveryCalls += 1;
        return [];
      },
    }), 4);
    assert.equal(discoveryCalls, 0);
  });

  for (const discovery of [
    { state: 'MANAGED_STALE', profileId: 'opencode' },
    { state: 'LEGACY_MANAGED', profileId: 'opencode' },
    { state: 'PARTIAL', profileId: 'opencode' },
  ] satisfies readonly ManagedIntegrationDiscovery[]) {
    it(`refreshes ${discovery.state} OpenCode integration only after the verified update`, async () => {
      const fixture = managedUpdateFixture(async () => discovery);

      assert.equal(await runUpdate(fixture.dependencies), 0);
      assert.deepEqual(fixture.events, ['npm', 'discover', 'refresh-start:opencode', 'refresh', 'refresh-stop:opencode:success']);
      assert.deepEqual(fixture.requests, [{
        command: process.execPath,
        args: [fixture.entry, 'integrate', 'opencode'],
        cwd: '/workspace/project',
        shell: false,
      }]);
    });
  }

  for (const discovery of [
    { state: 'ABSENT' },
    { state: 'MANAGED_CURRENT', profileId: 'opencode' },
    { state: 'CONFLICT' },
    { state: 'UNKNOWN_PROFILE', profileId: 'other' },
  ] satisfies readonly ManagedIntegrationDiscovery[]) {
    it(`does not refresh ${discovery.state} integration state`, async () => {
      const fixture = managedUpdateFixture(async () => discovery);

      assert.equal(await runUpdate(fixture.dependencies), 0);
      assert.deepEqual(fixture.events, ['npm', 'discover']);
      assert.deepEqual(fixture.requests, []);
      if (discovery.state === 'CONFLICT') {
        assert.equal(fixture.errors.at(-1), 'Integration refresh skipped: conflict requires attention.\n');
      } else if (discovery.state === 'UNKNOWN_PROFILE') {
        assert.equal(fixture.errors.at(-1), "Integration refresh skipped: unknown profile 'other' requires attention.\n");
      } else {
        assert.deepEqual(fixture.errors, []);
      }
    });
  }

  it('does not discover or refresh integration during update check', async () => {
    const fixture = managedUpdateFixture(async () => ({ state: 'MANAGED_CURRENT', profileId: 'opencode' }));
    let progressCreations = 0;
    const updateDependencies: ManagedUpdateDependencies = {
      ...fixture.dependencies,
      createProgress: () => {
        progressCreations += 1;
        return { start: () => undefined, stop: () => undefined };
      },
    };

    assert.equal(await runUpdateCheck(updateDependencies), 0);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.requests, []);
    assert.equal(progressCreations, 0);
  });

  for (const discovery of [
    { state: 'MANAGED_STALE', profileId: 'opencode' },
    { state: 'LEGACY_MANAGED', profileId: 'opencode' },
    { state: 'PARTIAL', profileId: 'opencode' },
  ] satisfies readonly ManagedIntegrationDiscovery[]) {
    it(`refreshes safe already-current ${discovery.state} integration in process`, async () => {
      const fixture = managedUpdateFixture(async () => discovery);
      const updateDependencies: ManagedUpdateDependencies = {
        ...fixture.dependencies,
        discoverVersions: async () => [version('v1.2.0')],
      };

      assert.equal(await runUpdate(updateDependencies), 0);
      assert.deepEqual(fixture.events, ['discover', 'refresh-start:opencode', 'current-refresh', 'refresh-stop:opencode:success']);
      assert.deepEqual(fixture.requests, []);
      assert.deepEqual(fixture.currentRefreshRequests, [{
        projectRoot: '/workspace/project',
        changeBudgetRoot: fixture.entry,
      }]);
    });
  }

  for (const discovery of [
    { state: 'ABSENT' },
    { state: 'MANAGED_CURRENT', profileId: 'opencode' },
    { state: 'CONFLICT' },
    { state: 'UNKNOWN_PROFILE', profileId: 'other' },
  ] satisfies readonly ManagedIntegrationDiscovery[]) {
    it(`does not refresh already-current ${discovery.state} integration state`, async () => {
      const fixture = managedUpdateFixture(async () => ({ state: 'MANAGED_CURRENT', profileId: 'opencode' }));
      const updateDependencies: ManagedUpdateDependencies = {
        ...fixture.dependencies,
        discoverVersions: async () => [version('v1.2.0')],
        discoverManagedIntegration: async () => {
          fixture.events.push('discover');
          return discovery;
        },
      };

      assert.equal(await runUpdate(updateDependencies), 0);
      assert.deepEqual(fixture.events, ['discover']);
      assert.deepEqual(fixture.requests, []);
      assert.deepEqual(fixture.currentRefreshRequests, []);
      if (discovery.state === 'CONFLICT') {
        assert.equal(fixture.errors.at(-1), 'Integration refresh skipped: conflict requires attention.\n');
      }
      if (discovery.state === 'UNKNOWN_PROFILE') {
        assert.equal(fixture.errors.at(-1), "Integration refresh skipped: unknown profile 'other' requires attention.\n");
      }
    });
  }

  it('does not discover or refresh integration when only a newer major is available', async () => {
    const fixture = managedUpdateFixture(async () => ({ state: 'MANAGED_CURRENT', profileId: 'opencode' }));
    const updateDependencies: ManagedUpdateDependencies = {
      ...fixture.dependencies,
      discoverVersions: async () => [version('v2.0.0')],
    };

    assert.equal(await runUpdate(updateDependencies), 0);
    assert.deepEqual(fixture.events, []);
    assert.deepEqual(fixture.requests, []);
    assert.deepEqual(fixture.currentRefreshRequests, []);
  });

  it('warns about discovery failure after completing the npm update', async () => {
    const fixture = managedUpdateFixture(async () => { throw new Error('project is unreadable'); });

    assert.equal(await runUpdate(fixture.dependencies), 0);
    assert.deepEqual(fixture.events, ['npm', 'discover']);
    assert.deepEqual(fixture.requests, []);
    assert.equal(fixture.output.includes('updated to 1.2.3\n'), true);
    assert.match(fixture.errors.join(''), /managed OpenCode integration/i);
  });

  it('reports a completed update and exits 4 when refreshed CLI execution fails', async () => {
    const fixture = managedUpdateFixture(
      async () => ({ state: 'MANAGED_STALE', profileId: 'opencode' }),
      { kind: 'failure', stdout: '', stderr: 'refresh failed', errorMessage: 'exit 1' },
    );

    assert.equal(await runUpdate(fixture.dependencies), 4);
    assert.deepEqual(fixture.events, ['npm', 'discover', 'refresh-start:opencode', 'refresh', 'refresh-stop:opencode:failure']);
    assert.equal(fixture.output.includes('updated to 1.2.3\n'), true);
    assert.match(fixture.errors.join(''), /refresh/i);
  });
});
