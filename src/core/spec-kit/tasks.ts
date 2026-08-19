import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ParsedTaskEntry,
  ParsedTaskLine,
  SpecKitTaskResolution,
  TaskSource,
  canonicalizeTaskId,
  isTaskIdInput,
} from '../../models/spec-kit-task.js';
import { InputValidationError, IOStateError } from '../../models/errors.js';

const SPECS_DIR = 'specs';
const TASKS_FILE = 'tasks.md';

const TASK_LINE_PATTERN = /^-\s+\[(?: |x|X)\]\s+(.*)$/;
const BRACKETED_MARKER_PATTERN = /^\[([^\]]*)\]$/;
const BUDGET_MARKER_PATTERN = /^budget:(.*)$/i;

export function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = TASK_LINE_PATTERN.exec(line.trim());
  if (!match) {
    return null;
  }

  const tokens = match[1].split(/\s+/);
  const [idToken, ...tail] = tokens;

  if (!isTaskIdInput(idToken)) {
    return null;
  }

  const task_id = canonicalizeTaskId(idToken);

  let budgetAnnotation: string | null = null;
  let titleIndex = 0;

  while (titleIndex < tail.length) {
    const markerMatch = BRACKETED_MARKER_PATTERN.exec(tail[titleIndex]);
    if (!markerMatch) {
      break;
    }

    const budgetMatch = BUDGET_MARKER_PATTERN.exec(markerMatch[1]);
    if (budgetMatch && budgetAnnotation === null) {
      budgetAnnotation = budgetMatch[1];
    }

    titleIndex += 1;
  }

  const title = tail.slice(titleIndex).join(' ').trim();
  const entry: ParsedTaskEntry = {
    task_id,
    title,
    budget_annotation: budgetAnnotation,
  };

  return title.length > 0
    ? { kind: 'ok', entry }
    : { kind: 'empty_title', entry };
}

export async function discoverTaskSources(repositoryRoot: string): Promise<TaskSource[]> {
  const specsDirectory = join(repositoryRoot, SPECS_DIR);
  let entries;

  try {
    entries = await readdir(specsDirectory, { withFileTypes: true });
  } catch (error) {
    if (isEnoent(error)) {
      return [];
    }

    throw new IOStateError(`Unable to list Spec-Kit sources in ${SPECS_DIR}/`, {
      path: `${SPECS_DIR}/`,
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  const features: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }

    if (!(await pathExists(join(specsDirectory, entry.name, TASKS_FILE)))) {
      continue;
    }

    features.push(entry.name);
  }

  features.sort((left, right) => left.localeCompare(right));

  return features.map((feature) => ({
    feature,
    relativePath: `${SPECS_DIR}/${feature}/${TASKS_FILE}`,
  }));
}

export async function resolveSpecKitTask(
  repositoryRoot: string,
  taskId: string,
): Promise<SpecKitTaskResolution> {
  const canonical = canonicalizeTaskId(taskId);
  const sources = await discoverTaskSources(repositoryRoot);
  const matches: Array<{ entry: ParsedTaskEntry; source: TaskSource }> = [];

  for (const source of sources) {
    const content = await readTaskSource(repositoryRoot, source);

    for (const rawLine of content.split(/\r?\n/)) {
      const parsed = parseTaskLine(rawLine);
      if (!parsed || parsed.entry.task_id !== canonical) {
        continue;
      }

      matches.push({ entry: parsed.entry, source });
    }
  }

  if (matches.length === 0) {
    throw new InputValidationError(
      `Task id ${canonical} was not found in any tasks.md file under ${SPECS_DIR}/.`,
      'task_id',
      {
        task_id: canonical,
        scanned_sources: sources.map((source) => source.relativePath),
      },
    );
  }

  const paths = matches.map((match) => match.source.relativePath);
  const distinctPaths = [...new Set(paths)].sort();
  const duplicateInFile = distinctPaths.some(
    (candidate) => paths.filter((entry) => entry === candidate).length > 1,
  );

  if (distinctPaths.length > 1 || duplicateInFile) {
    throw new InputValidationError(
      `Task id ${canonical} is ambiguous; found in multiple tasks.md sources.`,
      'task_id',
      {
        task_id: canonical,
        sources: distinctPaths,
      },
    );
  }

  const onlyMatch = matches[0];

  if (onlyMatch.entry.title.length === 0) {
    throw new InputValidationError(
      `Task id ${canonical} cannot be associated because its task line has no usable title.`,
      'task_id',
      {
        task_id: canonical,
        source_path: onlyMatch.source.relativePath,
      },
    );
  }

  return {
    task_id: canonical,
    task_title: onlyMatch.entry.title,
    source_feature: onlyMatch.source.feature,
    source_path: onlyMatch.source.relativePath,
    budget_default: onlyMatch.entry.budget_annotation,
  };
}

async function readTaskSource(repositoryRoot: string, source: TaskSource): Promise<string> {
  const absolutePath = join(repositoryRoot, source.relativePath);

  try {
    return await readFile(absolutePath, 'utf8');
  } catch (error) {
    throw new IOStateError(`Unable to read Spec-Kit task source ${source.relativePath}`, {
      path: source.relativePath,
      cause: error instanceof Error ? error.message : String(error),
    });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isEnoent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}