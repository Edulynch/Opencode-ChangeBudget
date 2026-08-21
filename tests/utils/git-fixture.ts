import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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
          scripts?: Record<string, string>;
          devDependencies?: Record<string, string>;
          private?: boolean;
        };
        packageJson.scripts = {
          ...(packageJson.scripts ?? {}),
          prepare:
            "node -e \"require('node:fs').accessSync('dist/src/cli/index.js');require('node:fs').writeFileSync('dist/src/.prepare-ran','yes')\"",
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

      runGit(root, ['init']);
      runGit(root, ['config', 'user.name', 'ChangeBudget test fixture']);
      runGit(root, ['config', 'user.email', 'changebudget-fixture@example.test']);
      runGit(root, ['add', '.']);
      if (sourceRoot) {
        // dist/ is normally ignored, but the tagged package must contain the
        // already-built runtime so its isolated prepare hook can verify it.
        runGit(root, ['add', '-f', 'dist', 'opencode-plugin/dist']);
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
