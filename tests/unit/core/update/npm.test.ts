import * as assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

import {
  NPM_REGISTRY,
  createVerifiedNpmCliRunner,
  discoverNpmVersions,
  parseNpmVersions,
  runSelfUpdate,
  type NpmExecutionRequest,
  type NpmExecutionResult,
  type NpmRegistryFetcher,
} from '../../../../src/core/update/npm.js';
import { parseSemVer, type SemVer } from '../../../../src/core/update/version.js';

const version = (tag: string): SemVer => {
  const parsed = parseSemVer(tag);
  if (parsed === null) throw new Error(`Invalid test version: ${tag}`);
  return parsed;
};

function executor(
  results: readonly NpmExecutionResult[],
  requests: NpmExecutionRequest[],
): (request: NpmExecutionRequest) => Promise<NpmExecutionResult> {
  let index = 0;
  return async (request) => {
    requests.push(request);
    const result = results[index];
    index += 1;
    if (result === undefined) throw new Error(`Unexpected npm command ${index}`);
    return result;
  };
}

const commandSuccess = (stdout = ''): NpmExecutionResult => ({
  kind: 'success',
  stdout,
  stderr: '',
});

function registryFetcher(response: { readonly ok: boolean; readonly status: number; readonly body: string }): NpmRegistryFetcher {
  return async () => ({
    ok: response.ok,
    status: response.status,
    text: async () => response.body,
  });
}

describe('core/update/npm registry adapter', () => {
  it('parses registry version maps while rejecting prerelease and malformed versions', () => {
    assert.deepEqual(parseNpmVersions('{"versions":{"1.2.3":{}}}').map((item) => item.tag), ['v1.2.3']);
    assert.deepEqual(
      parseNpmVersions('{"versions":{"1.2.3":{},"1.10.0":{},"2.0.0-beta.1":{},"v1.2.4":{},"01.2.3":{}}}').map((item) => item.tag),
      ['v1.2.3', 'v1.10.0'],
    );
  });

  it('uses the direct package registry endpoint without invoking npm', async () => {
    const requests: Array<{ readonly url: string; readonly init: RequestInit }> = [];
    const fetcher: NpmRegistryFetcher = async (url, init) => {
      requests.push({ url, init });
      return { ok: true, status: 200, text: async () => '{"versions":{"1.2.3":{}}}' };
    };
    const versions = await discoverNpmVersions(fetcher);

    assert.deepEqual(versions.map((item) => item.tag), ['v1.2.3']);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.url, `${NPM_REGISTRY}changebudget`);
    assert.equal(requests[0]?.init.signal instanceof AbortSignal, true);
  });

  it('rejects malformed registry responses, HTTP errors, and network failures', async () => {
    await assert.rejects(
      discoverNpmVersions(registryFetcher({ ok: true, status: 200, body: '{' })),
      /Invalid npm registry version output/,
    );
    await assert.rejects(
      discoverNpmVersions(registryFetcher({ ok: true, status: 200, body: '{"versions":["1.2.3"]}' })),
      /Invalid npm registry version output/,
    );
    await assert.rejects(
      discoverNpmVersions(registryFetcher({ ok: false, status: 503, body: '' })),
      /HTTP 503/,
    );
    await assert.rejects(
      discoverNpmVersions(async () => { throw new Error('network offline'); }),
      /network offline/,
    );
  });

  it('installs an exact package, finds the global entry, and verifies its exact version', async () => {
    const requests: NpmExecutionRequest[] = [];
    const result = await runSelfUpdate(
      version('v1.2.3'),
      executor([
        commandSuccess(),
        commandSuccess('/opt/npm/lib/node_modules\n'),
        commandSuccess('1.2.3\n'),
      ], requests),
      'linux',
      async (entry) => entry === join('/opt/npm/lib/node_modules', 'changebudget', 'dist', 'src', 'cli', 'index.js'),
    );

    assert.equal(result.success, true);
    assert.equal('entry' in result, true);
    if ('entry' in result) {
      assert.equal(result.entry, join('/opt/npm/lib/node_modules', 'changebudget', 'dist', 'src', 'cli', 'index.js'));
    }
    if (result.success) {
      await createVerifiedNpmCliRunner(executor([commandSuccess()], requests))({
        update: result,
        args: ['integrate', 'opencode'],
        cwd: '/workspace/project',
      });
    }
    assert.deepEqual(requests, [
      {
        command: 'npm',
        args: ['install', '--global', 'changebudget@1.2.3', `--registry=${NPM_REGISTRY}`],
        shell: false,
        timeoutMs: 15_000,
      },
      { command: 'npm', args: ['root', '--global'], shell: false, timeoutMs: 15_000 },
      {
        command: process.execPath,
        args: [join('/opt/npm/lib/node_modules', 'changebudget', 'dist', 'src', 'cli', 'index.js'), '--version'],
        shell: false,
        timeoutMs: 15_000,
      },
      {
        command: process.execPath,
        args: [join('/opt/npm/lib/node_modules', 'changebudget', 'dist', 'src', 'cli', 'index.js'), 'integrate', 'opencode'],
        cwd: '/workspace/project',
        shell: false,
        timeoutMs: 15_000,
      },
    ]);
  });

  it('runs the npm CLI through Node with structured argv on Windows and never invokes a shell', async () => {
    const requests: NpmExecutionRequest[] = [];
    const result = await runSelfUpdate(
      version('v1.2.3'),
      executor([commandSuccess(), commandSuccess('C:\\npm\\global\n'), commandSuccess('1.2.3\n')], requests),
      'win32',
      async () => true,
    );

    assert.equal(result.success, true);
    assert.equal(requests.every((request) => request.shell === false), true);
    const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    assert.deepEqual(requests[0], {
      command: process.execPath,
      args: [npmCli, 'install', '--global', 'changebudget@1.2.3', `--registry=${NPM_REGISTRY}`],
      shell: false,
      timeoutMs: 15_000,
    });
    assert.deepEqual(requests[1], {
      command: process.execPath,
      args: [npmCli, 'root', '--global'],
      shell: false,
      timeoutMs: 15_000,
    });
  });

  it('fails if the exact installed entry is absent or prints a different version', async () => {
    const missing = await runSelfUpdate(
      version('v1.2.3'),
      executor([commandSuccess(), commandSuccess('/opt/npm/lib/node_modules\n')], []),
      'linux',
      async () => false,
    );
    assert.equal(missing.success, false);
    assert.match(missing.errorMessage ?? '', /entry was not found/);

    const mismatch = await runSelfUpdate(
      version('v1.2.3'),
      executor([commandSuccess(), commandSuccess('/opt/npm/lib/node_modules\n'), commandSuccess('1.2.4\n')], []),
      'linux',
      async () => true,
    );
    assert.equal(mismatch.success, false);
    assert.match(mismatch.errorMessage ?? '', /reported 1.2.4/);
  });

  it('keeps untrusted version text out of npm argv', () => {
    assert.equal(parseNpmVersions('{"versions":{"1.2.3; echo hacked":{}}}').length, 0);
  });
});
