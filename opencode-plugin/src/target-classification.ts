import { lstat, realpath } from 'node:fs/promises';
import { basename, dirname, relative, resolve } from 'node:path';

export type TargetCreationState = 'existing-file' | 'new-file' | 'unsafe';

export interface TargetClassificationInput {
  readonly repositoryRoot: string;
  readonly targetPath: string;
}

export interface TargetClassification {
  readonly state: TargetCreationState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMissingPath(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isContainedPath(root: string, candidate: string): boolean {
  const candidateRelative = relative(root, candidate);
  return candidateRelative.length === 0
    || (!candidateRelative.startsWith('..') && !candidateRelative.includes('../') && candidateRelative !== '..');
}

export async function classifyTargetCreation(input: TargetClassificationInput): Promise<TargetClassification> {
  try {
    const repositoryRoot = await realpath(input.repositoryRoot);
    const target = resolve(repositoryRoot, input.targetPath);

    let targetStats;
    try {
      targetStats = await lstat(target);
    } catch (error) {
      if (!isMissingPath(error)) {
        return { state: 'unsafe' };
      }
    }

    if (targetStats !== undefined) {
      if (targetStats.isDirectory()) {
        return { state: 'unsafe' };
      }

      try {
        const resolvedTarget = await realpath(target);
        if (!isContainedPath(repositoryRoot, resolvedTarget)) {
          return { state: 'unsafe' };
        }

        const resolvedStats = await lstat(resolvedTarget);
        return { state: resolvedStats.isFile() ? 'existing-file' : 'unsafe' };
      } catch {
        return { state: 'unsafe' };
      }
    }

    const parent = await realpath(dirname(target));
    const parentStats = await lstat(parent);
    if (!parentStats.isDirectory() || !isContainedPath(repositoryRoot, parent)) {
      return { state: 'unsafe' };
    }

    const candidate = resolve(parent, basename(target));
    return { state: isContainedPath(repositoryRoot, candidate) ? 'new-file' : 'unsafe' };
  } catch {
    return { state: 'unsafe' };
  }
}
