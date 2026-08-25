import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type BaselineFailurePoint = 'observe-before' | 'capture' | 'observe-after' | 'persist';

export interface BaselineFailureInjection {
  readonly point: BaselineFailurePoint;
  readonly message: string;
}

export interface WorkingTreeBaselineFixture {
  readonly root: string;
  writeTracked(path: string, content: string): Promise<void>;
  writeUnstaged(path: string, content: string): Promise<void>;
  writeUntracked(path: string, content: string): Promise<void>;
  writeBinary(path: string, content: readonly number[]): Promise<void>;
  writeSymlink(path: string, target: string): Promise<void>;
  stage(path: string): void;
  stageGitlink(path: string, commit: string): void;
  commit(message: string): void;
  head(): string;
  injectFailure(point: BaselineFailurePoint, message?: string): BaselineFailureInjection;
  cleanup(): Promise<void>;
}

function runGit(root: string, args: readonly string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result.stdout.trim();
}

async function writeFixtureFile(root: string, path: string, content: string | Buffer): Promise<void> {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content);
}

export async function createWorkingTreeBaselineFixture(): Promise<WorkingTreeBaselineFixture> {
  const root = await mkdtemp(join(tmpdir(), 'changebudget-working-tree-baseline-'));
  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'working tree baseline fixture']);
  runGit(root, ['config', 'user.email', 'working-tree-baseline@example.test']);
  runGit(root, ['commit', '--allow-empty', '-m', 'seed']);

  return {
    root,
    writeTracked: async (path, content) => {
      await writeFixtureFile(root, path, content);
      runGit(root, ['add', '--', path]);
      runGit(root, ['commit', '-m', `track ${path}`]);
    },
    writeUnstaged: (path, content) => writeFixtureFile(root, path, content),
    writeUntracked: (path, content) => writeFixtureFile(root, path, content),
    writeBinary: (path, content) => writeFixtureFile(root, path, Buffer.from(content)),
    writeSymlink: async (path, target) => {
      const linkPath = join(root, path);
      await mkdir(join(linkPath, '..'), { recursive: true });
      await symlink(target, linkPath, 'file');
    },
    stage: (path) => runGit(root, ['add', '--', path]),
    stageGitlink: (path, commit) => runGit(root, ['update-index', '--add', '--cacheinfo', `160000,${commit},${path}`]),
    commit: (message) => runGit(root, ['commit', '-m', message]),
    head: () => runGit(root, ['rev-parse', 'HEAD']),
    injectFailure: (point, message = `Injected ${point} failure`) => ({ point, message }),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
