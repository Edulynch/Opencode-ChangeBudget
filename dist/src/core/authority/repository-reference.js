import { open, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { getChangeBudgetDirectory } from '../state/state.js';
export const REPOSITORY_REFERENCE_SCHEMA_VERSION = 1;
const MAX_REFERENCE_BYTES = 4096;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export class RepositoryReferenceError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'RepositoryReferenceError';
        this.code = code;
    }
}
function isNotFound(error) {
    return typeof error === 'object' && error !== null && error.code === 'ENOENT';
}
function isAlreadyPresent(error) {
    return typeof error === 'object' && error !== null && error.code === 'EEXIST';
}
export function getRepositoryReferencePath(repositoryRoot) {
    return join(getChangeBudgetDirectory(repositoryRoot), 'authority-reference.json');
}
function canonicalReference(reference) {
    return Buffer.from(`${JSON.stringify({
        reference_schema_version: reference.reference_schema_version,
        repository_reference_id: reference.repository_reference_id,
    }, null, 2)}\n`, 'utf8');
}
export function parseRepositoryPublicReferenceObservation(bytes) {
    if (bytes.length > MAX_REFERENCE_BYTES) {
        throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference exceeds its size limit.');
    }
    let value;
    try {
        value = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) {
        throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference is not valid JSON.', { cause: error });
    }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference must be a JSON object.');
    }
    const record = value;
    if (record.reference_schema_version !== REPOSITORY_REFERENCE_SCHEMA_VERSION) {
        throw new RepositoryReferenceError('UNSUPPORTED_SCHEMA', 'Repository authority reference schema is unsupported.');
    }
    const keys = Object.keys(record).sort();
    const expected = ['reference_schema_version', 'repository_reference_id'].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference contains missing, duplicate, or unknown fields.');
    }
    if (typeof record.repository_reference_id !== 'string' || !UUID_PATTERN.test(record.repository_reference_id)) {
        throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference locator is invalid.');
    }
    const reference = {
        reference_schema_version: REPOSITORY_REFERENCE_SCHEMA_VERSION,
        repository_reference_id: record.repository_reference_id,
    };
    if (!canonicalReference(reference).equals(bytes)) {
        throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference is not canonical JSON or contains duplicate keys.');
    }
    return reference;
}
async function requireNormalReferenceDirectory(directory) {
    let stats;
    try {
        stats = await lstat(directory, { bigint: true });
    }
    catch (error) {
        if (isNotFound(error))
            throw new RepositoryReferenceError('MISSING', 'The initialized .changebudget directory is unavailable.', { cause: error });
        throw error;
    }
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw new RepositoryReferenceError('MALFORMED', 'The .changebudget reference directory is not a normal directory.');
    }
}
async function syncDirectory(directory) {
    const handle = await open(directory, process.platform === 'win32' ? 'r+' : 'r');
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
}
export async function readRepositoryPublicReference(repositoryRoot) {
    const directory = getChangeBudgetDirectory(repositoryRoot);
    const path = getRepositoryReferencePath(repositoryRoot);
    await requireNormalReferenceDirectory(directory);
    let before;
    try {
        before = await lstat(path, { bigint: true });
    }
    catch (error) {
        if (isNotFound(error))
            return undefined;
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_REFERENCE_BYTES)) {
        throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference must be a bounded regular file.');
    }
    const handle = await open(path, 'r');
    try {
        const opened = await handle.stat({ bigint: true });
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
            throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference changed while being opened.');
        }
        const bytes = await handle.readFile();
        const after = await lstat(path, { bigint: true });
        if (after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino || after.birthtimeNs !== before.birthtimeNs) {
            throw new RepositoryReferenceError('MALFORMED', 'Repository authority reference changed while being read.');
        }
        return parseRepositoryPublicReferenceObservation(bytes);
    }
    finally {
        await handle.close();
    }
}
/** Initial locators are created only by the explicit direct grant-create transaction. */
export async function initializeAbsentRepositoryReference(repositoryRoot, repositoryReferenceId = randomUUID()) {
    if (!UUID_PATTERN.test(repositoryReferenceId)) {
        throw new RepositoryReferenceError('MALFORMED', 'Generated repository reference locator is invalid.');
    }
    const directory = getChangeBudgetDirectory(repositoryRoot);
    const path = getRepositoryReferencePath(repositoryRoot);
    await requireNormalReferenceDirectory(directory);
    const reference = {
        reference_schema_version: REPOSITORY_REFERENCE_SCHEMA_VERSION,
        repository_reference_id: repositoryReferenceId,
    };
    const bytes = canonicalReference(reference);
    let handle;
    try {
        handle = await open(path, 'wx', 0o600);
    }
    catch (error) {
        if (isAlreadyPresent(error)) {
            throw new RepositoryReferenceError('ALREADY_PRESENT', 'A repository authority reference already exists and will not be overwritten.', { cause: error });
        }
        throw new RepositoryReferenceError('WRITE_FAILED', 'Unable to create the repository authority reference.', { cause: error });
    }
    try {
        await handle.writeFile(bytes);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await syncDirectory(directory);
        const persisted = await readRepositoryPublicReference(repositoryRoot);
        if (persisted === undefined || persisted.repository_reference_id !== repositoryReferenceId) {
            throw new RepositoryReferenceError('WRITE_FAILED', 'Repository authority reference readback did not match its initial locator.');
        }
        return persisted;
    }
    catch (error) {
        // A possibly visible locator is intentionally retained. Registry state is not inferred or repaired here.
        if (error instanceof RepositoryReferenceError)
            throw error;
        throw new RepositoryReferenceError('WRITE_FAILED', 'Repository authority reference persistence is uncertain; no binding or grant success is reported.', { cause: error });
    }
    finally {
        await handle?.close().catch(() => undefined);
    }
}
//# sourceMappingURL=repository-reference.js.map