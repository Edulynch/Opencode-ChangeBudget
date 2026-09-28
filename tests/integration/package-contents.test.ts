import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { removeTestRepository } from '../utils/disposable-repository.js';
import { pathToFileURL } from 'node:url';

import { npmInvocation } from '../utils/disposable-npm.js';

function packJson(): Array<{ files?: Array<{ path: string }> }> {
  const invocation = npmInvocation(['pack', '--dry-run', '--json', '--ignore-scripts']);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
    env: { ...process.env, npm_config_loglevel: 'error' },
  });
  assert.equal(result.status, 0, `${result.error?.message ?? ''}\n${result.stderr ?? ''}`);

  const output = result.stdout.trim();
  const jsonStart = output.indexOf('[');
  assert.notEqual(jsonStart, -1, `npm pack did not return JSON: ${output}`);
  return JSON.parse(output.slice(jsonStart)) as Array<{ files?: Array<{ path: string }> }>;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function createNpmSpoofLaunchers(root: string): Promise<string> {
  const launcherDirectory = join(root, 'shadowed-npm-launchers');
  const npmRoot = join(launcherDirectory, 'node_modules', 'npm');
  const npmBinDirectory = join(npmRoot, 'bin');
  await mkdir(npmBinDirectory, { recursive: true });
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({
    name: 'npm',
    bin: { npm: 'bin/npm-cli.js', npx: 'bin/npx-cli.js' },
  }), 'utf8');

  for (const executable of ['npm', 'npx'] as const) {
    const cliPath = join(npmBinDirectory, `${executable}-cli.js`);
    await writeFile(cliPath, `// attacker-controlled ${executable} CLI\n`, 'utf8');
    if (process.platform === 'win32') {
      await writeFile(
        join(launcherDirectory, `${executable}.cmd`),
        `@ECHO off\r\n"${process.execPath}" "${cliPath}" %*\r\n`,
        'utf8',
      );
    } else {
      const launcher = join(launcherDirectory, executable);
      await writeFile(
        launcher,
        `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"\n`,
        'utf8',
      );
      await chmod(launcher, 0o755);
    }
  }
  return launcherDirectory;
}

test('T036: package whitelist contains runtime files and excludes development content', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    name?: string;
    private?: boolean;
    publishConfig?: { registry?: string; access?: string };
    scripts?: Record<string, string>;
    bin?: Record<string, string>;
    files?: string[];
  };
  assert.equal(packageJson.name, 'changebudget');
  assert.equal(packageJson.private, undefined);
  assert.deepEqual(packageJson.publishConfig, {
    registry: 'https://registry.npmjs.org/',
    access: 'public',
  });
  assert.equal(packageJson.scripts?.prepare, undefined);
  assert.equal(packageJson.scripts?.build, undefined);
  assert.equal(packageJson.scripts?.compile, 'tsc && tsc -p opencode-plugin/tsconfig.json');
  assert.equal(packageJson.scripts?.typecheck, 'tsc --noEmit && tsc --noEmit -p opencode-plugin/tsconfig.json');
  assert.equal(packageJson.scripts?.test, 'npm run compile && node --test "dist/tests/**/*.js"');
  assert.equal(packageJson.scripts?.start, 'node dist/src/cli/index.js');
  assert.deepEqual(packageJson.bin, { changebudget: 'dist/src/cli/index.js' });
  assert.deepEqual(packageJson.files, ['dist/src/**', 'opencode-plugin/dist/opencode-plugin/**']);

  const entries = packJson().flatMap((pack) => pack.files ?? []).map((file) => file.path.replaceAll('\\', '/'));
  const entrySet = new Set(entries);

  const required = [
    'package.json',
    'README.md',
    'LICENSE',
    'dist/src/cli/index.js',
    'dist/src/cli/index.js.map',
    'dist/src/cli/commands/update.js',
    'dist/src/cli/commands/version.js',
    'dist/src/core/package-root.js',
    'dist/src/core/update/version.js',
    'dist/src/core/update/selection.js',
    'dist/src/core/update/npm.js',
    'opencode-plugin/dist/opencode-plugin/src/index.js',
    'opencode-plugin/dist/opencode-plugin/src/index.js.map',
  ];
  for (const path of required) {
    assert.equal(entrySet.has(path), true, `missing packaged runtime file: ${path}`);
  }

  const forbidden = entries.filter((path) =>
    path.startsWith('dist/tests/') ||
    path.startsWith('opencode-plugin/dist/src/') ||
    path.startsWith('tests/') ||
    path.startsWith('specs/') ||
    path.startsWith('src/') ||
    path.startsWith('.github/') ||
    path.startsWith('scripts/') ||
    path.startsWith('.serena/') ||
    path.includes('/.git/') ||
    path.startsWith('node_modules/') ||
    path.endsWith('.ts'),
  );
  assert.deepEqual(forbidden, []);
});

test('the installed npm artifact loads its OpenCode plugin from the packaged runtime closure', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'cb-packaged-plugin-'));
  const packDirectory = join(temporaryRoot, 'packed');
  const installDirectory = join(temporaryRoot, 'installed');

  try {
    await mkdir(packDirectory, { recursive: true });
    const packInvocation = npmInvocation([
      'pack',
      '--json',
      '--ignore-scripts',
      '--pack-destination',
      packDirectory,
    ]);
    const packResult = spawnSync(packInvocation.command, packInvocation.args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsVerbatimArguments: packInvocation.windowsVerbatimArguments,
    });
    assert.equal(packResult.status, 0, `${packResult.error?.message ?? ''}\n${packResult.stderr ?? ''}`);

    const packOutput = (packResult.stdout ?? '').trim();
    const jsonStart = packOutput.indexOf('[');
    assert.notEqual(jsonStart, -1, `npm pack did not return JSON: ${packOutput}`);
    const packed = JSON.parse(packOutput.slice(jsonStart)) as Array<{ filename?: string }>;
    const filename = packed[0]?.filename;
    assert.ok(filename, 'npm pack did not report its tarball filename');

    const installInvocation = npmInvocation([
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--no-save',
      '--prefix',
      installDirectory,
      join(packDirectory, filename),
    ]);
    const installResult = spawnSync(installInvocation.command, installInvocation.args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      windowsVerbatimArguments: installInvocation.windowsVerbatimArguments,
    });
    assert.equal(installResult.status, 0, `${installResult.error?.message ?? ''}\n${installResult.stderr ?? ''}`);

    const pluginEntry = join(
      installDirectory,
      'node_modules',
      'changebudget',
      'opencode-plugin',
      'dist',
      'opencode-plugin',
      'src',
      'index.js',
    );
    const plugin = await import(pathToFileURL(pluginEntry).href) as {
      default?: { id?: string; setup?: unknown };
    };

    assert.equal(plugin.default?.id, 'changebudget');
    assert.equal(typeof plugin.default?.setup, 'function');

    const pluginDefinition = plugin.default as {
      setup(context: unknown): Promise<unknown>;
    };
    const capturePermissionHook = async (directory: string) => {
      let permissionHook: ((event: any) => Promise<void> | void) | undefined;
      await pluginDefinition.setup({
        location: { directory },
        session: {
          hook: async () => ({ dispose: async () => undefined }),
        },
        permission: {
          hook: async (_name: string, callback: (event: any) => Promise<void> | void) => {
            permissionHook = callback;
            return { dispose: async () => undefined };
          },
        },
      });
      assert.ok(permissionHook);
      return permissionHook!;
    };

    const installedPackageRoot = join(installDirectory, 'node_modules', 'changebudget');
    const localBinDirectory = join(installDirectory, 'node_modules', '.bin');
    const shadowedNpmLauncherDirectory = await createNpmSpoofLaunchers(temporaryRoot);
    const originalPath = process.env.PATH;
    process.env.PATH = [shadowedNpmLauncherDirectory, localBinDirectory, originalPath]
      .filter(Boolean)
      .join(delimiter);
    try {
      const consumerHook = await capturePermissionHook(installDirectory);
      const cliEntry = join(installedPackageRoot, 'dist', 'src', 'cli', 'index.js');
      const reason = 'operator approved inert policy-matrix recovery';
      const recoveryArgs = `recover lifecycle-lock --reason "${reason}"`;
      const forcedArgs = `recover lifecycle-lock --force --reason "${reason}"`;
      const packageShim = join(localBinDirectory, process.platform === 'win32' ? 'changebudget.cmd' : 'changebudget');
      const commands = [
        `node "${cliEntry}" ${recoveryArgs}`,
        `node --enable-source-maps "${cliEntry}" ${forcedArgs}`,
        `changebudget ${recoveryArgs}`,
        `${packageShim} ${recoveryArgs}`,
        ...(process.platform === 'win32'
          ? [
            String.raw`.\node_modules\.bin\changebudget ${forcedArgs}`,
            String.raw`.\node_modules\.bin\changebudget.cmd ${recoveryArgs}`,
            String.raw`.\node_modules\.bin\changebudget.ps1 ${forcedArgs}`,
            `${join(localBinDirectory, 'changebudget.ps1')} ${forcedArgs}`,
          ]
          : [`./node_modules/.bin/changebudget ${recoveryArgs}`]),
      ];
      for (const [index, command] of commands.entries()) {
        for (const effect of ['allow', 'ask'] as const) {
          const event = {
            sessionID: `packaged-first-party-recovery-${index}-${effect}`,
            action: 'shell',
            resources: [command],
            effect,
            metadata: {},
            message: undefined as string | undefined,
          };
          await consumerHook(event);
          assert.equal(event.effect, 'deny', `${effect}: ${command}`);
          assert.match(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, command);
        }
      }

      const packageRootHook = await capturePermissionHook(installedPackageRoot);
      for (const command of [
        `npm start -- ${recoveryArgs}`,
        `npm run start -- ${forcedArgs}`,
      ]) {
        const event = {
          sessionID: `packaged-npm-start-${command}`,
          action: 'shell',
          resources: [command],
          effect: 'allow' as const,
          metadata: {},
          message: undefined as string | undefined,
        };
        await packageRootHook(event);
        assert.equal(event.effect, 'deny', command);
        assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, command);
        assert.doesNotMatch(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, command);
      }

      for (const command of [
        `npm exec -- changebudget status`,
        `npx changebudget status`,
      ]) {
        const event = {
          sessionID: `fake-npm-read-only-${command}`,
          action: 'shell',
          resources: [command],
          effect: 'allow' as const,
          metadata: {},
          message: undefined as string | undefined,
        };
        await consumerHook(event);
        assert.equal(event.effect, 'deny', command);
        assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, command);
      }

      const verifiedPath = process.env.PATH;
      const shadowDirectory = join(temporaryRoot, 'shadowed-launchers');
      await mkdir(shadowDirectory, { recursive: true });
      const shadowedLaunchers = process.platform === 'win32'
        ? ['node.exe', 'npm.cmd', 'npx.cmd']
        : ['node', 'npm', 'npx'];
      for (const name of shadowedLaunchers) {
        const launcher = join(shadowDirectory, name);
        await writeFile(launcher, 'inert shadowed launcher\n', 'utf8');
        if (process.platform !== 'win32') await chmod(launcher, 0o755);
      }
      process.env.PATH = [shadowDirectory, verifiedPath].filter(Boolean).join(delimiter);
      const unprovenCommands = [
        { hook: consumerHook, command: `node "${join(installedPackageRoot, 'dist', 'src', 'cli', 'index.js')}" ${recoveryArgs}` },
        { hook: consumerHook, command: `npm exec -- changebudget ${recoveryArgs}` },
        { hook: consumerHook, command: `npx changebudget ${forcedArgs}` },
        { hook: packageRootHook, command: `npm start -- ${recoveryArgs}` },
      ];
      for (const [index, request] of unprovenCommands.entries()) {
        for (const effect of ['allow', 'ask'] as const) {
          const event = {
            sessionID: `shadowed-first-party-recovery-${index}-${effect}`,
            action: 'shell',
            resources: [request.command],
            effect,
            metadata: {},
            message: undefined as string | undefined,
          };
          await request.hook(event);
          assert.equal(event.effect, 'deny', request.command);
          assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, request.command);
          assert.doesNotMatch(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, request.command);
        }
      }
      process.env.PATH = verifiedPath;

      for (const command of [
        'npm exec -- eslint --fix',
        'echo "changebudget recover lifecycle-lock --reason not-executed"',
        'user-wrapper.cmd "changebudget recover lifecycle-lock --reason user-wrapper"',
      ]) {
        const event = {
          sessionID: `packaged-negative-identity-${command}`,
          action: 'shell',
          resources: [command],
          effect: 'allow' as const,
          metadata: {},
          message: undefined as string | undefined,
        };
        await consumerHook(event);
        assert.doesNotMatch(event.message ?? '', /OCG-CHANGEBUDGET-OPERATOR-RECOVERY/, command);
      }
    } finally {
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
    }
  } finally {
    await removeTestRepository(temporaryRoot);
  }
});
