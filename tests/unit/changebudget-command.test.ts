import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { delimiter, dirname, extname, join, relative } from 'node:path';
import { chmod, mkdtemp, mkdir, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { createTestFixtureDirectory, removeTestRepository } from '../utils/disposable-repository.js';

import {
  classifyChangeBudgetArguments,
  normalizeChangeBudgetCommand,
  resolveDenyOnlyChangeBudgetAdminIntent,
  type ChangeBudgetNodeCliIdentityContext,
} from '../../opencode-plugin/src/changebudget-command.js';

interface InstalledFixture {
  readonly root: string;
  readonly consumerRoot: string;
  readonly packageRoot: string;
  readonly canonicalCliEntryPath: string;
  readonly binDirectory: string;
  readonly npmLauncherDirectory: string;
  readonly context: ChangeBudgetNodeCliIdentityContext;
  readonly shimPaths: readonly string[];
}

function generatedChangeBudgetShim(extension: '' | '.cmd' | '.ps1'): string {
  if (extension === '') {
    return [
      '#!/bin/sh',
      'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")',
      '',
      'case `uname` in',
      '    *CYGWIN*|*MINGW*|*MSYS*)',
      '        if command -v cygpath > /dev/null 2>&1; then',
      '            basedir=`cygpath -w "$basedir"`',
      '        fi',
      '    ;;',
      'esac',
      '',
      'if [ -x "$basedir/node" ]; then',
      '  exec "$basedir/node"  "$basedir/../changebudget/dist/src/cli/index.js" "$@"',
      'else ',
      '  exec node  "$basedir/../changebudget/dist/src/cli/index.js" "$@"',
      'fi',
      '',
    ].join('\n');
  }
  if (extension === '.cmd') {
    return [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      '',
      'IF EXIST "%dp0%\\node.exe" (',
      '  SET "_prog=%dp0%\\node.exe"',
      ') ELSE (',
      '  SET "_prog=node"',
      '  SET PATHEXT=%PATHEXT:;.JS;=;%',
      ')',
      '',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\..\\changebudget\\dist\\src\\cli\\index.js" %*',
      '',
    ].join('\r\n');
  }
  return [
    '#!/usr/bin/env pwsh',
    '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent',
    '',
    '$exe=""',
    'if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {',
    '  # Fix case when both the Windows and Linux builds of Node',
    '  # are installed in the same directory',
    '  $exe=".exe"',
    '}',
    '$ret=0',
    'if (Test-Path "$basedir/node$exe") {',
    '  # Support pipeline input',
    '  if ($MyInvocation.ExpectingInput) {',
    '    $input | & "$basedir/node$exe"  "$basedir/../changebudget/dist/src/cli/index.js" $args',
    '  } else {',
    '    & "$basedir/node$exe"  "$basedir/../changebudget/dist/src/cli/index.js" $args',
    '  }',
    '  $ret=$LASTEXITCODE',
    '} else {',
    '  # Support pipeline input',
    '  if ($MyInvocation.ExpectingInput) {',
    '    $input | & "node$exe"  "$basedir/../changebudget/dist/src/cli/index.js" $args',
    '  } else {',
    '    & "node$exe"  "$basedir/../changebudget/dist/src/cli/index.js" $args',
    '  }',
    '  $ret=$LASTEXITCODE',
    '}',
    'exit $ret',
    '',
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function approvedTempBase(): string {
  return process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
    : tmpdir();
}

async function createSpoofedNpmLaunchers(root: string): Promise<string> {
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
    await writeFile(cliPath, `// attacker-controlled ${executable} target\n`, 'utf8');
    if (process.platform === 'win32') {
      const launcher = join(launcherDirectory, `${executable}.cmd`);
      await writeFile(launcher, `@ECHO off\r\n"${process.execPath}" "${cliPath}" %*\r\n`, 'utf8');
    } else {
      const launcher = join(launcherDirectory, executable);
      await writeFile(launcher, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"\n`, 'utf8');
      await chmod(launcher, 0o755);
    }
  }
  return launcherDirectory;
}

async function createInstalledFixture(root: string, name = 'changebudget'): Promise<InstalledFixture> {
  const consumerRoot = join(root, 'consumer');
  const packageRoot = join(consumerRoot, 'node_modules', name);
  const canonicalCliEntryPath = join(packageRoot, 'dist', 'src', 'cli', 'index.js');
  const binDirectory = join(consumerRoot, 'node_modules', '.bin');
  const npmLauncherDirectory = await createSpoofedNpmLaunchers(root);
  await mkdir(dirname(canonicalCliEntryPath), { recursive: true });
  await mkdir(binDirectory, { recursive: true });
  await writeFile(canonicalCliEntryPath, '#!/usr/bin/env node\n', 'utf8');
  await writeFile(join(packageRoot, 'package.json'), JSON.stringify({
    name,
    bin: { changebudget: 'dist/src/cli/index.js' },
    scripts: { start: 'node dist/src/cli/index.js' },
  }), 'utf8');

  const shimPaths = [join(binDirectory, 'changebudget')];
  await writeFile(shimPaths[0]!, generatedChangeBudgetShim(''), 'utf8');
  await chmod(shimPaths[0]!, 0o755);
  if (process.platform === 'win32') {
    const cmdShim = join(binDirectory, 'changebudget.cmd');
    const ps1Shim = join(binDirectory, 'changebudget.ps1');
    const cmdContents = generatedChangeBudgetShim('.cmd');
    const ps1Contents = generatedChangeBudgetShim('.ps1');
    assert.equal(Buffer.byteLength(cmdContents, 'utf8'), 339, 'npm 11.16 generated CMD bytes including CRLF');
    assert.equal(Buffer.byteLength(ps1Contents, 'utf8'), 861, 'npm 11.16 generated PowerShell bytes');
    await writeFile(cmdShim, cmdContents, 'utf8');
    await writeFile(ps1Shim, ps1Contents, 'utf8');
    shimPaths.push(cmdShim, ps1Shim);
  }

  return {
    root,
    consumerRoot,
    packageRoot,
    canonicalCliEntryPath,
    binDirectory,
    context: {
      packageRoot,
      workingDirectory: consumerRoot,
      canonicalCliEntryPath,
      pathValue: [npmLauncherDirectory, binDirectory, process.env.PATH ?? ''].filter(Boolean).join(delimiter),
    },
    shimPaths,
    npmLauncherDirectory,
  };
}

async function createStructurallyVerifiedNodeInstallation(root: string): Promise<string> {
  const nodeRoot = join(root, 'structural-node-installation');
  const nodePath = join(nodeRoot, process.platform === 'win32' ? 'node.exe' : 'node');
  const npmRoot = join(nodeRoot, 'node_modules', 'npm');
  const npmBin = join(npmRoot, 'bin');
  await mkdir(npmBin, { recursive: true });
  await writeFile(nodePath, 'unattested node candidate; never executed\n', 'utf8');
  if (process.platform !== 'win32') await chmod(nodePath, 0o755);
  await writeFile(join(npmRoot, 'package.json'), JSON.stringify({
    name: 'npm',
    bin: { npm: 'bin/npm-cli.js', npx: 'bin/npx-cli.js' },
  }), 'utf8');

  for (const executable of ['npm', 'npx'] as const) {
    const cliPath = join(npmBin, `${executable}-cli.js`);
    await writeFile(cliPath, `// structural ${executable} fixture; never executed\n`, 'utf8');
    const launcherCliPath = process.platform === 'win32' ? cliPath.toLowerCase() : cliPath;
    if (process.platform === 'win32') {
      await writeFile(join(nodeRoot, `${executable}.cmd`), `@ECHO off\r\n"${nodePath}" "${launcherCliPath}" %*\r\n`, 'utf8');
    } else {
      const launcher = join(nodeRoot, executable);
      await writeFile(launcher, `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(launcherCliPath)} "$@"\n`, 'utf8');
      await chmod(launcher, 0o755);
    }
  }
  return nodeRoot;
}

function assertFirstParty(
  tokens: readonly string[],
  context: ChangeBudgetNodeCliIdentityContext,
  args: readonly string[],
  wrapper?: 'npm-exec' | 'npx',
): void {
  const resolved = normalizeChangeBudgetCommand(tokens, context);
  assert.equal(resolved.identity, 'first-party', tokens.join(' '));
  if (resolved.identity !== 'first-party') return;
  assert.deepEqual(resolved.canonicalArgv, ['changebudget', ...args]);
  assert.equal(resolved.invocation, wrapper === undefined ? 'direct' : 'wrapped');
  if (wrapper !== undefined) assert.equal(resolved.wrapper, wrapper);
}

test('ChangeBudget argument grammar classifies normalized CLI arguments explicitly', () => {
  const readOnly = [
    ['--version'], ['--help'], ['help'], ['help', 'status'], ['status'],
    ['status', '--budget'], ['status', '--budget', '--json'], ['status', '--budget', '--json=TRUE'],
    ['diagnose', '--allow-path', 'src/example.ts', '--json'], ['diagnose', 'T104', '--json'],
    ['check'], ['check', '--json'], ['update', '--check'], ['integrate', 'opencode', '--dry-run'],
    ['init', '--help'], ['integrate', 'opencode', '--help'],
  ];
  for (const args of readOnly) assert.equal(classifyChangeBudgetArguments(args), 'read-only', args.join(' '));

  const managed = [
    ['init'], ['start', '--task', 'Runtime guard lifecycle test', '--allow-path', 'src/example.ts'],
    ['start', '--task', 'Runtime guard lifecycle test', '--execution-envelope-json', '{}'],
    ['amend', '--max-files', '3'], ['amend', '--allow-path', 'src/new.ts', '--reason', 'approved scope'],
    ['close'], ['integrate', 'opencode'], ['integrate', 'opencode', '--remove'],
    ['check', '--satisfaction-evidence-json', '{"satisfied":[{"criterion_ref":"AC-1","evidence":["verified"]}]}'],
  ];
  for (const args of managed) assert.equal(classifyChangeBudgetArguments(args), 'managed-mutation', args.join(' '));
  assert.equal(classifyChangeBudgetArguments(['close', '--force', '--reason', 'approved']), 'force-close');
  assert.equal(classifyChangeBudgetArguments(['update']), 'external-mutation');
  assert.equal(classifyChangeBudgetArguments(['recover', 'lifecycle-lock', '--reason', 'operator request']), 'operator-recovery');

  const unsupported = [
    ['unknown-command'], ['status', '--unknown'], ['status', '--json'], ['start', '--task'],
    ['start', '--task', 'task', '--unknown', 'value'], ['start', '--task', 'task', '--execution-envelope-json', 'invalid'],
    ['amend', '--max-files', '-1'], ['amend', '--allow-path', '../outside.ts', '--reason', 'approved'],
    ['amend', '--allow-path', '.changebudget/state.json', '--reason', 'approved'],
    ['integrate', 'wrong-target'], ['update', '--unknown'], ['help', 'unknown-command'],
    ['status', '&&', 'git', 'add'], ['recover'], ['recover', 'lifecycle-lock', '--reason', ''],
    ['close', '--force'],
  ];
  for (const args of unsupported) assert.equal(classifyChangeBudgetArguments(args), 'unsupported', args.join(' '));
});

test('T003: supported governed grant administration spellings classify as an unconditional deny class', () => {
  const governedAdmin = [
    ['authority', 'grant', 'create', '--grant-id', 'known-grant'],
    ['authority', 'grant', 'revoke', '--grant-id', 'known-grant'],
    ['authority', 'rebind', '--repository-reference', 'known-reference'],
    // Once an administrative route is selected, malformed options must not
    // make the request look unrelated or fall through to ordinary policy.
    ['authority', 'grant', 'create', '--grant-id'],
    ['authority', 'grant', 'revoke', '--unknown', 'value'],
    ['authority', 'rebind', '--unknown'],
  ];
  for (const args of governedAdmin) {
    assert.equal(classifyChangeBudgetArguments(args), 'governed-admin-mutation', args.join(' '));
  }

  for (const args of [
    ['authority'],
    ['authority', 'grant'],
    ['authority', 'grant', 'inspect'],
    ['authority', 'unknown'],
  ]) {
    assert.equal(classifyChangeBudgetArguments(args), 'unsupported', args.join(' '));
  }
});

test('T003: verified shim and canonical Node forms retain the admin deny class; npm wrappers fail closed when ambiguous', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-governed-admin-identity-');
  try {
    const fixture = await createInstalledFixture(root);
    const adminCases = [
      ['authority', 'grant', 'create', '--grant-id', 'known-grant'],
      ['authority', 'grant', 'revoke', '--grant-id', 'known-grant'],
      ['authority', 'rebind', '--repository-reference', 'known-reference'],
    ];

    for (const args of adminCases) {
      for (const shimPath of fixture.shimPaths) {
        const resolved = normalizeChangeBudgetCommand([shimPath, ...args], fixture.context);
        assert.equal(resolved.identity, 'first-party', [shimPath, ...args].join(' '));
        if (resolved.identity === 'first-party') {
          assert.equal(classifyChangeBudgetArguments(resolved.canonicalArgv.slice(1)), 'governed-admin-mutation');
        }
      }

      const nodeInvocation = normalizeChangeBudgetCommand([
        process.execPath, fixture.canonicalCliEntryPath, ...args,
      ], { ...fixture.context, workingDirectory: fixture.packageRoot });
      assert.equal(nodeInvocation.identity, 'first-party', args.join(' '));
      if (nodeInvocation.identity === 'first-party') {
        assert.equal(classifyChangeBudgetArguments(nodeInvocation.canonicalArgv.slice(1)), 'governed-admin-mutation');
      }
    }

    const actualNodeDirectory = dirname(process.execPath);
    for (const tokens of [
      ['npm', 'exec', '--', 'changebudget', 'authority', 'grant', 'create', '--grant-id', 'known-grant'],
      ['npm', 'exec', '--', 'changebudget', 'authority', 'grant', 'revoke', '--grant-id', 'known-grant'],
      ['npm', 'exec', '--', 'changebudget', 'authority', 'rebind', '--repository-reference', 'known-reference'],
      ['npx', 'changebudget', 'authority', 'grant', 'create', '--grant-id', 'known-grant'],
      ['npx', 'changebudget', 'authority', 'grant', 'revoke', '--grant-id', 'known-grant'],
      ['npx', 'changebudget', 'authority', 'rebind', '--repository-reference', 'known-reference'],
    ]) {
      const resolved = normalizeChangeBudgetCommand(tokens, {
        ...fixture.context,
        pathValue: actualNodeDirectory,
      });
      assert.ok(resolved.identity === 'first-party' || resolved.identity === 'ambiguous', tokens.join(' '));
      if (resolved.identity === 'first-party') {
        assert.equal(classifyChangeBudgetArguments(resolved.canonicalArgv.slice(1)), 'governed-admin-mutation');
      }
    }
  } finally {
    await removeTestRepository(root);
  }
});

test('denial-only admin intent separates structural CLI targeting from first-party identity', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-deny-only-admin-');
  try {
    const fixture = await createInstalledFixture(root);
    const nodeRoot = await createStructurallyVerifiedNodeInstallation(root);
    const context = {
      ...fixture.context,
      pathValue: [nodeRoot, fixture.binDirectory].join(delimiter),
    };
    const adminCases = [
      ['authority', 'grant', 'create', '--request-json', '{}'],
      ['authority', 'grant', 'revoke', '--grant-id', 'fixture-grant', '--expected-digest', 'fixture-digest'],
      ['authority', 'rebind', '--repository-reference', 'fixture-reference'],
    ];
    const invocations = (args: readonly string[]) => [
      [process.platform === 'win32' ? join(nodeRoot, 'node.exe') : join(nodeRoot, 'node'), fixture.canonicalCliEntryPath, ...args],
      ...fixture.shimPaths.map((shim) => [shim, ...args]),
      ['npm', 'exec', '--', 'changebudget', ...args],
      ['npx', 'changebudget', ...args],
    ];

    for (const args of adminCases) {
      for (const tokens of invocations(args)) {
        const identity = normalizeChangeBudgetCommand(tokens, context);
        assert.equal(identity.identity, 'ambiguous',
          `${tokens.join(' ')}: the unanchored runtime must not acquire permissive first-party identity`);
        const intent = resolveDenyOnlyChangeBudgetAdminIntent(tokens, context);
        assert.equal(intent.kind, 'admin-intent', tokens.join(' '));
        if (intent.kind === 'admin-intent') {
          assert.equal(classifyChangeBudgetArguments(intent.canonicalArgv.slice(1)), 'governed-admin-mutation');
        }
      }
    }

    const canonicalNode = [join(nodeRoot, process.platform === 'win32' ? 'node.exe' : 'node'),
      fixture.canonicalCliEntryPath, ...adminCases[1]!];
    assert.deepEqual(normalizeChangeBudgetCommand(canonicalNode, context), { identity: 'ambiguous' });
    const shadowedContext = { ...context, pathValue: join(root, 'shadow-only') };
    await mkdir(shadowedContext.pathValue, { recursive: true });
    const shadowNode = join(shadowedContext.pathValue, process.platform === 'win32' ? 'node.exe' : 'node');
    await writeFile(shadowNode, 'unrelated shadow executable; never executed\n', 'utf8');
    if (process.platform !== 'win32') await chmod(shadowNode, 0o755);
    assert.deepEqual(normalizeChangeBudgetCommand(canonicalNode, shadowedContext), { identity: 'ambiguous' },
      'PATH-shadowed Node remains ambiguous in the permissive identity resolver');
    assert.equal(resolveDenyOnlyChangeBudgetAdminIntent(canonicalNode, shadowedContext).kind, 'admin-intent',
      'exact canonical-CLI admin intent remains denial-classifiable despite an unattested PATH-shadowed interpreter');
    const bareNodeWithShadow = ['node', fixture.canonicalCliEntryPath, ...adminCases[1]!];
    assert.deepEqual(normalizeChangeBudgetCommand(bareNodeWithShadow, shadowedContext), { identity: 'ambiguous' },
      'a shadowed bare Node token still does not become permissive first-party identity');
    assert.equal(resolveDenyOnlyChangeBudgetAdminIntent(bareNodeWithShadow, shadowedContext).kind, 'admin-intent',
      'the denial-only path does not require Node/npm installation attestation for the canonical CLI target');

    const unrelatedScript = join(root, 'unrelated-cli.js');
    await writeFile(unrelatedScript, '// unrelated Node program\n', 'utf8');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      canonicalNode[0]!, unrelatedScript, ...adminCases[1]!,
    ], context), { kind: 'none' });
    const unsupportedCanonicalNodeOption = [
      canonicalNode[0]!, '--inspect', fixture.canonicalCliEntryPath, ...adminCases[1]!,
    ];
    assert.deepEqual(normalizeChangeBudgetCommand(unsupportedCanonicalNodeOption, context), { identity: 'unrelated' },
      'the ordinary identity resolver preserves its existing result for an unsupported Node option');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent(unsupportedCanonicalNodeOption, context), { kind: 'ambiguous' },
      'a canonical CLI candidate behind an unsupported Node option is uncertainty, never admin intent');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent(unsupportedCanonicalNodeOption, context, false), { kind: 'ambiguous' },
      'malformed input still reports uncertainty when the canonical target remains structurally identifiable');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      canonicalNode[0]!, '--inspect', unrelatedScript, ...adminCases[1]!,
    ], context), { kind: 'none' }, 'an unrelated Node script with options stays unrelated to denial-only classification');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      canonicalNode[0]!, fixture.canonicalCliEntryPath, 'authority', 'unknown', 'argument',
    ], context), { kind: 'none' }, 'unknown ChangeBudget entry points are not governed-admin intent');
    assert.notEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      'npm', 'exec', 'changebudget', ...adminCases[1]!,
    ], context).kind, 'admin-intent', 'unsupported npm separator/chain forms stay ambiguous');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent(canonicalNode, context, false), { kind: 'ambiguous' },
      'malformed lexical input cannot establish canonical admin intent');

    const npmLauncherPath = join(nodeRoot, process.platform === 'win32' ? 'npm.cmd' : 'npm');
    const originalNpmLauncher = await readFile(npmLauncherPath, 'utf8');
    await writeFile(npmLauncherPath, '#!/bin/sh\necho unsupported npm wrapper\n', 'utf8');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      'npm', 'exec', '--', 'changebudget', ...adminCases[1]!,
    ], context), { kind: 'ambiguous' }, 'an unknown npm wrapper body cannot establish wrapped admin intent');
    await writeFile(npmLauncherPath, originalNpmLauncher, 'utf8');

    const separatedNodeRoot = await createStructurallyVerifiedNodeInstallation(join(root, 'node-only'));
    const separatedWrapperRoot = await createStructurallyVerifiedNodeInstallation(join(root, 'wrappers-only'));
    await Promise.all([
      unlink(join(separatedNodeRoot, process.platform === 'win32' ? 'npm.cmd' : 'npm')),
      unlink(join(separatedNodeRoot, process.platform === 'win32' ? 'npx.cmd' : 'npx')),
      unlink(join(separatedWrapperRoot, process.platform === 'win32' ? 'node.exe' : 'node')),
    ]);
    const rootCollisionContext = {
      ...context,
      pathValue: [separatedNodeRoot, separatedWrapperRoot].join(delimiter),
    };
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      'npm', 'exec', '--', 'changebudget', ...adminCases[1]!,
    ], rootCollisionContext), { kind: 'ambiguous' },
    'Node/npm/npx candidates from different real installation roots cannot prove npm wrapper intent');

    const invalidPackageContext = {
      ...context,
      packageRoot: fixture.root,
      canonicalCliEntryPath: fixture.canonicalCliEntryPath,
    };
    assert.notEqual(resolveDenyOnlyChangeBudgetAdminIntent(canonicalNode, invalidPackageContext).kind, 'admin-intent',
      'a wrong or colliding package root cannot establish canonical CLI intent');

    const attackerContext = { ...fixture.context, pathValue: fixture.context.pathValue };
    assert.notEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      'npm', 'exec', '--', 'changebudget', ...adminCases[1]!,
    ], attackerContext).kind, 'admin-intent',
    'the existing attacker-controlled npm launcher/npm-cli fixtures remain negative');

    const aliasCli = join(root, 'canonical-cli-alias.js');
    try {
      await symlink(fixture.canonicalCliEntryPath, aliasCli, 'file');
      const aliasedNode = [canonicalNode[0]!, aliasCli, ...adminCases[1]!];
      assert.deepEqual(normalizeChangeBudgetCommand(aliasedNode, context), { identity: 'unrelated' },
        'a noncanonical symlink spelling must not gain permissive first-party identity');
      assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent(aliasedNode, context), { kind: 'ambiguous' },
        'a realpath-related alias to the canonical CLI is uncertain, not admin intent');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      assert.ok(['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(code ?? ''),
        `unexpected canonical CLI alias test failure: ${String(error)}`);
    }

    if (process.platform === 'win32') {
      await writeFile(join(nodeRoot, 'npm.ps1'), '# unsupported alternate npm launcher\n', 'utf8');
      await writeFile(join(nodeRoot, 'npx.ps1'), '# unsupported alternate npx launcher\n', 'utf8');
      assert.equal(resolveDenyOnlyChangeBudgetAdminIntent(canonicalNode, context).kind, 'admin-intent',
        'the direct Node admin route does not require interpreter or wrapper attestation for denial');
      assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent([
        'npm', 'exec', '--', 'changebudget', ...adminCases[1]!,
      ], context), { kind: 'ambiguous' }, 'an unknown sibling npm wrapper body prevents npm-exec intent');
      await unlink(join(nodeRoot, 'npm.ps1'));
      await unlink(join(nodeRoot, 'npx.ps1'));
    }

    const npmManifestPath = join(nodeRoot, 'node_modules', 'npm', 'package.json');
    const originalNpmManifest = await readFile(npmManifestPath, 'utf8');
    await writeFile(npmManifestPath, JSON.stringify({
      name: 'attacker-npm',
      bin: { npm: 'bin/npm-cli.js', npx: 'bin/npx-cli.js' },
    }), 'utf8');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      'npm', 'exec', '--', 'changebudget', ...adminCases[1]!,
    ], context), { kind: 'ambiguous' }, 'the installed npm package name is part of the structural proof');
    await writeFile(npmManifestPath, JSON.stringify({
      name: 'npm',
      bin: { npm: 'bin/not-npm-cli.js', npx: 'bin/npx-cli.js' },
    }), 'utf8');
    assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent([
      'npm', 'exec', '--', 'changebudget', ...adminCases[1]!,
    ], context), { kind: 'ambiguous' }, 'the exact installed npm CLI bin entry is required');
    await writeFile(npmManifestPath, originalNpmManifest, 'utf8');

    const symlinkTarget = join(root, 'outside-canonical-cli.js');
    await writeFile(symlinkTarget, '// not the canonical package CLI\n', 'utf8');
    await unlink(fixture.canonicalCliEntryPath);
    try {
      await symlink(symlinkTarget, fixture.canonicalCliEntryPath, 'file');
      assert.deepEqual(resolveDenyOnlyChangeBudgetAdminIntent(canonicalNode, context), { kind: 'ambiguous' },
        'a symlinked CLI target outside the package cannot establish denial-only intent');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      assert.ok(['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(code ?? ''),
        `unexpected symlink test failure: ${String(error)}`);
    }
  } finally {
    await removeTestRepository(root);
  }
});

test('first-party identity proves ChangeBudget bins and Node while rejecting shadow npm launchers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-first-party-'));
  try {
    const fixture = await createInstalledFixture(root);
    const recovery = ['recover', 'lifecycle-lock', '--reason', 'operator request'];

    assertFirstParty(['changebudget', ...recovery], fixture.context, recovery);
    for (const tokens of [
      ['npm', 'exec', '--', 'changebudget', ...recovery],
      ['npx', 'changebudget', ...recovery],
      ['npm', 'start', '--', ...recovery],
      ['npm', 'run', 'start', '--', ...recovery],
    ]) {
      const context = tokens[1] === 'start' || tokens[1] === 'run'
        ? { ...fixture.context, workingDirectory: fixture.packageRoot }
        : fixture.context;
      assert.deepEqual(
        normalizeChangeBudgetCommand(tokens, context),
        { identity: 'ambiguous' },
        `a PATH-earlier fake ${tokens[0]} wrapper and sibling fake npm package are not trusted`,
      );
    }
    assert.equal(classifyChangeBudgetArguments(['status']), 'read-only');
    assert.deepEqual(
      normalizeChangeBudgetCommand(['npm', 'exec', '--', 'changebudget', 'status'], fixture.context),
      { identity: 'ambiguous' },
      'a fake npm wrapper cannot make attacker-controlled status read-only',
    );

    for (const shim of fixture.shimPaths) {
      assertFirstParty([shim, ...recovery], fixture.context, recovery);
      const relativeShim = relative(fixture.consumerRoot, shim).replace(/[\\/]/g, '/');
      assertFirstParty([`./${relativeShim}`, ...recovery], fixture.context, recovery);
    }
    const windowsRelativeShim = String.raw`.\node_modules\.bin\changebudget`;
    assertFirstParty([windowsRelativeShim, ...recovery], fixture.context, recovery);

    const packageContext = { ...fixture.context, workingDirectory: fixture.packageRoot };
    const nodeForms = [
      ['node', fixture.canonicalCliEntryPath, ...recovery],
      ...(process.platform === 'win32' ? [['node.exe', fixture.canonicalCliEntryPath, ...recovery]] : []),
      [process.execPath, fixture.canonicalCliEntryPath, ...recovery],
      ['node', '--enable-source-maps', fixture.canonicalCliEntryPath, ...recovery],
      ['node', 'dist/src/cli/index.js', ...recovery],
      ['node', '--enable-source-maps', String.raw`dist\src\cli\index.js`, ...recovery],
    ];
    for (const tokens of nodeForms) assertFirstParty(tokens, packageContext, recovery);
    if (process.platform !== 'win32') {
      assert.deepEqual(
        normalizeChangeBudgetCommand(['node.exe', fixture.canonicalCliEntryPath, ...recovery], packageContext),
        { identity: 'ambiguous' },
        'node.exe without a proven POSIX executable must not receive first-party identity',
      );
      await unlink(fixture.shimPaths[0]!);
      await symlink(join('..', 'changebudget', 'dist', 'src', 'cli', 'index.js'), fixture.shimPaths[0]!);
      assertFirstParty(['changebudget', ...recovery], fixture.context, recovery);
      assertFirstParty([fixture.shimPaths[0]!, ...recovery], fixture.context, recovery);
      await unlink(fixture.shimPaths[0]!);
      await symlink(join('..', 'changebudget', 'package.json'), fixture.shimPaths[0]!);
      assert.deepEqual(normalizeChangeBudgetCommand(['changebudget', ...recovery], fixture.context),
        { identity: 'ambiguous' }, 'a symlink to a different package file is not executable proof');
    }

    const forced = ['recover', 'lifecycle-lock', '--force', '--reason', 'operator request'];
    const forcedDirect = normalizeChangeBudgetCommand(
      ['node', fixture.canonicalCliEntryPath, ...forced], packageContext,
    );
    assert.equal(forcedDirect.identity === 'first-party'
      ? classifyChangeBudgetArguments(forcedDirect.canonicalArgv.slice(1))
      : null, 'operator-recovery');

    assert.deepEqual(
      normalizeChangeBudgetCommand(['changebudget', ...recovery], { ...fixture.context, pathValue: '' }),
      { identity: 'ambiguous' },
      'bare executable names without PATH proof fail closed',
    );
    const missingPathContext = { ...fixture.context, pathValue: '' };
    for (const tokens of [
      ['node', fixture.canonicalCliEntryPath, ...recovery],
      ['npm', 'exec', '--', 'changebudget', ...recovery],
      ['npx', 'changebudget', ...recovery],
    ]) {
      assert.deepEqual(
        normalizeChangeBudgetCommand(tokens, missingPathContext),
        { identity: 'ambiguous' },
        `missing PATH proof fails closed for ${tokens[0]}`,
      );
    }
    assert.deepEqual(
      normalizeChangeBudgetCommand(['npm', 'start', '--', ...recovery], {
        ...missingPathContext,
        workingDirectory: fixture.packageRoot,
      }),
      { identity: 'ambiguous' },
      'a canonical package script does not prove a missing npm launcher',
    );

    if (process.platform === 'win32' && existsSync(join(dirname(process.execPath), 'npm.ps1'))) {
      const installedNodeDirectory = dirname(process.execPath);
      const installedLauncherContext = {
        ...fixture.context,
        pathValue: installedNodeDirectory,
      };
      for (const tokens of [
        ['npm', 'exec', '--', 'changebudget', ...recovery],
        ['npx', 'changebudget', ...recovery],
      ]) {
        assert.deepEqual(
          normalizeChangeBudgetCommand(tokens, installedLauncherContext),
          { identity: 'ambiguous' },
          `the installed ${tokens[0]} launcher has an unresolved config-derived branch`,
        );
      }
    }
    assert.deepEqual(
      normalizeChangeBudgetCommand(['npm', 'exec', '--', 'changebudget', ...recovery], {
        ...fixture.context,
        workingDirectory: root,
      }),
      { identity: 'ambiguous' },
      'npm syntax alone does not establish package identity',
    );
    assert.deepEqual(
      normalizeChangeBudgetCommand(['npm', 'exec', '--', 'eslint', '--fix'], fixture.context),
      { identity: 'unrelated' },
    );
  } finally {
    await removeTestRepository(root);
  }
});

test('first-party resolution rejects decoy packages, copied shims, user wrappers, and unsupported chains', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-first-party-decoys-'));
  try {
    const fixture = await createInstalledFixture(root);
    const recovery = ['recover', 'lifecycle-lock', '--reason', 'operator request'];
    const copiedDirectory = join(root, 'copied-bin');
    await mkdir(copiedDirectory, { recursive: true });
    const copiedShim = join(copiedDirectory, 'changebudget.cmd');
    await writeFile(copiedShim, await readFile(fixture.shimPaths.at(-1)!, 'utf8'), 'utf8');

    assert.deepEqual(
      normalizeChangeBudgetCommand([copiedShim, ...recovery], fixture.context),
      { identity: 'unrelated' },
      'copying a package shim outside its sibling .bin is not package proof',
    );

    for (const shim of fixture.shimPaths) {
      const extension = extname(shim);
      const original = await readFile(shim, 'utf8');
      const marker = extension === '.cmd'
        ? String.raw`%dp0%\..\changebudget\dist\src\cli\index.js`
        : '$basedir/../changebudget/dist/src/cli/index.js';
      const decoys = extension === '.cmd'
        ? [
          `@ECHO off\nREM ${marker}\n`,
          `@ECHO off\nSET "_target=${marker}"\n`,
          `@ECHO off\nECHO ${marker}\n"node.exe" "other.js" %*\n`,
        ]
        : extension === '.ps1'
          ? [
            `# ${marker}\n`,
            `$target = "${marker}"\nexit 0\n`,
            `Write-Output "${marker}"\n& "node.exe" "other.js" $args\n`,
          ]
          : [
            `#!/bin/sh\n# ${marker}\n`,
            `#!/bin/sh\nTARGET="${marker}"\nexit 0\n`,
            `#!/bin/sh\necho "${marker}"\nexec node other.js "$@"\n`,
          ];
      for (const decoy of decoys) {
        await writeFile(shim, decoy, 'utf8');
        assert.deepEqual(
          normalizeChangeBudgetCommand([shim, ...recovery], fixture.context),
          { identity: 'ambiguous' },
          `a ${extension || 'POSIX'} shim target mention is not execution proof`,
        );
      }
      await writeFile(shim, original, 'utf8');
    }

    const npmManifestPath = join(fixture.npmLauncherDirectory, 'node_modules', 'npm', 'package.json');
    const originalNpmManifest = await readFile(npmManifestPath, 'utf8');
    await writeFile(npmManifestPath, JSON.stringify({
      name: 'npm',
      bin: { npm: 'bin/not-npm-cli.js', npx: 'bin/npx-cli.js' },
    }), 'utf8');
    assert.deepEqual(
      normalizeChangeBudgetCommand(['npm', 'exec', '--', 'changebudget', ...recovery], fixture.context),
      { identity: 'ambiguous' },
      'an npm-name manifest with the wrong bin target is not launcher proof',
    );
    await writeFile(npmManifestPath, originalNpmManifest, 'utf8');

    assert.deepEqual(
      normalizeChangeBudgetCommand([join(root, 'other', 'changebudget.exe'), ...recovery], fixture.context),
      { identity: 'unrelated' },
      'unsupported absolute executable suffixes are not recognized',
    );

    const decoyDirectory = join(root, 'earlier-path');
    await mkdir(decoyDirectory, { recursive: true });
    await writeFile(join(decoyDirectory, 'changebudget'), 'user command\n', 'utf8');
    assert.deepEqual(
      normalizeChangeBudgetCommand(['changebudget', ...recovery], {
        ...fixture.context,
        pathValue: [decoyDirectory, fixture.binDirectory].join(delimiter),
      }),
      { identity: 'ambiguous' },
      'an earlier PATH entry wins and cannot be mistaken for this package',
    );

    const fakeLauncherDirectory = join(root, 'fake-launchers');
    await mkdir(fakeLauncherDirectory, { recursive: true });
    const fakeNode = join(fakeLauncherDirectory, process.platform === 'win32' ? 'node.exe' : 'node');
    await writeFile(fakeNode, 'not the running Node executable\n', 'utf8');
    if (process.platform !== 'win32') await chmod(fakeNode, 0o755);
    const fakeNpmNames = process.platform === 'win32'
      ? ['npm.cmd', 'npx.cmd']
      : ['npm', 'npx'];
    for (const name of fakeNpmNames) {
      const fakeLauncher = join(fakeLauncherDirectory, name);
      await writeFile(fakeLauncher, 'unverified launcher\n', 'utf8');
      if (process.platform !== 'win32') await chmod(fakeLauncher, 0o755);
    }
    const shadowedPathContext = {
      ...fixture.context,
      pathValue: [fakeLauncherDirectory, fixture.context.pathValue ?? ''].filter(Boolean).join(delimiter),
    };
    for (const tokens of [
      ['node', fixture.canonicalCliEntryPath, ...recovery],
      ['npm', 'exec', '--', 'changebudget', ...recovery],
      ['npx', 'changebudget', ...recovery],
    ]) {
      assert.deepEqual(
        normalizeChangeBudgetCommand(tokens, shadowedPathContext),
        { identity: 'ambiguous' },
        `an earlier PATH ${tokens[0]} launcher is not trusted by basename`,
      );
    }

    const suffixDecoy = join(fixture.binDirectory, 'changebudget.exe');
    await writeFile(suffixDecoy, 'not an npm shim\n', 'utf8');
    if (process.platform === 'win32') {
      assert.deepEqual(
        normalizeChangeBudgetCommand(['changebudget', ...recovery], fixture.context),
        { identity: 'ambiguous' },
        'a same-directory suffix decoy makes the effective launcher ambiguous',
      );
    } else {
      assertFirstParty(['changebudget', ...recovery], fixture.context, recovery);
    }

    const other = await createInstalledFixture(join(root, 'other-install'));
    assert.deepEqual(
      normalizeChangeBudgetCommand(['npm', 'exec', '--', 'changebudget', ...recovery], {
        ...fixture.context,
        workingDirectory: other.consumerRoot,
        pathValue: other.binDirectory,
      }),
      { identity: 'ambiguous' },
      'an identically named package in another node_modules tree is not first-party',
    );
    await writeFile(join(other.packageRoot, 'package.json'), JSON.stringify({
      name: 'changebudget',
      bin: { changebudget: 'dist/not-the-cli.js' },
      scripts: { start: 'node dist/src/cli/index.js' },
    }), 'utf8');
    assert.deepEqual(
      normalizeChangeBudgetCommand(['changebudget', ...recovery], other.context),
      { identity: 'ambiguous' },
      'a package name alone cannot substitute for the verified bin mapping',
    );

    if (process.platform === 'win32') {
      for (const extension of ['.cmd', '.ps1']) {
        const userShim = join(fixture.binDirectory, `changebudget${extension}`);
        await writeFile(userShim, '@echo off\necho user wrapper\n', 'utf8');
        assert.deepEqual(
          normalizeChangeBudgetCommand([userShim, ...recovery], fixture.context),
          { identity: 'ambiguous' },
          `user-created ${extension} content is not trusted`,
        );
      }
      assert.deepEqual(
        normalizeChangeBudgetCommand([
          String.raw`.\node_modules\.bin\changebudget.exe`, ...recovery,
        ], fixture.context),
        { identity: 'ambiguous' },
        'an arbitrary suffix inside the local bin is still unproven',
      );
    }

    const decoyScript = join(root, 'index.js');
    await writeFile(decoyScript, '// unrelated script\n', 'utf8');
    assert.deepEqual(
      normalizeChangeBudgetCommand(['node', decoyScript, ...recovery], fixture.context),
      { identity: 'unrelated' },
    );
    assert.deepEqual(
      normalizeChangeBudgetCommand(['node', '--inspect', fixture.canonicalCliEntryPath, ...recovery], fixture.context),
      { identity: 'unrelated' },
    );
    assert.deepEqual(
      normalizeChangeBudgetCommand(['echo', '"npm exec -- changebudget recover lifecycle-lock"'], fixture.context),
      { identity: 'unrelated' },
      'quoted text is not an executable identity; user-authored executable chains are out of scope',
    );
    assert.deepEqual(
      normalizeChangeBudgetCommand(['npx', '-c', 'changebudget recover lifecycle-lock'], fixture.context),
      { identity: 'ambiguous' },
    );
    assert.deepEqual(
      normalizeChangeBudgetCommand(['npm', 'start', '--', ...recovery], fixture.context),
      { identity: 'unrelated' },
      'npm start outside this package root is not normalized',
    );
    assert.deepEqual(
      normalizeChangeBudgetCommand(
        ['node', fixture.canonicalCliEntryPath, ...recovery], fixture.context, false,
      ),
      { identity: 'ambiguous' },
      'malformed command text never receives a first-party claim',
    );
  } finally {
    await removeTestRepository(root);
  }
});
