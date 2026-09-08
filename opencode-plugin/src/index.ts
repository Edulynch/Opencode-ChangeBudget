import { randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const runtimeSourceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../dist/src',
);
const patternModule = await import(
  pathToFileURL(join(runtimeSourceRoot, 'core/check/patterns.js')).href,
) as typeof import('../../src/core/check/patterns.js');
const { compilePathPatterns, matchPathPattern } = patternModule;
import { evaluateRuntimeDecision, type RuntimeEvaluationResult } from './evaluator.js';
import { classifyTargetCreation } from './target-classification.js';
import {
  MutationIntent,
  RuntimeProjectionInput,
  RuntimeSensitiveInput,
  RUNTIME_RULES,
  projectRuntimeDecision,
  toRuntimePermissionStatus,
} from './projection.js';

type PermissionStatus = 'allow' | 'deny' | 'ask';

type PermissionMetadata = Record<string, unknown>;

type PermissionLike = {
  id?: string;
  sessionID?: string;
  callID?: string;
  type?: string;
  pattern?: string;
  patterns?: unknown;
  metadata?: PermissionMetadata;
  tool?: {
    callID?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ToolExecuteBeforeInput = {
  tool: string;
  sessionID: string;
  callID: string;
};

type ToolExecuteBeforeOutput = {
  args: unknown;
};

type CommandExecuteBeforeInput = {
  command: string;
  sessionID: string;
  arguments: string;
};

type CommandExecuteBeforeOutput = {
  parts: unknown[];
};

type PermissionAskInput = PermissionLike;

type PermissionAskOutput = {
  status: PermissionStatus;
};

type PluginInput = {
  directory: string;
  worktree: string;
};

type Hooks = {
  'tool.execute.before'?: (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>;
  'command.execute.before'?: (
    input: CommandExecuteBeforeInput,
    output: CommandExecuteBeforeOutput,
  ) => Promise<void>;
  'permission.ask'?: (input: PermissionAskInput, output: PermissionAskOutput) => Promise<void>;
};

type Plugin = (input: PluginInput, options?: Record<string, unknown>) => Promise<Hooks>;

type PluginModule = {
  id?: string;
  server: Plugin;
};

type OperationSource = 'tool' | 'command' | 'permission';

type OperationContext = {
  mutationIntent: MutationIntent;
  rawTargetPath: string | null;
  isTargetResolved: boolean;
  source: OperationSource;
  operationId: string;
  rawMetadata: PermissionMetadata;
  tool: string;
};

type ProjectedDecisionInput = RuntimeProjectionInput & {
  targetInChangeBudget: boolean;
  operationId: string;
};

const MAX_COMMAND_CONTEXTS = 16;
const MAX_TOOL_CONTEXTS = 128;
const MAX_SESSIONS = 32;
const CHANGE_BUDGET_DIR = '.changebudget';

const READ_ONLY_TOOL_HINTS = [
  'read',
  'cat',
  'ls',
  'list',
  'search',
  'glob',
  'grep',
  'diff',
  'status',
  'show',
  'view',
  'inspect',
  'open',
  'preview',
  'get',
];

const MUTATE_TOOL_HINTS = [
  'write',
  'edit',
  'replace',
  'patch',
  'delete',
  'remove',
  'create',
  'mkdir',
  'touch',
  'rename',
  'move',
  'copy',
  'cp',
  'mv',
  'rm',
];

const READ_ONLY_COMMAND_HINTS = [
  'status',
  'log',
  'show',
  'diff',
  'list',
  'ls',
  'cat',
  'head',
  'tail',
  'find',
  'grep',
];

const MUTATE_COMMAND_HINTS = [
  'install',
  'add',
  'apply',
  'checkout',
  'commit',
  'restore',
  'reset',
  'revert',
  'merge',
  'rm',
  'mv',
  'cp',
  'mkdir',
  'rmdir',
  'touch',
  'chmod',
  'chown',
  'git',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'pip',
  'cargo',
];

const toolContextBySessionCall = new Map<string, Map<string, OperationContext>>();
const commandContextBySession = new Map<string, OperationContext[]>();

function enforceSessionCeiling(
  map: Map<string, Map<string, OperationContext>> | Map<string, OperationContext[]>,
  ceiling: number,
): void {
  while (map.size > ceiling) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    map.delete(oldest);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized.length) {
    return null;
  }

  return normalized;
}

function toBooleanText(value: unknown): MutationIntent | null {
  if (typeof value !== 'string') {
    return null;
  }

  const lower = value.toLowerCase();

  if (lower === 'read' || lower === 'readonly' || lower === 'read-only') {
    return 'read-only';
  }

  if (lower === 'write' || lower === 'mutate' || lower === 'mutating') {
    return 'mutate';
  }

  return null;
}

function splitNormalizedParts(value: string): string[] {
  return value
    .trim()
    .split(/\s+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function stripWrappingQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2
    && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function looksLikePath(text: string): boolean {
  const value = stripWrappingQuotes(text);

  if (!value.length) {
    return false;
  }

  if (/[\r\n\0]/.test(value)) {
    return false;
  }

  if (value.includes('*') || value.includes('?') || value.includes('[') || value.includes(']')) {
    return false;
  }

  if (value.startsWith('-')) {
    return false;
  }

  if (value === '.' || value === '..' || value === '-') {
    return false;
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return false;
  }

  if (value.includes('/') || value.includes('\\') || value.startsWith('.')) {
    return true;
  }

  return /\.[A-Za-z0-9]+$/.test(value);
}

function normalizeForRepo(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '.') {
    return '.';
  }

  return normalized
    .replace(/^\.\//, '')
    .replace(/\/+$/, '')
    .replace(/^\/+/, '');
}

function toRepoRelativePath(repositoryRoot: string, candidate: string): string | null {
  const cleaned = stripWrappingQuotes(candidate).trim();
  if (!looksLikePath(cleaned)) {
    return null;
  }

  const absolute = isAbsolute(cleaned) ? cleaned : resolve(repositoryRoot, cleaned);
  const relativePath = relative(repositoryRoot, absolute);
  if (isAbsolute(relativePath)) {
    return null;
  }

  const normalized = normalizeForRepo(relativePath);

  if (normalized === '..' || normalized.startsWith('../')) {
    return null;
  }

  return normalized;
}

function isChangeBudgetTarget(targetPath: string | null): boolean {
  if (!targetPath) {
    return false;
  }

  const normalized = normalizeForRepo(targetPath);
  return normalized === CHANGE_BUDGET_DIR || normalized.startsWith(`${CHANGE_BUDGET_DIR}/`);
}

function classifyByKeywords(value: string, mutateHints: string[], readHints: string[]): MutationIntent {
  const lower = value.toLowerCase();

  for (const token of mutateHints) {
    if (lower.includes(token)) {
      return 'mutate';
    }
  }

  for (const token of readHints) {
    if (lower.includes(token)) {
      return 'read-only';
    }
  }

  return 'mutate';
}

function inferMutationIntentFromPermission(permission: PermissionLike): MutationIntent {
  if (permission.type) {
    const byType = toBooleanText(permission.type);
    if (byType) {
      return byType;
    }

    const fromType = classifyByKeywords(permission.type, MUTATE_TOOL_HINTS, READ_ONLY_TOOL_HINTS);
    if (fromType === 'read-only') {
      return 'read-only';
    }
  }

  const patternText = toString(permission.pattern) ?? '';
  if (patternText.length > 0) {
    const byPattern = classifyByKeywords(patternText, MUTATE_TOOL_HINTS, READ_ONLY_TOOL_HINTS);
    if (byPattern === 'read-only') {
      return 'read-only';
    }
  }

  const patterns = normalizePatterns(permission.patterns);
  const combined = patterns.join(' ');
  const byPatterns = classifyByKeywords(combined, MUTATE_TOOL_HINTS, READ_ONLY_TOOL_HINTS);

  if (byPatterns === 'read-only') {
    return 'read-only';
  }

  return 'mutate';
}

function normalizePatterns(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => toString(entry))
    .filter((entry): entry is string => entry !== null);
}

function parseTokenList(value: string): string[] {
  const parsed = splitCommandLine(value);
  return parsed
    .map((entry) => stripWrappingQuotes(entry))
    .filter((entry) => entry.length > 0);
}

function splitCommandLine(value: string): string[] {
  const parts: string[] = [];
  const tokens: string[] = [];
  let token = '';
  let quote: string | null = null;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      token += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && quote !== "'") {
      escaped = true;
      continue;
    }

    if (quote === null) {
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (token.length > 0) {
          parts.push(token);
          token = '';
        }
        continue;
      }

      token += char;
      continue;
    }

    if (char === quote) {
      quote = null;
      continue;
    }

    token += char;
  }

  if (token.length > 0) {
    parts.push(token);
  }

  return parts.filter((entry) => entry.length > 0);
}

function parseTokensForPaths(tokens: string[]): string[] {
  return tokens
    .map((entry) => stripWrappingQuotes(entry))
    .filter((entry) => looksLikePath(entry));
}

function extractPathsFromValue(value: unknown, keys: string[] = []): string[] {
  const discovered: string[] = [];

  if (!value) {
    return discovered;
  }

  if (typeof value === 'string') {
    discovered.push(...parseTokensForPaths(splitNormalizedParts(value)));
    return discovered;
  }

  if (!isRecord(value)) {
    return discovered;
  }

  for (const key of Object.keys(value)) {
    if (keys.length > 0 && !keys.includes(key)) {
      continue;
    }

    const raw = value[key];
    const text = toString(raw);
    if (text !== null && looksLikePath(text)) {
      discovered.push(text);
    }
  }

  if (Array.isArray(value.files)) {
    for (const entry of value.files) {
      const text = toString(entry);
      if (text !== null && looksLikePath(text)) {
        discovered.push(text);
      }

      if (isRecord(entry)) {
        const filePath = toString(entry.path);
        const from = toString(entry.from);
        const target = toString(entry.target);

        if (filePath !== null && looksLikePath(filePath)) {
          discovered.push(filePath);
        }

        if (from !== null && looksLikePath(from)) {
          discovered.push(from);
        }

        if (target !== null && looksLikePath(target)) {
          discovered.push(target);
        }
      }
    }
  }

  if (Array.isArray(value.paths)) {
    for (const entry of value.paths) {
      const text = toString(entry);
      if (text !== null && looksLikePath(text)) {
        discovered.push(text);
      }
    }
  }

  if (isRecord(value.args) && value.args !== value) {
    const inner = extractPathsFromValue(value.args, keys);
    discovered.push(...inner);
  }

  if (keys.length === 0 && isRecord(value.input) && isRecord(value.input.args)) {
    const nested = extractPathsFromValue(value.input.args, []);
    discovered.push(...nested);
  }

  return discovered;
}

function normalizeContextPaths(values: string[]): string[] {
  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = stripWrappingQuotes(value).trim();
    if (!looksLikePath(normalized)) {
      continue;
    }

    deduped.add(normalized);
  }

  return [...deduped];
}

function extractConfidentTarget(value: unknown): string | null {
  if (!isRecord(value)) {
    return null;
  }

  const selectOne = (keys: readonly string[]): { readonly value: string | null; readonly ambiguous: boolean } => {
    const candidates = new Set<string>();
    for (const key of keys) {
      const candidate = toString(value[key]);
      if (candidate !== null && looksLikePath(candidate)) {
        candidates.add(stripWrappingQuotes(candidate));
      }
    }

    return {
      value: candidates.size === 1 ? [...candidates][0] ?? null : null,
      ambiguous: candidates.size > 1,
    };
  };

  const destination = selectOne(['destination', 'destinationPath', 'target', 'targetPath', 'to', 'dst', 'outputPath', 'pathTo']);
  if (destination.ambiguous) {
    return null;
  }
  if (destination.value !== null) {
    return destination.value;
  }

  const primary = selectOne(['path', 'filePath', 'file']);
  return primary.ambiguous ? null : primary.value;
}

function inferToolMutationIntent(tool: string, args: unknown): MutationIntent {
  const byTool = classifyByKeywords(tool, MUTATE_TOOL_HINTS, READ_ONLY_TOOL_HINTS);
  if (byTool === 'read-only') {
    return 'read-only';
  }

  if (isRecord(args)) {
    const metadataIntent = toBooleanText(toString(args.mutationIntent));
    if (metadataIntent) {
      return metadataIntent;
    }
  }

  return byTool;
}

function inferDependencyPathFromCommand(command: string, tokens: string[]): string | null {
  if (command === 'npm' || command === 'pnpm' || command === 'yarn' || command === 'bun') {
    return 'package.json';
  }

  if (command === 'poetry') {
    return 'pyproject.toml';
  }

  if (command === 'pip' || command === 'pipenv') {
    return 'requirements.txt';
  }

  if (command === 'cargo') {
    return 'Cargo.toml';
  }

  if (command === 'go') {
    if (tokens.includes('mod')) {
      return 'go.mod';
    }
    return 'go.sum';
  }

  if (command === 'mvn' || command === 'gradle') {
    return 'pom.xml';
  }

  return null;
}

function inferCommandMutationIntent(rawCommand: string, tokens: string[], commandText: string): MutationIntent {
  if (commandText.includes(' > ') || commandText.includes(' >> ')) {
    return 'mutate';
  }

  const command = rawCommand.toLowerCase();
  if (command === 'git') {
    return inferMutationFromGitTokens(tokens);
  }

  return classifyByKeywords(command, MUTATE_COMMAND_HINTS, READ_ONLY_COMMAND_HINTS);
}

function inferMutationFromGitTokens(tokens: string[]): MutationIntent {
  const command = tokens[0]?.toLowerCase();
  if (!command) {
    return 'mutate';
  }

  const readCommands = new Set(['status', 'show', 'diff', 'log', 'branch', 'remote', 'rev-parse', 'fetch']);
  const mutateCommands = new Set([
    'add',
    'apply',
    'cherry-pick',
    'checkout',
    'clone',
    'commit',
    'merge',
    'mv',
    'remove',
    'rm',
    'restore',
    'revert',
    'switch',
    'tag',
    'blame',
  ]);

  if (readCommands.has(command)) {
    return 'read-only';
  }

  if (mutateCommands.has(command)) {
    return 'mutate';
  }

  return 'mutate';
}

function extractPathFromCommand(command: string, tokens: string[]): string | null {
  if (command === 'git') {
    const sub = tokens[0]?.toLowerCase();
    if (!sub) {
      return null;
    }

    const pathToken = findPathToken(tokens.slice(1));
    if (sub === 'add' || sub === 'rm' || sub === 'mv' || sub === 'restore' || sub === 'checkout') {
      return pathToken;
    }

    if (sub === 'commit' || sub === 'merge' || sub === 'status') {
      return null;
    }

    return pathToken;
  }

  const pathToken = findPathToken(tokens);
  if (pathToken) {
    return pathToken;
  }

  return inferDependencyPathFromCommand(command, tokens);
}

function findPathToken(tokens: string[]): string | null {
  for (const token of tokens) {
    if (!looksLikePath(token)) {
      continue;
    }

    return stripWrappingQuotes(token);
  }

  return null;
}

function extractCommandText(commandName: string, args: string): string {
  const command = commandName.trim().toLowerCase();
  const trimmed = args.trim();

  if (!trimmed) {
    return commandName.trim();
  }

  const tokens = splitCommandLine(trimmed);
  if (command === 'bash' || command === 'sh' || command === 'zsh') {
    if (tokens.length >= 2 && (tokens[0] === '-c' || tokens[0] === '-lc')) {
      return tokens.slice(1).join(' ');
    }
  }

  if (command === 'cmd') {
    if (tokens[0] === '/c' || tokens[0] === '/c"' || tokens[0] === '/c\'') {
      return tokens.slice(1).join(' ');
    }
  }

  return `${commandName} ${trimmed}`;
}

function extractToolContext(tool: string, args: unknown): OperationContext {
  const mutationIntent = inferToolMutationIntent(tool, args);
  const target = extractConfidentTarget(args);

  return {
    mutationIntent,
    rawTargetPath: target,
    isTargetResolved: target !== null,
    source: 'tool',
    operationId: randomUUID(),
    rawMetadata: isRecord(args) ? { ...args } : {},
    tool,
  };
}

function extractCommandContext(command: string, args: string): OperationContext {
  const commandText = extractCommandText(command, args);
  const tokens = parseTokenList(commandText);
  const [first] = tokens;

  const tool = first || command;
  const commandTail = first && first.toLowerCase() === command.toLowerCase() ? tokens.slice(1) : tokens.slice(0);
  const normalizedTool = first?.toLowerCase() ?? command.toLowerCase();

  const mutationIntent = inferCommandMutationIntent(normalizedTool, commandTail, commandText);
  const rawPath = extractPathFromCommand(normalizedTool, commandTail);

  return {
    mutationIntent,
    rawTargetPath: rawPath,
    isTargetResolved: rawPath !== null,
    source: 'command',
    operationId: randomUUID(),
    rawMetadata: { command: commandText },
    tool,
  };
}

function getPermissionCallID(permission: PermissionLike): string | undefined {
  if (typeof permission.callID === 'string' && permission.callID.length > 0) {
    return permission.callID;
  }

  const toolInfo = isRecord(permission.tool) ? toString(permission.tool.callID) : null;
  if (toolInfo) {
    return toolInfo;
  }

  const metadata = isRecord(permission.metadata) ? toString(permission.metadata.callID) : null;
  if (metadata) {
    return metadata;
  }

  return undefined;
}

function isCommandPermission(permission: PermissionLike): boolean {
  const type = toString(permission.type)?.toLowerCase() ?? '';
  const patternText = toString(permission.pattern)?.toLowerCase() ?? '';
  const patterns = normalizePatterns(permission.patterns).map((entry) => entry.toLowerCase());

  return (
    type.includes('command')
    || patternText.includes('command')
    || patterns.some((entry) => entry.includes('command'))
    || (type === 'permission.ask' && patternText.length > 0 && patternText.includes('command'))
  );
}

function buildPermissionFallbackContext(permission: PermissionLike): OperationContext {
  const mutationIntent = inferMutationIntentFromPermission(permission);
  const candidates = normalizeContextPaths([
    ...extractPathsFromValue(permission, [
      'path',
      'file',
      'target',
      'targetPath',
      'sourcePath',
      'destinationPath',
      'pathFrom',
      'pathTo',
    ]),
    ...extractPathsFromValue(toString(permission.pattern), []),
    ...normalizePatterns(permission.patterns),
    ...normalizePatterns(permission.type),
  ]);

  return {
    mutationIntent,
    rawTargetPath: candidates[0] ?? null,
    isTargetResolved: candidates.length > 0,
    source: 'permission',
    operationId: permission.id ?? randomUUID(),
    rawMetadata: isRecord(permission.metadata) ? { ...permission.metadata } : {},
    tool: toString(permission.type) ?? 'permission',
  };
}

function buildOperationContext(
  sessionID: string,
  permission: PermissionLike,
): OperationContext {
  const callID = getPermissionCallID(permission);
  if (callID) {
    const sessionMap = toolContextBySessionCall.get(sessionID);
    const fromTool = sessionMap?.get(callID);
    if (fromTool) {
      sessionMap?.delete(callID);
      return fromTool;
    }
  }

  if (isCommandPermission(permission)) {
    const commandContext = consumeCommandContext(sessionID);
    if (commandContext) {
      return commandContext;
    }
  }

  return buildPermissionFallbackContext(permission);
}

function storeToolContext(sessionID: string, callID: string, context: OperationContext): void {
  const normalizedSessionID = sessionID || 'global';
  let sessionMap = toolContextBySessionCall.get(normalizedSessionID);
  const isNewSession = !sessionMap;
  if (!sessionMap) {
    sessionMap = new Map<string, OperationContext>();
    toolContextBySessionCall.set(normalizedSessionID, sessionMap);
  }

  sessionMap.set(callID, context);

  if (sessionMap.size > MAX_TOOL_CONTEXTS) {
    const oldestKey = [...sessionMap.keys()][0];
    sessionMap.delete(oldestKey);
  }

  if (isNewSession) {
    enforceSessionCeiling(toolContextBySessionCall, MAX_SESSIONS);
  }
}

function consumeCommandContext(sessionID: string): OperationContext | null {
  const list = commandContextBySession.get(sessionID) ?? [];
  if (list.length === 0) {
    return null;
  }

  const item = list.shift() ?? null;
  if (item === null) {
    return null;
  }

  commandContextBySession.set(sessionID, list);
  return item;
}

function storeCommandContext(sessionID: string, context: OperationContext): void {
  const existing = commandContextBySession.get(sessionID);
  const isNewSession = existing === undefined;
  const list = existing ?? [];
  list.push(context);
  if (list.length > MAX_COMMAND_CONTEXTS) {
    list.shift();
  }

  commandContextBySession.set(sessionID, list);
  if (isNewSession) {
    enforceSessionCeiling(commandContextBySession, MAX_SESSIONS);
  }
}

function buildPathRules(contract: RuntimeEvaluationResult['contract'], targetPath: string): {
  isPathDenied: boolean;
  isPathNotAllowed: boolean;
} {
  if (!contract || !targetPath) {
    return {
      isPathDenied: false,
      isPathNotAllowed: false,
    };
  }

  try {
    const denyPatterns = compilePathPatterns(contract.deny_paths);
    const allowPatterns = compilePathPatterns(contract.allow_paths);

    const isPathDenied = matchPathPattern(targetPath, denyPatterns);
    const isPathAllowed = allowPatterns.length === 0 || matchPathPattern(targetPath, allowPatterns);

    return {
      isPathDenied,
      isPathNotAllowed: !isPathAllowed,
    };
  } catch {
    return {
      isPathDenied: false,
      isPathNotAllowed: true,
    };
  }
}

function buildSensitiveFlags(targetPath: string, contract: RuntimeEvaluationResult['contract']): RuntimeSensitiveInput {
  const lower = normalizeForRepo(targetPath).toLowerCase();

  const dependencies =
    /(^|\/)package\.json$/i.test(lower)
    || /(^|\/)package-lock\.json$/i.test(lower)
    || /(^|\/)pnpm-lock\.yaml$/i.test(lower)
    || /(^|\/)yarn\.lock$/i.test(lower)
    || /(^|\/)requirements\.txt$/i.test(lower)
    || /(^|\/)poetry\.lock$/i.test(lower)
    || /(^|\/)pyproject\.toml$/i.test(lower)
    || /(^|\/)go\.mod$/i.test(lower)
    || /(^|\/)Cargo\.toml$/i.test(lower)
    || /(^|\/)Gemfile(\.lock)?$/i.test(lower)
    || /(^|\/)composer\.json$/i.test(lower);

  const migrations =
    /(^|\/)migration(s)?(\/|$)/i.test(lower)
    || /(^|\/)migrations?$/i.test(lower);

  const config =
    /(^|\/)\.env(\..*)?$/i.test(lower)
    || /(^|\/)\.config\//i.test(lower)
    || /(^|\/)tsconfig(\.json)?$/i.test(lower)
    || /(^|\/)eslint(\.config)?\./i.test(lower)
    || /(^|\/)prettier(\.config)?\./i.test(lower)
    || /(^|\/)vite\.config/i.test(lower)
    || /(^|\/)webpack\.config/i.test(lower)
    || /(^|\/)rollup\.config/i.test(lower)
    || /(^|\/)config\//i.test(lower);

  const publicApi =
    /(^|\/)public\//i.test(lower)
    || /(^|\/)api\//i.test(lower)
    || /(^|\/)routes\//i.test(lower)
    || /(^|\/)controllers\//i.test(lower)
    || /(^|\/)dto\//i.test(lower)
    || /(^|\/)openapi\//i.test(lower)
    || /(^|\/)schema\.ts$/i.test(lower)
    || /(^|\/)\.d\.ts$/i.test(lower)
    || /(^|\/)index\.ts$/i.test(lower) && lower.includes('api');

  return {
    dependencies: dependencies && !contract?.allow_new_dependencies,
    migrations: migrations && !contract?.allow_migrations,
    config: config && !contract?.allow_config_changes,
    publicApi: publicApi && !contract?.allow_public_api_changes,
  };
}

function resolveEvaluation(repositoryRoot: string): Promise<RuntimeEvaluationResult> {
  return evaluateRuntimeDecision(repositoryRoot);
}

async function toRuntimeContext(
  repositoryRoot: string,
  context: OperationContext,
  evaluation: RuntimeEvaluationResult,
): Promise<ProjectedDecisionInput> {
  const targetPath = context.rawTargetPath ? toRepoRelativePath(repositoryRoot, context.rawTargetPath) : null;

  if (!context.rawTargetPath || targetPath === null) {
    return {
      policyDecision: evaluation.policyDecision,
      mutationIntent: context.mutationIntent,
      targetPath: null,
      isInited: evaluation.isInited,
      isPathDenied: false,
      isPathNotAllowed: false,
      isSensitive: {
        dependencies: false,
        migrations: false,
        config: false,
        publicApi: false,
      },
      newFileDenied: false,
      targetInChangeBudget: false,
      isTargetResolved: false,
      operationId: context.operationId,
    };
  }

  const sensitive = buildSensitiveFlags(targetPath, evaluation.contract);
  const pathRules = buildPathRules(evaluation.contract, targetPath);
  const targetInChangeBudget = isChangeBudgetTarget(targetPath);
  const forceUnresolved = evaluation.isInited && evaluation.contract === null;
  const targetClassification = await classifyTargetCreation({ repositoryRoot, targetPath });
  const isTargetResolved = !forceUnresolved && targetClassification.state !== 'unsafe';

  return {
    policyDecision: evaluation.policyDecision,
    mutationIntent: context.mutationIntent,
    targetPath,
    isInited: evaluation.isInited,
    isPathDenied: pathRules.isPathDenied,
    isPathNotAllowed: pathRules.isPathNotAllowed,
    isSensitive: evaluation.contract ? sensitive : {
      dependencies: false,
      migrations: false,
      config: false,
      publicApi: false,
    },
    newFileDenied: evaluation.contract !== null
      && targetClassification.state === 'new-file'
      && !evaluation.contract.allow_new_files,
    targetInChangeBudget,
    isTargetResolved,
    operationId: context.operationId,
  };
}

export function __testContextSessionCounts(): { toolSessions: number; commandSessions: number } {
  return {
    toolSessions: toolContextBySessionCall.size,
    commandSessions: commandContextBySession.size,
  };
}

export function __testContextSessionIds(): { toolSessionIds: string[]; commandSessionIds: string[] } {
  return {
    toolSessionIds: [...toolContextBySessionCall.keys()],
    commandSessionIds: [...commandContextBySession.keys()],
  };
}

export function __testResetContextMaps(): void {
  toolContextBySessionCall.clear();
  commandContextBySession.clear();
}

const plugin: Plugin = async (input) => {
  const repositoryRoot = input.directory || input.worktree;

  return {
    'tool.execute.before': async (hookInput, output) => {
      const context = extractToolContext(hookInput.tool, output.args);
      context.rawMetadata = isRecord(output.args) ? { ...output.args } : {};
      storeToolContext(hookInput.sessionID, hookInput.callID, context);
    },
    'command.execute.before': async (hookInput) => {
      storeCommandContext(hookInput.sessionID, extractCommandContext(hookInput.command, hookInput.arguments));
    },
    'permission.ask': async (hookInput, output) => {
      try {
        const evaluation = await resolveEvaluation(repositoryRoot);
        const sessionID = toString(hookInput.sessionID) ?? 'global';
        const permissionContext = buildOperationContext(sessionID, hookInput);
        const context = await toRuntimeContext(repositoryRoot, permissionContext, evaluation);
        const projection = projectRuntimeDecision(context);
        const metadata = isRecord(hookInput.metadata) ? { ...hookInput.metadata } : {};

        hookInput.metadata = {
          ...metadata,
          operationId: context.operationId,
          mutationIntent: context.mutationIntent,
          targetPath: context.targetPath,
          isTargetResolved: context.isTargetResolved,
          policyDecision: evaluation.policyDecision,
          rule: projection.rule,
          reasonCode: projection.reasonCode,
          reason: projection.message,
          runtimeAction: projection.runtimeAction,
          contractId: evaluation.contractId,
        };

        output.status = toRuntimePermissionStatus(projection.runtimeAction);
      } catch {
        const metadata = isRecord(hookInput.metadata) ? { ...hookInput.metadata } : {};
        hookInput.metadata = {
          ...metadata,
          rule: RUNTIME_RULES.HUMAN_REVIEW,
          reasonCode: RUNTIME_RULES.HUMAN_REVIEW,
          runtimeAction: 'block',
          policyDecision: 'HUMAN_REVIEW',
        };
        output.status = 'deny';
      }
    },
  };
};

const pluginModule: PluginModule = {
  id: 'changebudget-runtime-guard',
  server: plugin,
};

export default pluginModule;
