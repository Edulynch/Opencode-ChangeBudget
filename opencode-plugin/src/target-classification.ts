import { lstat, realpath } from 'node:fs/promises';
import * as path from 'node:path';

type PathOperations = Pick<typeof path.win32, 'relative' | 'isAbsolute' | 'sep'>;

export type TargetCreationState = 'existing-file' | 'new-file' | 'unsafe';

export interface TargetClassificationInput {
  readonly repositoryRoot: string;
  readonly targetPath: string;
}

export interface TargetClassification {
  readonly state: TargetCreationState;
  readonly lexicalPath: string;
  readonly effectivePath: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isMissingPath(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

export function isContainedPath(
  root: string,
  candidate: string,
  pathOperations: PathOperations = path,
): boolean {
  const candidateRelative = pathOperations.relative(root, candidate);
  return candidateRelative.length === 0
    || (!pathOperations.isAbsolute(candidateRelative)
      && candidateRelative !== '..'
      && !candidateRelative.startsWith(`..${pathOperations.sep}`));
}

function toRepositoryRelative(repositoryRoot: string, target: string): string {
  return path.relative(repositoryRoot, target).replace(/\\/g, '/');
}

export async function classifyTargetCreation(input: TargetClassificationInput): Promise<TargetClassification> {
  try {
    const repositoryRoot = await realpath(input.repositoryRoot);
    const target = path.resolve(repositoryRoot, input.targetPath);
    const lexicalPath = toRepositoryRelative(repositoryRoot, target);

    let targetStats;
    try {
      targetStats = await lstat(target);
    } catch (error) {
        if (!isMissingPath(error)) {
        return { state: 'unsafe', lexicalPath, effectivePath: null };
      }
    }

    if (targetStats !== undefined) {
        if (targetStats.isDirectory()) {
        return { state: 'unsafe', lexicalPath, effectivePath: null };
      }

      try {
        const resolvedTarget = await realpath(target);
        if (!isContainedPath(repositoryRoot, resolvedTarget)) {
          return { state: 'unsafe', lexicalPath, effectivePath: null };
        }

        const resolvedStats = await lstat(resolvedTarget);
        return resolvedStats.isFile()
          ? {
            state: 'existing-file',
            lexicalPath,
            effectivePath: toRepositoryRelative(repositoryRoot, resolvedTarget),
          }
          : { state: 'unsafe', lexicalPath, effectivePath: null };
      } catch {
        return { state: 'unsafe', lexicalPath, effectivePath: null };
      }
    }

    const parent = await realpath(path.dirname(target));
    const parentStats = await lstat(parent);
    if (!parentStats.isDirectory() || !isContainedPath(repositoryRoot, parent)) {
      return { state: 'unsafe', lexicalPath, effectivePath: null };
    }

    const candidate = path.resolve(parent, path.basename(target));
    return isContainedPath(repositoryRoot, candidate)
      ? {
        state: 'new-file',
        lexicalPath,
        effectivePath: toRepositoryRelative(repositoryRoot, candidate),
      }
      : { state: 'unsafe', lexicalPath, effectivePath: null };
  } catch {
    return { state: 'unsafe', lexicalPath: input.targetPath, effectivePath: null };
  }
}
