import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CHANGE_BUDGET_GIT_REMOTE,
  UpdateGitError,
  discoverRemoteTags,
  parseRemoteTags,
  validateTagIntegrity,
  type GitExecutionRequest,
  type GitExecutionResult,
  type GitExecutor,
} from '../../../../src/core/update/git.js';

function sequenceExecutor(
  results: readonly GitExecutionResult[],
  requests: GitExecutionRequest[],
): GitExecutor {
  let index = 0;
  return async (request) => {
    requests.push(request);
    const result = results[index];
    index += 1;
    if (result === undefined) {
      throw new Error(`Unexpected Git execution ${index}`);
    }
    return result;
  };
}

const success = (stdout = ''): GitExecutionResult => ({
  kind: 'success',
  stdout,
});

describe('core/update/git remote discovery', () => {
  it('normalizes annotated and lightweight stable tags without duplicates', () => {
    const parsed = parseRemoteTags([
      '1111111111111111111111111111111111111111\trefs/tags/v1.2.0',
      '2222222222222222222222222222222222222222\trefs/tags/v1.10.0',
      '3333333333333333333333333333333333333333\trefs/tags/v1.10.0^{}',
      'malformed output that must be ignored safely',
      '4444444444444444444444444444444444444444\trefs/tags/v01.0.0',
      '5555555555555555555555555555555555555555\trefs/tags/v2.0.0-beta.1',
      '',
    ].join('\r\n'));

    assert.deepEqual(parsed, {
      kind: 'tags',
      tags: ['v1.10.0', 'v1.2.0'],
    });
  });

  it('distinguishes malformed output from a valid remote with no stable tags', () => {
    assert.deepEqual(parseRemoteTags('not an ls-remote line\n'), {
      kind: 'malformed_remote_output',
    });
    assert.deepEqual(
      parseRemoteTags(
        '1111111111111111111111111111111111111111\trefs/tags/latest\n',
      ),
      { kind: 'no_stable_tags' },
    );
  });

  it('surfaces malformed and stable-tag-empty discovery outcomes as distinct errors', async () => {
    const cases: readonly {
      readonly stdout: string;
      readonly kind: UpdateGitError['kind'];
    }[] = [
      { stdout: 'not an ls-remote line\n', kind: 'malformed_remote_output' },
      {
        stdout: '1111111111111111111111111111111111111111\trefs/tags/latest\n',
        kind: 'no_stable_tags',
      },
    ];

    for (const discoveryCase of cases) {
      await assert.rejects(
        discoverRemoteTags({
          executeGit: sequenceExecutor([success(discoveryCase.stdout)], []),
        }),
        (error: unknown) => error instanceof UpdateGitError && error.kind === discoveryCase.kind,
      );
    }
  });

  it('uses the canonical credential-free HTTPS remote with structured argv', async () => {
    const requests: GitExecutionRequest[] = [];
    const tags = await discoverRemoteTags({
      executeGit: sequenceExecutor([
        success(
          '1111111111111111111111111111111111111111\trefs/tags/v1.2.3\n',
        ),
      ], requests),
    });

    assert.deepEqual(tags, ['v1.2.3']);
    assert.deepEqual(requests, [{
      command: 'git',
      args: ['ls-remote', '--refs', '--tags', CHANGE_BUDGET_GIT_REMOTE],
      shell: false,
      timeoutMs: 15_000,
    }]);
    assert.equal(requests[0]?.args.some((arg) => /token|github_token|pat|@github\.com/i.test(arg)), false);
  });

  it('classifies unavailable Git, timeout, access, and transport failures safely', async () => {
    const cases: readonly {
      readonly result: GitExecutionResult;
      readonly kind: UpdateGitError['kind'];
    }[] = [
      { result: { kind: 'failure', reason: 'unavailable', stderr: '' }, kind: 'git_unavailable' },
      { result: { kind: 'failure', reason: 'timeout', stderr: '' }, kind: 'timeout' },
      {
        result: { kind: 'failure', reason: 'exit', stderr: 'fatal: Authentication failed for secret remote' },
        kind: 'authentication_access',
      },
      {
        result: { kind: 'failure', reason: 'exit', stderr: 'fatal: unable to access remote' },
        kind: 'transport',
      },
    ];

    for (const failureCase of cases) {
      await assert.rejects(
        discoverRemoteTags({
          executeGit: sequenceExecutor([failureCase.result], []),
        }),
        (error: unknown) => {
          assert.ok(error instanceof UpdateGitError);
          assert.equal(error.kind, failureCase.kind);
          assert.doesNotMatch(error.message, /Authentication failed|secret remote/);
          return true;
        },
      );
    }
  });
});

describe('core/update/git candidate integrity', () => {
  it('fetches and inspects one tag in an isolated bare repository, then cleans up', async () => {
    const requests: GitExecutionRequest[] = [];
    const removed: string[] = [];
    const repository = 'C:\\Temp\\change budget integrity';
    const valid = await validateTagIntegrity('v1.2.3', {
      executeGit: sequenceExecutor([
        success(),
        success(),
        success('commit-id\n'),
        success('{"version":"1.2.3"}\n'),
      ], requests),
      makeTemporaryRepository: async () => repository,
      removeTemporaryRepository: async (path) => {
        removed.push(path);
      },
    });

    assert.equal(valid, true);
    assert.deepEqual(requests.map((request) => request.args), [
      ['init', '--bare', '.'],
      ['fetch', '--no-tags', '--depth=1', CHANGE_BUDGET_GIT_REMOTE, 'refs/tags/v1.2.3:refs/tags/v1.2.3'],
      ['rev-parse', '--verify', 'v1.2.3^{commit}'],
      ['show', 'v1.2.3^{commit}:package.json'],
    ]);
    assert.equal(requests.every((request) => request.command === 'git' && request.shell === false), true);
    assert.equal(requests.every((request) => request.cwd === repository), true);
    assert.equal(requests.some((request) => request.args.includes(repository)), false);
    assert.deepEqual(removed, [repository]);
  });

  it('rejects mismatched and malformed package metadata and cleans up each repository', async () => {
    const packageJsonValues = [
      '{"version":"1.2.4"}',
      '{"version":123}',
      '{}',
      'not-json',
    ];
    const removed: string[] = [];

    for (const [index, packageJson] of packageJsonValues.entries()) {
      const repository = `/tmp/change budget integrity ${index}`;
      assert.equal(await validateTagIntegrity('v1.2.3', {
        executeGit: sequenceExecutor([
          success(),
          success(),
          success('commit-id'),
          success(packageJson),
        ], []),
        makeTemporaryRepository: async () => repository,
        removeTemporaryRepository: async (path) => {
          removed.push(path);
        },
      }), false);
    }

    assert.deepEqual(removed, packageJsonValues.map((_, index) => `/tmp/change budget integrity ${index}`));
  });

  it('cleans up after Git failure and reports cleanup failure as a typed error', async () => {
    const removed: string[] = [];
    await assert.rejects(
      validateTagIntegrity('v1.2.3', {
        executeGit: sequenceExecutor([
          success(),
          { kind: 'failure', reason: 'timeout', stderr: '' },
        ], []),
        makeTemporaryRepository: async () => '/tmp/failing-integrity',
        removeTemporaryRepository: async (path) => {
          removed.push(path);
        },
      }),
      (error: unknown) => error instanceof UpdateGitError && error.kind === 'timeout',
    );
    assert.deepEqual(removed, ['/tmp/failing-integrity']);

    await assert.rejects(
      validateTagIntegrity('v1.2.3', {
        executeGit: sequenceExecutor([
          success(),
          success(),
          success('commit-id'),
          success('{"version":"1.2.3"}'),
        ], []),
        makeTemporaryRepository: async () => '/tmp/cleanup-failure',
        removeTemporaryRepository: async () => {
          throw new Error('private cleanup detail');
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof UpdateGitError);
        assert.equal(error.kind, 'cleanup_failed');
        assert.doesNotMatch(error.message, /private cleanup detail/);
        return true;
      },
    );
  });
});
