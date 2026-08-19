import { rm, mkdir, readFile, writeFile, rename, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { CURRENT_SCHEMA_VERSION, LifecycleState, LifecycleStateRecord, isLifecycleState } from '../../models/lifecycle-state.js';
import { IOStateError, StateCorruptionError } from '../../models/errors.js';

export const CHANGEBUDGET_DIR = '.changebudget';
export const STATE_FILE = 'state.json';
export const CONTRACTS_DIR = 'contracts';
export const HISTORY_FILE = 'history.json';
export const STACK_POLICY_OVERRIDES_FILE = 'stack-policy-overrides.json';

export interface LifecycleStateResult {
  state: LifecycleStateRecord;
  changed: boolean;
}

export interface AtomicWriteOptions {
  renameImpl?: (from: string, to: string) => Promise<void>;
  retryDelayMs?: () => number;
  maxRenameAttempts?: number;
}

export const DEFAULT_MAX_RENAME_ATTEMPTS = 3;

function defaultRenameDelayMs(): number {
  return 50 + Math.floor(Math.random() * 101);
}

async function renameWithRetry(
  renameImpl: (from: string, to: string) => Promise<void>,
  tempFilePath: string,
  path: string,
  maxRenameAttempts: number,
  retryDelayMs: () => number,
): Promise<void> {
  let lastCode: string | undefined;

  for (let attempt = 0; attempt < maxRenameAttempts; attempt += 1) {
    try {
      await renameImpl(tempFilePath, path);
      return;
    } catch (error) {
      const renameError = error as NodeJS.ErrnoException;
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

  const exhausted = new Error(
    `rename failed with code ${lastCode ?? 'unknown'} after ${maxRenameAttempts} attempts`,
  ) as NodeJS.ErrnoException;
  exhausted.code = lastCode;
  throw exhausted;
}

export function createInitializedState(): LifecycleStateRecord {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    lifecycle_state: 'initialized',
    active_contract_id: null,
    last_closed_contract_id: null,
    updated_at: new Date().toISOString(),
  };
}

function isLifecycleStateRecord(value: unknown): value is LifecycleStateRecord {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.schema_version !== 'string' || !candidate.schema_version.trim().length) {
    return false;
  }

  if (typeof candidate.lifecycle_state !== 'string' || !isLifecycleState(candidate.lifecycle_state as LifecycleState)) {
    return false;
  }

  const hasUpdatedAt = typeof candidate.updated_at === 'string' && candidate.updated_at.trim().length > 0;
  if (!hasUpdatedAt) {
    return false;
  }

  const hasActiveContractId =
    candidate.active_contract_id === undefined
    || candidate.active_contract_id === null
    || typeof candidate.active_contract_id === 'string';

  const hasLastClosedContractId =
    candidate.last_closed_contract_id === undefined
    || candidate.last_closed_contract_id === null
    || typeof candidate.last_closed_contract_id === 'string';

  return hasActiveContractId && hasLastClosedContractId;
}

function normalizeLifecycleStateRecord(value: Record<string, unknown>): LifecycleStateRecord {
  return {
    schema_version: String(value.schema_version),
    lifecycle_state: value.lifecycle_state as LifecycleState,
    active_contract_id: typeof value.active_contract_id === 'string' ? value.active_contract_id : null,
    last_closed_contract_id:
      typeof value.last_closed_contract_id === 'string' ? value.last_closed_contract_id : null,
    updated_at: String(value.updated_at),
  };
}

export async function readLifecycleState(repositoryRoot: string): Promise<LifecycleStateRecord | null> {
  const loaded = await readJsonFileOptional<unknown>(getStateFilePath(repositoryRoot));
  if (loaded === null) {
    return null;
  }

  if (!isLifecycleStateRecord(loaded)) {
    throw new StateCorruptionError('Lifecycle state file has invalid structure', {
      path: getStateFilePath(repositoryRoot),
      valueType: typeof loaded,
    });
  }

  return normalizeLifecycleStateRecord(loaded as unknown as Record<string, unknown>);
}

export async function writeLifecycleState(repositoryRoot: string, state: LifecycleStateRecord): Promise<void> {
  await writeJsonFileAtomic(getStateFilePath(repositoryRoot), state);
}

export async function initializeLifecycleState(
  repositoryRoot: string,
): Promise<LifecycleStateResult> {
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

export function getChangeBudgetDirectory(repositoryRoot: string): string {
  return join(repositoryRoot, CHANGEBUDGET_DIR);
}

export function getStateFilePath(repositoryRoot: string): string {
  return join(getChangeBudgetDirectory(repositoryRoot), STATE_FILE);
}

export function getContractsDirectoryPath(repositoryRoot: string): string {
  return join(getChangeBudgetDirectory(repositoryRoot), CONTRACTS_DIR);
}

export function getStackPolicyOverridesFilePath(repositoryRoot: string): string {
  return join(getChangeBudgetDirectory(repositoryRoot), STACK_POLICY_OVERRIDES_FILE);
}

export function getContractFilePath(repositoryRoot: string, contractId: string): string {
  return join(getContractsDirectoryPath(repositoryRoot), `${contractId}.json`);
}

export function getHistoryFilePath(repositoryRoot: string): string {
  return join(getContractsDirectoryPath(repositoryRoot), HISTORY_FILE);
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function sortObjectRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectRecursively);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const prioritized = entries.filter(([key]) => key === 'schema_version');
  const sorted = entries
    .filter(([key]) => key !== 'schema_version')
    .sort(([left], [right]) => left.localeCompare(right));

  return Object.fromEntries(
    [...prioritized, ...sorted].map(([key, val]) => [key, sortObjectRecursively(val)]),
  );
}

function buildStableJson(value: unknown): string {
  return `${JSON.stringify(sortObjectRecursively(value), null, 2)}\n`;
}

export async function readJsonFile<T>(path: string): Promise<T> {
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    const osError = error as NodeJS.ErrnoException;
    throw new IOStateError(`Unable to read JSON file at ${path}`, {
      path,
      code: typeof osError.code === 'string' ? osError.code : undefined,
      cause: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }

  try {
    return JSON.parse(content) as T;
  } catch (error) {
    throw new StateCorruptionError(`Invalid JSON in file ${path}`,
      {
        path,
        cause: error instanceof Error ? error.message : JSON.stringify(error),
      },
    );
  }
}

export async function readJsonFileOptional<T>(path: string): Promise<T | null> {
  try {
    return await readJsonFile<T>(path);
  } catch (error) {
    if (error instanceof IOStateError && error.context.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

export async function writeJsonFileAtomic<T>(
  path: string,
  value: T,
  options: AtomicWriteOptions = {},
): Promise<void> {
  await ensureDirectory(dirname(path));

  const payload = buildStableJson(value);
  const tempFilePath = `${path}.${Date.now()}.${randomUUID()}.tmp`;
  const renameImpl = options.renameImpl ?? rename;
  const maxRenameAttempts = options.maxRenameAttempts ?? DEFAULT_MAX_RENAME_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? defaultRenameDelayMs;

  try {
    await writeFile(tempFilePath, payload, 'utf8');
    await renameWithRetry(renameImpl, tempFilePath, path, maxRenameAttempts, retryDelayMs);
  } catch (error) {
    await rm(tempFilePath, { force: true });
    throw new IOStateError(`Failed writing JSON atomically to ${path}`, {
      path,
      cause: error instanceof Error ? error.message : JSON.stringify(error),
    });
  }
}
