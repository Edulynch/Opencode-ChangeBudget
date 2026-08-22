import { access, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalizeTaskId, isTaskIdInput, } from '../../models/spec-kit-task.js';
import { InputValidationError, IOStateError } from '../../models/errors.js';
import { compareCodeUnits } from '../ordering.js';
const SPECS_DIR = 'specs';
const TASKS_FILE = 'tasks.md';
const TASK_LINE_PATTERN = /^-\s+\[(?: |x|X)\]\s+(.*)$/;
const BRACKETED_MARKER_PATTERN = /^\[([^\]]*)\]$/;
const BUDGET_MARKER_PATTERN = /^budget:(.*)$/i;
export function parseTaskLine(line) {
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
    let budgetAnnotation = null;
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
    const entry = {
        task_id,
        title,
        budget_annotation: budgetAnnotation,
    };
    return title.length > 0
        ? { kind: 'ok', entry }
        : { kind: 'empty_title', entry };
}
export async function discoverTaskSources(repositoryRoot) {
    const specsDirectory = join(repositoryRoot, SPECS_DIR);
    let entries;
    try {
        entries = await readdir(specsDirectory, { withFileTypes: true });
    }
    catch (error) {
        if (isEnoent(error)) {
            return [];
        }
        throw new IOStateError(`Unable to list Spec-Kit sources in ${SPECS_DIR}/`, {
            path: `${SPECS_DIR}/`,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    const features = [];
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
            continue;
        }
        if (!(await pathExists(join(specsDirectory, entry.name, TASKS_FILE)))) {
            continue;
        }
        features.push(entry.name);
    }
    features.sort((left, right) => compareCodeUnits(left, right));
    return features.map((feature) => ({
        feature,
        relativePath: `${SPECS_DIR}/${feature}/${TASKS_FILE}`,
    }));
}
export async function resolveSpecKitTask(repositoryRoot, taskId) {
    const canonical = canonicalizeTaskId(taskId);
    const sources = await discoverTaskSources(repositoryRoot);
    const matches = [];
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
        throw new InputValidationError(`Task id ${canonical} was not found in any tasks.md file under ${SPECS_DIR}/.`, 'task_id', {
            task_id: canonical,
            scanned_sources: sources.map((source) => source.relativePath),
        });
    }
    const paths = matches.map((match) => match.source.relativePath);
    const distinctPaths = [...new Set(paths)].sort();
    const duplicateInFile = distinctPaths.some((candidate) => paths.filter((entry) => entry === candidate).length > 1);
    if (distinctPaths.length > 1 || duplicateInFile) {
        throw new InputValidationError(`Task id ${canonical} is ambiguous; found in multiple tasks.md sources.`, 'task_id', {
            task_id: canonical,
            sources: distinctPaths,
        });
    }
    const onlyMatch = matches[0];
    if (onlyMatch.entry.title.length === 0) {
        throw new InputValidationError(`Task id ${canonical} cannot be associated because its task line has no usable title.`, 'task_id', {
            task_id: canonical,
            source_path: onlyMatch.source.relativePath,
        });
    }
    return {
        task_id: canonical,
        task_title: onlyMatch.entry.title,
        source_feature: onlyMatch.source.feature,
        source_path: onlyMatch.source.relativePath,
        budget_default: onlyMatch.entry.budget_annotation,
    };
}
async function readTaskSource(repositoryRoot, source) {
    const absolutePath = join(repositoryRoot, source.relativePath);
    try {
        return await readFile(absolutePath, 'utf8');
    }
    catch (error) {
        throw new IOStateError(`Unable to read Spec-Kit task source ${source.relativePath}`, {
            path: source.relativePath,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
}
async function pathExists(path) {
    try {
        await access(path);
        return true;
    }
    catch {
        return false;
    }
}
function isEnoent(error) {
    return error instanceof Error && error.code === 'ENOENT';
}
//# sourceMappingURL=tasks.js.map