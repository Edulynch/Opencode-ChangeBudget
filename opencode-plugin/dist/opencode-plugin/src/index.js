import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Plugin } from '@opencode/plugin';
const runtimeSourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../dist/src');
const [patternModule, gitModule] = await Promise.all([
    import(pathToFileURL(join(runtimeSourceRoot, 'core/check/patterns.js')).href),
    import(pathToFileURL(join(runtimeSourceRoot, 'core/git/repo.js')).href),
]);
const { compilePathPatterns, matchPathPattern } = patternModule;
const { getRepositoryRoot } = gitModule;
import { evaluateRuntimeDecision, } from './evaluator.js';
import { classifyTargetCreation } from './target-classification.js';
import { RUNTIME_RULES, projectRuntimeDecision, } from './projection.js';
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
const CHANGE_BUDGET_DIR = '.changebudget';
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
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toString(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}
function normalizeDecisionStringList(value) {
    if (!Array.isArray(value))
        return null;
    const normalized = value.map((entry) => typeof entry === 'string' ? entry.trim() : '');
    return normalized.every((entry) => entry.length > 0) ? normalized : null;
}
function normalizeMaterialDecision(value) {
    if (!isRecord(value))
        return undefined;
    const id = toString(value.id);
    const necessity = toString(value.necessity);
    const criterionRefs = normalizeDecisionStringList(value.criterion_refs);
    const evidence = normalizeDecisionStringList(value.evidence);
    const kind = toString(value.kind);
    if (id === null
        || (necessity !== 'optional' && necessity !== 'required')
        || criterionRefs === null
        || evidence === null
        || kind === null) {
        return undefined;
    }
    switch (kind) {
        case 'delegated_agent':
        case 'concurrent_worker': {
            if (!isRecord(value.requested) || typeof value.requested.amount !== 'number')
                return undefined;
            if (value.minimum_required !== undefined && typeof value.minimum_required !== 'number')
                return undefined;
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
            if (!isRecord(value.requested))
                return undefined;
            const requestedValue = toString(value.requested.value);
            if (requestedValue === null)
                return undefined;
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
            if (requestedPaths === null || typeof value.requests_new_files !== 'boolean')
                return undefined;
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
            if (operation === null)
                return undefined;
            return { id, kind, operation, necessity, criterion_refs: criterionRefs, evidence };
        }
        default:
            return undefined;
    }
}
function normalizeRuntimeMaterialDecision(value) {
    const proposal = normalizeMaterialDecision(value);
    return proposal === undefined ? { kind: 'INVALID' } : { kind: 'VALID', proposal };
}
function normalizeForRepo(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/').replace(/\/+/g, '/');
    if (normalized === '.')
        return '.';
    const withoutDotPrefix = normalized.replace(/^\.\//, '');
    let end = withoutDotPrefix.length;
    while (end > 0 && withoutDotPrefix[end - 1] === '/')
        end -= 1;
    return withoutDotPrefix.slice(0, end).replace(/^\/+/, '');
}
function stripWrappingQuotes(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2
        && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function looksLikePath(text) {
    const value = stripWrappingQuotes(text);
    if (!value.length || /[\r\n\0]/.test(value))
        return false;
    if (value.includes('*') || value.includes('?') || value.includes('[') || value.includes(']'))
        return false;
    if (value.startsWith('-') || value === '.' || value === '..' || value === '-')
        return false;
    if (value.startsWith('http://') || value.startsWith('https://'))
        return false;
    return value.includes('/') || value.includes('\\') || value.startsWith('.') || /\.[A-Za-z0-9]+$/.test(value);
}
function toRepoRelativePath(repositoryRoot, candidate) {
    const cleaned = stripWrappingQuotes(candidate);
    if (!looksLikePath(cleaned))
        return null;
    const absolute = isAbsolute(cleaned) ? cleaned : resolve(repositoryRoot, cleaned);
    const relativePath = relative(repositoryRoot, absolute);
    if (isAbsolute(relativePath))
        return null;
    const normalized = normalizeForRepo(relativePath);
    return normalized === '..' || normalized.startsWith('../') ? null : normalized;
}
function isChangeBudgetTarget(targetPaths) {
    return targetPaths.some((targetPath) => {
        const normalized = normalizeForRepo(targetPath);
        return normalized === CHANGE_BUDGET_DIR || normalized.startsWith(`${CHANGE_BUDGET_DIR}/`);
    });
}
function classifyByKeywords(value, mutateHints, readHints) {
    const lower = value.toLowerCase();
    if (mutateHints.some((token) => lower.includes(token)))
        return 'mutate';
    if (readHints.some((token) => lower.includes(token)))
        return 'read-only';
    return 'mutate';
}
function splitCommandLine(value) {
    const parts = [];
    let token = '';
    let quote = null;
    let escaped = false;
    for (const char of value) {
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
            }
            else if (/\s/.test(char)) {
                if (token.length > 0) {
                    parts.push(token);
                    token = '';
                }
            }
            else {
                token += char;
            }
            continue;
        }
        if (char === quote)
            quote = null;
        else
            token += char;
    }
    if (token.length > 0)
        parts.push(token);
    return parts;
}
function inferDependencyPathFromCommand(command, tokens) {
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
function inferMutationFromGitTokens(tokens) {
    const command = tokens[0]?.toLowerCase();
    if (!command)
        return 'mutate';
    if (new Set(['status', 'show', 'diff', 'log', 'branch', 'remote', 'rev-parse', 'fetch']).has(command)) {
        return 'read-only';
    }
    return 'mutate';
}
function inferCommandMutationIntent(command, tokens, commandText) {
    if (commandText.includes(' > ') || commandText.includes(' >> '))
        return 'mutate';
    if (command === 'git')
        return inferMutationFromGitTokens(tokens);
    return classifyByKeywords(command, MUTATE_COMMAND_HINTS, READ_ONLY_COMMAND_HINTS);
}
function findPathToken(tokens) {
    return tokens.find((token) => looksLikePath(token)) ?? null;
}
function extractPathFromCommand(command, tokens) {
    if (command === 'git') {
        const sub = tokens[0]?.toLowerCase();
        if (!sub)
            return null;
        if (['commit', 'merge', 'status'].includes(sub))
            return null;
        return findPathToken(tokens.slice(1));
    }
    return findPathToken(tokens) ?? inferDependencyPathFromCommand(command, tokens);
}
function extractCommandContext(commandText) {
    const tokens = splitCommandLine(commandText);
    const first = tokens[0]?.toLowerCase() ?? 'shell';
    let command = first;
    let commandTokens = tokens.slice(1);
    if (['bash', 'sh', 'zsh'].includes(command) && ['-c', '-lc'].includes(commandTokens[0] ?? '')) {
        const nested = splitCommandLine(commandTokens.slice(1).join(' '));
        command = nested[0]?.toLowerCase() ?? command;
        commandTokens = nested.slice(1);
    }
    const mutationIntent = inferCommandMutationIntent(command, commandTokens, commandText);
    const rawTargetPath = extractPathFromCommand(command, commandTokens);
    return {
        mutationIntent,
        rawTargetPath,
        isTargetResolved: rawTargetPath !== null,
        tool: command,
    };
}
function buildOperationContexts(action, resources) {
    const normalizedAction = action.toLowerCase();
    if (normalizedAction === 'edit') {
        return (resources.length > 0 ? resources : [null]).map((resource) => ({
            mutationIntent: 'mutate',
            rawTargetPath: resource,
            isTargetResolved: resource !== null,
            tool: 'edit',
        }));
    }
    if (normalizedAction === 'shell') {
        return (resources.length > 0 ? resources : ['']).map((resource) => extractCommandContext(resource));
    }
    const readOnly = READ_ONLY_ACTIONS.has(normalizedAction) || normalizedAction !== 'edit';
    return [{
            mutationIntent: readOnly ? 'read-only' : 'mutate',
            rawTargetPath: null,
            isTargetResolved: false,
            tool: normalizedAction,
        }];
}
function buildPathRules(contract, targetPaths) {
    if (!contract || targetPaths.length === 0)
        return { isPathDenied: false, isPathNotAllowed: false };
    try {
        const denyPatterns = compilePathPatterns(contract.deny_paths);
        const allowPatterns = compilePathPatterns(contract.allow_paths);
        const isPathDenied = targetPaths.some((targetPath) => matchPathPattern(targetPath, denyPatterns));
        const isPathAllowed = targetPaths.every((targetPath) => allowPatterns.length === 0 || matchPathPattern(targetPath, allowPatterns));
        return { isPathDenied, isPathNotAllowed: !isPathAllowed };
    }
    catch {
        return { isPathDenied: false, isPathNotAllowed: true };
    }
}
function buildSensitiveFlags(targetPaths, contract) {
    const lowers = targetPaths.map((targetPath) => normalizeForRepo(targetPath).toLowerCase());
    const matchesAnyPath = (pattern) => lowers.some((targetPath) => pattern.test(targetPath));
    const dependencies = matchesAnyPath(/(^|\/)package\.json$/i)
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
    const config = lowers.some((targetPath) => {
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
    const publicApi = matchesAnyPath(/(^|\/)public\//i)
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
async function toRuntimeContext(repositoryRoot, operation, evaluation) {
    const targetPath = operation.rawTargetPath === null
        ? null
        : toRepoRelativePath(repositoryRoot, operation.rawTargetPath);
    if (operation.rawTargetPath === null || targetPath === null) {
        return {
            policyDecision: evaluation.policyDecision,
            executionGateResult: evaluation.executionGateResult,
            mutationIntent: operation.mutationIntent,
            targetPath: null,
            isInited: evaluation.isInited,
            isPathDenied: false,
            isPathNotAllowed: false,
            isSensitive: { dependencies: false, migrations: false, config: false, publicApi: false },
            newFileDenied: false,
            targetInChangeBudget: false,
            isTargetResolved: operation.isTargetResolved && operation.mutationIntent === 'read-only',
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
async function resolveProjectRoot(directory) {
    try {
        return await getRepositoryRoot(directory);
    }
    catch {
        return directory;
    }
}
function permissionRank(effect) {
    return effect === 'deny' ? 2 : effect === 'ask' ? 1 : 0;
}
function projectionRank(action) {
    return action === 'block' ? 2 : action === 'ask' ? 1 : 0;
}
function effectFromRank(rank) {
    return rank >= 2 ? 'deny' : rank === 1 ? 'ask' : 'allow';
}
const plugin = Plugin.define({
    id: 'changebudget',
    async setup(context) {
        const repositoryRoot = await resolveProjectRoot(context.location.directory);
        const sessionRegistration = await context.session.hook('context', (event) => {
            const alreadyAdded = event.system.some((part) => ('text' in part
                && typeof part.text === 'string'
                && part.text.includes('ChangeBudget is the scope authority')));
            if (!alreadyAdded)
                event.system.push({ type: 'text', text: CHANGE_BUDGET_INSTRUCTIONS });
        });
        const permissionRegistration = await context.permission.hook('evaluate', async (event) => {
            try {
                const materialDecision = isRecord(event.metadata)
                    && Object.prototype.hasOwnProperty.call(event.metadata, 'materialDecision')
                    ? normalizeRuntimeMaterialDecision(event.metadata.materialDecision)
                    : { kind: 'ABSENT' };
                const evaluation = await evaluateRuntimeDecision(repositoryRoot, materialDecision);
                const contexts = buildOperationContexts(event.action, event.resources);
                const projections = [];
                for (const operation of contexts) {
                    const runtimeContext = await toRuntimeContext(repositoryRoot, operation, evaluation);
                    projections.push(projectRuntimeDecision(runtimeContext));
                }
                const mostRestrictive = projections.reduce((selected, candidate) => (projectionRank(candidate.runtimeAction) > projectionRank(selected.runtimeAction) ? candidate : selected));
                const finalRank = Math.max(permissionRank(event.effect), projectionRank(mostRestrictive.runtimeAction));
                event.effect = effectFromRank(finalRank);
                if (event.effect !== 'allow')
                    event.message = mostRestrictive.message;
            }
            catch {
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
//# sourceMappingURL=index.js.map