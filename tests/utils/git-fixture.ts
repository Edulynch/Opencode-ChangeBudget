import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export interface GitFixture {
  readonly root: string;
  readonly version: string;
  readonly tag: string;
  init(): Promise<void>;
  getPackageSpec(tag: string): string;
  cleanup(): Promise<void>;
}

const PREFIX = 'changebudget-git-fixture-';

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr ?? ''}`);
  }
}

/** Create a temporary local Git package fixture with a tagged commit. */
export async function createGitFixture(
  sourceRoot?: string,
): Promise<GitFixture> {
  const root = await mkdtemp(join(tmpdir(), PREFIX));
  let initialized = false;
  let cleaned = false;
  let version = '1.0.0';
  let tag = 'v1.0.0';

  const fixture: GitFixture = {
    root,
    get version(): string {
      return version;
    },
    get tag(): string {
      return tag;
    },
    async init(): Promise<void> {
      if (initialized) return;

      if (sourceRoot) {
        await cp(sourceRoot, root, {
          recursive: true,
          filter: (source) =>
            !source.split(sep).includes('.git') &&
            !source.split(sep).includes('node_modules') &&
            !source.split(sep).includes('package-lock.json'),
        });

        const packagePath = join(root, 'package.json');
        const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as {
          devDependencies?: Record<string, string>;
          private?: boolean;
        };
        delete packageJson.devDependencies;
        delete packageJson.private;
        await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
      } else {
        await mkdir(root, { recursive: true });
        await writeFile(
          join(root, 'package.json'),
          '{"name":"changebudget-fixture","version":"1.0.0","private":true}\n',
          'utf8',
        );
      }

      version = (JSON.parse(
        await readFile(join(root, 'package.json'), 'utf8'),
      ) as { version?: string }).version ?? '';
      if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
        throw new Error(`Invalid fixture package version: ${version}`);
      }
      tag = `v${version}`;

      if (sourceRoot) {
        const requiredRuntime = [
          'dist/src/cli/index.js',
          'opencode-plugin/dist/opencode-plugin/src/index.js',
        ];
        for (const path of requiredRuntime) {
          await access(join(root, path));
        }
      }

      runGit(root, ['init']);
      runGit(root, ['config', 'user.name', 'ChangeBudget test fixture']);
      runGit(root, ['config', 'user.email', 'changebudget-fixture@example.test']);
      runGit(root, ['add', '.']);
      if (sourceRoot) {
        const tracked = spawnSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
        if (tracked.status !== 0) {
          throw new Error(`git ls-files failed: ${tracked.stderr ?? ''}`);
        }
        const trackedPaths = new Set(tracked.stdout.split(/\r?\n/).filter(Boolean));
        for (const path of [
          'dist/src/cli/index.js',
          'opencode-plugin/dist/opencode-plugin/src/index.js',
        ]) {
          if (!trackedPaths.has(path)) {
            throw new Error(`Required fixture runtime was not staged normally: ${path}`);
          }
        }
        for (const path of trackedPaths) {
          if (path.startsWith('dist/tests/') || path.startsWith('opencode-plugin/dist/src/')) {
            throw new Error(`Forbidden fixture output was staged: ${path}`);
          }
        }
      }
      runGit(root, ['commit', '-m', 'fixture']);
      initialized = true;
    },
    getPackageSpec(tag: string): string {
      if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
        throw new Error(`Invalid fixture tag: ${tag}`);
      }
      return `git+${pathToFileURL(root).href}#${tag}`;
    },
    async cleanup(): Promise<void> {
      if (!cleaned) {
        cleaned = true;
        await rm(root, { recursive: true, force: true });
      }
    },
  };

  await fixture.init();
  runGit(root, ['tag', fixture.tag]);
  return fixture;
}
