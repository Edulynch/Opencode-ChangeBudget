export const TINY_MAX_TRACKED_FILES = 5;
export const TINY_MAX_DECLARED_PATHS = 2;
export const NORMAL_MAX_TRACKED_FILES = 50;
export const NORMAL_MAX_DECLARED_PATHS = 3;
export const HIGH_RISK_CATEGORIES = ['migrations', 'release_artifacts'] as const;
export const SENSITIVE_CATEGORIES = [
  'dependencies',
  'migrations',
  'configuration',
  'public_api',
  'release_artifacts',
] as const;

export const DIAGNOSIS_OUTCOMES = ['tiny', 'normal', 'free', 'manual_review'] as const;
export type DiagnosisOutcome = (typeof DIAGNOSIS_OUTCOMES)[number];

export const DIAGNOSIS_SOURCES = ['explicit', 'inferred'] as const;
export type DiagnosisSource = (typeof DIAGNOSIS_SOURCES)[number];

export const DIAGNOSIS_SIGNALS = [
  'declared_paths',
  'tracked_files',
  'task_id',
  'task_budget_default',
  'sensitive_category',
] as const;
export type DiagnosisSignal = (typeof DIAGNOSIS_SIGNALS)[number];

export interface DiagnoseInput {
  task_id: string | null;
  task_description: string | null;
  allow_paths: string[];
  deny_paths: string[];
  stack_profile: string | null;
  json: boolean;
}

export interface ObservableSignals {
  declared_path_count: number;
  tracked_file_count: number | null;
  sensitive_categories: string[];
  task_id: string | null;
  task_budget_default: 'tiny' | 'normal' | 'free' | null;
}

export interface RecommendationReason {
  signal: string;
  value: string | number;
}

export interface DiagnosisResult {
  recommendation: DiagnosisOutcome;
  source: DiagnosisSource;
  reasons: RecommendationReason[];
  inputs: DiagnoseInput;
}

export function isDiagnosisOutcome(value: string): value is DiagnosisOutcome {
  return (DIAGNOSIS_OUTCOMES as readonly string[]).includes(value);
}
