import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

export interface DisposableNpm {
  readonly root: string;
  readonly prefix: string;
  readonly env: NodeJS.ProcessEnv;
  cleanup(): Promise<void>;
}

const PREFIX = 'changebudget-npm-';

function quoteWindowsArg(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }

  let result = '"';
  let slashes = 0;
  for (const character of value) {
    if (character === '\\') {
      slashes += 1;
    } else if (character === '"') {
      result += '\\'.repeat(slashes * 2 + 1);
      result += '"';
      slashes = 0;
    } else {
      result += '\\'.repeat(slashes);
      result += character;
      slashes = 0;
    }
  }
  return `${result}${'\\'.repeat(slashes * 2)}"`;
}

/** Quote only test-controlled values crossing the Windows cmd boundary. */
export function windowsCommandLine(args: readonly string[]): string {
  return args.map(quoteWindowsArg).join(' ');
}

/** Invoke npm through Node's npm CLI script without shell-enabled argv execution. */
export function npmInvocation(args: readonly string[]): {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
} {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath) {
    return { command: process.execPath, args: [npmExecPath, ...args] };
  }

  const bundledNpmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (existsSync(bundledNpmCli)) {
    return { command: process.execPath, args: [bundledNpmCli, ...args] };
  }

  if (process.platform !== 'win32') {
    return { command: 'npm', args: [...args] };
  }

  return {
    command: process.env.ComSpec || 'cmd.exe',
    args: ['/D', '/S', '/C', windowsCommandLine(['npm.cmd', ...args])],
    windowsVerbatimArguments: true,
  };
}

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
