import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
const MAX_REFERENCE_BYTES = 4 * 1024;
const MAX_REFERENCE_STRING = 512;
const MAX_REFERENCE_ITEMS = 8;
const MAX_EDIT_ARGUMENT_BYTES = 64 * 1024;
const MAX_EDIT_FILE_BYTES = 256 * 1024;
function ownDataRecord(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return null;
    try {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null)
            return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        if (Reflect.ownKeys(descriptors).some((key) => typeof key !== 'string'))
            return null;
        for (const descriptor of Object.values(descriptors)) {
            if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value'))
                return null;
        }
        return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
    }
    catch {
        return null;
    }
}
function hasExactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function boundedString(value, maximum = MAX_REFERENCE_STRING) {
    return typeof value === 'string'
        && value.length > 0
        && value.length <= maximum
        && value === value.trim()
        && !/[\u0000-\u001f\u007f]/u.test(value);
}
function boundedStringList(value) {
    try {
        if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
            || value.length < 1 || value.length > MAX_REFERENCE_ITEMS)
            return null;
        const expectedKeys = new Set(['length', ...Array.from({ length: value.length }, (_unused, index) => String(index))]);
        const ownKeys = Reflect.ownKeys(value);
        if (ownKeys.length !== expectedKeys.size || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))) {
            return null;
        }
        const result = [];
        for (let index = 0; index < value.length; index += 1) {
            const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
            if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')
                || !boundedString(descriptor.value))
                return null;
            result.push(descriptor.value);
        }
        return result;
    }
    catch {
        return null;
    }
}
export function parseAuthorityReference(metadata) {
    const objectLike = (typeof metadata === 'object' && metadata !== null) || typeof metadata === 'function';
    if (!objectLike)
        return { status: 'NO_REFERENCE' };
    let referencePresent;
    try {
        referencePresent = Object.hasOwn(metadata, 'changebudgetAuthority');
    }
    catch {
        return { status: 'MALFORMED' };
    }
    if (!referencePresent)
        return { status: 'NO_REFERENCE' };
    const metadataRecord = ownDataRecord(metadata);
    if (metadataRecord === null || !Object.hasOwn(metadataRecord, 'changebudgetAuthority'))
        return { status: 'MALFORMED' };
    const envelope = ownDataRecord(metadataRecord.changebudgetAuthority);
    if (!envelope || !hasExactKeys(envelope, ['schema_version', 'reference_id', 'request'])) {
        return { status: 'MALFORMED' };
    }
    if (envelope.schema_version !== 1)
        return { status: 'MALFORMED' };
    if (!boundedString(envelope.reference_id, 128))
        return { status: 'MALFORMED' };
    const request = ownDataRecord(envelope.request);
    if (!request || !hasExactKeys(request, ['operation', 'capabilities', 'paths', 'ceilings'])) {
        return { status: 'MALFORMED' };
    }
    if (!boundedString(request.operation, 64))
        return { status: 'MALFORMED' };
    const capabilities = boundedStringList(request.capabilities);
    const paths = boundedStringList(request.paths);
    if (!capabilities || !paths)
        return { status: 'MALFORMED' };
    const ceilings = ownDataRecord(request.ceilings);
    if (!ceilings || !hasExactKeys(ceilings, ['max_files', 'max_changed_lines']))
        return { status: 'MALFORMED' };
    if (!Number.isSafeInteger(ceilings.max_files) || ceilings.max_files < 0
        || !Number.isSafeInteger(ceilings.max_changed_lines) || ceilings.max_changed_lines < 0) {
        return { status: 'MALFORMED' };
    }
    try {
        const bytes = Buffer.byteLength(JSON.stringify(envelope), 'utf8');
        if (bytes > MAX_REFERENCE_BYTES)
            return { status: 'MALFORMED' };
    }
    catch {
        return { status: 'MALFORMED' };
    }
    return {
        status: 'PRESENT',
        descriptor: {
            referenceId: envelope.reference_id,
            operation: request.operation,
            capabilities,
            paths,
            ceilings: {
                max_files: ceilings.max_files,
                max_changed_lines: ceilings.max_changed_lines,
            },
        },
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isAssistantMessage(value) {
    return isRecord(value) && value.type === 'assistant'
        && boundedString(value.id, 256) && Array.isArray(value.content);
}
function isAssistantTool(value) {
    return isRecord(value) && value.type === 'tool' && boundedString(value.id, 256)
        && boundedString(value.name, 128) && isRecord(value.state);
}
/** Correlate only the current builtin edit tool call in the public Session.context schema. */
export function findCurrentEditInput(messages, source) {
    if (!Array.isArray(messages) || !isRecord(source) || source.type !== 'tool'
        || !boundedString(source.messageID, 256) || !boundedString(source.id, 256))
        return null;
    const assistants = messages.filter(isAssistantMessage);
    const matchingAssistants = assistants.filter((message) => message.id === source.messageID);
    if (matchingAssistants.length !== 1)
        return null;
    const matchingTools = assistants.flatMap((message) => message.content.filter(isAssistantTool))
        .filter((tool) => tool.id === source.id);
    if (matchingTools.length !== 1 || matchingTools[0].name !== 'edit'
        || matchingTools[0].state.status !== 'running')
        return null;
    if (!matchingAssistants[0].content.includes(matchingTools[0]))
        return null;
    return matchingTools[0].state.input;
}
function hasReparsePoint(stats) {
    return process.platform === 'win32'
        && typeof stats.attributes === 'number'
        && (stats.attributes & 0x400) !== 0;
}
function samePath(left, right) {
    return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}
function physicalPathIdentity(stats) {
    if (stats.dev <= 0n || stats.ino <= 0n || stats.birthtimeNs <= 0n)
        return null;
    return { dev: stats.dev, ino: stats.ino, birthtimeNs: stats.birthtimeNs };
}
function samePhysicalPathIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.birthtimeNs === right.birthtimeNs;
}
function existingPathComponent(path, kind, stats) {
    if (stats.isSymbolicLink() || hasReparsePoint(stats)
        || (kind === 'directory' ? !stats.isDirectory() : !stats.isFile()))
        return null;
    const identity = physicalPathIdentity(stats);
    if (!identity || stats.ctimeNs <= 0n || stats.mtimeNs < 0n || stats.size < 0n)
        return null;
    return kind === 'file'
        ? { path, kind, identity, ctimeNs: stats.ctimeNs, mtimeNs: stats.mtimeNs, size: stats.size }
        : { path, kind, identity };
}
function samePathComponent(expected, actual) {
    if (!actual || expected.kind !== actual.kind || !samePhysicalPathIdentity(expected.identity, actual.identity))
        return false;
    return expected.kind === 'directory'
        || (expected.ctimeNs === actual.ctimeNs && expected.mtimeNs === actual.mtimeNs && expected.size === actual.size);
}
async function observePathComponents(observation) {
    if (!samePath(await realpath(observation.root), observation.root)
        || !samePath(await realpath(observation.absolute), observation.absolute))
        return false;
    for (const expected of observation.components) {
        const stats = await lstat(expected.path, { bigint: true });
        if (!samePathComponent(expected, existingPathComponent(expected.path, expected.kind, stats)))
            return false;
    }
    return true;
}
function sameExistingFileObservation(left, right) {
    if (left.canonical !== right.canonical || left.components.length !== right.components.length)
        return false;
    return left.components.every((component, index) => {
        const other = right.components[index];
        return other !== undefined && samePathComponent(component, other);
    });
}
async function canonicalExistingFile(repositoryRoot, candidate) {
    if (!boundedString(candidate, 4096) || /[\u0000-\u001f\u007f*?\[\]]/u.test(candidate))
        return null;
    if (candidate.split(/[\\/]/u).some((component) => component === '.' || component === '..'))
        return null;
    const root = resolve(repositoryRoot);
    const physicalRoot = await realpath(root);
    if (!samePath(root, physicalRoot))
        return null;
    const rootStats = await lstat(root, { bigint: true });
    const rootComponent = existingPathComponent(root, 'directory', rootStats);
    if (!rootComponent)
        return null;
    const absolute = resolve(root, candidate);
    const relativePath = relative(root, absolute);
    if (!relativePath || isAbsolute(relativePath) || relativePath === '..' || relativePath.startsWith(`..${sep}`))
        return null;
    const canonical = relativePath.split(sep).join('/');
    if (!canonical || canonical.includes('\\') || canonical.startsWith('/') || canonical.endsWith('/'))
        return null;
    const observations = [rootComponent];
    const components = canonical.split('/');
    let current = root;
    for (let index = 0; index < components.length; index += 1) {
        current = resolve(current, components[index]);
        const kind = index < components.length - 1 ? 'directory' : 'file';
        const stats = await lstat(current, { bigint: true });
        const component = existingPathComponent(current, kind, stats);
        if (!component)
            return null;
        observations.push(component);
    }
    if (!samePath(await realpath(current), current))
        return null;
    return { root, absolute: current, canonical, components: observations };
}
async function openAndReadPinnedFile(observation, maximumBytes) {
    const leaf = observation.components[observation.components.length - 1];
    const parent = observation.components[observation.components.length - 2];
    if (!leaf || leaf.kind !== 'file' || !parent || parent.kind !== 'directory'
        || leaf.size === undefined || leaf.size > BigInt(maximumBytes)
        || leaf.size > BigInt(Number.MAX_SAFE_INTEGER))
        return null;
    let parentHandle;
    let fileHandle;
    try {
        if (!await observePathComponents(observation))
            return null;
        const noFollow = constants.O_NOFOLLOW;
        const directoryFlag = constants.O_DIRECTORY;
        const parentFlags = constants.O_RDONLY
            | (typeof noFollow === 'number' ? noFollow : 0)
            | (typeof directoryFlag === 'number' ? directoryFlag : 0);
        parentHandle = await open(parent.path, parentFlags);
        const parentStats = await parentHandle.stat({ bigint: true });
        if (!samePathComponent(parent, existingPathComponent(parent.path, 'directory', parentStats))
            || !await observePathComponents(observation))
            return null;
        const flags = constants.O_RDONLY | (typeof noFollow === 'number' ? noFollow : 0);
        fileHandle = await open(observation.absolute, flags);
        const openedStats = await fileHandle.stat({ bigint: true });
        if (!samePathComponent(leaf, existingPathComponent(observation.absolute, 'file', openedStats))
            || !await observePathComponents(observation))
            return null;
        const bytes = Buffer.alloc(Number(leaf.size));
        let offset = 0;
        while (offset < bytes.byteLength) {
            const result = await fileHandle.read(bytes, offset, bytes.byteLength - offset, offset);
            if (!Number.isInteger(result.bytesRead) || result.bytesRead <= 0
                || result.bytesRead > bytes.byteLength - offset)
                return null;
            offset += result.bytesRead;
        }
        const finalHandleStats = await fileHandle.stat({ bigint: true });
        const finalParentStats = await parentHandle.stat({ bigint: true });
        if (!samePathComponent(leaf, existingPathComponent(observation.absolute, 'file', finalHandleStats))
            || !samePathComponent(parent, existingPathComponent(parent.path, 'directory', finalParentStats))
            || !await observePathComponents(observation))
            return null;
        return bytes;
    }
    finally {
        await Promise.all([
            fileHandle?.close().catch(() => undefined),
            parentHandle?.close().catch(() => undefined),
        ]);
    }
}
function exactEditArgs(value) {
    const record = ownDataRecord(value);
    if (!record)
        return null;
    const keys = Object.keys(record).sort();
    const expected = ['newString', 'oldString', 'path'];
    const withOptional = [...expected, 'replaceAll'].sort();
    if (keys.length === expected.length && keys.every((key, index) => key === expected[index]))
        return record;
    if (keys.length === withOptional.length && keys.every((key, index) => key === withOptional[index]))
        return record;
    return null;
}
function hasTrailingSpaceSemantics(value) {
    return value.split('\n').some((line) => /[ \t]+$/u.test(line));
}
export async function projectActualEdit(inputValue, resources, repositoryRoot, canonicalizePath, countTextDiff, classifySensitivePath) {
    if (!Array.isArray(resources) || resources.length !== 1 || typeof resources[0] !== 'string')
        return null;
    const input = exactEditArgs(inputValue);
    if (!input || typeof input.path !== 'string' || typeof input.oldString !== 'string'
        || typeof input.newString !== 'string' || (Object.hasOwn(input, 'replaceAll') && input.replaceAll !== false))
        return null;
    if (Buffer.byteLength(input.path, 'utf8') > 4096
        || Buffer.byteLength(input.oldString, 'utf8') > MAX_EDIT_ARGUMENT_BYTES
        || Buffer.byteLength(input.newString, 'utf8') > MAX_EDIT_ARGUMENT_BYTES
        || input.oldString.length === 0 || input.oldString === input.newString
        || /[\r\0]/u.test(input.oldString) || /[\r\0]/u.test(input.newString)
        || hasTrailingSpaceSemantics(input.oldString) || hasTrailingSpaceSemantics(input.newString))
        return null;
    try {
        const pathObservation = await canonicalExistingFile(repositoryRoot, input.path);
        const resourceObservation = await canonicalExistingFile(repositoryRoot, resources[0]);
        if (pathObservation === null || resourceObservation === null
            || pathObservation.canonical !== resourceObservation.canonical
            || !sameExistingFileObservation(pathObservation, resourceObservation)
            || canonicalizePath(pathObservation.canonical) !== pathObservation.canonical)
            return null;
        const contents = await openAndReadPinnedFile(pathObservation, MAX_EDIT_FILE_BYTES);
        if (contents === null || contents.byteLength > MAX_EDIT_FILE_BYTES)
            return null;
        let before;
        try {
            before = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(contents);
        }
        catch {
            return null;
        }
        if (/[\r\0]/u.test(before))
            return null;
        const first = before.indexOf(input.oldString);
        if (first < 0 || before.indexOf(input.oldString, first + input.oldString.length) >= 0)
            return null;
        const after = `${before.slice(0, first)}${input.newString}${before.slice(first + input.oldString.length)}`;
        if (Buffer.byteLength(after, 'utf8') > MAX_EDIT_FILE_BYTES || after === before)
            return null;
        const lineCounts = countTextDiff(before, after);
        if (lineCounts === null)
            return null;
        const changedLines = lineCounts.addedLines + lineCounts.removedLines;
        if (!Number.isSafeInteger(changedLines) || changedLines < 0)
            return null;
        const path = pathObservation.canonical;
        const sensitive = classifySensitivePath(path);
        return {
            path,
            maxFiles: 1,
            maxChangedLines: changedLines,
            permissions: {
                allow_new_files: false,
                allow_dependencies: sensitive.dependencies,
                allow_migrations: sensitive.migrations,
                allow_configuration: sensitive.config,
                allow_public_api: sensitive.publicApi,
            },
        };
    }
    catch {
        return null;
    }
}
export async function buildAuthorityUseRequest(descriptor, facts, normalize) {
    if (descriptor.operation !== 'file.write'
        || descriptor.capabilities.length !== 1 || descriptor.capabilities[0] !== 'source.edit'
        || descriptor.paths.length !== 1 || descriptor.paths[0] !== facts.path
        || descriptor.ceilings.max_files !== facts.maxFiles
        || descriptor.ceilings.max_changed_lines !== facts.maxChangedLines)
        return null;
    try {
        return normalize({
            grant_reference_id: descriptor.referenceId,
            requested_operation: 'file.write',
            requested_capabilities: ['source.edit'],
            requested_paths: [facts.path],
            requested_ceilings: {
                max_files: facts.maxFiles,
                max_changed_lines: facts.maxChangedLines,
            },
            requested_permissions: facts.permissions,
        });
    }
    catch {
        return null;
    }
}
const VERIFIED_FAILURE_CODES = new Set([
    'INVALID_REQUEST', 'NOT_FOUND', 'CORRUPT_STATE', 'UNSUPPORTED_SCHEMA', 'WORK_CONTEXT_UNAVAILABLE',
    'SUBJECT_CONTEXT_UNAVAILABLE', 'REPOSITORY_IDENTITY_UNAVAILABLE', 'STALE_AUTHORITY', 'EXPIRED',
    'NOT_YET_VALID', 'REVOKED', 'CONSUMED', 'REPLAY', 'REPOSITORY_MISMATCH', 'WORK_MISMATCH',
    'SUBJECT_MISMATCH', 'OPERATION_MISMATCH', 'CAPABILITY_MISMATCH', 'PATH_MISMATCH', 'CEILING_EXCEEDED',
    'LOCK_BUSY', 'LOCK_UNVERIFIABLE', 'AUDIT_UNAVAILABLE', 'STORAGE_UNAVAILABLE',
]);
export function mapGrantVerificationResult(value) {
    if (!isRecord(value))
        return 'INVALID';
    if (value.status === 'VERIFIED' && value.match === true)
        return 'VERIFIED';
    if (value.status !== 'REJECTED' || value.match !== false || !Array.isArray(value.reasons))
        return 'INVALID';
    const reasons = value.reasons.filter((reason) => typeof reason === 'string');
    if (reasons.length !== value.reasons.length || reasons.some((reason) => !VERIFIED_FAILURE_CODES.has(reason)))
        return 'INVALID';
    if (reasons.includes('NOT_FOUND'))
        return 'UNKNOWN';
    if (reasons.includes('REVOKED'))
        return 'REVOKED';
    if (reasons.includes('EXPIRED'))
        return 'EXPIRED';
    if (reasons.includes('CONSUMED') || reasons.includes('REPLAY'))
        return 'REPLAYED';
    if (reasons.includes('STALE_AUTHORITY'))
        return 'STALE';
    return 'INVALID';
}
export function formatAuthorityReferenceFailure(status) {
    switch (status) {
        case 'MALFORMED': return 'REFERENCE_MALFORMED';
        case 'NO_TRUSTED_CONTEXT': return 'WORK_CONTEXT_UNAVAILABLE';
        case 'UNKNOWN': return 'REFERENCE_UNKNOWN';
        case 'REVOKED': return 'GRANT_REVOKED';
        case 'EXPIRED': return 'GRANT_EXPIRED';
        case 'STALE': return 'AUTHORITY_STALE';
        case 'REPLAYED': return 'GRANT_REPLAY';
        case 'INVALID': return 'REFERENCE_INVALID';
        case 'NO_REFERENCE':
        case 'VERIFIED': return 'REFERENCE_INVALID';
    }
}
//# sourceMappingURL=authority-reference.js.map