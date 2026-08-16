import {
  CONTRACT_PRESETS,
  isContractPreset,
  ParsedContractInput,
  ContractPreset,
} from '../../models/change-contract.js';
import { ContractValidationFailure } from '../../core/validation/contract-validator.js';
import { readJsonFile } from '../../core/state/state.js';
import { readContract } from '../../core/state/contracts.js';
import { join, isAbsolute, win32 } from 'node:path';
import {
  readLifecycleState,
} from '../../core/state/state.js';
import { InputValidationError } from '../../models/errors.js';
import { ensureGitRepository } from '../../core/git/repo.js';
import { normalizeValidatedContractInput, validateContractInput } from '../../core/validation/contract-validator.js';

export interface CheckResult {
  repositoryRoot: string;
  source: 'active' | 'draft';
  contractId: string | null;
}

function parseNextValue(args: string[], index: number): { value: string; nextIndex: number } {
  if (index + 1 >= args.length) {
    throw new InputValidationError('Missing value for --draft', 'draft');
  }

  const value = args[index + 1];
  if (value.startsWith('--')) {
    throw new InputValidationError('Missing value for --draft', 'draft');
  }

  return { value, nextIndex: index + 1 };
}

function parseCheckArgs(args: string[]): { draftPath?: string } {
  let draftPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith('--')) {
      throw new InputValidationError(`Unexpected positional argument: ${token}`, 'argument');
    }

    const pair = token.slice(2).split('=', 2);
    const key = pair[0].toLowerCase();
    const inlineValue = pair.length === 2 ? pair[1] : null;

    if (key === 'draft') {
      if (inlineValue === null) {
        const next = parseNextValue(args, index);
        draftPath = next.value;
        index = next.nextIndex;
      } else {
        draftPath = inlineValue;
      }
      continue;
    }

    throw new InputValidationError(`Unknown option --${key}`, `--${key}`);
  }

  if (draftPath && !draftPath.trim().length) {
    throw new InputValidationError('Draft path cannot be empty', 'draft', { value: draftPath });
  }

  return { draftPath };
}

function parseStringArray(
  failures: ContractValidationFailure[],
  field: 'allow_paths' | 'deny_paths',
  value: unknown,
): string[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    failures.push({
      field,
      message: `${field} must be a list of strings`,
    });
    return [];
  }

  const values: string[] = [];
  value.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      failures.push({
        field,
        message: `${field}[${index}] must be a non-empty path string`,
      });
      return;
    }

    const trimmed = entry.trim();
    if (!trimmed.length) {
      failures.push({
        field,
        message: `${field}[${index}] must be a non-empty path string`,
      });
      return;
    }

    values.push(trimmed);
  });

  return values;
}

function parseContractPayloadForValidation(payload: unknown): ParsedContractInput {
  const failures: ContractValidationFailure[] = [];
  const candidate = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : null;

  const booleanField = (field: keyof ParsedContractInput): boolean => {
    const value = candidate === null ? undefined : candidate[field];
    if (typeof value !== 'boolean') {
      failures.push({
        field,
        message: `${field} must be a boolean`,
      });
      return false;
    }

    return value;
  };

  const numericField = (field: 'max_files' | 'max_changed_lines'): number | null => {
    const value = candidate === null ? undefined : candidate[field];

    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      failures.push({
        field,
        message: `${field} must be a non-negative integer`,
      });
      return null;
    }

    return value;
  };

  const stringField = (field: 'task_description' | 'base_revision'): string | null => {
    const value = candidate === null ? undefined : candidate[field];
    if (typeof value !== 'string') {
      failures.push({
        field,
        message: `${field} must be a string`,
      });
      return null;
    }

    return value;
  };

  const presetField = (): ContractPreset | null => {
    const value = candidate === null ? undefined : candidate.preset;
    if (value === undefined || value === null) {
      return null;
    }

    if (typeof value !== 'string' || !isContractPreset(value.toLowerCase())) {
      failures.push({
        field: 'preset',
        message: `preset must be one of ${CONTRACT_PRESETS.join(', ')}`,
      });
      return null;
    }

    return value.toLowerCase() as ContractPreset;
  };

  const parsed: ParsedContractInput = {
    task_description: stringField('task_description'),
    base_revision: stringField('base_revision'),
    allow_paths: parseStringArray(failures, 'allow_paths', candidate?.allow_paths),
    deny_paths: parseStringArray(failures, 'deny_paths', candidate?.deny_paths),
    max_files: numericField('max_files'),
    max_changed_lines: numericField('max_changed_lines'),
    allow_new_files: booleanField('allow_new_files'),
    allow_new_dependencies: booleanField('allow_new_dependencies'),
    allow_migrations: booleanField('allow_migrations'),
    allow_config_changes: booleanField('allow_config_changes'),
    allow_public_api_changes: booleanField('allow_public_api_changes'),
    preset: presetField(),
  };

  const result = validateContractInput(parsed);
  const combinedFailures = [...failures, ...result.errors];

  if (combinedFailures.length) {
    throw new InputValidationError(
      `Contract validation failed: ${combinedFailures.map((failure) => failure.field).join(', ')}`,
      'input',
      { errors: combinedFailures },
    );
  }

  return normalizeValidatedContractInput(parsed);
}

function getDraftContractPath(repositoryRoot: string, draftPath: string): string {
  if (isAbsolute(draftPath) || win32.isAbsolute(draftPath)) {
    return draftPath;
  }

  return join(repositoryRoot, draftPath);
}

async function validateDraftContract(repositoryRoot: string, draftPath: string): Promise<{ payload: unknown; resolvedPath: string }> {
  const resolvedPath = getDraftContractPath(repositoryRoot, draftPath);
  const payload = await readJsonFile<unknown>(resolvedPath);
  parseContractPayloadForValidation(payload);

  return { payload, resolvedPath };
}

export async function runCheck(repositoryRootHint = process.cwd(), args: string[] = []): Promise<CheckResult> {
  const repositoryRoot = await ensureGitRepository(repositoryRootHint);
  const { draftPath } = parseCheckArgs(args);

  if (draftPath) {
    const { payload } = await validateDraftContract(repositoryRoot, draftPath);
    const candidate = typeof payload === 'object' && payload !== null
      ? payload as Record<string, unknown>
      : null;

    return {
      repositoryRoot,
      source: 'draft',
      contractId: candidate === null ? null : (typeof candidate.id === 'string' ? candidate.id : null),
    };
  }

  const state = await readLifecycleState(repositoryRoot);
  if (!state || !state.active_contract_id) {
    throw new InputValidationError('No active contract to check and no draft path provided', 'state', {
      lifecycleState: state?.lifecycle_state ?? 'uninitialized',
    });
  }

  const active = await readContract(repositoryRoot, state.active_contract_id);
  parseContractPayloadForValidation(active);

  return {
    repositoryRoot,
    source: 'active',
    contractId: active.id,
  };
}
