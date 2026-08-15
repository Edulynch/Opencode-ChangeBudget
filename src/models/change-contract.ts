import { CURRENT_SCHEMA_VERSION } from './lifecycle-state.js';

export const CONTRACT_STATUSES = ['draft', 'active', 'closed'] as const;
export const CONTRACT_PRESETS = ['tiny', 'normal', 'free', 'custom'] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];
export type ContractPreset = (typeof CONTRACT_PRESETS)[number];

export interface ChangeContract {
  schema_version: string;
  id: string;
  task_description: string;
  base_revision: string;
  allow_paths: string[];
  deny_paths: string[];
  max_files: number | null;
  max_changed_lines: number | null;
  allow_new_files: boolean;
  allow_new_dependencies: boolean;
  allow_migrations: boolean;
  allow_config_changes: boolean;
  allow_public_api_changes: boolean;
  preset: ContractPreset | null;
  status: ContractStatus;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  closed_by?: string | null;
  close_reason?: string | null;
}

export interface ParsedContractInput {
  task_description: string | null;
  base_revision: string | null;
  allow_paths: string[];
  deny_paths: string[];
  max_files: number | null;
  max_changed_lines: number | null;
  allow_new_files: boolean;
  allow_new_dependencies: boolean;
  allow_migrations: boolean;
  allow_config_changes: boolean;
  allow_public_api_changes: boolean;
  preset: ContractPreset | null;
}

export interface ValidatedContractInput {
  task_description: string;
  base_revision: string;
  allow_paths: string[];
  deny_paths: string[];
  max_files: number | null;
  max_changed_lines: number | null;
  allow_new_files: boolean;
  allow_new_dependencies: boolean;
  allow_migrations: boolean;
  allow_config_changes: boolean;
  allow_public_api_changes: boolean;
  preset: ContractPreset | null;
}

export function createDraftContract(
  input: ValidatedContractInput,
  id: string,
  createdAt: string,
): ChangeContract {
  return {
    schema_version: CURRENT_SCHEMA_VERSION,
    id,
    task_description: input.task_description,
    base_revision: input.base_revision,
    allow_paths: [...input.allow_paths],
    deny_paths: [...input.deny_paths],
    max_files: input.max_files,
    max_changed_lines: input.max_changed_lines,
    allow_new_files: input.allow_new_files,
    allow_new_dependencies: input.allow_new_dependencies,
    allow_migrations: input.allow_migrations,
    allow_config_changes: input.allow_config_changes,
    allow_public_api_changes: input.allow_public_api_changes,
    preset: input.preset,
    status: 'draft',
    created_at: createdAt,
    updated_at: createdAt,
    closed_at: null,
  };
}

export function isContractPreset(value: string): value is ContractPreset {
  return (CONTRACT_PRESETS as readonly string[]).includes(value);
}
