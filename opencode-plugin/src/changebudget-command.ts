import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, extname, isAbsolute, resolve } from 'node:path';

export type ChangeBudgetCommandClass =
  | 'read-only'
  | 'managed-mutation'
  | 'force-close'
  | 'external-mutation'
  | 'unsupported';

const CHANGE_BUDGET_EXECUTABLE_NAMES = new Set([
  'changebudget',
  'changebudget.cmd',
  'changebudget.exe',
  'changebudget.ps1',
]);

const SUPPORTED_COMMANDS = new Set([
  'init',
  'start',
  'status',
  'check',
  'close',
  'amend',
  'diagnose',
  'integrate',
  'update',
]);

const CONTRACT_PRESETS = new Set(['tiny', 'normal', 'free', 'custom']);
const STACK_PROFILES = new Set(['android', 'flutter', 'spring-boot', 'node-ts']);
const START_VALUE_OPTIONS = new Set([
  'task',
  'task-description',
  'base-revision',
  'allow-path',
  'allow-paths',
  'deny-path',
  'deny-paths',
  'max-files',
  'max-changed-lines',
  'preset',
  'stack-profile',
  'disable-stack-rule',
  'disable-stack-rules',
  'execution-envelope-json',
]);
const START_BOOLEAN_OPTIONS = new Set([
  'allow-new-files',
  'allow-new-dependencies',
  'allow-migrations',
  'allow-config-changes',
  'allow-public-api-changes',
]);
const READ_ONLY_CHECK_FLAGS = new Set(['json', 'draft']);

function normalizedPath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '');
  return process.platform === 'win32' || /^[A-Za-z]:\//.test(normalized)
    ? normalized.toLowerCase()
    : normalized;
}

function sameFilePath(left: string, right: string): boolean {
  try {
    return normalizedPath(realpathSync(left)) === normalizedPath(realpathSync(right));
  } catch {
    return normalizedPath(resolve(left)) === normalizedPath(resolve(right));
  }
}

function isNpmShimForPackage(shimPath: string, cliEntryPath: string): boolean {
  if (!existsSync(shimPath)) return false;

  const extension = extname(shimPath).toLowerCase();
  if (extension === '.exe') {
    return ['.cmd', '.ps1', '.bat'].some((siblingExtension) => (
      isNpmShimForPackage(shimPath.slice(0, -extension.length) + siblingExtension, cliEntryPath)
    ));
  }

  if (extension === '') return sameFilePath(shimPath, cliEntryPath);
  if (!['.cmd', '.ps1', '.bat'].includes(extension)) return false;

  const shimDirectory = dirname(shimPath);
  const possibleEntries = [
    resolve(shimDirectory, 'node_modules/changebudget/dist/src/cli/index.js'),
    resolve(shimDirectory, '../changebudget/dist/src/cli/index.js'),
  ];
  if (!possibleEntries.some((entry) => sameFilePath(entry, cliEntryPath))) return false;

  try {
    const contents = readFileSync(shimPath, 'utf8').replace(/\\/g, '/').toLowerCase();
    return contents.includes('changebudget') && contents.includes('dist/src/cli/index.js');
  } catch {
    return false;
  }
}

/**
 * Resolve absolute executable paths that are npm shims for this exact installed
 * ChangeBudget package. A path that merely contains the word "changebudget" is
 * never considered sufficient evidence.
 */
export function resolveKnownChangeBudgetExecutables(
  packageRoot: string,
  pathValue = process.env.PATH ?? '',
): string[] {
  const cliEntryPath = resolve(packageRoot, 'dist/src/cli/index.js');
  const executableNames = process.platform === 'win32'
    ? ['changebudget', 'changebudget.cmd', 'changebudget.exe', 'changebudget.ps1']
    : ['changebudget'];
  const candidates = new Set<string>();

  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const executableName of executableNames) {
      const candidate = resolve(directory, executableName);
      if (isNpmShimForPackage(candidate, cliEntryPath)) candidates.add(candidate);
    }
  }

  const inferredDirectories = [
    resolve(packageRoot, '../..'),
    resolve(packageRoot, '../.bin'),
  ];
  for (const directory of inferredDirectories) {
    for (const executableName of executableNames) {
      const candidate = resolve(directory, executableName);
      if (isNpmShimForPackage(candidate, cliEntryPath)) candidates.add(candidate);
    }
  }

  return [...candidates];
}

function isAbsoluteExecutablePath(value: string): boolean {
  return isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function isChangeBudgetExecutable(value: string, knownAbsoluteExecutables: readonly string[]): boolean {
  const executable = value.trim().replace(/^(["'])(.*)\1$/, '$2');
  if (CHANGE_BUDGET_EXECUTABLE_NAMES.has(executable.toLowerCase())) return true;
  if (!isAbsoluteExecutablePath(executable)) return false;
  return knownAbsoluteExecutables.some((known) => normalizedPath(known) === normalizedPath(executable));
}

function parseOption(token: string): { key: string; value: string | null } {
  const equalIndex = token.indexOf('=');
  return {
    key: (equalIndex < 0 ? token.slice(2) : token.slice(2, equalIndex)).toLowerCase().replace(/_/g, '-'),
    value: equalIndex < 0 ? null : token.slice(equalIndex + 1),
  };
}

function takeValue(
  args: readonly string[],
  index: number,
  inlineValue: string | null,
): { value: string; nextIndex: number } | null {
  const value = inlineValue ?? args[index + 1];
  if (value === undefined || value.length === 0 || (inlineValue === null && value.startsWith('--'))) return null;
  return { value, nextIndex: inlineValue === null ? index + 1 : index };
}

function isNonNegativeInteger(value: string): boolean {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0;
}

function isJsonObject(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
  } catch {
    return false;
  }
}

function canonicalizeAmendPath(value: string): string | null {
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/\/+$/, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) return null;
  if (normalized.split('/').some((component) => component === '.' || component === '..')) return null;
  if (/[\0\r\n*?\[\]{}!()]/.test(normalized)) return null;
  const lower = normalized.toLowerCase();
  if (lower === '.changebudget' || lower.startsWith('.changebudget/')) return null;
  return normalized;
}

function validBoolean(value: string | null): boolean {
  return value === null || value.toLowerCase() === 'true' || value.toLowerCase() === 'false';
}

function classifyStatus(args: readonly string[]): ChangeBudgetCommandClass {
  let budget = false;
  let jsonSeen = false;
  let jsonEnabled = false;
  for (const token of args) {
    if (token === '--budget' && !budget) {
      budget = true;
      continue;
    }
    const normalizedToken = token.toLowerCase();
    if ((normalizedToken === '--json' || normalizedToken === '--json=true' || normalizedToken === '--json=false') && !jsonSeen) {
      jsonSeen = true;
      jsonEnabled = normalizedToken !== '--json=false';
      continue;
    }
    return 'unsupported';
  }
  return jsonEnabled && !budget ? 'unsupported' : 'read-only';
}

function classifyDiagnose(args: readonly string[]): ChangeBudgetCommandClass {
  let taskIdSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      if (taskIdSeen || !/^[Tt]\d{3,}$/.test(token)) return 'unsupported';
      taskIdSeen = true;
      continue;
    }

    const { key, value: inlineValue } = parseOption(token);
    if (inlineValue !== null && inlineValue.length === 0) return 'unsupported';
    if (key === 'json') {
      if (!validBoolean(inlineValue)) return 'unsupported';
      continue;
    }
    if (!['task', 'task-description', 'allow-path', 'allow-paths', 'deny-path', 'deny-paths', 'stack-profile'].includes(key)) {
      return 'unsupported';
    }

    const taken = takeValue(args, index, inlineValue);
    if (!taken) return 'unsupported';
    if (key === 'stack-profile' && !STACK_PROFILES.has(taken.value.toLowerCase())) return 'unsupported';
    index = taken.nextIndex;
  }
  return 'read-only';
}

function classifyCheck(args: readonly string[]): ChangeBudgetCommandClass {
  let draftSeen = false;
  let evidenceSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) return 'unsupported';
    const { key, value: inlineValue } = parseOption(token);
    if (key === 'json') {
      if (!validBoolean(inlineValue)) return 'unsupported';
      continue;
    }
    if (!READ_ONLY_CHECK_FLAGS.has(key) && key !== 'satisfaction-evidence-json') return 'unsupported';
    if (key === 'draft' && draftSeen) return 'unsupported';
    if (key === 'satisfaction-evidence-json' && evidenceSeen) return 'unsupported';
    const taken = takeValue(args, index, inlineValue);
    if (!taken) return 'unsupported';
    if (key === 'satisfaction-evidence-json' && !isValidSatisfactionEvidence(taken.value)) return 'unsupported';
    index = taken.nextIndex;
    if (key === 'draft') draftSeen = true;
    if (key === 'satisfaction-evidence-json') evidenceSeen = true;
  }

  if (draftSeen && evidenceSeen) return 'unsupported';
  return evidenceSeen ? 'managed-mutation' : 'read-only';
}

function isValidSatisfactionEvidence(value: string): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    return false;
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const satisfied = (payload as { satisfied?: unknown }).satisfied;
  if (!Array.isArray(satisfied) || satisfied.length === 0) return false;

  const criterionRefs = new Set<string>();
  return satisfied.every((entry: unknown) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const item = entry as { criterion_ref?: unknown; evidence?: unknown };
    if (typeof item.criterion_ref !== 'string' || item.criterion_ref.trim().length === 0
      || criterionRefs.has(item.criterion_ref)) return false;
    if (!Array.isArray(item.evidence) || item.evidence.length === 0
      || item.evidence.some((evidence) => typeof evidence !== 'string' || evidence.trim().length === 0)) {
      return false;
    }
    criterionRefs.add(item.criterion_ref);
    return true;
  });
}

function classifyStart(args: readonly string[]): ChangeBudgetCommandClass {
  let taskSupplied = false;
  let positionalTask = false;
  let presetSpecified = false;
  let executionEnvelopeSeen = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      if (positionalTask || !/^[Tt]\d{3,}$/.test(token)) return 'unsupported';
      positionalTask = true;
      taskSupplied = true;
      continue;
    }

    const { key, value: inlineValue } = parseOption(token);
    if (START_BOOLEAN_OPTIONS.has(key)) {
      if (!validBoolean(inlineValue)) return 'unsupported';
      continue;
    }
    if (key.startsWith('no-') && START_BOOLEAN_OPTIONS.has(key.slice(3))) {
      if (inlineValue !== null) return 'unsupported';
      continue;
    }
    if (['tiny', 'normal', 'free'].includes(key)) {
      if (inlineValue !== null || presetSpecified) return 'unsupported';
      presetSpecified = true;
      continue;
    }
    if (!START_VALUE_OPTIONS.has(key)) return 'unsupported';
    if (inlineValue !== null && inlineValue.length === 0) return 'unsupported';
    const taken = takeValue(args, index, inlineValue);
    if (!taken) return 'unsupported';
    if (key === 'task' || key === 'task-description') taskSupplied = taken.value.trim().length > 0;
    if (key === 'max-files' || key === 'max-changed-lines') {
      if (!isNonNegativeInteger(taken.value)) return 'unsupported';
    }
    if (key === 'preset' && !CONTRACT_PRESETS.has(taken.value.toLowerCase())) return 'unsupported';
    if (key === 'preset') {
      if (presetSpecified) return 'unsupported';
      presetSpecified = true;
    }
    if (key === 'stack-profile' && !STACK_PROFILES.has(taken.value.toLowerCase())) return 'unsupported';
    if (key === 'execution-envelope-json') {
      if (executionEnvelopeSeen || !isJsonObject(taken.value)) return 'unsupported';
      executionEnvelopeSeen = true;
    }
    if (['allow-path', 'allow-paths', 'deny-path', 'deny-paths'].includes(key)
      && !taken.value.split(',').every((entry) => entry.trim().length > 0)) return 'unsupported';
    if (['disable-stack-rule', 'disable-stack-rules'].includes(key)
      && !taken.value.split(',').some((entry) => entry.trim().length > 0)) return 'unsupported';
    index = taken.nextIndex;
  }
  return taskSupplied ? 'managed-mutation' : 'unsupported';
}

function classifyAmend(args: readonly string[]): ChangeBudgetCommandClass {
  let hasMutation = false;
  let hasAllowPath = false;
  let hasReason = false;
  const seen = new Set<string>();
  const seenAllowPaths = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) return 'unsupported';
    const { key, value: inlineValue } = parseOption(token);
    if (!['max-files', 'max-changed-lines', 'allow-path', 'allow-paths', 'reason'].includes(key)) return 'unsupported';
    if (key !== 'allow-path' && key !== 'allow-paths' && seen.has(key)) return 'unsupported';
    if (key !== 'allow-path' && key !== 'allow-paths') seen.add(key);
    const taken = takeValue(args, index, inlineValue);
    if (!taken) return 'unsupported';
    if ((key === 'max-files' || key === 'max-changed-lines') && !isNonNegativeInteger(taken.value)) return 'unsupported';
    if (key === 'reason') {
      if (taken.value.trim().length === 0) return 'unsupported';
      hasReason = true;
    }
    if (key === 'allow-path' || key === 'allow-paths') {
      if (!taken.value.split(',').every((entry) => entry.trim().length > 0)) return 'unsupported';
      for (const entry of taken.value.split(',')) {
        const canonical = canonicalizeAmendPath(entry);
        if (canonical === null || seenAllowPaths.has(canonical)) return 'unsupported';
        seenAllowPaths.add(canonical);
      }
      hasAllowPath = true;
    }
    if (key !== 'reason') hasMutation = true;
    index = taken.nextIndex;
  }
  return hasMutation && (!hasAllowPath || hasReason) ? 'managed-mutation' : 'unsupported';
}

function classifyClose(args: readonly string[]): ChangeBudgetCommandClass {
  let force = false;
  let reasonSeen = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) return 'unsupported';
    const { key, value: inlineValue } = parseOption(token);
    if (!['force', 'actor', 'reason'].includes(key) || seen.has(key)) return 'unsupported';
    seen.add(key);
    if (key === 'force') {
      if (inlineValue !== null) return 'unsupported';
      force = true;
      continue;
    }
    const taken = takeValue(args, index, inlineValue);
    if (!taken) return 'unsupported';
    if (key === 'reason') {
      if (taken.value.trim().length === 0) return 'unsupported';
      reasonSeen = true;
    }
    index = taken.nextIndex;
  }
  if (force && !reasonSeen) return 'unsupported';
  return force ? 'force-close' : 'managed-mutation';
}

function classifyIntegrate(args: readonly string[]): ChangeBudgetCommandClass {
  if (args[0] !== 'opencode') return 'unsupported';
  let dryRun = false;
  let remove = false;
  for (const token of args.slice(1)) {
    if (token === '--dry-run' && !dryRun) dryRun = true;
    else if (token === '--remove' && !remove) remove = true;
    else return 'unsupported';
  }
  if (dryRun && remove) return 'unsupported';
  if (dryRun) return 'read-only';
  return 'managed-mutation';
}

function classifyChangeBudgetArguments(args: readonly string[]): ChangeBudgetCommandClass {
  if (args.length === 0) return 'read-only';
  const [command, ...rest] = args;

  if (command === '--version' || command === '-v' || command === '--help' || command === '-h') {
    return rest.length === 0 ? 'read-only' : 'unsupported';
  }
  if (command === 'help') {
    return rest.length === 0 || (rest.length === 1 && SUPPORTED_COMMANDS.has(rest[0]))
      ? 'read-only'
      : 'unsupported';
  }

  if (!SUPPORTED_COMMANDS.has(command)) return 'unsupported';
  if ((rest.length === 1 && (rest[0] === '--help' || rest[0] === '-h'))
    || (command === 'integrate' && rest.length === 2 && rest[0] === 'opencode'
      && (rest[1] === '--help' || rest[1] === '-h'))) {
    return 'read-only';
  }

  switch (command) {
    case 'init':
      return rest.length === 0 ? 'managed-mutation' : 'unsupported';
    case 'start':
      return classifyStart(rest);
    case 'status':
      return classifyStatus(rest);
    case 'check':
      return classifyCheck(rest);
    case 'close':
      return classifyClose(rest);
    case 'amend':
      return classifyAmend(rest);
    case 'diagnose':
      return classifyDiagnose(rest);
    case 'integrate':
      return classifyIntegrate(rest);
    case 'update':
      if (rest.length === 1 && rest[0] === '--check') return 'read-only';
      return rest.length === 0 ? 'external-mutation' : 'unsupported';
    default:
      return 'unsupported';
  }
}

/** Classify a ChangeBudget CLI invocation using its supported public grammar. */
export function classifyChangeBudgetCommand(
  executableAndArgs: readonly string[],
  knownAbsoluteExecutables: readonly string[] = [],
): ChangeBudgetCommandClass | null {
  const executable = executableAndArgs[0];
  if (executable === undefined || !isChangeBudgetExecutable(executable, knownAbsoluteExecutables)) return null;
  return classifyChangeBudgetArguments(executableAndArgs.slice(1));
}
