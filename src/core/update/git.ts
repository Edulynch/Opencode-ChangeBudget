import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compareSemVer, formatSemVer, parseSemVer } from './version.js';

export const CHANGE_BUDGET_GIT_REMOTE =
  'https://github.com/Edulynch/Opencode-ChangeBudget.git';

const GIT_TIMEOUT_MS = 15_000;
const OBJECT_ID_PATTERN = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const AUTHENTICATION_FAILURE_PATTERN =
  /authentication failed|could not read username|permission denied|repository not found|access denied|(?:error|http)[: ]+(?:401|403)/i;

export type UpdateGitErrorKind =
  | 'authentication_access'
  | 'git_unavailable'
  | 'timeout'
  | 'transport'
  | 'malformed_remote_output'
  | 'no_stable_tags'
  | 'no_trustworthy_candidates'
  | 'cleanup_failed';

export type GitOperation = 'discovery' | 'integrity';

const ERROR_MESSAGES: Readonly<Record<UpdateGitErrorKind, string>> = {
  authentication_access: 'System Git credentials cannot access the ChangeBudget repository',
  git_unavailable: 'Git is not available in PATH',
  timeout: 'Git operation timed out',
  transport: 'Cannot reach GitHub for tag discovery',
  malformed_remote_output: 'Invalid Git tag discovery output',
  no_stable_tags: 'No valid stable GitHub tags found',
  no_trustworthy_candidates: 'No trustworthy validated GitHub tags found',
  cleanup_failed: 'Cannot clean up isolated Git validation repository',
};

export class UpdateGitError extends Error {
  public readonly name = 'UpdateGitError';

  public constructor(
    public readonly kind: UpdateGitErrorKind,
    public readonly operation: GitOperation,
  ) {
    super(ERROR_MESSAGES[kind]);
  }
}

export type GitExecutionRequest = {
  readonly command: 'git';
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly shell: false;
  readonly timeoutMs: number;
};

export type GitExecutionResult =
  | { readonly kind: 'success'; readonly stdout: string }
  | {
      readonly kind: 'failure';
      readonly reason: 'unavailable' | 'timeout' | 'exit';
      readonly stderr: string;
    };

export type GitExecutor = (
  request: GitExecutionRequest,
) => Promise<GitExecutionResult>;

export type RemoteTagParseResult =
  | { readonly kind: 'tags'; readonly tags: readonly string[] }
  | { readonly kind: 'malformed_remote_output' }
  | { readonly kind: 'no_stable_tags' };

type GitDependencies = {
  readonly executeGit?: GitExecutor;
};

type IntegrityDependencies = GitDependencies & {
  readonly makeTemporaryRepository?: () => Promise<string>;
  readonly removeTemporaryRepository?: (path: string) => Promise<void>;
};

const executeGitProcess: GitExecutor = (request) =>
  new Promise((resolve) => {
    execFile(
      request.command,
      [...request.args],
      {
        cwd: request.cwd,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
        shell: request.shell,
        timeout: request.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ kind: 'success', stdout });
          return;
        }
        if (error.code === 'ENOENT') {
          resolve({ kind: 'failure', reason: 'unavailable', stderr: '' });
          return;
        }
        if (error.killed) {
          resolve({ kind: 'failure', reason: 'timeout', stderr: '' });
          return;
        }
        resolve({ kind: 'failure', reason: 'exit', stderr });
      },
    );
  });

function gitRequest(args: readonly string[], cwd?: string): GitExecutionRequest {
  return {
    command: 'git',
    args,
    ...(cwd === undefined ? {} : { cwd }),
    shell: false,
    timeoutMs: GIT_TIMEOUT_MS,
  };
}

function failureError(
  result: Extract<GitExecutionResult, { readonly kind: 'failure' }>,
  operation: GitOperation,
): UpdateGitError {
  if (result.reason === 'unavailable') {
    return new UpdateGitError('git_unavailable', operation);
  }
  if (result.reason === 'timeout') {
    return new UpdateGitError('timeout', operation);
  }
  return new UpdateGitError(
    AUTHENTICATION_FAILURE_PATTERN.test(result.stderr)
      ? 'authentication_access'
      : 'transport',
    operation,
  );
}

async function runGit(
  executor: GitExecutor,
  request: GitExecutionRequest,
  operation: GitOperation,
): Promise<string> {
  const result = await executor(request);
  if (result.kind === 'failure') {
    throw failureError(result, operation);
  }
  return result.stdout;
}

export function parseRemoteTags(output: string): RemoteTagParseResult {
  const stableVersions = new Map<string, NonNullable<ReturnType<typeof parseSemVer>>>();
  let remoteRefCount = 0;
  let contentLineCount = 0;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    contentLineCount += 1;

    const fields = line.split('\t');
    if (fields.length !== 2) continue;
    const [objectId, rawRef] = fields;
    if (objectId === undefined || rawRef === undefined) continue;
    if (!OBJECT_ID_PATTERN.test(objectId) || !rawRef.startsWith('refs/tags/')) continue;

    remoteRefCount += 1;
    const peeledRef = rawRef.endsWith('^{}') ? rawRef.slice(0, -3) : rawRef;
    const tag = peeledRef.slice('refs/tags/'.length);
    const version = parseSemVer(tag);
    if (version !== null) stableVersions.set(version.tag, version);
  }

  if (stableVersions.size > 0) {
    return {
      kind: 'tags',
      tags: [...stableVersions.values()]
        .sort((left, right) => compareSemVer(right, left))
        .map((version) => version.tag),
    };
  }
  if (contentLineCount > 0 && remoteRefCount === 0) {
    return { kind: 'malformed_remote_output' };
  }
  return { kind: 'no_stable_tags' };
}

export async function discoverRemoteTags(
  dependencies: GitDependencies = {},
): Promise<readonly string[]> {
  const output = await runGit(
    dependencies.executeGit ?? executeGitProcess,
    gitRequest(['ls-remote', '--refs', '--tags', CHANGE_BUDGET_GIT_REMOTE]),
    'discovery',
  );
  const parsed = parseRemoteTags(output);
  if (parsed.kind === 'tags') return parsed.tags;
  throw new UpdateGitError(parsed.kind, 'discovery');
}

function packageVersionMatches(contents: string, tag: string): boolean {
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(contents);
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }

  if (packageJson === null || typeof packageJson !== 'object' || Array.isArray(packageJson)) {
    return false;
  }
  const version = parseSemVer(tag);
  return version !== null && Reflect.get(packageJson, 'version') === formatSemVer(version);
}

export async function validateTagIntegrity(
  tag: string,
  dependencies: IntegrityDependencies = {},
): Promise<boolean> {
  if (parseSemVer(tag) === null) return false;

  const makeTemporaryRepository = dependencies.makeTemporaryRepository
    ?? (() => mkdtemp(join(tmpdir(), 'changebudget-update-')));
  const removeTemporaryRepository = dependencies.removeTemporaryRepository
    ?? ((path: string) => rm(path, { recursive: true, force: true }));
  const executor = dependencies.executeGit ?? executeGitProcess;

  let repository: string;
  try {
    repository = await makeTemporaryRepository();
  } catch (error) {
    if (error instanceof Error) {
      throw new UpdateGitError('transport', 'integrity');
    }
    throw error;
  }

  try {
    await runGit(executor, gitRequest(['init', '--bare', '.'], repository), 'integrity');
    await runGit(
      executor,
      gitRequest([
        'fetch',
        '--no-tags',
        '--depth=1',
        CHANGE_BUDGET_GIT_REMOTE,
        `refs/tags/${tag}:refs/tags/${tag}`,
      ], repository),
      'integrity',
    );
    await runGit(
      executor,
      gitRequest(['rev-parse', '--verify', `${tag}^{commit}`], repository),
      'integrity',
    );
    const packageJson = await runGit(
      executor,
      gitRequest(['show', `${tag}^{commit}:package.json`], repository),
      'integrity',
    );
    return packageVersionMatches(packageJson, tag);
  } finally {
    try {
      await removeTemporaryRepository(repository);
    } catch (error) {
      if (error instanceof Error) {
        throw new UpdateGitError('cleanup_failed', 'integrity');
      }
      throw error;
    }
  }
}
