import { lstat, readFile, readlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { runGit } from '../git/repo.js';
import { createEvidenceDescriptor } from './integrity.js';
import { parseGitObservationZOutput } from './observe.js';
function isChangeBudgetMetadata(observation) {
    return observation.path === '.changebudget' || observation.path.startsWith('.changebudget/');
}
function digest(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}
function sameObservation(left, right) {
    return left.path === right.path
        && left.sourcePath === right.sourcePath
        && left.mode === right.mode
        && left.objectType === right.objectType
        && left.tracked === right.tracked
        && left.staged === right.staged
        && left.unstaged === right.unstaged
        && left.untracked === right.untracked
        && left.deleted === right.deleted
        && left.renamed === right.renamed
        && left.copied === right.copied
        && left.isBinary === right.isBinary;
}
async function observeRepository(repositoryRoot) {
    return parseGitObservationZOutput({
        statusOutput: await runGit(repositoryRoot, ['status', '--porcelain=v2', '-z', '--untracked-files=all']),
    });
}
async function readObservedValue(repositoryRoot, observation) {
    if (observation.deleted)
        return { type: observation.objectType, bytes: Buffer.alloc(0), mode: null };
    const target = join(repositoryRoot, observation.path);
    const stat = await lstat(target);
    if (stat.isSymbolicLink())
        return { type: 'symlink', bytes: Buffer.from(await readlink(target)), mode: observation.mode };
    if (!stat.isFile())
        return { type: observation.objectType, bytes: Buffer.alloc(0), mode: observation.mode };
    return { type: 'file', bytes: await readFile(target), mode: observation.mode };
}
function entryFor(observation, value) {
    return {
        path: observation.path,
        objectType: value.type,
        mode: value.mode,
        size: value.bytes.length,
        contentDigest: observation.deleted ? null : digest(value.bytes),
        payload: observation.deleted ? null : value.bytes.toString('base64'),
        observation: {
            tracked: observation.tracked, staged: observation.staged, unstaged: observation.unstaged,
            untracked: observation.untracked, deleted: observation.deleted, renamed: observation.renamed,
            copied: observation.copied, isBinary: observation.isBinary || value.bytes.includes(0),
        },
    };
}
function sameValue(left, right) {
    return left.type === right.type
        && left.mode === right.mode
        && left.bytes.length === right.bytes.length
        && digest(left.bytes) === digest(right.bytes);
}
export async function captureBaseline(options) {
    const maxAttempts = options.maxAttempts ?? 3;
    const observe = options.observe ?? (() => observeRepository(options.repositoryRoot));
    const afterCapture = options.afterCapture ?? observe;
    const readValue = options.readValue ?? ((observation) => readObservedValue(options.repositoryRoot, observation));
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const before = (await observe()).filter((observation) => !isChangeBudgetMetadata(observation));
        const values = await Promise.all(before.map(readValue));
        const entries = before.map((observation, index) => entryFor(observation, values[index]));
        const after = (await afterCapture()).filter((observation) => !isChangeBudgetMetadata(observation));
        const afterValues = await Promise.all(after.map(readValue));
        if (before.length === after.length
            && before.every((entry, index) => sameObservation(entry, after[index]) && sameValue(values[index], afterValues[index]))) {
            return { ok: true, evidence: createEvidenceDescriptor({ schemaVersion: 1, contractId: options.contractId, activationHead: options.activationHead, entries }) };
        }
    }
    return { ok: false, reasonCode: 'BASELINE_UNSTABLE_CAPTURE' };
}
//# sourceMappingURL=capture.js.map