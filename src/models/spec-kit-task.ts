export const TASK_ID_PATTERN = /^[Tt][0-9]{3,}$/;

export interface ParsedTaskEntry {
  task_id: string;
  title: string;
  budget_annotation: string | null;
}

export type ParsedTaskLine =
  | { kind: 'ok'; entry: ParsedTaskEntry }
  | { kind: 'empty_title'; entry: ParsedTaskEntry };

export interface TaskSource {
  feature: string;
  relativePath: string;
}

export interface SpecKitTaskResolution {
  task_id: string;
  task_title: string;
  source_feature: string;
  source_path: string;
  budget_default: string | null;
}

export interface TaskOutputObject {
  id: string;
  title: string;
  source_feature: string;
  source_path: string;
}

export function isTaskIdInput(value: string): boolean {
  return TASK_ID_PATTERN.test(value);
}

export function canonicalizeTaskId(value: string): string {
  return value.toUpperCase();
}