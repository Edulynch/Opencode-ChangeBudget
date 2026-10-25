import { accessSync, constants, existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';

const PACKAGE_NAME = 'changebudget';
const CLI_RELATIVE_PATH = join('dist', 'src', 'cli', 'index.js');
const NPM_START_SCRIPT = 'node dist/src/cli/index.js';
const WINDOWS_SHIM_EXTENSIONS = ['', '.cmd', '.ps1'] as const;
const WINDOWS_EXECUTABLE_SUFFIXES = ['', '.com', '.exe', '.bat', '.cmd', '.ps1'];

const POSIX_CHANGE_BUDGET_SHIM = [
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

// npm 11.16 cmd-shim bodies captured from an installed ChangeBudget package.
const WINDOWS_CMD_CHANGE_BUDGET_SHIM = [
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
].join('\n');

const WINDOWS_PS1_CHANGE_BUDGET_SHIM = [
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

export interface FirstPartyIdentityContext {
  readonly packageRoot: string;
  readonly workingDirectory: string;
  readonly canonicalCliEntryPath: string;
  readonly pathValue?: string;
}

export type FirstPartyIdentityResolution =
  | {
    readonly identity: 'first-party';
    readonly invocation: 'direct' | 'wrapped';
    readonly wrapper?: 'npm-exec' | 'npx';
    readonly canonicalArgv: readonly string[];
  }
  | { readonly identity: 'unrelated' }
  | { readonly identity: 'ambiguous' };

interface VerifiedPackage {
  readonly root: string;
  readonly cliEntry: string;
  readonly binDirectory: string | null;
}

function normalizedPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' || /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function strictRealpath(value: string): string | null {
  try {
    return normalizedPath(realpathSync(value));
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function verifyPackage(context: FirstPartyIdentityContext): VerifiedPackage | null {
  if (!isAbsolute(context.packageRoot) || !isAbsolute(context.canonicalCliEntryPath)) return null;

  const packageRoot = strictRealpath(context.packageRoot);
  const cliEntry = strictRealpath(context.canonicalCliEntryPath);
  const packageJsonPath = resolve(context.packageRoot, 'package.json');
  const packageJson = strictRealpath(packageJsonPath);
  if (packageRoot === null || cliEntry === null || packageJson === null
    || normalizedPath(dirname(packageJson)) !== packageRoot) return null;

  try {
    const metadata: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if (!isRecord(metadata) || metadata.name !== PACKAGE_NAME) return null;
    const bin = metadata.bin;
    if (!isRecord(bin) || bin[PACKAGE_NAME] !== CLI_RELATIVE_PATH.replace(/\\/g, '/')) return null;
    const expectedCli = resolve(context.packageRoot, CLI_RELATIVE_PATH);
    if (normalizedPath(expectedCli) !== normalizedPath(context.canonicalCliEntryPath)
      || strictRealpath(expectedCli) !== cliEntry) return null;

    const packageDirectory = dirname(packageRoot);
    const isInstalledNodeModule = basenamePortable(packageRoot) === PACKAGE_NAME
      && basenamePortable(packageDirectory) === 'node_modules';
    return {
      root: packageRoot,
      cliEntry,
      binDirectory: isInstalledNodeModule ? resolve(packageDirectory, '.bin') : null,
    };
  } catch {
    return null;
  }
}

function verifyPackageForDenial(context: FirstPartyIdentityContext): VerifiedPackage | null {
  const packageInfo = verifyPackage(context);
  if (packageInfo === null) return null;
  const lexicalCli = resolve(context.packageRoot, CLI_RELATIVE_PATH);
  try {
    const stat = lstatSync(lexicalCli);
    if (!stat.isFile() || stat.isSymbolicLink()
      || strictRealpath(lexicalCli) !== normalizedPath(lexicalCli)
      || packageInfo.cliEntry !== normalizedPath(lexicalCli)) return null;
    return packageInfo;
  } catch {
    return null;
  }
}

function basenamePortable(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/$/, '').split('/').at(-1)?.toLowerCase() ?? '';
}

function supportedShimPaths(packageInfo: VerifiedPackage): string[] {
  if (packageInfo.binDirectory === null) return [];
  const extensions = process.platform === 'win32' ? WINDOWS_SHIM_EXTENSIONS : [''] as const;
  return extensions.map((extension) => resolve(packageInfo.binDirectory!, `${PACKAGE_NAME}${extension}`));
}

function isNpmGeneratedShimStructure(
  shimPath: string,
  packageInfo: VerifiedPackage,
): boolean {
  if (!supportedShimPaths(packageInfo).some((known) => normalizedPath(known) === normalizedPath(shimPath))) {
    return false;
  }
  const binDirectory = packageInfo.binDirectory;
  if (binDirectory === null || strictRealpath(binDirectory) !== normalizedPath(binDirectory)) return false;
  const invokedCli = resolve(binDirectory, '..', PACKAGE_NAME, CLI_RELATIVE_PATH);
  if (normalizedPath(invokedCli) !== packageInfo.cliEntry || strictRealpath(invokedCli) !== packageInfo.cliEntry) {
    return false;
  }

  try {
      const stat = lstatSync(shimPath);
      if (process.platform !== 'win32' && stat.isSymbolicLink()) {
        // POSIX npm installs a relative .bin symlink, not a generated shell wrapper.
        // This structural check is suitable for deny-only classification; the
        // ordinary first-party resolver separately attests its interpreter.
        return readlinkSync(shimPath) === join('..', PACKAGE_NAME, CLI_RELATIVE_PATH)
          && strictRealpath(shimPath) === packageInfo.cliEntry
          && statSync(shimPath).size <= 64 * 1024
          && readFileSync(shimPath, 'utf8').startsWith('#!/usr/bin/env node\n');
      }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) return false;
    if (process.platform !== 'win32') accessSync(shimPath, constants.X_OK);
    if (strictRealpath(shimPath) !== normalizedPath(shimPath)) return false;

    const extension = extname(shimPath).toLowerCase();
    const contents = readFileSync(shimPath, 'utf8').replace(/\r\n?/g, '\n');
    if (extension === '') {
      return contents === POSIX_CHANGE_BUDGET_SHIM;
    }
    if (extension === '.cmd') {
      return contents === WINDOWS_CMD_CHANGE_BUDGET_SHIM;
    }
    if (extension === '.ps1') {
      return contents === WINDOWS_PS1_CHANGE_BUDGET_SHIM;
    }
    return false;
  } catch {
    return false;
  }
}

function isNpmGeneratedShim(
  shimPath: string,
  packageInfo: VerifiedPackage,
  context: FirstPartyIdentityContext,
): boolean {
  if (!isNpmGeneratedShimStructure(shimPath, packageInfo)) return false;
  try {
    return lstatSync(shimPath).isSymbolicLink()
      ? isNodeExecutable('node', context)
      : changeBudgetShimNodeVerified(shimPath, context);
  } catch {
    return false;
  }
}

function npmBinShimForWorkingDirectory(
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage,
): string | null {
  if (!isAbsolute(context.workingDirectory) || packageInfo.binDirectory === null) return null;
  const localBinDirectory = resolve(context.workingDirectory, 'node_modules', '.bin');
  return strictRealpath(localBinDirectory) === normalizedPath(packageInfo.binDirectory)
    ? packageInfo.binDirectory
    : null;
}

function canonicalArgv(args: readonly string[]): readonly string[] {
  return [PACKAGE_NAME, ...args];
}

function firstParty(
  args: readonly string[],
  wellFormed: boolean,
  invocation: 'direct' | 'wrapped' = 'direct',
  wrapper?: 'npm-exec' | 'npx',
): FirstPartyIdentityResolution {
  if (!wellFormed) return { identity: 'ambiguous' };
  return {
    identity: 'first-party',
    invocation,
    ...(wrapper === undefined ? {} : { wrapper }),
    canonicalArgv: canonicalArgv(args),
  };
}

function isAbsoluteExecutable(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function isPlausibleBareName(value: string): boolean {
  return /^changebudget(?:\.[a-z0-9_-]+)?$/i.test(value);
}

function pathCandidateNames(requestedName: string): string[] {
  if (extname(requestedName).length > 0) return [requestedName];
  return process.platform === 'win32'
    ? WINDOWS_EXECUTABLE_SUFFIXES.map((extension) => `${PACKAGE_NAME}${extension}`)
    : [PACKAGE_NAME];
}

function candidatesInDirectory(directory: string, requestedName: string): string[] {
  return pathCandidateNames(requestedName).map((name) => resolve(directory, name)).filter(existsSync);
}

function findBarePathTarget(
  requestedName: string,
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage,
): 'first-party' | 'ambiguous' {
  if (process.platform !== 'win32' && requestedName !== PACKAGE_NAME) return 'ambiguous';
  const pathValue = context.pathValue ?? process.env.PATH ?? '';
  const directories = pathValue.split(delimiter).map((entry) => (
    entry.length === 0 ? context.workingDirectory : isAbsolute(entry) ? entry : resolve(context.workingDirectory, entry)
  ));
  if (process.platform === 'win32' && isAbsolute(context.workingDirectory)) {
    // Windows searches the working directory before PATH. Such a hit means
    // PATH did not prove the token's target, so preserve ambiguity.
    if (candidatesInDirectory(context.workingDirectory, requestedName).length > 0) return 'ambiguous';
  }

  for (const directory of directories) {
    const candidates = candidatesInDirectory(directory, requestedName);
    if (candidates.length === 0) continue;
    return candidates.every((candidate) => isNpmGeneratedShim(candidate, packageInfo, context))
      ? 'first-party'
      : 'ambiguous';
  }
  return 'ambiguous';
}

function resolveDirectExecutable(
  executableToken: string,
  args: readonly string[],
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage,
  wellFormed: boolean,
): FirstPartyIdentityResolution | null {
  const executable = executableToken.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (isPlausibleBareName(executable)) {
    const resolution = findBarePathTarget(executable, context, packageInfo);
    return resolution === 'first-party'
      ? firstParty(args, wellFormed)
      : { identity: 'ambiguous' };
  }

  let candidatePath: string | null = null;
  let relativeBinInvocation = false;
  if (isAbsoluteExecutable(executable)) {
    candidatePath = resolve(executable);
  } else if (/^\.([/\\])node_modules\1\.bin\1changebudget(?:\.[a-z0-9_-]+)?$/i.test(executable)) {
    relativeBinInvocation = true;
    candidatePath = resolve(context.workingDirectory, executable.replace(/[\\/]/g, sep));
  } else {
    return null;
  }

  if (packageInfo.binDirectory === null) {
    return relativeBinInvocation ? { identity: 'ambiguous' } : { identity: 'unrelated' };
  }
  const canonicalCandidates = supportedShimPaths(packageInfo);
  if (canonicalCandidates.some((known) => normalizedPath(known) === normalizedPath(candidatePath!))) {
    return isNpmGeneratedShim(candidatePath, packageInfo, context)
      ? firstParty(args, wellFormed)
      : { identity: 'ambiguous' };
  }

  const candidateParent = normalizedPath(dirname(candidatePath));
  if (candidateParent === normalizedPath(packageInfo.binDirectory)
    && /^changebudget(?:\.[a-z0-9_-]+)?$/i.test(candidatePath.slice(dirname(candidatePath).length + 1))) {
    return { identity: 'ambiguous' };
  }
  return { identity: 'unrelated' };
}

function bareLauncherNames(requestedName: string): string[] {
  if (process.platform !== 'win32' || extname(requestedName).length > 0) return [requestedName];
  return WINDOWS_EXECUTABLE_SUFFIXES.map((extension) => `${requestedName}${extension}`);
}

function executableFilesInDirectory(directory: string, requestedName: string): string[] {
  const candidates: string[] = [];
  for (const name of bareLauncherNames(requestedName)) {
    const candidate = resolve(directory, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      if (process.platform !== 'win32') accessSync(candidate, constants.X_OK);
      candidates.push(candidate);
    } catch {
      // Non-executable POSIX files do not win PATH lookup; inaccessible files
      // cannot serve as identity proof.
    }
  }
  return candidates;
}

function firstBarePathCandidates(
  requestedName: string,
  context: FirstPartyIdentityContext,
): string[] | null {
  if (!isAbsolute(context.workingDirectory)) return null;
  const pathValue = context.pathValue ?? process.env.PATH ?? '';
  const pathDirectories = pathValue.split(delimiter).map((entry) => (
    entry.length === 0 ? context.workingDirectory
      : isAbsolute(entry) ? entry : resolve(context.workingDirectory, entry)
  ));
  const directories = process.platform === 'win32'
    ? [context.workingDirectory, ...pathDirectories]
    : pathDirectories;

  for (const directory of directories) {
    const candidates = executableFilesInDirectory(directory, requestedName);
    if (candidates.length > 0) return candidates;
  }
  return null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function npmCliFromLauncherAtNodePath(
  launcherPath: string,
  executable: 'npm' | 'npx',
  nodePath: string,
): string | null {
  const realNodePath = strictRealpath(nodePath);
  if (realNodePath === null) return null;
  const trustedNodeRoot = dirname(realNodePath);
  const launcherDirectory = dirname(launcherPath);
  const expectedLauncher = resolve(
    trustedNodeRoot,
    `${executable}${process.platform === 'win32' ? '.cmd' : ''}`,
  );
  if (normalizedPath(launcherDirectory) !== normalizedPath(trustedNodeRoot)
    || strictRealpath(launcherDirectory) !== normalizedPath(trustedNodeRoot)
    || normalizedPath(launcherPath) !== normalizedPath(expectedLauncher)) return null;

  const npmRoot = resolve(trustedNodeRoot, 'node_modules', 'npm');
  const manifestPath = resolve(npmRoot, 'package.json');
  const npmRootRealpath = strictRealpath(npmRoot);
  const manifestRealpath = strictRealpath(manifestPath);
  try {
    const manifestStat = lstatSync(manifestPath);
    if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  if (npmRootRealpath !== normalizedPath(npmRoot) || manifestRealpath === null
    || normalizedPath(dirname(manifestRealpath)) !== npmRootRealpath) return null;

  try {
    const metadata: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const cliRelativePath = `bin/${executable}-cli.js`;
    if (!isRecord(metadata) || metadata.name !== 'npm' || !isRecord(metadata.bin)
      || metadata.bin[executable] !== cliRelativePath) return null;
    const cliPath = resolve(npmRoot, cliRelativePath);
    const cliStat = lstatSync(cliPath);
    return cliStat.isFile() && !cliStat.isSymbolicLink()
      && strictRealpath(cliPath) === normalizedPath(cliPath)
      ? cliPath
      : null;
  } catch {
    return null;
  }
}

function npmCliFromLauncher(launcherPath: string, executable: 'npm' | 'npx'): string | null {
  return npmCliFromLauncherAtNodePath(launcherPath, executable, process.execPath);
}

function verifiedNpmLauncherWithNodePath(
  launcherPath: string,
  executable: 'npm' | 'npx',
  nodePath: string,
): boolean {
  try {
    const stat = lstatSync(launcherPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024
      || strictRealpath(launcherPath) !== normalizedPath(launcherPath)) return false;

    const extension = extname(launcherPath).toLowerCase();
    if ((process.platform === 'win32' && extension !== '.cmd')
      || (process.platform !== 'win32' && extension !== '')) return false;

    const cliPath = npmCliFromLauncherAtNodePath(launcherPath, executable, nodePath);
    const realNodePath = strictRealpath(nodePath);
    if (cliPath === null || realNodePath === null) return false;
    const contents = readFileSync(launcherPath, 'utf8').replace(/\r\n?/g, '\n');
    if (process.platform === 'win32') {
      const commandPaths = [nodePath, cliPath];
      if (commandPaths.some((path) => /[%!\r\n"]/.test(path))) return false;
      return contents === `@ECHO off\n"${nodePath}" "${cliPath}" %*\n`;
    }
    if ([nodePath, cliPath].some((path) => /[\0\r\n]/.test(path))) return false;
    return contents === `#!/bin/sh\nexec ${shellQuote(nodePath)} ${shellQuote(cliPath)} "$@"\n`;
  } catch {
    return false;
  }
}

function verifiedNpmLauncher(launcherPath: string, executable: 'npm' | 'npx'): boolean {
  return verifiedNpmLauncherWithNodePath(launcherPath, executable, process.execPath);
}

function hasVerifiedBareNpmLauncher(
  executable: 'npm' | 'npx',
  context: FirstPartyIdentityContext,
): boolean {
  const candidates = firstBarePathCandidates(executable, context);
  return candidates !== null && candidates.every((candidate) => verifiedNpmLauncher(candidate, executable));
}

export function isNodeCommandSpelling(value: string): boolean {
  const executable = value.trim().replace(/^(['"])(.*)\1$/, '$2');
  if (/^node(?:\.exe)?$/i.test(executable)) return true;
  return isAbsoluteExecutable(executable)
    && (strictRealpath(executable) === strictRealpath(process.execPath)
      || /^node(?:\.exe)?$/i.test(basenamePortable(executable)));
}

function isNodeExecutable(value: string, context: FirstPartyIdentityContext): boolean {
  const executable = value.trim().replace(/^(['"])(.*)\1$/, '$2');
  const processNode = strictRealpath(process.execPath);
  if (processNode === null) return false;
  if (isAbsoluteExecutable(executable)) return strictRealpath(executable) === processNode;
  if (!/^node(?:\.exe)?$/i.test(executable)) return false;
  const candidates = firstBarePathCandidates(executable, context);
  return candidates !== null
    && candidates.every((candidate) => strictRealpath(candidate) === processNode);
}

function changeBudgetShimNodeVerified(shimPath: string, context: FirstPartyIdentityContext): boolean {
  const extension = extname(shimPath).toLowerCase();
  const localNodeName = process.platform === 'win32' && extension !== '' ? 'node.exe' : 'node';
  const localNode = resolve(dirname(shimPath), localNodeName);
  const localBranchSelected = process.platform === 'win32'
    ? existsSync(localNode)
    : (() => {
      try {
        accessSync(localNode, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    })();

  if (localBranchSelected) return strictRealpath(localNode) === strictRealpath(process.execPath);
  const fallbackName = process.platform === 'win32' && extension === '.ps1' ? 'node.exe' : 'node';
  return isNodeExecutable(fallbackName, context);
}

function npmLifecycleNodeVerified(context: FirstPartyIdentityContext): boolean {
  if (!isAbsolute(context.workingDirectory)) return false;
  const processNode = strictRealpath(process.execPath);
  if (processNode === null) return false;

  let directory = resolve(context.workingDirectory);
  while (true) {
    const lifecycleBin = resolve(directory, 'node_modules', '.bin');
    const candidates = executableFilesInDirectory(lifecycleBin, 'node');
    if (candidates.length > 0
      && !candidates.every((candidate) => strictRealpath(candidate) === processNode)) return false;
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return isNodeExecutable('node', context);
}

function normalizeNodeInvocation(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage,
  wellFormed: boolean,
): FirstPartyIdentityResolution | null {
  if (tokens.length < 2 || !isNodeCommandSpelling(tokens[0] ?? '')) return null;
  const scriptIndex = tokens[1] === '--enable-source-maps' ? 2 : 1;
  const scriptToken = tokens[scriptIndex]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
  if (scriptToken.length === 0 || /[\0\r\n]/.test(scriptToken) || scriptToken.startsWith('-')) return null;
  if (!isAbsolute(context.workingDirectory)) return null;

  const invokedPath = resolve(context.workingDirectory, scriptToken.replace(/[\\/]/g, sep));
  if (normalizedPath(invokedPath) !== normalizedPath(context.canonicalCliEntryPath)) return null;
  if (!isNodeExecutable(tokens[0] ?? '', context)) return { identity: 'ambiguous' };
  const invokedRealpath = strictRealpath(invokedPath);
  if (invokedRealpath === null) return { identity: 'ambiguous' };
  if (invokedRealpath !== packageInfo.cliEntry) return { identity: 'ambiguous' };
  return firstParty(tokens.slice(scriptIndex + 1), wellFormed);
}

function canonicalPackageNpmStart(
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage,
): boolean | 'ambiguous' {
  if (!isAbsolute(context.workingDirectory)) return false;
  const lexicalRootMatch = normalizedPath(context.workingDirectory) === packageInfo.root;
  const workingDirectory = strictRealpath(context.workingDirectory);
  if (lexicalRootMatch && workingDirectory === null) return 'ambiguous';
  if (workingDirectory !== packageInfo.root) return false;

  try {
    const metadata: unknown = JSON.parse(readFileSync(resolve(context.packageRoot, 'package.json'), 'utf8'));
    if (!isRecord(metadata) || !isRecord(metadata.scripts)) return false;
    return metadata.scripts.start === NPM_START_SCRIPT;
  } catch {
    return false;
  }
}

function normalizeNpmStart(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage,
  wellFormed: boolean,
): FirstPartyIdentityResolution | null {
  let argumentIndex: number;
  if (tokens[0]?.toLowerCase() === 'npm' && tokens[1]?.toLowerCase() === 'start'
    && tokens[2] === '--' && tokens[3] === 'recover' && tokens[4] === 'lifecycle-lock') {
    argumentIndex = 3;
  } else if (tokens[0]?.toLowerCase() === 'npm' && tokens[1]?.toLowerCase() === 'run'
    && tokens[2]?.toLowerCase() === 'start' && tokens[3] === '--'
    && tokens[4] === 'recover' && tokens[5] === 'lifecycle-lock') {
    argumentIndex = 4;
  } else {
    return null;
  }

  const packageMatch = canonicalPackageNpmStart(context, packageInfo);
  if (packageMatch === 'ambiguous') return { identity: 'ambiguous' };
  if (!packageMatch) return null;
  if (!hasVerifiedBareNpmLauncher('npm', context) || !npmLifecycleNodeVerified(context)) {
    return { identity: 'ambiguous' };
  }
  return firstParty(tokens.slice(argumentIndex), wellFormed);
}

const NPM_EXEC_OPTIONS_WITH_VALUE = new Set(['--call', '-c', '--package', '-p', '--workspace', '-w']);
const NPX_OPTIONS_WITH_VALUE = new Set(['--package', '-p']);

function firstWrapperTargetIndex(
  tokens: readonly string[],
  startIndex: number,
  optionsWithValue: ReadonlySet<string>,
): number | null {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === '--') return index + 1 < tokens.length ? index + 1 : null;
    if (!token.startsWith('-') || token === '-') return index;
    const option = token.split('=', 1)[0]!.toLowerCase();
    if (optionsWithValue.has(option) && !token.includes('=')) {
      if (index + 1 >= tokens.length) return null;
      index += 1;
    }
  }
  return null;
}

function hasChangeBudgetCall(tokens: readonly string[]): boolean {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const option = token.split('=', 1)[0]!.toLowerCase();
    if (!['--call', '-c'].includes(option)) continue;
    const command = token.includes('=') ? token.slice(token.indexOf('=') + 1) : tokens[index + 1] ?? '';
    if (/^\s*["']?changebudget(?:\.[a-z0-9_-]+)?(?:\s|$)/i.test(command.replace(/^["']/, ''))) return true;
  }
  return false;
}

type NpmWrapperInvocation =
  | { readonly kind: 'not-wrapper' }
  | { readonly kind: 'unrelated' }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'candidate'; readonly canonicalArgs: readonly string[]; readonly wrapper: 'npm-exec' | 'npx' };

function parseNpmExecInvocation(tokens: readonly string[]): NpmWrapperInvocation {
  if (tokens[0]?.toLowerCase() !== 'npm' || tokens[1]?.toLowerCase() !== 'exec') {
    return { kind: 'not-wrapper' };
  }
  const separatorIndex = tokens.indexOf('--', 2);
  const wrapperTokens = separatorIndex >= 0 ? tokens.slice(0, separatorIndex) : tokens;
  if (hasChangeBudgetCall(wrapperTokens)) return { kind: 'ambiguous' };
  const targetIndex = separatorIndex >= 0
    ? separatorIndex + 1
    : firstWrapperTargetIndex(tokens, 2, NPM_EXEC_OPTIONS_WITH_VALUE);
  if (targetIndex === null || targetIndex < 0 || !isPlausibleBareName(tokens[targetIndex] ?? '')) {
    return { kind: 'unrelated' };
  }
  if (separatorIndex !== 2 || targetIndex !== 3 || tokens[targetIndex] !== PACKAGE_NAME) {
    return { kind: 'ambiguous' };
  }
  return { kind: 'candidate', canonicalArgs: tokens.slice(targetIndex + 1), wrapper: 'npm-exec' };
}

function parseNpxInvocation(tokens: readonly string[]): NpmWrapperInvocation {
  if (tokens[0]?.toLowerCase() !== 'npx') return { kind: 'not-wrapper' };
  if (hasChangeBudgetCall(tokens.slice(0, 3))) return { kind: 'ambiguous' };
  if (!isPlausibleBareName(tokens[1] ?? '')) {
    const targetIndex = firstWrapperTargetIndex(tokens, 1, NPX_OPTIONS_WITH_VALUE);
    return targetIndex !== null && isPlausibleBareName(tokens[targetIndex] ?? '')
      ? { kind: 'ambiguous' }
      : { kind: 'unrelated' };
  }
  if (tokens[1] !== PACKAGE_NAME) return { kind: 'ambiguous' };
  return { kind: 'candidate', canonicalArgs: tokens.slice(2), wrapper: 'npx' };
}

function normalizeNpmExec(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage,
  wellFormed: boolean,
): FirstPartyIdentityResolution | null {
  const invocation = parseNpmExecInvocation(tokens);
  if (invocation.kind === 'not-wrapper') return null;
  if (invocation.kind === 'unrelated') return { identity: 'unrelated' };
  if (invocation.kind === 'ambiguous') return { identity: 'ambiguous' };
  if (!hasVerifiedBareNpmLauncher('npm', context)) return { identity: 'ambiguous' };
  if (npmBinShimForWorkingDirectory(context, packageInfo) === null) return { identity: 'ambiguous' };
  const shim = resolve(packageInfo.binDirectory!, PACKAGE_NAME + (process.platform === 'win32' ? '.cmd' : ''));
  if (!isNpmGeneratedShim(shim, packageInfo, context)) return { identity: 'ambiguous' };
  return firstParty(invocation.canonicalArgs, wellFormed, 'wrapped', 'npm-exec');
}

function normalizeNpx(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage,
  wellFormed: boolean,
): FirstPartyIdentityResolution | null {
  const invocation = parseNpxInvocation(tokens);
  if (invocation.kind === 'not-wrapper') return null;
  if (invocation.kind === 'unrelated') return { identity: 'unrelated' };
  if (invocation.kind === 'ambiguous') return { identity: 'ambiguous' };
  if (!hasVerifiedBareNpmLauncher('npx', context)) return { identity: 'ambiguous' };
  if (npmBinShimForWorkingDirectory(context, packageInfo) === null) return { identity: 'ambiguous' };
  const shim = resolve(packageInfo.binDirectory!, PACKAGE_NAME + (process.platform === 'win32' ? '.cmd' : ''));
  if (!isNpmGeneratedShim(shim, packageInfo, context)) return { identity: 'ambiguous' };
  return firstParty(invocation.canonicalArgs, wellFormed, 'wrapped', 'npx');
}

/**
 * Resolve only ChangeBudget's own CLI identities using its canonical package
 * manifest/bin and narrowly verified npm shims. This is not a general resolver.
 * OUT_OF_SCOPE_EXECUTION_CHAINS: arbitrary user-authored wrappers/interpreters
 * are not followed; an unproven identity remains ambiguous.
 */
export function resolveFirstPartyChangeBudgetIdentity(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
  wellFormed = true,
): FirstPartyIdentityResolution {
  const packageInfo = verifyPackage(context);
  if (packageInfo === null) {
    const executable = tokens[0]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
    if (isPlausibleBareName(executable)) return { identity: 'ambiguous' };
    if (/^npm$/i.test(executable) && tokens[1]?.toLowerCase() === 'exec') {
      const separatorIndex = tokens.indexOf('--', 2);
      const targetIndex = separatorIndex >= 0
        ? separatorIndex + 1
        : firstWrapperTargetIndex(tokens, 2, NPM_EXEC_OPTIONS_WITH_VALUE);
      return targetIndex !== null && isPlausibleBareName(tokens[targetIndex] ?? '')
        ? { identity: 'ambiguous' }
        : { identity: 'unrelated' };
    }
    if (/^npx$/i.test(executable)) {
      const targetIndex = firstWrapperTargetIndex(tokens, 1, NPX_OPTIONS_WITH_VALUE);
      return isPlausibleBareName(tokens[1] ?? '') || (targetIndex !== null
        && isPlausibleBareName(tokens[targetIndex] ?? ''))
        ? { identity: 'ambiguous' }
        : { identity: 'unrelated' };
    }
    return { identity: 'unrelated' };
  }

  const nodeInvocation = normalizeNodeInvocation(tokens, context, packageInfo, wellFormed);
  if (nodeInvocation !== null) return nodeInvocation;

  const npmStart = normalizeNpmStart(tokens, context, packageInfo, wellFormed);
  if (npmStart !== null) return npmStart;

  const npmExec = normalizeNpmExec(tokens, context, packageInfo, wellFormed);
  if (npmExec !== null) return npmExec;

  const npx = normalizeNpx(tokens, context, packageInfo, wellFormed);
  if (npx !== null) return npx;

  const executable = tokens[0];
  if (executable === undefined) return { identity: 'unrelated' };
  return resolveDirectExecutable(executable, tokens.slice(1), context, packageInfo, wellFormed)
    ?? { identity: 'unrelated' };
}

export type DenialOnlyCanonicalInvocation =
  | { readonly kind: 'canonical-cli'; readonly canonicalArgv: readonly string[] }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous' };

interface StructuralExecutableCandidate {
  readonly path: string;
  readonly root: string;
  readonly candidatePaths: readonly string[];
}

function firstPathExecutableCandidates(
  executable: 'node' | 'npm' | 'npx',
  context: FirstPartyIdentityContext,
): StructuralExecutableCandidate | null {
  const candidates = firstBarePathCandidates(executable, context);
  if (candidates === null || candidates.length === 0) return null;
  const expectedName = process.platform === 'win32'
    ? `${executable}${executable === 'node' ? '.exe' : '.cmd'}`
    : executable;
  const selectedPath = candidates.find((candidate) => basenamePortable(candidate) === expectedName);
  if (selectedPath === undefined) return null;
  const resolved = candidates.map((candidate) => {
    try {
      const stat = lstatSync(candidate);
      if (!stat.isFile() || stat.isSymbolicLink()) return null;
    } catch {
      return null;
    }
    const realpath = strictRealpath(candidate);
    const root = strictRealpath(dirname(candidate));
    return realpath === null || root === null || dirname(realpath) !== root
      ? null
      : { path: candidate, root };
  });
  if (resolved.some((candidate) => candidate === null)) return null;
  const roots = new Set(resolved.map((candidate) => candidate!.root));
  if (roots.size !== 1) return null;
  const selected = resolved.find((candidate) => candidate?.path === selectedPath);
  if (selected === undefined || selected === null) return null;
  return {
    ...selected,
    candidatePaths: candidates,
  };
}

function structurallyVerifiedNodeInstallation(
  context: FirstPartyIdentityContext,
): {
  readonly root: string;
  readonly node: StructuralExecutableCandidate;
} | null {
  const node = firstPathExecutableCandidates('node', context);
  const npm = firstPathExecutableCandidates('npm', context);
  const npx = firstPathExecutableCandidates('npx', context);
  if (node === null || npm === null || npx === null
    || npm.root !== node.root || npx.root !== node.root
    || npmCliFromLauncherAtNodePath(npm.path, 'npm', node.path) === null
    || npmCliFromLauncherAtNodePath(npx.path, 'npx', node.path) === null
    || !npm.candidatePaths.every((path) => verifiedNpmLauncherWithNodePath(path, 'npm', node.path))
    || !npx.candidatePaths.every((path) => verifiedNpmLauncherWithNodePath(path, 'npx', node.path))) return null;
  return { root: node.root, node };
}

function canonicalNodeScriptIndex(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
): number | null | 'ambiguous' {
  if (tokens.length < 2 || !isNodeCommandSpelling(tokens[0] ?? '')) return null;
  const scriptIndex = tokens[1] === '--enable-source-maps' ? 2 : 1;
  const scriptToken = tokens[scriptIndex]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
  const canonicalTargetRelation = (candidate: string): 'exact' | 'related' | 'none' => {
    const normalizedCandidate = candidate.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (normalizedCandidate.length === 0 || /[\0\r\n]/.test(normalizedCandidate)
      || normalizedCandidate.startsWith('-') || !isAbsolute(context.workingDirectory)) return 'none';
    const invokedPath = resolve(context.workingDirectory, normalizedCandidate.replace(/[\\/]/g, sep));
    if (normalizedPath(invokedPath) === normalizedPath(context.canonicalCliEntryPath)) return 'exact';
    const invokedRealpath = strictRealpath(invokedPath);
    const canonicalRealpath = strictRealpath(context.canonicalCliEntryPath);
    return invokedRealpath !== null && canonicalRealpath !== null && invokedRealpath === canonicalRealpath
      ? 'related'
      : 'none';
  };

  if (scriptToken.length === 0 || /[\0\r\n]/.test(scriptToken)) return 'ambiguous';
  if (scriptToken.startsWith('-')) {
    // Node accepts a large and version-dependent option set. Do not parse it
    // here: only treat an option-bearing invocation as pertinent uncertainty
    // when another argv token names this canonical CLI entry (or its alias).
    // This keeps unrelated Node scripts with options out of the DENY-only path.
    return tokens.slice(scriptIndex + 1).some((candidate) => canonicalTargetRelation(candidate) !== 'none')
      ? 'ambiguous'
      : null;
  }
  const targetRelation = canonicalTargetRelation(scriptToken);
  if (targetRelation === 'none') return null;
  if (targetRelation === 'related') return 'ambiguous';
  return scriptIndex;
}

function structurallyResolveNodeInvocation(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage | null,
  wellFormed: boolean,
): DenialOnlyCanonicalInvocation {
  const scriptIndex = canonicalNodeScriptIndex(tokens, context);
  if (scriptIndex === null) return { kind: 'none' };
  if (scriptIndex === 'ambiguous' || packageInfo === null || !wellFormed) return { kind: 'ambiguous' };
  const invokedPath = resolve(context.workingDirectory,
    (tokens[scriptIndex] ?? '').trim().replace(/^(['"])(.*)\1$/, '$2').replace(/[\\/]/g, sep));
  const invokedRealpath = strictRealpath(invokedPath);
  // The executable is intentionally not attested here. For this DENY-only
  // result, the canonical package and exact CLI target establish intent; the
  // ordinary identity resolver above still requires its existing Node anchor
  // before any permissive classification can occur.
  if (invokedRealpath === null || invokedRealpath !== packageInfo.cliEntry) return { kind: 'ambiguous' };
  return { kind: 'canonical-cli', canonicalArgv: canonicalArgv(tokens.slice(scriptIndex + 1)) };
}

function structurallyResolveShimInvocation(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage | null,
  wellFormed: boolean,
): DenialOnlyCanonicalInvocation {
  const executableToken = tokens[0]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
  const isBareShim = isPlausibleBareName(executableToken);
  const isRelativeBin = /^\.([/\\])node_modules\1\.bin\1changebudget(?:\.[a-z0-9_-]+)?$/i.test(executableToken);
  const isAbsolutePath = isAbsoluteExecutable(executableToken);
  if (!isBareShim && !isRelativeBin && !isAbsolutePath) return { kind: 'none' };
  if (packageInfo === null) return { kind: 'ambiguous' };

  if (isBareShim) {
    if (process.platform !== 'win32' && executableToken !== PACKAGE_NAME) return { kind: 'ambiguous' };
    const pathValue = context.pathValue ?? process.env.PATH ?? '';
    const directories = pathValue.split(delimiter).map((entry) => (
      entry.length === 0 ? context.workingDirectory : isAbsolute(entry) ? entry : resolve(context.workingDirectory, entry)
    ));
    if (process.platform === 'win32' && isAbsolute(context.workingDirectory)
      && candidatesInDirectory(context.workingDirectory, executableToken).length > 0) return { kind: 'ambiguous' };
    for (const directory of directories) {
      const candidates = candidatesInDirectory(directory, executableToken);
      if (candidates.length === 0) continue;
      if (candidates.every((candidate) => isNpmGeneratedShimStructure(candidate, packageInfo))) {
        return wellFormed
          ? { kind: 'canonical-cli', canonicalArgv: canonicalArgv(tokens.slice(1)) }
          : { kind: 'ambiguous' };
      }
      return { kind: 'ambiguous' };
    }
    return { kind: 'ambiguous' };
  }

  if (packageInfo.binDirectory === null) return isRelativeBin ? { kind: 'ambiguous' } : { kind: 'none' };
  const candidatePath = isAbsolutePath
    ? resolve(executableToken)
    : resolve(context.workingDirectory, executableToken.replace(/[\\/]/g, sep));
  const canonicalCandidates = supportedShimPaths(packageInfo);
  if (canonicalCandidates.some((known) => normalizedPath(known) === normalizedPath(candidatePath))) {
    if (!isNpmGeneratedShimStructure(candidatePath, packageInfo)) return { kind: 'ambiguous' };
    return wellFormed
      ? { kind: 'canonical-cli', canonicalArgv: canonicalArgv(tokens.slice(1)) }
      : { kind: 'ambiguous' };
  }
  if (normalizedPath(dirname(candidatePath)) === normalizedPath(packageInfo.binDirectory)
    && /^changebudget(?:\.[a-z0-9_-]+)?$/i.test(candidatePath.slice(dirname(candidatePath).length + 1))) {
    return { kind: 'ambiguous' };
  }
  return { kind: 'none' };
}

function structurallyResolveNpmWrapper(
  context: FirstPartyIdentityContext,
  packageInfo: VerifiedPackage | null,
  wellFormed: boolean,
  invocation: NpmWrapperInvocation,
): DenialOnlyCanonicalInvocation {
  if (invocation.kind === 'not-wrapper' || invocation.kind === 'unrelated') return { kind: 'none' };
  if (invocation.kind === 'ambiguous' || packageInfo === null || !wellFormed) return { kind: 'ambiguous' };
  const installation = structurallyVerifiedNodeInstallation(context);
  if (installation === null || packageInfo.binDirectory === null
    || npmBinShimForWorkingDirectory(context, packageInfo) === null) return { kind: 'ambiguous' };
  const shim = resolve(packageInfo.binDirectory, PACKAGE_NAME + (process.platform === 'win32' ? '.cmd' : ''));
  if (!isNpmGeneratedShimStructure(shim, packageInfo)) return { kind: 'ambiguous' };
  return { kind: 'canonical-cli', canonicalArgv: canonicalArgv(invocation.canonicalArgs) };
}

/**
 * Read-only structural proof for the narrow denial-only classification path.
 * It never confers first-party identity: the ordinary resolver above remains
 * the sole source of permissive identity, including its host-interpreter check.
 */
export function resolveCanonicalChangeBudgetInvocationForDenial(
  tokens: readonly string[],
  context: FirstPartyIdentityContext,
  wellFormed = true,
): DenialOnlyCanonicalInvocation {
  if (tokens.length === 0) return { kind: 'none' };
  const packageInfo = verifyPackageForDenial(context);
  if (isNodeCommandSpelling(tokens[0] ?? '')) {
    return structurallyResolveNodeInvocation(tokens, context, packageInfo, wellFormed);
  }
  const npmExec = parseNpmExecInvocation(tokens);
  if (npmExec.kind !== 'not-wrapper') {
    return structurallyResolveNpmWrapper(context, packageInfo, wellFormed, npmExec);
  }
  const npx = parseNpxInvocation(tokens);
  if (npx.kind !== 'not-wrapper') {
    return structurallyResolveNpmWrapper(context, packageInfo, wellFormed, npx);
  }
  return structurallyResolveShimInvocation(tokens, context, packageInfo, wellFormed);
}
