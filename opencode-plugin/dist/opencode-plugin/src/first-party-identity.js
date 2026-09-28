import { accessSync, constants, existsSync, lstatSync, readFileSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path';
const PACKAGE_NAME = 'changebudget';
const CLI_RELATIVE_PATH = join('dist', 'src', 'cli', 'index.js');
const NPM_START_SCRIPT = 'node dist/src/cli/index.js';
const WINDOWS_SHIM_EXTENSIONS = ['', '.cmd', '.ps1'];
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
function normalizedPath(value) {
    const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' || /^[A-Za-z]:\//.test(normalized)
        ? normalized.toLowerCase()
        : normalized;
}
function strictRealpath(value) {
    try {
        return normalizedPath(realpathSync(value));
    }
    catch {
        return null;
    }
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function verifyPackage(context) {
    if (!isAbsolute(context.packageRoot) || !isAbsolute(context.canonicalCliEntryPath))
        return null;
    const packageRoot = strictRealpath(context.packageRoot);
    const cliEntry = strictRealpath(context.canonicalCliEntryPath);
    const packageJsonPath = resolve(context.packageRoot, 'package.json');
    const packageJson = strictRealpath(packageJsonPath);
    if (packageRoot === null || cliEntry === null || packageJson === null
        || normalizedPath(dirname(packageJson)) !== packageRoot)
        return null;
    try {
        const metadata = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
        if (!isRecord(metadata) || metadata.name !== PACKAGE_NAME)
            return null;
        const bin = metadata.bin;
        if (!isRecord(bin) || bin[PACKAGE_NAME] !== CLI_RELATIVE_PATH.replace(/\\/g, '/'))
            return null;
        const expectedCli = resolve(context.packageRoot, CLI_RELATIVE_PATH);
        if (normalizedPath(expectedCli) !== normalizedPath(context.canonicalCliEntryPath)
            || strictRealpath(expectedCli) !== cliEntry)
            return null;
        const packageDirectory = dirname(packageRoot);
        const isInstalledNodeModule = basenamePortable(packageRoot) === PACKAGE_NAME
            && basenamePortable(packageDirectory) === 'node_modules';
        return {
            root: packageRoot,
            cliEntry,
            binDirectory: isInstalledNodeModule ? resolve(packageDirectory, '.bin') : null,
        };
    }
    catch {
        return null;
    }
}
function basenamePortable(value) {
    return value.replace(/\\/g, '/').replace(/\/$/, '').split('/').at(-1)?.toLowerCase() ?? '';
}
function supportedShimPaths(packageInfo) {
    if (packageInfo.binDirectory === null)
        return [];
    const extensions = process.platform === 'win32' ? WINDOWS_SHIM_EXTENSIONS : [''];
    return extensions.map((extension) => resolve(packageInfo.binDirectory, `${PACKAGE_NAME}${extension}`));
}
function isNpmGeneratedShim(shimPath, packageInfo, context) {
    if (!supportedShimPaths(packageInfo).some((known) => normalizedPath(known) === normalizedPath(shimPath))) {
        return false;
    }
    const binDirectory = packageInfo.binDirectory;
    if (binDirectory === null || strictRealpath(binDirectory) !== normalizedPath(binDirectory))
        return false;
    const invokedCli = resolve(binDirectory, '..', PACKAGE_NAME, CLI_RELATIVE_PATH);
    if (normalizedPath(invokedCli) !== packageInfo.cliEntry || strictRealpath(invokedCli) !== packageInfo.cliEntry) {
        return false;
    }
    try {
        const stat = lstatSync(shimPath);
        if (process.platform !== 'win32' && stat.isSymbolicLink()) {
            // POSIX npm installs a relative .bin symlink, not a generated shell wrapper.
            // Prove the exact npm target and the Node interpreter selected by its shebang.
            return readlinkSync(shimPath) === join('..', PACKAGE_NAME, CLI_RELATIVE_PATH)
                && strictRealpath(shimPath) === packageInfo.cliEntry
                && statSync(shimPath).size <= 64 * 1024
                && readFileSync(shimPath, 'utf8').startsWith('#!/usr/bin/env node\n')
                && isNodeExecutable('node', context);
        }
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024)
            return false;
        if (process.platform !== 'win32')
            accessSync(shimPath, constants.X_OK);
        if (strictRealpath(shimPath) !== normalizedPath(shimPath))
            return false;
        const extension = extname(shimPath).toLowerCase();
        const contents = readFileSync(shimPath, 'utf8').replace(/\r\n?/g, '\n');
        if (extension === '') {
            return contents === POSIX_CHANGE_BUDGET_SHIM && changeBudgetShimNodeVerified(shimPath, context);
        }
        if (extension === '.cmd') {
            return contents === WINDOWS_CMD_CHANGE_BUDGET_SHIM && changeBudgetShimNodeVerified(shimPath, context);
        }
        if (extension === '.ps1') {
            return contents === WINDOWS_PS1_CHANGE_BUDGET_SHIM && changeBudgetShimNodeVerified(shimPath, context);
        }
        return false;
    }
    catch {
        return false;
    }
}
function npmBinShimForWorkingDirectory(context, packageInfo) {
    if (!isAbsolute(context.workingDirectory) || packageInfo.binDirectory === null)
        return null;
    const localBinDirectory = resolve(context.workingDirectory, 'node_modules', '.bin');
    return strictRealpath(localBinDirectory) === normalizedPath(packageInfo.binDirectory)
        ? packageInfo.binDirectory
        : null;
}
function canonicalArgv(args) {
    return [PACKAGE_NAME, ...args];
}
function firstParty(args, wellFormed, invocation = 'direct', wrapper) {
    if (!wellFormed)
        return { identity: 'ambiguous' };
    return {
        identity: 'first-party',
        invocation,
        ...(wrapper === undefined ? {} : { wrapper }),
        canonicalArgv: canonicalArgv(args),
    };
}
function isAbsoluteExecutable(value) {
    return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}
function isPlausibleBareName(value) {
    return /^changebudget(?:\.[a-z0-9_-]+)?$/i.test(value);
}
function pathCandidateNames(requestedName) {
    if (extname(requestedName).length > 0)
        return [requestedName];
    return process.platform === 'win32'
        ? WINDOWS_EXECUTABLE_SUFFIXES.map((extension) => `${PACKAGE_NAME}${extension}`)
        : [PACKAGE_NAME];
}
function candidatesInDirectory(directory, requestedName) {
    return pathCandidateNames(requestedName).map((name) => resolve(directory, name)).filter(existsSync);
}
function findBarePathTarget(requestedName, context, packageInfo) {
    if (process.platform !== 'win32' && requestedName !== PACKAGE_NAME)
        return 'ambiguous';
    const pathValue = context.pathValue ?? process.env.PATH ?? '';
    const directories = pathValue.split(delimiter).map((entry) => (entry.length === 0 ? context.workingDirectory : isAbsolute(entry) ? entry : resolve(context.workingDirectory, entry)));
    if (process.platform === 'win32' && isAbsolute(context.workingDirectory)) {
        // Windows searches the working directory before PATH. Such a hit means
        // PATH did not prove the token's target, so preserve ambiguity.
        if (candidatesInDirectory(context.workingDirectory, requestedName).length > 0)
            return 'ambiguous';
    }
    for (const directory of directories) {
        const candidates = candidatesInDirectory(directory, requestedName);
        if (candidates.length === 0)
            continue;
        return candidates.every((candidate) => isNpmGeneratedShim(candidate, packageInfo, context))
            ? 'first-party'
            : 'ambiguous';
    }
    return 'ambiguous';
}
function resolveDirectExecutable(executableToken, args, context, packageInfo, wellFormed) {
    const executable = executableToken.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (isPlausibleBareName(executable)) {
        const resolution = findBarePathTarget(executable, context, packageInfo);
        return resolution === 'first-party'
            ? firstParty(args, wellFormed)
            : { identity: 'ambiguous' };
    }
    let candidatePath = null;
    let relativeBinInvocation = false;
    if (isAbsoluteExecutable(executable)) {
        candidatePath = resolve(executable);
    }
    else if (/^\.([/\\])node_modules\1\.bin\1changebudget(?:\.[a-z0-9_-]+)?$/i.test(executable)) {
        relativeBinInvocation = true;
        candidatePath = resolve(context.workingDirectory, executable.replace(/[\\/]/g, sep));
    }
    else {
        return null;
    }
    if (packageInfo.binDirectory === null) {
        return relativeBinInvocation ? { identity: 'ambiguous' } : { identity: 'unrelated' };
    }
    const canonicalCandidates = supportedShimPaths(packageInfo);
    if (canonicalCandidates.some((known) => normalizedPath(known) === normalizedPath(candidatePath))) {
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
function bareLauncherNames(requestedName) {
    if (process.platform !== 'win32' || extname(requestedName).length > 0)
        return [requestedName];
    return WINDOWS_EXECUTABLE_SUFFIXES.map((extension) => `${requestedName}${extension}`);
}
function executableFilesInDirectory(directory, requestedName) {
    const candidates = [];
    for (const name of bareLauncherNames(requestedName)) {
        const candidate = resolve(directory, name);
        try {
            if (!statSync(candidate).isFile())
                continue;
            if (process.platform !== 'win32')
                accessSync(candidate, constants.X_OK);
            candidates.push(candidate);
        }
        catch {
            // Non-executable POSIX files do not win PATH lookup; inaccessible files
            // cannot serve as identity proof.
        }
    }
    return candidates;
}
function firstBarePathCandidates(requestedName, context) {
    if (!isAbsolute(context.workingDirectory))
        return null;
    const pathValue = context.pathValue ?? process.env.PATH ?? '';
    const pathDirectories = pathValue.split(delimiter).map((entry) => (entry.length === 0 ? context.workingDirectory
        : isAbsolute(entry) ? entry : resolve(context.workingDirectory, entry)));
    const directories = process.platform === 'win32'
        ? [context.workingDirectory, ...pathDirectories]
        : pathDirectories;
    for (const directory of directories) {
        const candidates = executableFilesInDirectory(directory, requestedName);
        if (candidates.length > 0)
            return candidates;
    }
    return null;
}
function shellQuote(value) {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}
function npmCliFromLauncher(launcherPath, executable) {
    const processNode = strictRealpath(process.execPath);
    if (processNode === null)
        return null;
    const trustedNodeRoot = dirname(processNode);
    const launcherDirectory = dirname(launcherPath);
    const expectedLauncher = resolve(trustedNodeRoot, `${executable}${process.platform === 'win32' ? '.cmd' : ''}`);
    if (normalizedPath(launcherDirectory) !== normalizedPath(trustedNodeRoot)
        || strictRealpath(launcherDirectory) !== normalizedPath(trustedNodeRoot)
        || normalizedPath(launcherPath) !== normalizedPath(expectedLauncher))
        return null;
    const npmRoot = resolve(trustedNodeRoot, 'node_modules', 'npm');
    const manifestPath = resolve(npmRoot, 'package.json');
    const npmRootRealpath = strictRealpath(npmRoot);
    const manifestRealpath = strictRealpath(manifestPath);
    if (npmRootRealpath !== normalizedPath(npmRoot) || manifestRealpath === null
        || normalizedPath(dirname(manifestRealpath)) !== npmRootRealpath)
        return null;
    try {
        const metadata = JSON.parse(readFileSync(manifestPath, 'utf8'));
        const cliRelativePath = `bin/${executable}-cli.js`;
        if (!isRecord(metadata) || metadata.name !== 'npm' || !isRecord(metadata.bin)
            || metadata.bin[executable] !== cliRelativePath)
            return null;
        const cliPath = resolve(npmRoot, cliRelativePath);
        return strictRealpath(cliPath) === normalizedPath(cliPath) ? cliPath : null;
    }
    catch {
        return null;
    }
}
function verifiedNpmLauncher(launcherPath, executable) {
    try {
        const stat = lstatSync(launcherPath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024
            || strictRealpath(launcherPath) !== normalizedPath(launcherPath))
            return false;
        const extension = extname(launcherPath).toLowerCase();
        if ((process.platform === 'win32' && extension !== '.cmd')
            || (process.platform !== 'win32' && extension !== ''))
            return false;
        const cliPath = npmCliFromLauncher(launcherPath, executable);
        const nodePath = strictRealpath(process.execPath);
        if (cliPath === null || nodePath === null)
            return false;
        const contents = readFileSync(launcherPath, 'utf8').replace(/\r\n?/g, '\n');
        if (process.platform === 'win32') {
            const commandPaths = [process.execPath, cliPath];
            if (commandPaths.some((path) => /[%!\r\n"]/.test(path)))
                return false;
            return contents === `@ECHO off\n"${process.execPath}" "${cliPath}" %*\n`;
        }
        if ([process.execPath, cliPath].some((path) => /[\0\r\n]/.test(path)))
            return false;
        return contents === `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(cliPath)} "$@"\n`;
    }
    catch {
        return false;
    }
}
function hasVerifiedBareNpmLauncher(executable, context) {
    const candidates = firstBarePathCandidates(executable, context);
    return candidates !== null && candidates.every((candidate) => verifiedNpmLauncher(candidate, executable));
}
function isNodeCommandSpelling(value) {
    const executable = value.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (/^node(?:\.exe)?$/i.test(executable))
        return true;
    return isAbsoluteExecutable(executable)
        && (strictRealpath(executable) === strictRealpath(process.execPath)
            || /^node(?:\.exe)?$/i.test(basenamePortable(executable)));
}
function isNodeExecutable(value, context) {
    const executable = value.trim().replace(/^(['"])(.*)\1$/, '$2');
    const processNode = strictRealpath(process.execPath);
    if (processNode === null)
        return false;
    if (isAbsoluteExecutable(executable))
        return strictRealpath(executable) === processNode;
    if (!/^node(?:\.exe)?$/i.test(executable))
        return false;
    const candidates = firstBarePathCandidates(executable, context);
    return candidates !== null
        && candidates.every((candidate) => strictRealpath(candidate) === processNode);
}
function changeBudgetShimNodeVerified(shimPath, context) {
    const extension = extname(shimPath).toLowerCase();
    const localNodeName = process.platform === 'win32' && extension !== '' ? 'node.exe' : 'node';
    const localNode = resolve(dirname(shimPath), localNodeName);
    const localBranchSelected = process.platform === 'win32'
        ? existsSync(localNode)
        : (() => {
            try {
                accessSync(localNode, constants.X_OK);
                return true;
            }
            catch {
                return false;
            }
        })();
    if (localBranchSelected)
        return strictRealpath(localNode) === strictRealpath(process.execPath);
    const fallbackName = process.platform === 'win32' && extension === '.ps1' ? 'node.exe' : 'node';
    return isNodeExecutable(fallbackName, context);
}
function npmLifecycleNodeVerified(context) {
    if (!isAbsolute(context.workingDirectory))
        return false;
    const processNode = strictRealpath(process.execPath);
    if (processNode === null)
        return false;
    let directory = resolve(context.workingDirectory);
    while (true) {
        const lifecycleBin = resolve(directory, 'node_modules', '.bin');
        const candidates = executableFilesInDirectory(lifecycleBin, 'node');
        if (candidates.length > 0
            && !candidates.every((candidate) => strictRealpath(candidate) === processNode))
            return false;
        const parent = dirname(directory);
        if (parent === directory)
            break;
        directory = parent;
    }
    return isNodeExecutable('node', context);
}
function normalizeNodeInvocation(tokens, context, packageInfo, wellFormed) {
    if (tokens.length < 2 || !isNodeCommandSpelling(tokens[0] ?? ''))
        return null;
    const scriptIndex = tokens[1] === '--enable-source-maps' ? 2 : 1;
    const scriptToken = tokens[scriptIndex]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
    if (scriptToken.length === 0 || /[\0\r\n]/.test(scriptToken) || scriptToken.startsWith('-'))
        return null;
    if (!isAbsolute(context.workingDirectory))
        return null;
    const invokedPath = resolve(context.workingDirectory, scriptToken.replace(/[\\/]/g, sep));
    if (normalizedPath(invokedPath) !== normalizedPath(context.canonicalCliEntryPath))
        return null;
    if (!isNodeExecutable(tokens[0] ?? '', context))
        return { identity: 'ambiguous' };
    const invokedRealpath = strictRealpath(invokedPath);
    if (invokedRealpath === null)
        return { identity: 'ambiguous' };
    if (invokedRealpath !== packageInfo.cliEntry)
        return { identity: 'ambiguous' };
    return firstParty(tokens.slice(scriptIndex + 1), wellFormed);
}
function canonicalPackageNpmStart(context, packageInfo) {
    if (!isAbsolute(context.workingDirectory))
        return false;
    const lexicalRootMatch = normalizedPath(context.workingDirectory) === packageInfo.root;
    const workingDirectory = strictRealpath(context.workingDirectory);
    if (lexicalRootMatch && workingDirectory === null)
        return 'ambiguous';
    if (workingDirectory !== packageInfo.root)
        return false;
    try {
        const metadata = JSON.parse(readFileSync(resolve(context.packageRoot, 'package.json'), 'utf8'));
        if (!isRecord(metadata) || !isRecord(metadata.scripts))
            return false;
        return metadata.scripts.start === NPM_START_SCRIPT;
    }
    catch {
        return false;
    }
}
function normalizeNpmStart(tokens, context, packageInfo, wellFormed) {
    let argumentIndex;
    if (tokens[0]?.toLowerCase() === 'npm' && tokens[1]?.toLowerCase() === 'start'
        && tokens[2] === '--' && tokens[3] === 'recover' && tokens[4] === 'lifecycle-lock') {
        argumentIndex = 3;
    }
    else if (tokens[0]?.toLowerCase() === 'npm' && tokens[1]?.toLowerCase() === 'run'
        && tokens[2]?.toLowerCase() === 'start' && tokens[3] === '--'
        && tokens[4] === 'recover' && tokens[5] === 'lifecycle-lock') {
        argumentIndex = 4;
    }
    else {
        return null;
    }
    const packageMatch = canonicalPackageNpmStart(context, packageInfo);
    if (packageMatch === 'ambiguous')
        return { identity: 'ambiguous' };
    if (!packageMatch)
        return null;
    if (!hasVerifiedBareNpmLauncher('npm', context) || !npmLifecycleNodeVerified(context)) {
        return { identity: 'ambiguous' };
    }
    return firstParty(tokens.slice(argumentIndex), wellFormed);
}
const NPM_EXEC_OPTIONS_WITH_VALUE = new Set(['--call', '-c', '--package', '-p', '--workspace', '-w']);
const NPX_OPTIONS_WITH_VALUE = new Set(['--package', '-p']);
function firstWrapperTargetIndex(tokens, startIndex, optionsWithValue) {
    for (let index = startIndex; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token === '--')
            return index + 1 < tokens.length ? index + 1 : null;
        if (!token.startsWith('-') || token === '-')
            return index;
        const option = token.split('=', 1)[0].toLowerCase();
        if (optionsWithValue.has(option) && !token.includes('=')) {
            if (index + 1 >= tokens.length)
                return null;
            index += 1;
        }
    }
    return null;
}
function hasChangeBudgetCall(tokens) {
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const option = token.split('=', 1)[0].toLowerCase();
        if (!['--call', '-c'].includes(option))
            continue;
        const command = token.includes('=') ? token.slice(token.indexOf('=') + 1) : tokens[index + 1] ?? '';
        if (/^\s*["']?changebudget(?:\.[a-z0-9_-]+)?(?:\s|$)/i.test(command.replace(/^["']/, '')))
            return true;
    }
    return false;
}
function normalizeNpmExec(tokens, context, packageInfo, wellFormed) {
    if (tokens[0]?.toLowerCase() !== 'npm' || tokens[1]?.toLowerCase() !== 'exec')
        return null;
    const separatorIndex = tokens.indexOf('--', 2);
    const wrapperTokens = separatorIndex >= 0 ? tokens.slice(0, separatorIndex) : tokens;
    if (hasChangeBudgetCall(wrapperTokens))
        return { identity: 'ambiguous' };
    const targetIndex = separatorIndex >= 0
        ? separatorIndex + 1
        : firstWrapperTargetIndex(tokens, 2, NPM_EXEC_OPTIONS_WITH_VALUE);
    if (targetIndex === null || targetIndex < 0 || !isPlausibleBareName(tokens[targetIndex] ?? '')) {
        return { identity: 'unrelated' };
    }
    if (separatorIndex !== 2 || targetIndex !== 3 || tokens[targetIndex] !== PACKAGE_NAME) {
        return { identity: 'ambiguous' };
    }
    if (!hasVerifiedBareNpmLauncher('npm', context))
        return { identity: 'ambiguous' };
    if (npmBinShimForWorkingDirectory(context, packageInfo) === null)
        return { identity: 'ambiguous' };
    const shim = resolve(packageInfo.binDirectory, PACKAGE_NAME + (process.platform === 'win32' ? '.cmd' : ''));
    if (!isNpmGeneratedShim(shim, packageInfo, context))
        return { identity: 'ambiguous' };
    return firstParty(tokens.slice(targetIndex + 1), wellFormed, 'wrapped', 'npm-exec');
}
function normalizeNpx(tokens, context, packageInfo, wellFormed) {
    if (tokens[0]?.toLowerCase() !== 'npx')
        return null;
    if (hasChangeBudgetCall(tokens.slice(0, 3)))
        return { identity: 'ambiguous' };
    if (!isPlausibleBareName(tokens[1] ?? '')) {
        const targetIndex = firstWrapperTargetIndex(tokens, 1, NPX_OPTIONS_WITH_VALUE);
        return targetIndex !== null && isPlausibleBareName(tokens[targetIndex] ?? '')
            ? { identity: 'ambiguous' }
            : { identity: 'unrelated' };
    }
    if (tokens[1] !== PACKAGE_NAME)
        return { identity: 'ambiguous' };
    if (!hasVerifiedBareNpmLauncher('npx', context))
        return { identity: 'ambiguous' };
    if (npmBinShimForWorkingDirectory(context, packageInfo) === null)
        return { identity: 'ambiguous' };
    const shim = resolve(packageInfo.binDirectory, PACKAGE_NAME + (process.platform === 'win32' ? '.cmd' : ''));
    if (!isNpmGeneratedShim(shim, packageInfo, context))
        return { identity: 'ambiguous' };
    return firstParty(tokens.slice(2), wellFormed, 'wrapped', 'npx');
}
/**
 * Resolve only ChangeBudget's own CLI identities using its canonical package
 * manifest/bin and narrowly verified npm shims. This is not a general resolver.
 * OUT_OF_SCOPE_EXECUTION_CHAINS: arbitrary user-authored wrappers/interpreters
 * are not followed; an unproven identity remains ambiguous.
 */
export function resolveFirstPartyChangeBudgetIdentity(tokens, context, wellFormed = true) {
    const packageInfo = verifyPackage(context);
    if (packageInfo === null) {
        const executable = tokens[0]?.trim().replace(/^(['"])(.*)\1$/, '$2') ?? '';
        if (isPlausibleBareName(executable))
            return { identity: 'ambiguous' };
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
    if (nodeInvocation !== null)
        return nodeInvocation;
    const npmStart = normalizeNpmStart(tokens, context, packageInfo, wellFormed);
    if (npmStart !== null)
        return npmStart;
    const npmExec = normalizeNpmExec(tokens, context, packageInfo, wellFormed);
    if (npmExec !== null)
        return npmExec;
    const npx = normalizeNpx(tokens, context, packageInfo, wellFormed);
    if (npx !== null)
        return npx;
    const executable = tokens[0];
    if (executable === undefined)
        return { identity: 'unrelated' };
    return resolveDirectExecutable(executable, tokens.slice(1), context, packageInfo, wellFormed)
        ?? { identity: 'unrelated' };
}
//# sourceMappingURL=first-party-identity.js.map