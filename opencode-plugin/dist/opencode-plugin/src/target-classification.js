import { lstat, realpath } from 'node:fs/promises';
import * as path from 'node:path';
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isMissingPath(error) {
    return isRecord(error) && error.code === 'ENOENT';
}
export function isContainedPath(root, candidate, pathOperations = path) {
    const candidateRelative = pathOperations.relative(root, candidate);
    return candidateRelative.length === 0
        || (!pathOperations.isAbsolute(candidateRelative)
            && candidateRelative !== '..'
            && !candidateRelative.startsWith(`..${pathOperations.sep}`));
}
function toRepositoryRelative(repositoryRoot, target) {
    return path.relative(repositoryRoot, target).replace(/\\/g, '/');
}
export async function classifyTargetCreation(input) {
    try {
        const repositoryRoot = await realpath(input.repositoryRoot);
        const target = path.resolve(repositoryRoot, input.targetPath);
        const lexicalPath = toRepositoryRelative(repositoryRoot, target);
        let targetStats;
        try {
            targetStats = await lstat(target);
        }
        catch (error) {
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
            }
            catch {
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
    }
    catch {
        return { state: 'unsafe', lexicalPath: input.targetPath, effectivePath: null };
    }
}
//# sourceMappingURL=target-classification.js.map