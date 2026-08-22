import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { runUpdate, runUpdateCheck } from '../../../../src/cli/commands/update.js';
import { validateTagIntegrity } from '../../../../src/core/update/github.js';
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

function contentsResponse(packageJson: unknown): Response {
  return new Response(JSON.stringify({
    content: Buffer.from(JSON.stringify(packageJson)).toString('base64'),
  }));
}

test('T042: integrity validation accepts matching versions and rejects mismatch/malformed metadata', async () => {
  const matching = async () => contentsResponse({ version: '1.2.3' });
  const mismatch = async () => contentsResponse({ version: '1.2.4' });
  const missing = async () => contentsResponse({});
  const nonString = async () => contentsResponse({ version: 1.2 });
  const malformed = async () => new Response(JSON.stringify({ content: 'not-base64-json' }));

  assert.equal(await validateTagIntegrity('owner', 'repo', 'v1.2.3', matching), true);
  assert.equal(await validateTagIntegrity('owner', 'repo', 'v1.2.3', mismatch), false);
  assert.equal(await validateTagIntegrity('owner', 'repo', 'v1.2.3', missing), false);
  assert.equal(await validateTagIntegrity('owner', 'repo', 'v1.2.3', nonString), false);
  assert.equal(await validateTagIntegrity('owner', 'repo', 'v1.2.3', malformed), false);
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
