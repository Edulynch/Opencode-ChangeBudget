import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { runUpdate, runUpdateCheck } from '../../../../src/cli/commands/update.js';
import { UpdateGitError } from '../../../../src/core/update/git.js';
import type { NpmUpdateResult } from '../../../../src/core/update/npm.js';
import { parseSemVer, type SemVer } from '../../../../src/core/update/version.js';

function version(tag: string): SemVer {
  const parsed = parseSemVer(tag);
  if (!parsed) throw new Error(`Invalid test version: ${tag}`);
  return parsed;
}

const success: NpmUpdateResult = {
  success: true,
  exitCode: 0,
  stderr: '',
  stdout: '',
  errorMessage: null,
  interrupted: false,
  signal: null,
};

function deps(
  tags: string[],
  npmCalls: SemVer[],
  validateTagIntegrity: (tag: string) => Promise<boolean> = async () => true,
) {
  return {
    getInstalledVersion: () => '1.2.0',
    fetchTags: async () => tags,
    validateTagIntegrity,
    runSelfUpdate: async (target: SemVer) => {
      npmCalls.push(target);
      return success;
    },
    writeOut: (_message: string): void => undefined,
    writeErr: (_message: string): void => undefined,
  };
}

test('T042: highest compatible version wins across numeric ordering and duplicate tags', async () => {
  const npmCalls: SemVer[] = [];
  const result = await runUpdate(deps(['v1.2.0', 'v1.10.0', 'v1.10.0', 'v2.0.0'], npmCalls));
  assert.equal(result, 0);
  assert.deepEqual(npmCalls.map((target) => target.tag), ['v1.10.0']);
});

test('T042: check output preserves compatible and newer-major ordering without npm', async () => {
  // Given compatible and newer-major releases are both trustworthy
  const npmCalls: SemVer[] = [];
  const output: string[] = [];
  const dependencies = deps(['v1.4.0', 'v3.0.0'], npmCalls);
  dependencies.writeOut = (message: string) => output.push(message);

  // When update check reports the available releases
  const exitCode = await runUpdateCheck(dependencies);

  // Then output order remains stable and check mode does not install
  assert.equal(exitCode, 0);
  assert.deepEqual(output, [
    'current version: 1.2.0\n',
    'latest compatible: 1.4.0\n',
    'update available: yes\n',
    'newer major available: 3.0.0\n',
    'manual install: npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#v3.0.0\n',
  ]);
  assert.deepEqual(npmCalls, []);
});

test('T042: check stops each newer lane at its first trusted candidate', async () => {
  // Given unsorted compatible, major, and fallback tags
  const npmCalls: SemVer[] = [];
  const validatedTags: string[] = [];
  const dependencies = deps(
    ['v2.0.0', 'v1.2.0', 'v1.4.0', 'v3.0.0', 'v1.5.0'],
    npmCalls,
    async (tag) => {
      validatedTags.push(tag);
      return true;
    },
  );

  // When update check resolves both newer lanes
  const exitCode = await runUpdateCheck(dependencies);

  // Then only the newest compatible and newest major tags are validated
  assert.equal(exitCode, 0);
  assert.deepEqual(validatedTags, ['v1.5.0', 'v3.0.0']);
  assert.deepEqual(npmCalls, []);
});

test('T042: invalid newest candidates fall back independently with stable output', async () => {
  // Given the newest candidate in each newer lane has invalid integrity
  const npmCalls: SemVer[] = [];
  const validatedTags: string[] = [];
  const output: string[] = [];
  const dependencies = deps(
    ['v2.0.0', 'v1.4.0', 'v3.0.0', 'v1.5.0'],
    npmCalls,
    async (tag) => {
      validatedTags.push(tag);
      return tag === 'v1.4.0' || tag === 'v2.0.0';
    },
  );
  dependencies.writeOut = (message: string) => output.push(message);

  // When update check searches for a trusted answer in both lanes
  const exitCode = await runUpdateCheck(dependencies);

  // Then each lane falls back newest-first and both answers are preserved
  assert.equal(exitCode, 0);
  assert.deepEqual(validatedTags, ['v1.5.0', 'v1.4.0', 'v3.0.0', 'v2.0.0']);
  assert.deepEqual(output, [
    'current version: 1.2.0\n',
    'latest compatible: 1.4.0\n',
    'update available: yes\n',
    'newer major available: 2.0.0\n',
    'manual install: npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#v2.0.0\n',
  ]);
  assert.deepEqual(npmCalls, []);
});

test('T042: absent installed tag uses the first trusted older fallback', async () => {
  // Given an installed version newer than every remote tag and absent remotely
  const npmCalls: SemVer[] = [];
  const validatedTags: string[] = [];
  const output: string[] = [];
  const dependencies = deps(['v1.1.0', 'v1.2.0'], npmCalls, async (tag) => {
    validatedTags.push(tag);
    return true;
  });
  dependencies.getInstalledVersion = () => '1.10.0';
  dependencies.writeOut = (message: string) => output.push(message);

  // When the normal update command checks the remote history
  const exitCode = await runUpdate(dependencies);

  // Then one trusted fallback establishes that the install is already current
  assert.equal(exitCode, 0);
  assert.deepEqual(validatedTags, ['v1.2.0']);
  assert.deepEqual(output, [
    'current version: 1.10.0\n',
    'latest compatible: none\n',
    'update available: no\n',
    'already current\n',
  ]);
  assert.deepEqual(npmCalls, []);
});

test('T042: all invalid lanes fail closed after deterministic exhaustion', async () => {
  // Given every compatible, major, and fallback tag has invalid integrity
  const npmCalls: SemVer[] = [];
  const validatedTags: string[] = [];
  const errors: string[] = [];
  const dependencies = deps(
    ['v1.1.0', 'v2.0.0', 'v1.4.0', 'v1.2.0', 'v3.0.0', 'v1.5.0'],
    npmCalls,
    async (tag) => {
      validatedTags.push(tag);
      return false;
    },
  );
  dependencies.writeErr = (message: string) => errors.push(message);

  // When update check exhausts every decision lane
  const exitCode = await runUpdateCheck(dependencies);

  // Then validation order is deterministic and the command fails closed
  assert.equal(exitCode, 4);
  assert.deepEqual(validatedTags, [
    'v1.5.0',
    'v1.4.0',
    'v3.0.0',
    'v2.0.0',
    'v1.2.0',
    'v1.1.0',
  ]);
  assert.deepEqual(errors, ['No trustworthy validated GitHub tags found\n']);
  assert.deepEqual(npmCalls, []);
});

test('T042: UpdateGitError stops integrity validation with sanitized exit 4', async () => {
  // Given integrity validation raises a classified operational failure
  const npmCalls: SemVer[] = [];
  const validatedTags: string[] = [];
  const errors: string[] = [];
  const dependencies = deps(['v1.5.0', 'v1.4.0'], npmCalls, async (tag) => {
    validatedTags.push(tag);
    throw new UpdateGitError('timeout', 'integrity');
  });
  dependencies.writeErr = (message: string) => errors.push(message);

  // When update check validates the first candidate
  const exitCode = await runUpdateCheck(dependencies);

  // Then the error terminates validation without npm or another candidate
  assert.equal(exitCode, 4);
  assert.deepEqual(validatedTags, ['v1.5.0']);
  assert.deepEqual(errors, ['Git operation timed out\n']);
  assert.deepEqual(npmCalls, []);
});

test('T042: newer-major failure discards a trusted compatible candidate', async () => {
  // Given compatible validation succeeds before newer-major validation fails
  const npmCalls: SemVer[] = [];
  const validatedTags: string[] = [];
  const output: string[] = [];
  const errors: string[] = [];
  const dependencies = deps(['v2.0.0', 'v1.4.0'], npmCalls, async (tag) => {
    validatedTags.push(tag);
    if (tag === 'v1.4.0') return true;
    throw new UpdateGitError('timeout', 'integrity');
  });
  dependencies.writeOut = (message: string) => output.push(message);
  dependencies.writeErr = (message: string) => errors.push(message);

  // When the normal update command resolves both independent lanes
  const exitCode = await runUpdate(dependencies);

  // Then the later operational failure prevents reporting and installation
  assert.equal(exitCode, 4);
  assert.deepEqual(validatedTags, ['v1.4.0', 'v2.0.0']);
  assert.deepEqual(output, []);
  assert.deepEqual(errors, ['Git operation timed out\n']);
  assert.deepEqual(npmCalls, []);
});

test('T042: generic validator errors stop with sanitized exit 4', async () => {
  // Given integrity validation raises an unclassified operational error
  const npmCalls: SemVer[] = [];
  const validatedTags: string[] = [];
  const errors: string[] = [];
  const dependencies = deps(['v1.5.0', 'v1.4.0'], npmCalls, async (tag) => {
    validatedTags.push(tag);
    throw new Error('integrity unavailable');
  });
  dependencies.writeErr = (message: string) => errors.push(message);

  // When update check validates the first candidate
  const exitCode = await runUpdateCheck(dependencies);

  // Then the error is normalized without npm or another candidate
  assert.equal(exitCode, 4);
  assert.deepEqual(validatedTags, ['v1.5.0']);
  assert.deepEqual(errors, [
    'GitHub tag integrity validation failed: integrity unavailable\n',
  ]);
  assert.deepEqual(npmCalls, []);
});

test('T042: current newer than discovered tags is a no-op', async () => {
  const npmCalls: SemVer[] = [];
  const output: string[] = [];
  const dependencies = deps(['v1.1.0', 'v1.2.0'], npmCalls);
  dependencies.getInstalledVersion = () => '1.10.0';
  dependencies.writeOut = (message: string) => output.push(message);

  assert.equal(await runUpdate(dependencies), 0);
  assert.deepEqual(npmCalls, []);
  assert.ok(output.some((line) => line.includes('already current')));
  assert.equal(output.some((line) => line.includes('manual install:')), false);
});

test('T042: invalid stable candidates fall back and invalid majors are not recommended', async () => {
  const npmCalls: SemVer[] = [];
  const dependencies = deps(
    ['v1.5.0', 'v1.4.0', 'v2.0.0', 'v3.0.0'],
    npmCalls,
    async (tag) => tag !== 'v1.5.0' && tag !== 'v3.0.0',
  );

  assert.equal(await runUpdate(dependencies), 0);
  assert.deepEqual(npmCalls.map((target) => target.tag), ['v1.4.0']);

  const majorErrors: string[] = [];
  const onlyInvalidMajor = deps(['v2.0.0'], [], async () => false);
  onlyInvalidMajor.writeErr = (message: string) => majorErrors.push(message);
  assert.equal(await runUpdateCheck(onlyInvalidMajor), 4);
  assert.match(majorErrors[0], /trustworthy validated/);
});

test('T042: malformed, prerelease, aliases, and empty stable metadata produce no candidate', async () => {
  const errors: string[] = [];
  const dependencies = deps(['v1.3.0-beta.1', 'v1.3', 'release-1.3.0', 'latest', 'master', 'main'], []);
  dependencies.writeErr = (message: string) => errors.push(message);

  assert.equal(await runUpdateCheck(dependencies), 4);
  assert.match(errors[0], /No valid stable GitHub tags found/);
});

test('T041/T043: invalid CLI usage is 2 and platform subprocess branches are covered', () => {
  const cli = `${process.cwd()}/dist/src/cli/index.js`;
  const result = spawnSync(process.execPath, [cli, 'update', '--invalid'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 2);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /exit 1/);
});
