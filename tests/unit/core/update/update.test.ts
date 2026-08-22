import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  runUpdate,
  runUpdateCheck,
  UpdateDependencies,
} from '../../../../src/cli/commands/update.js';
import { NpmUpdateResult } from '../../../../src/core/update/npm.js';
import { SemVer, parseSemVer } from '../../../../src/core/update/version.js';

const version = (tag: string): SemVer => {
  const parsed = parseSemVer(tag);
  if (!parsed) throw new Error(`Invalid test version: ${tag}`);
  return parsed;
};

const success = (): NpmUpdateResult => ({
  success: true,
  exitCode: 0,
  stderr: '',
  stdout: '',
  errorMessage: null,
  interrupted: false,
  signal: null,
});

function dependencies(
  tags: string[],
  npmCalls: SemVer[],
  validate: (tag: string) => Promise<boolean> = async () => true,
  npmResult: NpmUpdateResult = success(),
): UpdateDependencies {
  const output: string[] = [];
  return {
    getInstalledVersion: () => '1.2.0',
    fetchTags: async () => tags,
    validateTagIntegrity: validate,
    runSelfUpdate: async (target) => {
      npmCalls.push(target);
      return npmResult;
    },
    writeOut: (message) => output.push(message),
    writeErr: (message) => output.push(`ERR:${message}`),
  };
}

describe('SPEC-010 T025-T029 update orchestration', () => {
  it('selects a newer same-major candidate and never installs a major', async () => {
    const npmCalls: SemVer[] = [];
    const deps = dependencies(
      ['v1.4.0', 'v2.0.0'],
      npmCalls,
    );

    assert.equal(await runUpdate(deps), 0);
    assert.deepEqual(npmCalls.map((candidate) => candidate.tag), ['v1.4.0']);
  });

  it('reports only newer majors informationally and does not invoke npm', async () => {
    const npmCalls: SemVer[] = [];
    const output: string[] = [];
    const deps = dependencies(['v2.0.0', 'v3.0.0'], npmCalls);
    deps.writeOut = (message) => output.push(message);

    assert.equal(await runUpdateCheck(deps), 0);
    assert.equal(await runUpdate(deps), 0);
    assert.deepEqual(npmCalls, []);
    assert.ok(output.some((line) => line.includes(
      'manual install: npm install -g --ignore-scripts --allow-git=all --install-links=true github:Edulynch/Opencode-ChangeBudget#v3.0.0',
    )));
    assert.ok(output.some((line) => line.includes('automatic major update refused')));
  });

  it('uses the highest validated newer major for the manual recommendation', async () => {
    const output: string[] = [];
    const npmCalls: SemVer[] = [];
    const deps = dependencies(['v1.2.0', 'v2.0.0', 'v3.0.0'], npmCalls);
    deps.writeOut = (message) => output.push(message);

    assert.equal(await runUpdateCheck(deps), 0);
    assert.ok(output.some((line) => line.includes('#v3.0.0')));
    assert.deepEqual(npmCalls, []);
  });

  it('skips an integrity-mismatched candidate and selects the next valid one', async () => {
    const npmCalls: SemVer[] = [];
    const deps = dependencies(
      ['v1.5.0', 'v1.4.0', 'v2.0.0'],
      npmCalls,
      async (tag) => tag !== 'v1.5.0',
    );

    assert.equal(await runUpdate(deps), 0);
    assert.deepEqual(npmCalls.map((candidate) => candidate.tag), ['v1.4.0']);
  });

  it('rejects malformed or unvalidated candidates when no trustworthy tag remains', async () => {
    const npmCalls: SemVer[] = [];
    const output: string[] = [];
    const deps = dependencies(
      ['latest', 'master', 'v1.3.0-beta.1', 'v1.5.0'],
      npmCalls,
      async () => false,
    );
    deps.writeErr = (message) => output.push(message);

    assert.equal(await runUpdate(deps), 4);
    assert.deepEqual(npmCalls, []);
    assert.ok(output.some((line) => line.includes('trustworthy validated')));
  });

  it('stops before discovery when installed version cannot be determined', async () => {
    let discoveryCalls = 0;
    let npmCalls = 0;
    const errors: string[] = [];
    const deps: UpdateDependencies = {
      getInstalledVersion: () => {
        throw new Error('package.json missing');
      },
      fetchTags: async () => {
        discoveryCalls += 1;
        return ['v1.3.0'];
      },
      runSelfUpdate: async () => {
        npmCalls += 1;
        return success();
      },
      writeErr: (message) => errors.push(message),
    };

    assert.equal(await runUpdateCheck(deps), 4);
    assert.equal(discoveryCalls, 0);
    assert.equal(npmCalls, 0);
    assert.match(errors[0], /Cannot determine ChangeBudget version/);
  });

  it('maps GitHub/network discovery failure to exit 4 without npm', async () => {
    let npmCalls = 0;
    const errors: string[] = [];
    const deps: UpdateDependencies = {
      getInstalledVersion: () => '1.2.0',
      fetchTags: async () => {
        throw new Error('network offline');
      },
      runSelfUpdate: async () => {
        npmCalls += 1;
        return success();
      },
      writeErr: (message) => errors.push(message),
    };

    assert.equal(await runUpdateCheck(deps), 4);
    assert.equal(npmCalls, 0);
    assert.match(errors[0], /Cannot reach GitHub for tag discovery/);
  });

  it('maps npm unavailable and non-zero exits to exit 4 with context', async () => {
    const errors: string[] = [];
    const npmFailure: NpmUpdateResult = {
      ...success(),
      success: false,
      exitCode: 127,
      stderr: 'npm: not found',
      errorMessage: 'ENOENT',
    };
    const deps = dependencies(['v1.3.0'], [], async () => true, npmFailure);
    deps.writeErr = (message) => errors.push(message);

    assert.equal(await runUpdate(deps), 4);
    assert.match(errors[0], /npm not found in PATH/);
    assert.match(errors[0], /npm: not found/);
  });

  it('maps thrown spawn failures and signals to exit 4', async () => {
    const errors: string[] = [];
    const thrown: UpdateDependencies = dependencies(['v1.3.0'], []);
    thrown.runSelfUpdate = async () => {
      throw new Error('spawn ENOENT');
    };
    thrown.writeErr = (message) => errors.push(message);
    assert.equal(await runUpdate(thrown), 4);
    assert.match(errors[0], /spawn ENOENT/);

    const signalErrors: string[] = [];
    const interrupted: UpdateDependencies = dependencies(['v1.3.0'], [], async () => true, {
      ...success(),
      success: false,
      exitCode: null,
      interrupted: true,
      signal: 'SIGTERM',
      errorMessage: null,
    });
    interrupted.writeErr = (message) => signalErrors.push(message);
    assert.equal(await runUpdate(interrupted), 4);
    assert.match(signalErrors[0], /npm update failed/);
  });

  it('maps genuinely unclassified orchestration errors to exit 10', async () => {
    const errors: string[] = [];
    const deps: UpdateDependencies = {
      getInstalledVersion: () => '1.2.0',
      fetchTags: async () => null as unknown as string[],
      writeErr: (message) => errors.push(message),
    };

    assert.equal(await runUpdateCheck(deps), 10);
    assert.match(errors[0], /Internal error/);
  });
});
