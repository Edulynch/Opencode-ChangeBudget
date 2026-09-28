import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { Plugin } from '@opencode/plugin';

const runtimeSourceRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../dist/src',
);

const [patternModule, gitModule] = await Promise.all([
  import(pathToFileURL(join(runtimeSourceRoot, 'core/check/patterns.js')).href),
  import(pathToFileURL(join(runtimeSourceRoot, 'core/git/repo.js')).href),
]);
const { compilePathPatterns, matchPathPattern } = patternModule as typeof import('../../src/core/check/patterns.js');
const { getRepositoryRoot } = gitModule as typeof import('../../src/core/git/repo.js');

import {
  evaluateRuntimeDecision,
  type RuntimeEvaluationResult,
  type RuntimeMaterialDecisionInput,
} from './evaluator.js';
import { classifyTargetCreation } from './target-classification.js';
import type { MaterialDecision } from '../../src/models/execution-gate.js';
import {
  MutationIntent,
  RuntimeProjectionInput,
  RuntimeSensitiveInput,
  RuntimeOperationClass,
  RUNTIME_RULES,
  projectRuntimeDecision,
} from './projection.js';
import {
  classifyChangeBudgetArguments,
  normalizeChangeBudgetCommand,
  type ChangeBudgetNodeCliIdentityContext,
} from './changebudget-command.js';

const CHANGE_BUDGET_INSTRUCTIONS = `ChangeBudget is the scope authority for this implementation task.

Before changing files:
- Run 'changebudget status'. If the repository is uninitialized, run 'changebudget init' and check status again.
- If no contract is active, start one with the exact paths and budget approved by the developer.
- For a Spec-Kit Txxx task without an explicit budget, run 'changebudget diagnose Txxx' before starting.
- Never widen or amend a contract automatically. Ask the developer for explicit approval of each exact path and reason.
- REPAIR and HUMAN_REVIEW do not authorize a wider contract.
- Never edit .changebudget/** manually.

During implementation:
- Stay inside the active contract's allow_paths and respect deny_paths.
- Do not add dependencies, migrations, configuration, or public API changes unless explicitly allowed.
- Keep the diff focused on the requested task.

After implementation:
- Run targeted tests, type checks, linters, and builds relevant to the change.
- Run 'changebudget check'. Repair only violations that fit the existing contract.
- Close the contract only after validation succeeds and the developer agrees the task is complete.`;

type PermissionMetadata = Record<string, unknown>;

type OperationContext = {
  operationClass: RuntimeOperationClass;
  mutationIntent: MutationIntent;
  rawTargetPath: string | null;
  isTargetResolved: boolean;
  tool: string;
};

type ProjectedDecisionInput = RuntimeProjectionInput;

const CHANGE_BUDGET_DIR = '.changebudget';
const CHANGE_BUDGET_PACKAGE_ROOT = resolve(runtimeSourceRoot, '../..');
const CHANGE_BUDGET_CLI_ENTRY_PATH = join(CHANGE_BUDGET_PACKAGE_ROOT, 'dist', 'src', 'cli', 'index.js');

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

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'show',
  'diff',
  'log',
  'branch',
  'remote',
  'rev-parse',
  'fetch',
  'ls-files',
  'check-ignore',
]);

const GIT_GLOBAL_OPTIONS_WITH_VALUE = new Set([
  '-c',
  '-C',
  '--config-env',
  '--exec-path',
  '--git-dir',
  '--namespace',
  '--super-prefix',
  '--work-tree',
]);

// OpenCode's PowerShell scanner can split `--option=value` status arguments
// into a command ending at the option name and a following pathspec resource.
const GIT_STATUS_OPTIONS_WITH_SPLIT_VALUES = new Set([
  '--column',
  '--color',
  '--find-renames',
  '--ignore-submodules',
  '--ignored',
  '--porcelain',
  '--untracked-files',
]);

const READ_ONLY_ACTIONS = new Set([
  'read',
  'glob',
  'grep',
  'list',
  'search',
  'webfetch',
  'question',
  'subagent',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeDecisionStringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const normalized = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
  return normalized.every((entry) => entry.length > 0) ? normalized : null;
}

function normalizeMaterialDecision(value: unknown): MaterialDecision | undefined {
  if (!isRecord(value)) return undefined;

  const id = toString(value.id);
  const necessity = toString(value.necessity);
  const criterionRefs = normalizeDecisionStringList(value.criterion_refs);
  const evidence = normalizeDecisionStringList(value.evidence);
  const kind = toString(value.kind);

  if (
    id === null
    || (necessity !== 'optional' && necessity !== 'required')
    || criterionRefs === null
    || evidence === null
    || kind === null
  ) {
    return undefined;
  }

  switch (kind) {
    case 'delegated_agent':
    case 'concurrent_worker': {
      if (!isRecord(value.requested) || typeof value.requested.amount !== 'number') return undefined;
      if (value.minimum_required !== undefined && typeof value.minimum_required !== 'number') return undefined;
      return {
        id,
        kind,
        requested: { amount: value.requested.amount },
        necessity,
        ...(value.minimum_required === undefined ? {} : { minimum_required: value.minimum_required }),
        criterion_refs: criterionRefs,
        evidence,
      };
    }
    case 'reasoning_escalation':
    case 'research_expansion':
    case 'architecture_review':
    case 'verification_expansion':
    case 'documentation_expansion':
    case 'infrastructure_expansion':
    case 'external_service': {
      if (!isRecord(value.requested)) return undefined;
      const requestedValue = toString(value.requested.value);
      if (requestedValue === null) return undefined;
      return {
        id,
        kind,
        requested: { value: requestedValue },
        necessity,
        criterion_refs: criterionRefs,
        evidence,
      };
    }
    case 'scope_expansion': {
      const requestedPaths = normalizeDecisionStringList(value.requested_paths);
      if (requestedPaths === null || typeof value.requests_new_files !== 'boolean') return undefined;
      return {
        id,
        kind,
        requested_paths: requestedPaths,
        requests_new_files: value.requests_new_files,
        necessity,
        criterion_refs: criterionRefs,
        evidence,
      };
    }
    case 'post_satisfaction_work': {
      const operation = toString(value.operation);
      if (operation === null) return undefined;
      return { id, kind, operation, necessity, criterion_refs: criterionRefs, evidence };
    }
    default:
      return undefined;
  }
}

function normalizeRuntimeMaterialDecision(value: unknown): RuntimeMaterialDecisionInput {
  const proposal = normalizeMaterialDecision(value);
  return proposal === undefined ? { kind: 'INVALID' } : { kind: 'VALID', proposal };
}

function normalizeForRepo(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/\/+/g, '/');
  if (normalized === '.') return '.';
  const withoutDotPrefix = normalized.replace(/^\.\//, '');
  let end = withoutDotPrefix.length;
  while (end > 0 && withoutDotPrefix[end - 1] === '/') end -= 1;
  return withoutDotPrefix.slice(0, end).replace(/^\/+/, '');
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
  if (!value.length || /[\r\n\0]/.test(value)) return false;
  if (value.includes('*') || value.includes('?') || value.includes('[') || value.includes(']')) return false;
  if (value.startsWith('-') || value === '.' || value === '..' || value === '-') return false;
  if (value.startsWith('http://') || value.startsWith('https://')) return false;
  return value.includes('/') || value.includes('\\') || value.startsWith('.') || /\.[A-Za-z0-9]+$/.test(value);
}

function toRepoRelativePath(repositoryRoot: string, candidate: string): string | null {
  const cleaned = stripWrappingQuotes(candidate);
  if (!looksLikePath(cleaned)) return null;
  const absolute = isAbsolute(cleaned) ? cleaned : resolve(repositoryRoot, cleaned);
  const relativePath = relative(repositoryRoot, absolute);
  if (isAbsolute(relativePath)) return null;
  const normalized = normalizeForRepo(relativePath);
  return normalized === '..' || normalized.startsWith('../') ? null : normalized;
}

function isChangeBudgetTarget(targetPaths: readonly string[]): boolean {
  return targetPaths.some((targetPath) => {
    const normalized = normalizeForRepo(targetPath);
    return normalized === CHANGE_BUDGET_DIR || normalized.startsWith(`${CHANGE_BUDGET_DIR}/`);
  });
}

function classifyByKeywords(value: string, mutateHints: string[], readHints: string[]): MutationIntent {
  const lower = value.toLowerCase();
  if (mutateHints.some((token) => lower.includes(token))) return 'mutate';
  if (readHints.some((token) => lower.includes(token))) return 'read-only';
  return 'mutate';
}

function tokenizeCommandLine(value: string): { tokens: string[]; wellFormed: boolean } {
  const parts: string[] = [];
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
      const next = value[index + 1];
      if (next !== undefined && /[\s"'\\;&|<>`()$]/.test(next)) {
        escaped = true;
        continue;
      }
      token += char;
      continue;
    }
    if (quote === null) {
      if (char === '"' || char === "'") {
        quote = char;
      } else if (/\s/.test(char)) {
        if (token.length > 0) {
          parts.push(token);
          token = '';
        }
      } else {
        token += char;
      }
      continue;
    }
    if (char === quote) quote = null;
    else token += char;
  }
  if (token.length > 0) parts.push(token);
  return { tokens: parts, wellFormed: quote === null };
}

function splitCommandLine(value: string): string[] {
  return tokenizeCommandLine(value).tokens;
}

function hasShellControlOperator(value: string): boolean {
  let quote: string | null = null;
  let escaped = false;

  for (const char of value) {
    if (escaped) {
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
      } else if (';&|<>`()'.includes(char) || char === '\n' || char === '\r') {
        return true;
      }
      continue;
    }
    if (char === quote) quote = null;
  }

  return false;
}

function inferDependencyPathFromCommand(command: string, tokens: string[]): string | null {
  switch (command) {
    case 'npm':
    case 'pnpm':
    case 'yarn':
    case 'bun':
      return 'package.json';
    case 'poetry':
      return 'pyproject.toml';
    case 'pip':
    case 'pipenv':
      return 'requirements.txt';
    case 'cargo':
      return 'Cargo.toml';
    case 'go':
      return tokens.includes('mod') ? 'go.mod' : 'go.sum';
    case 'mvn':
    case 'gradle':
      return 'pom.xml';
    default:
      return null;
  }
}

function findGitSubcommandIndex(tokens: string[]): number | null {
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index].toLowerCase();
    if (GIT_GLOBAL_OPTIONS_WITH_VALUE.has(token)) {
      if (index + 1 >= tokens.length) return null;
      index += 2;
      continue;
    }
    if (token.startsWith('-')) {
      index += 1;
      continue;
    }
    return index;
  }
  return null;
}

function inferMutationFromGitTokens(tokens: string[]): MutationIntent {
  const subcommandIndex = findGitSubcommandIndex(tokens);
  if (subcommandIndex === null) return 'mutate';
  return READ_ONLY_GIT_SUBCOMMANDS.has(tokens[subcommandIndex].toLowerCase())
    ? 'read-only'
    : 'mutate';
}

function inferCommandMutationIntent(command: string, tokens: string[], commandText: string): MutationIntent {
  if (hasShellControlOperator(commandText)) return 'mutate';
  if (command === 'git') return inferMutationFromGitTokens(tokens);
  return classifyByKeywords(command, MUTATE_COMMAND_HINTS, READ_ONLY_COMMAND_HINTS);
}

function findPathToken(tokens: string[]): string | null {
  return tokens.find((token) => looksLikePath(token)) ?? null;
}

function extractPathFromCommand(command: string, tokens: string[]): string | null {
  if (command === 'git') {
    const subcommandIndex = findGitSubcommandIndex(tokens);
    if (subcommandIndex === null) return null;
    const sub = tokens[subcommandIndex].toLowerCase();
    if (['commit', 'merge', 'status'].includes(sub)) return null;
    return findPathToken(tokens.slice(subcommandIndex + 1));
  }
  return findPathToken(tokens) ?? inferDependencyPathFromCommand(command, tokens);
}

function parseCommandResource(commandText: string): {
  executableToken: string;
  command: string;
  commandTokens: string[];
  commandTextToAnalyze: string;
} {
  const tokens = splitCommandLine(commandText);
  const first = tokens[0]?.toLowerCase() ?? 'shell';
  let executableToken = tokens[0] ?? 'shell';
  let command = first;
  let commandTokens = tokens.slice(1);
  let commandTextToAnalyze = commandText;

  if (['bash', 'sh', 'zsh'].includes(command) && ['-c', '-lc'].includes(commandTokens[0] ?? '')) {
    commandTextToAnalyze = commandTokens.slice(1).join(' ');
    const nested = splitCommandLine(commandTextToAnalyze);
    executableToken = nested[0] ?? command;
    command = nested[0]?.toLowerCase() ?? command;
    commandTokens = nested.slice(1);
  }

  return { executableToken, command, commandTokens, commandTextToAnalyze };
}

const SHELL_SEGMENT_LIMIT = 32;
const CHANGE_BUDGET_SHELL_DEPTH_LIMIT = 2;
const SHELL_SEGMENT_OPERATORS = new Set([';', '&', '|', '<', '>', '`', '(', ')', '\n', '\r']);

function splitUnquotedShellSegments(value: string): {
  segments: string[];
  hasOperator: boolean;
  wellFormed: boolean;
  overflow: boolean;
} {
  const segments: string[] = [];
  let quote: string | null = null;
  let escaped = false;
  let start = 0;
  let hasOperator = false;
  let overflow = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      const next = value[index + 1];
      if (next !== undefined && /[\s"'\\;&|<>`()$]/.test(next)) {
        escaped = true;
        continue;
      }
    }
    if (quote === null) {
      if (char === '"' || char === "'") {
        quote = char;
      } else if (SHELL_SEGMENT_OPERATORS.has(char)) {
        hasOperator = true;
        if (segments.length < SHELL_SEGMENT_LIMIT) segments.push(value.slice(start, index));
        else overflow = true;
        start = index + 1;
      }
      continue;
    }
    if (char === quote) quote = null;
  }

  if (segments.length < SHELL_SEGMENT_LIMIT) segments.push(value.slice(start));
  else overflow = true;

  return {
    segments: segments.map((segment) => segment.trim()).filter(Boolean),
    hasOperator,
    wellFormed: quote === null,
    overflow,
  };
}

type NormalizedChangeBudgetClass = ReturnType<typeof classifyChangeBudgetArguments>;

const COMMAND_SUBSTITUTION_DEPTH_LIMIT = 4;
const COMMAND_SUBSTITUTION_COUNT_LIMIT = 16;

function matchingCommandSubstitutionEnd(
  value: string,
  startIndex: number,
  nestedDepth = 0,
): { endIndex: number; closed: boolean } {
  if (nestedDepth >= COMMAND_SUBSTITUTION_DEPTH_LIMIT) {
    return { endIndex: value.length, closed: false };
  }

  let parentheses = 1;
  let quote: string | null = null;
  let escaped = false;
  for (let index = startIndex + 2; index < value.length; index += 1) {
    const char = value[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\' && /["\\$`\n\r]/.test(value[index + 1] ?? '')) {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quote = null;
        continue;
      }
      if (char === '$' && value[index + 1] === '(') {
        const nested = matchingCommandSubstitutionEnd(value, index, nestedDepth + 1);
        if (!nested.closed) return nested;
        index = nested.endIndex;
      }
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '$' && value[index + 1] === '(') {
      const nested = matchingCommandSubstitutionEnd(value, index, nestedDepth + 1);
      if (!nested.closed) return nested;
      index = nested.endIndex;
      continue;
    }
    if (char === '(') parentheses += 1;
    else if (char === ')') {
      parentheses -= 1;
      if (parentheses === 0) return { endIndex: index, closed: true };
    }
  }
  return { endIndex: value.length, closed: false };
}

function classifyChangeBudgetAtInspectionLimit(
  commandText: string,
  inheritedWellFormed: boolean,
  nodeCliIdentity?: ChangeBudgetNodeCliIdentityContext,
): NormalizedChangeBudgetClass | null {
  const scan = splitUnquotedShellSegments(commandText);
  const candidates: NormalizedChangeBudgetClass[] = [];

  const classifyTokens = (
    tokens: readonly string[],
    wellFormed: boolean,
  ): NormalizedChangeBudgetClass | null => {
    const normalized = normalizeChangeBudgetCommand(
      tokens,
      nodeCliIdentity,
      wellFormed,
    );
    if (normalized.identity === 'ambiguous') return 'unsupported';
    if (normalized.identity !== 'first-party') return null;
    const commandClass = classifyChangeBudgetArguments(normalized.canonicalArgv.slice(1));
    return commandClass === 'operator-recovery' || commandClass === 'unsupported'
      ? commandClass
      : null;
  };

  for (const segment of scan.segments) {
    const tokenized = tokenizeCommandLine(segment);
    if (tokenized.tokens.length === 0) continue;
    let currentTokens = tokenized.tokens;
    let currentWellFormed = inheritedWellFormed && scan.wellFormed && tokenized.wellFormed;
    let shellUnwraps = 0;
    let candidate: NormalizedChangeBudgetClass | null = null;

    while (true) {
      candidate = classifyTokens(currentTokens, currentWellFormed);
      const shell = currentTokens[0]?.toLowerCase();
      const npmSeparatorIndex = shell === 'npm' && currentTokens[1]?.toLowerCase() === 'exec'
        ? currentTokens.indexOf('--', 2)
        : -1;
      const npmOptionTokens = npmSeparatorIndex >= 0
        ? currentTokens.slice(0, npmSeparatorIndex)
        : currentTokens;
      const npmCallString = shell === 'npm' && currentTokens[1]?.toLowerCase() === 'exec'
        ? optionCommandString(npmOptionTokens, ['--call', '-c'], ['--call', '-c'])
        : null;
      const npxCallString = shell === 'npx'
        && (currentTokens[1] === '-c' || currentTokens[1] === '--call'
          || currentTokens[1]?.startsWith('--call='))
        ? optionCommandString(currentTokens.slice(0, 3), ['-c', '--call'], ['--call'])
        : null;
      const callString = npmCallString ?? npxCallString;
      if (candidate === null && callString !== null) {
        const substitutionClass = classifyCommandSubstitutions(
          callString,
          COMMAND_SUBSTITUTION_DEPTH_LIMIT,
          currentWellFormed,
          nodeCliIdentity,
        );
        candidate = hasChangeBudgetDenialClass(substitutionClass)
          ? substitutionClass
          : classifyTokens(tokenizeCommandLine(callString).tokens, currentWellFormed);
      }
      if (candidate !== null) break;

      if (!['bash', 'sh', 'zsh'].includes(shell ?? '')
        || !['-c', '-lc'].includes(currentTokens[1] ?? '')
        || currentTokens[2] === undefined) break;
      if (shellUnwraps >= 4) {
        // Beyond the bounded number of supported -c unwraps, don't allow a
        // still-nested executable to fall back to generic command policy.
        candidate = 'unsupported';
        break;
      }

      const nested = tokenizeCommandLine(currentTokens[2]!);
      currentTokens = nested.tokens;
      currentWellFormed = currentWellFormed && nested.wellFormed;
      shellUnwraps += 1;
    }

    if (candidate !== null) candidates.push(candidate);
  }

  if (candidates.length === 0) return null;
  if (scan.hasOperator || !inheritedWellFormed || !scan.wellFormed || candidates.length > 1) return 'unsupported';
  return candidates[0] ?? 'unsupported';
}

function classifyCommandSubstitutions(
  commandText: string,
  shellDepth: number,
  inheritedWellFormed: boolean,
  nodeCliIdentity?: ChangeBudgetNodeCliIdentityContext,
): NormalizedChangeBudgetClass | null {
  let quote: string | null = null;
  let escaped = false;
  let found = 0;

  for (let index = 0; index < commandText.length; index += 1) {
    const char = commandText[index]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote === "'") {
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      if (char === '\\' && /["\\$`\n\r]/.test(commandText[index + 1] ?? '')) {
        escaped = true;
        continue;
      }
      if (char === '"') {
        quote = null;
        continue;
      }
    } else {
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
    }

    if (char !== '$' || commandText[index + 1] !== '(') continue;
    found += 1;
    const substitution = matchingCommandSubstitutionEnd(commandText, index);
    const nestedText = commandText.slice(index + 2, substitution.closed ? substitution.endIndex : undefined);
    if (found > COMMAND_SUBSTITUTION_COUNT_LIMIT || shellDepth >= COMMAND_SUBSTITUTION_DEPTH_LIMIT) {
      const candidate = classifyChangeBudgetAtInspectionLimit(
        nestedText,
        inheritedWellFormed && substitution.closed,
        nodeCliIdentity,
      );
      if (candidate !== null) return candidate;
      if (!substitution.closed) return null;
      index = substitution.endIndex;
      continue;
    }

    const nestedClass = classifyChangeBudgetCommandText(
      nestedText,
      shellDepth + 1,
      inheritedWellFormed && substitution.closed,
      nodeCliIdentity,
    );
    if (nestedClass === 'operator-recovery' || nestedClass === 'unsupported') return nestedClass;
    if (!substitution.closed) return nestedClass === null ? null : 'unsupported';
    index = substitution.endIndex;
  }
  return null;
}

function optionCommandString(
  tokens: readonly string[],
  options: readonly string[],
  inlineOptions: readonly string[] = [],
): string | null {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (options.includes(token)) return tokens[index + 1] ?? null;
    const inlineOption = inlineOptions.find((option) => token.startsWith(`${option}=`));
    if (inlineOption !== undefined) return token.slice(inlineOption.length + 1);
  }
  return null;
}

function hasChangeBudgetDenialClass(
  value: NormalizedChangeBudgetClass | null,
): value is 'operator-recovery' | 'unsupported' {
  return value === 'operator-recovery' || value === 'unsupported';
}

function classifyChangeBudgetCommandText(
  commandText: string,
  shellDepth = 0,
  inheritedWellFormed = true,
  nodeCliIdentity?: ChangeBudgetNodeCliIdentityContext,
): NormalizedChangeBudgetClass | null {
  const substitutionClass = classifyCommandSubstitutions(
    commandText,
    shellDepth,
    inheritedWellFormed,
    nodeCliIdentity,
  );
  if (hasChangeBudgetDenialClass(substitutionClass)) return substitutionClass;

  const scan = splitUnquotedShellSegments(commandText);
  const commandClasses: NormalizedChangeBudgetClass[] = [];
  const wellFormed = inheritedWellFormed && scan.wellFormed;

  for (const segment of scan.segments) {
    const tokenized = tokenizeCommandLine(segment);
    const tokens = tokenized.tokens;
    if (tokens.length === 0) continue;

    const shell = tokens[0]?.toLowerCase();
    const npmSeparatorIndex = shell === 'npm' && tokens[1]?.toLowerCase() === 'exec'
      ? tokens.indexOf('--', 2)
      : -1;
    const npmOptionTokens = npmSeparatorIndex >= 0 ? tokens.slice(0, npmSeparatorIndex) : tokens;
    const npmCallString = shell === 'npm' && tokens[1]?.toLowerCase() === 'exec'
      ? optionCommandString(npmOptionTokens, ['--call', '-c'], ['--call', '-c'])
      : null;
    const npxCallString = shell === 'npx'
      && (tokens[1] === '-c' || tokens[1] === '--call' || tokens[1]?.startsWith('--call='))
      ? optionCommandString(tokens.slice(0, 3), ['-c', '--call'], ['--call'])
      : null;
    const commandStringClass = npmCallString === null && npxCallString === null
      ? null
      : classifyChangeBudgetCommandText(
        npmCallString ?? npxCallString ?? '',
        shellDepth + 1,
        wellFormed && tokenized.wellFormed,
        nodeCliIdentity,
      );
    if (hasChangeBudgetDenialClass(commandStringClass)) {
      commandClasses.push(commandStringClass);
      continue;
    }

    if (['bash', 'sh', 'zsh'].includes(shell ?? '') && ['-c', '-lc'].includes(tokens[1] ?? '')) {
      const nestedText = tokens[2];
      if (nestedText === undefined) continue;
      const nestedClass = shellDepth >= CHANGE_BUDGET_SHELL_DEPTH_LIMIT
        ? classifyChangeBudgetAtInspectionLimit(
          nestedText,
          wellFormed && tokenized.wellFormed,
          nodeCliIdentity,
        )
        : classifyChangeBudgetCommandText(
          nestedText,
          shellDepth + 1,
          wellFormed && tokenized.wellFormed,
          nodeCliIdentity,
        );
      if (nestedClass !== null) {
        // A shell -c command string with extra positional arguments is not an
        // argv-preserving wrapper shape; keep it denied but unsupported.
        commandClasses.push(
          !wellFormed || !tokenized.wellFormed || shellDepth >= CHANGE_BUDGET_SHELL_DEPTH_LIMIT
            || tokens.length !== 3
            ? 'unsupported'
            : nestedClass,
        );
      } else if (tokens.length > 3 && tokens[2] === 'changebudget') {
        commandClasses.push('unsupported');
      }
      continue;
    }

    const normalized = normalizeChangeBudgetCommand(
      tokens,
      nodeCliIdentity,
      wellFormed && tokenized.wellFormed,
    );
    if (normalized.identity === 'ambiguous') {
      commandClasses.push('unsupported');
    } else if (normalized.identity === 'first-party') {
      commandClasses.push(classifyChangeBudgetArguments(normalized.canonicalArgv.slice(1)));
    }
  }

  if (scan.overflow) return 'unsupported';
  if (commandClasses.length === 0) return null;
  if (scan.hasOperator || !wellFormed || commandClasses.length > 1) return 'unsupported';
  return commandClasses[0] ?? 'unsupported';
}

function operationFromChangeBudgetClass(changeBudgetClass: NormalizedChangeBudgetClass): OperationContext {
  if (changeBudgetClass === 'read-only') {
    return {
      operationClass: 'read-only',
      mutationIntent: 'read-only',
      rawTargetPath: null,
      isTargetResolved: true,
      tool: 'changebudget',
    };
  }
  if (changeBudgetClass === 'operator-recovery') {
    return {
      operationClass: 'changebudget-operator-recovery',
      mutationIntent: 'mutate',
      rawTargetPath: null,
      isTargetResolved: true,
      tool: 'changebudget',
    };
  }
  if (changeBudgetClass === 'managed-mutation' || changeBudgetClass === 'force-close'
    || changeBudgetClass === 'external-mutation') {
    return {
      operationClass: changeBudgetClass === 'force-close'
        ? 'changebudget-force-close'
        : changeBudgetClass === 'external-mutation'
          ? 'changebudget-external-mutation'
          : 'changebudget-managed-mutation',
      mutationIntent: 'mutate',
      rawTargetPath: null,
      isTargetResolved: true,
      tool: 'changebudget',
    };
  }
  return {
    operationClass: 'changebudget-unsupported',
    mutationIntent: 'mutate',
    rawTargetPath: null,
    isTargetResolved: false,
    tool: 'changebudget',
  };
}

function isGitStatusResourceWithSplitOptionValue(commandText: string): boolean {
  const parsed = parseCommandResource(commandText);
  if (parsed.command !== 'git' || hasShellControlOperator(parsed.commandTextToAnalyze)) return false;
  const subcommandIndex = findGitSubcommandIndex(parsed.commandTokens);
  if (subcommandIndex === null || parsed.commandTokens[subcommandIndex].toLowerCase() !== 'status') return false;
  const lastToken = parsed.commandTokens.at(-1)?.toLowerCase();
  return lastToken !== undefined && GIT_STATUS_OPTIONS_WITH_SPLIT_VALUES.has(lastToken);
}

function isGitStatusPathspecFragment(resource: string): boolean {
  if (hasShellControlOperator(resource)) return false;
  const tokens = splitCommandLine(resource);
  if (tokens.length === 0 || !tokens.every(looksLikePath)) return false;

  const firstToken = stripWrappingQuotes(tokens[0]);
  return !/^(?:\.\.?[\\/]|[\\/]{1,2}|[A-Za-z]:[\\/])/i.test(firstToken);
}

function extractCommandContext(
  commandText: string,
  nodeCliIdentity: ChangeBudgetNodeCliIdentityContext,
): OperationContext {
  const normalizedChangeBudgetClass = classifyChangeBudgetCommandText(commandText, 0, true, nodeCliIdentity);
  if (normalizedChangeBudgetClass !== null) {
    return operationFromChangeBudgetClass(normalizedChangeBudgetClass);
  }

  const { command, commandTokens, commandTextToAnalyze } = parseCommandResource(commandText);
  const hasShellOperator = hasShellControlOperator(commandTextToAnalyze);

  const mutationIntent = inferCommandMutationIntent(command, commandTokens, commandTextToAnalyze);
  const rawTargetPath = mutationIntent === 'read-only' || (command === 'git' && hasShellOperator)
    ? null
    : extractPathFromCommand(command, commandTokens);
  return {
    operationClass: mutationIntent === 'read-only'
      ? 'read-only'
      : rawTargetPath === null ? 'unresolved-mutation' : 'repository-mutation',
    mutationIntent,
    rawTargetPath,
    isTargetResolved: mutationIntent === 'read-only' || rawTargetPath !== null,
    tool: command,
  };
}

function buildOperationContexts(
  action: string,
  resources: readonly string[],
  nodeCliIdentity: ChangeBudgetNodeCliIdentityContext,
): OperationContext[] {
  const normalizedAction = action.toLowerCase();
  if (normalizedAction === 'edit') {
    return (resources.length > 0 ? resources : [null]).map((resource) => ({
      operationClass: 'repository-mutation',
      mutationIntent: 'mutate',
      rawTargetPath: resource,
      isTargetResolved: resource !== null,
      tool: 'edit',
    }));
  }
  if (normalizedAction === 'shell') {
    const commandResources = resources.length > 0 ? resources : [''];
    const pathspecFragments = new Set<number>();
    for (let index = 0; index < commandResources.length - 1; index += 1) {
      if (!isGitStatusResourceWithSplitOptionValue(commandResources[index])) continue;
      for (let next = index + 1; next < commandResources.length; next += 1) {
        if (!isGitStatusPathspecFragment(commandResources[next])) break;
        pathspecFragments.add(next);
      }
    }
    return commandResources
      .filter((_resource, index) => !pathspecFragments.has(index))
      .map((resource) => extractCommandContext(resource, nodeCliIdentity));
  }

  const readOnly = READ_ONLY_ACTIONS.has(normalizedAction) || normalizedAction !== 'edit';
  return [{
    mutationIntent: readOnly ? 'read-only' : 'mutate',
    operationClass: readOnly ? 'read-only' : 'repository-mutation',
    rawTargetPath: null,
    isTargetResolved: false,
    tool: normalizedAction,
  }];
}

function buildPathRules(contract: RuntimeEvaluationResult['contract'], targetPaths: readonly string[]): {
  isPathDenied: boolean;
  isPathNotAllowed: boolean;
} {
  if (!contract || targetPaths.length === 0) return { isPathDenied: false, isPathNotAllowed: false };
  try {
    const denyPatterns = compilePathPatterns(contract.deny_paths);
    const allowPatterns = compilePathPatterns(contract.allow_paths);
    const isPathDenied = targetPaths.some((targetPath) => matchPathPattern(targetPath, denyPatterns));
    const isPathAllowed = targetPaths.every(
      (targetPath) => allowPatterns.length === 0 || matchPathPattern(targetPath, allowPatterns),
    );
    return { isPathDenied, isPathNotAllowed: !isPathAllowed };
  } catch {
    return { isPathDenied: false, isPathNotAllowed: true };
  }
}

function buildSensitiveFlags(
  targetPaths: readonly string[],
  contract: RuntimeEvaluationResult['contract'],
): RuntimeSensitiveInput {
  const lowers = targetPaths.map((targetPath) => normalizeForRepo(targetPath).toLowerCase());
  const matchesAnyPath = (pattern: RegExp): boolean => lowers.some((targetPath) => pattern.test(targetPath));
  const dependencies =
    matchesAnyPath(/(^|\/)package\.json$/i)
    || matchesAnyPath(/(^|\/)package-lock\.json$/i)
    || matchesAnyPath(/(^|\/)pnpm-lock\.yaml$/i)
    || matchesAnyPath(/(^|\/)yarn\.lock$/i)
    || matchesAnyPath(/(^|\/)requirements\.txt$/i)
    || matchesAnyPath(/(^|\/)poetry\.lock$/i)
    || matchesAnyPath(/(^|\/)pyproject\.toml$/i)
    || matchesAnyPath(/(^|\/)go\.mod$/i)
    || matchesAnyPath(/(^|\/)Cargo\.toml$/i)
    || matchesAnyPath(/(^|\/)Gemfile(\.lock)?$/i)
    || matchesAnyPath(/(^|\/)composer\.json$/i);
  const migrations = matchesAnyPath(/(^|\/)migration(s)?(\/|$)/i) || matchesAnyPath(/(^|\/)migrations?$/i);
  const config =
    lowers.some((targetPath) => {
      const filename = targetPath.slice(targetPath.lastIndexOf('/') + 1);
      return filename === '.env' || filename.startsWith('.env.');
    })
    || matchesAnyPath(/(^|\/)\.config\//i)
    || matchesAnyPath(/(^|\/)tsconfig(\.json)?$/i)
    || matchesAnyPath(/(^|\/)eslint(\.config)?\./i)
    || matchesAnyPath(/(^|\/)prettier(\.config)?\./i)
    || matchesAnyPath(/(^|\/)vite\.config/i)
    || matchesAnyPath(/(^|\/)webpack\.config/i)
    || matchesAnyPath(/(^|\/)rollup\.config/i)
    || matchesAnyPath(/(^|\/)config\//i);
  const publicApi =
    matchesAnyPath(/(^|\/)public\//i)
    || matchesAnyPath(/(^|\/)api\//i)
    || matchesAnyPath(/(^|\/)routes\//i)
    || matchesAnyPath(/(^|\/)controllers\//i)
    || matchesAnyPath(/(^|\/)dto\//i)
    || matchesAnyPath(/(^|\/)openapi\//i)
    || matchesAnyPath(/(^|\/)schema\.ts$/i)
    || matchesAnyPath(/(^|\/)\.d\.ts$/i)
    || lowers.some((targetPath) => /(^|\/)index\.ts$/i.test(targetPath) && targetPath.includes('api'));
  return {
    dependencies: dependencies && !contract?.allow_new_dependencies,
    migrations: migrations && !contract?.allow_migrations,
    config: config && !contract?.allow_config_changes,
    publicApi: publicApi && !contract?.allow_public_api_changes,
  };
}

async function toRuntimeContext(
  repositoryRoot: string,
  operation: OperationContext,
  evaluation: RuntimeEvaluationResult,
): Promise<ProjectedDecisionInput> {
  const targetPath = operation.rawTargetPath === null
    ? null
    : toRepoRelativePath(repositoryRoot, operation.rawTargetPath);

  if (operation.rawTargetPath === null || targetPath === null) {
    return {
      policyDecision: evaluation.policyDecision,
      executionGateResult: evaluation.executionGateResult,
      mutationIntent: operation.mutationIntent,
      operationClass: operation.operationClass,
      targetPath: null,
      isInited: evaluation.isInited,
      isPathDenied: false,
      isPathNotAllowed: false,
      isSensitive: { dependencies: false, migrations: false, config: false, publicApi: false },
      newFileDenied: false,
      targetInChangeBudget: false,
      isTargetResolved: operation.isTargetResolved,
    };
  }

  const forceUnresolved = evaluation.isInited && evaluation.contract === null;
  const targetClassification = await classifyTargetCreation({ repositoryRoot, targetPath });
  const isTargetResolved = !forceUnresolved && targetClassification.state !== 'unsafe';
  const targetPaths = targetClassification.effectivePath === null
    ? [targetClassification.lexicalPath]
    : [targetClassification.lexicalPath, targetClassification.effectivePath];
  const pathRules = buildPathRules(evaluation.contract, targetPaths);
  return {
    policyDecision: evaluation.policyDecision,
    executionGateResult: evaluation.executionGateResult,
    mutationIntent: operation.mutationIntent,
    operationClass: operation.operationClass,
    targetPath,
    isInited: evaluation.isInited,
    isPathDenied: pathRules.isPathDenied,
    isPathNotAllowed: pathRules.isPathNotAllowed,
    isSensitive: evaluation.contract ? buildSensitiveFlags(targetPaths, evaluation.contract) : {
      dependencies: false,
      migrations: false,
      config: false,
      publicApi: false,
    },
    newFileDenied: evaluation.contract !== null
      && targetClassification.state === 'new-file'
      && !evaluation.contract.allow_new_files,
    targetInChangeBudget: isChangeBudgetTarget(targetPaths),
    isTargetResolved,
  };
}

async function resolveProjectRoot(directory: string): Promise<string> {
  try {
    return await getRepositoryRoot(directory);
  } catch {
    return directory;
  }
}

function permissionRank(effect: string): number {
  return effect === 'deny' ? 2 : effect === 'ask' ? 1 : 0;
}

function projectionRank(action: 'allow' | 'ask' | 'block'): number {
  return action === 'block' ? 2 : action === 'ask' ? 1 : 0;
}

function effectFromRank(rank: number): 'allow' | 'ask' | 'deny' {
  return rank >= 2 ? 'deny' : rank === 1 ? 'ask' : 'allow';
}

const plugin = Plugin.define({
  id: 'changebudget',
  async setup(context) {
    const repositoryRoot = await resolveProjectRoot(context.location.directory);
    const nodeCliIdentity: ChangeBudgetNodeCliIdentityContext = {
      packageRoot: CHANGE_BUDGET_PACKAGE_ROOT,
      workingDirectory: context.location.directory,
      canonicalCliEntryPath: CHANGE_BUDGET_CLI_ENTRY_PATH,
    };
    const sessionRegistration = await context.session.hook('context', (event) => {
      const alreadyAdded = event.system.some((part) => (
        'text' in part
        && typeof part.text === 'string'
        && part.text.includes('ChangeBudget is the scope authority')
      ));
      if (!alreadyAdded) event.system.push({ type: 'text', text: CHANGE_BUDGET_INSTRUCTIONS });
    });
    const permissionRegistration = await context.permission.hook('evaluate', async (event) => {
      try {
        const materialDecision: RuntimeMaterialDecisionInput = isRecord(event.metadata)
          && Object.prototype.hasOwnProperty.call(event.metadata, 'materialDecision')
          ? normalizeRuntimeMaterialDecision(event.metadata.materialDecision)
          : { kind: 'ABSENT' };
        const evaluation = await evaluateRuntimeDecision(repositoryRoot, materialDecision);
        const contexts = buildOperationContexts(event.action, event.resources, nodeCliIdentity);
        const projections = [];
        for (const operation of contexts) {
          const runtimeContext = await toRuntimeContext(repositoryRoot, operation, evaluation);
          projections.push(projectRuntimeDecision(runtimeContext));
        }

        const mostRestrictive = projections.reduce((selected, candidate) => (
          projectionRank(candidate.runtimeAction) > projectionRank(selected.runtimeAction) ? candidate : selected
        ));
        const finalRank = Math.max(permissionRank(event.effect), projectionRank(mostRestrictive.runtimeAction));
        event.effect = effectFromRank(finalRank);
        if (event.effect !== 'allow') event.message = mostRestrictive.message;
      } catch {
        event.effect = 'deny';
        event.message = `${RUNTIME_RULES.HUMAN_REVIEW} (${RUNTIME_RULES.HUMAN_REVIEW}).`;
      }
    });

    return async () => {
      await Promise.all([sessionRegistration.dispose(), permissionRegistration.dispose()]);
    };
  },
});

export default plugin;
