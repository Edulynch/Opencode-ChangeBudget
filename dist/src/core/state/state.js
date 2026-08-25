import { rm, mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CURRENT_SCHEMA_VERSION, isLifecycleState } from '../../models/lifecycle-state.js';
import { IOStateError, StateCorruptionError } from '../../models/errors.js';
import { verifyEvidenceDescriptor } from '../baseline/integrity.js';
export const CHANGEBUDGET_DIR = '.changebudget';
export const STATE_FILE = 'state.json';
export const CONTRACTS_DIR = 'contracts';
export const HISTORY_FILE = 'history.json';
export const STACK_POLICY_OVERRIDES_FILE = 'stack-policy-overrides.json';
export const BASELINES_DIR = 'baselines';
export const DEFAULT_MAX_RENAME_ATTEMPTS = 3;
function defaultRenameDelayMs() {
    return 50 + Math.floor(Math.random() * 101);
}
async function renameWithRetry(renameImpl, tempFilePath, path, maxRenameAttempts, retryDelayMs) {
    let lastCode;
    for (let attempt = 0; attempt < maxRenameAttempts; attempt += 1) {
        try {
            await renameImpl(tempFilePath, path);
            return;
        }
        catch (error) {
            const renameError = error;
            lastCode = renameError.code;
            if (renameError.code !== 'EEXIST' && renameError.code !== 'EPERM') {
                throw error;
            }
            if (attempt < maxRenameAttempts - 1) {
                const delay = retryDelayMs();
                if (delay > 0) {
                    await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
        }
    }
    const exhausted = new Error(`rename failed with code ${lastCode ?? 'unknown'} after ${maxRenameAttempts} attempts`);
    exhausted.code = lastCode;
    throw exhausted;
}
export function createInitializedState() {
    return {
        schema_version: CURRENT_SCHEMA_VERSION,
        lifecycle_state: 'initialized',
        active_contract_id: null,
        last_closed_contract_id: null,
        updated_at: new Date().toISOString(),
    };
}
function isLifecycleStateRecord(value) {
    if (value === null || typeof value !== 'object') {
        return false;
    }
    const candidate = value;
    if (typeof candidate.schema_version !== 'string' || !candidate.schema_version.trim().length) {
        return false;
    }
    if (typeof candidate.lifecycle_state !== 'string' || !isLifecycleState(candidate.lifecycle_state)) {
        return false;
    }
    const hasUpdatedAt = typeof candidate.updated_at === 'string' && candidate.updated_at.trim().length > 0;
    if (!hasUpdatedAt) {
        return false;
    }
    const hasActiveContractId = candidate.active_contract_id === undefined
        || candidate.active_contract_id === null
        || typeof candidate.active_contract_id === 'string';
    const hasLastClosedContractId = candidate.last_closed_contract_id === undefined
        || candidate.last_closed_contract_id === null
        || typeof candidate.last_closed_contract_id === 'string';
    return hasActiveContractId && hasLastClosedContractId;
}
function normalizeLifecycleStateRecord(value) {
    return {
        schema_version: String(value.schema_version),
        lifecycle_state: value.lifecycle_state,
        active_contract_id: typeof value.active_contract_id === 'string' ? value.active_contract_id : null,
        last_closed_contract_id: typeof value.last_closed_contract_id === 'string' ? value.last_closed_contract_id : null,
        updated_at: String(value.updated_at),
    };
}
export async function readLifecycleState(repositoryRoot) {
    const loaded = await readJsonFileOptional(getStateFilePath(repositoryRoot));
    if (loaded === null) {
        return null;
    }
    if (!isLifecycleStateRecord(loaded)) {
        throw new StateCorruptionError('Lifecycle state file has invalid structure', {
            path: getStateFilePath(repositoryRoot),
            valueType: typeof loaded,
        });
    }
    return normalizeLifecycleStateRecord(loaded);
}
export async function writeLifecycleState(repositoryRoot, state) {
    await writeJsonFileAtomic(getStateFilePath(repositoryRoot), state);
}
export async function initializeLifecycleState(repositoryRoot) {
    const existing = await readLifecycleState(repositoryRoot);
    if (existing) {
        return {
            state: existing,
            changed: false,
        };
    }
    await ensureDirectory(getContractsDirectoryPath(repositoryRoot));
    const state = createInitializedState();
    await writeLifecycleState(repositoryRoot, state);
    return {
        state,
        changed: true,
    };
}
export function getChangeBudgetDirectory(repositoryRoot) {
    return join(repositoryRoot, CHANGEBUDGET_DIR);
}
export function getStateFilePath(repositoryRoot) {
    return join(getChangeBudgetDirectory(repositoryRoot), STATE_FILE);
}
export function getContractsDirectoryPath(repositoryRoot) {
    return join(getChangeBudgetDirectory(repositoryRoot), CONTRACTS_DIR);
}
export function getStackPolicyOverridesFilePath(repositoryRoot) {
    return join(getChangeBudgetDirectory(repositoryRoot), STACK_POLICY_OVERRIDES_FILE);
}
export function getContractFilePath(repositoryRoot, contractId) {
    return join(getContractsDirectoryPath(repositoryRoot), `${contractId}.json`);
}
export function getHistoryFilePath(repositoryRoot) {
    return join(getContractsDirectoryPath(repositoryRoot), HISTORY_FILE);
}
export function getBaselineEvidencePath(repositoryRoot, contractId) {
    return join(getChangeBudgetDirectory(repositoryRoot), BASELINES_DIR, `${contractId}.json`);
}
export async function persistBaselineEvidence(repositoryRoot, evidence) {
    if (verifyEvidenceDescriptor(evidence).evidenceState !== 'valid') {
        throw new StateCorruptionError('Cannot persist baseline evidence with invalid integrity', { contractId: evidence.contractId });
    }
    await writeJsonFileAtomic(getBaselineEvidencePath(repositoryRoot, evidence.contractId), evidence);
}
export async function readBaselineEvidence(repositoryRoot, contractId) {
    const evidence = await readJsonFileOptional(getBaselineEvidencePath(repositoryRoot, contractId));
    if (evidence !== null && verifyEvidenceDescriptor(evidence).evidenceState !== 'valid') {
        throw new StateCorruptionError('Baseline evidence integrity verification failed', { contractId });
    }
    return evidence;
}
export async function removeBaselineEvidence(repositoryRoot, contractId) {
    await rm(getBaselineEvidencePath(repositoryRoot, contractId), { force: true });
}
export async function ensureDirectory(path) {
    await mkdir(path, { recursive: true });
}
export async function pathExists(path) {
    try {
        await access(path, fsConstants.F_OK);
        return true;
    }
    catch {
        return false;
    }
}
function sortObjectRecursively(value) {
    if (Array.isArray(value)) {
        return value.map(sortObjectRecursively);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }
    const entries = Object.entries(value);
    const prioritized = entries.filter(([key]) => key === 'schema_version');
    const sorted = entries
        .filter(([key]) => key !== 'schema_version')
        .sort(([left], [right]) => left.localeCompare(right));
    return Object.fromEntries([...prioritized, ...sorted].map(([key, val]) => [key, sortObjectRecursively(val)]));
}
function buildStableJson(value) {
    return `${JSON.stringify(sortObjectRecursively(value), null, 2)}\n`;
}
export async function readJsonFile(path) {
    let content;
    try {
        content = await readFile(path, 'utf8');
    }
    catch (error) {
        const osError = error;
        throw new IOStateError(`Unable to read JSON file at ${path}`, {
            path,
            code: typeof osError.code === 'string' ? osError.code : undefined,
            cause: error instanceof Error ? error.message : JSON.stringify(error),
        });
    }
    try {
        return JSON.parse(content);
    }
    catch (error) {
        throw new StateCorruptionError(`Invalid JSON in file ${path}`, {
            path,
            cause: error instanceof Error ? error.message : JSON.stringify(error),
        });
    }
}
export async function readJsonFileOptional(path) {
    try {
        return await readJsonFile(path);
    }
    catch (error) {
        if (error instanceof IOStateError && error.context.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
export async function writeJsonFileAtomic(path, value, options = {}) {
    await ensureDirectory(dirname(path));
    const payload = buildStableJson(value);
    const tempFilePath = `${path}.${Date.now()}.${randomUUID()}.tmp`;
    const renameImpl = options.renameImpl ?? rename;
    const maxRenameAttempts = options.maxRenameAttempts ?? DEFAULT_MAX_RENAME_ATTEMPTS;
    const retryDelayMs = options.retryDelayMs ?? defaultRenameDelayMs;
    try {
        await writeFile(tempFilePath, payload, 'utf8');
        await renameWithRetry(renameImpl, tempFilePath, path, maxRenameAttempts, retryDelayMs);
    }
    catch (error) {
        await rm(tempFilePath, { force: true });
        throw new IOStateError(`Failed writing JSON atomically to ${path}`, {
            path,
            cause: error instanceof Error ? error.message : JSON.stringify(error),
        });
    }
}
//# sourceMappingURL=state.js.map