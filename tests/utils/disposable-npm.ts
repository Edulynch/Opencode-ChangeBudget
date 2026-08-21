import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export interface DisposableNpm {
  readonly root: string;
  readonly prefix: string;
  readonly env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

const PREFIX = 'changebudget-npm-';

function npmBin(prefix: string): string {
  return process.platform === 'win32' ? prefix : join(prefix, 'bin');
}

/** Resolve npm's global package directory for the supported host platforms. */
export function disposableGlobalPackageRoot(
  disposable: DisposableNpm,
  packageName: string,
): string {
  return process.platform === 'win32'
    ? join(disposable.prefix, 'node_modules', packageName)
    : join(disposable.prefix, 'lib', 'node_modules', packageName);
}

/** Resolve the executable shim linked by a disposable global installation. */
export function disposableGlobalCliExecutable(
  disposable: DisposableNpm,
  commandName: string,
): string {
  return process.platform === 'win32'
    ? join(disposable.prefix, `${commandName}.cmd`)
    : join(disposable.prefix, 'bin', commandName);
}

/** Create an isolated npm global prefix outside the repository. */
export async function createDisposableNpm(
  suffix = 'space path',
): Promise<DisposableNpm> {
  const root = await mkdtemp(join(tmpdir(), `${PREFIX}${suffix}-`));
  const prefix = join(root, 'global prefix');
  const path = [npmBin(prefix), process.env.PATH ?? ''].filter(Boolean).join(delimiter);
  let cleaned = false;

  return {
    root,
    prefix,
    env: {
      ...process.env,
      npm_config_prefix: prefix,
      NPM_CONFIG_PREFIX: prefix,
      PATH: path,
    },
    async cleanup(): Promise<void> {
      if (!cleaned) {
        cleaned = true;
        await rm(root, { recursive: true, force: true });
      }
    },
  };
}

export async function disposableNpmExists(
  disposable: DisposableNpm,
): Promise<boolean> {
  try {
    await access(disposable.root, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** Run a callback with an isolated prefix and always clean it up. */
export async function withDisposableNpm<T>(
  callback: (disposable: DisposableNpm) => Promise<T>,
): Promise<T> {
  const disposable = await createDisposableNpm();
  try {
    return await callback(disposable);
  } finally {
    await disposable.cleanup();
  }
}
