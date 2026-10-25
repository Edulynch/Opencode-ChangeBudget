import { open, lstat, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute as pathIsAbsolute, join, parse, resolve } from 'node:path';
import { resolvePhysicalObjectIdentity, samePhysicalIdentity, } from './physical-identity.js';
import { REPOSITORY_ANCHOR_KIND } from './repository-binding.js';
import { validateCanonicalGrantRecord } from './grants.js';
export const AUTHORITY_REGISTRY_SCHEMA_VERSION = 2;
const MAX_REGISTRY_BYTES = 4 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const MAX_GRANTS = 100;
const MAX_AUDIT_RECORDS = 20_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const CONTRACT_ID_PATTERN = /^contract-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
export class AuthorityRegistryError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'AuthorityRegistryError';
        this.code = code;
    }
}
export function createEmptyAuthorityRegistrySnapshot() {
    return {
        schema_version: AUTHORITY_REGISTRY_SCHEMA_VERSION,
        revision: 0,
        repository_bindings: [],
        work_bindings: [],
        subject_bindings: [],
        grants: [],
        grant_lifecycle: [],
        audit: [],
    };
}
export function getDefaultAuthorityRegistryPath() {
    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (typeof localAppData !== 'string' || localAppData.length === 0) {
            throw new AuthorityRegistryError('UNSAFE_PATH', 'The user-local registry location is unavailable.');
        }
        return join(localAppData, 'ChangeBudget-Authority', 'registry-v1.json');
    }
    if (process.platform === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'ChangeBudget-Authority', 'registry-v1.json');
    }
    const stateHome = process.env.XDG_STATE_HOME;
    const localState = typeof stateHome === 'string' && stateHome.length > 0
        ? stateHome
        : join(homedir(), '.changebudget-authority');
    if (typeof stateHome === 'string' && stateHome.length > 0 && !pathIsAbsolute(stateHome)) {
        throw new AuthorityRegistryError('UNSAFE_PATH', 'XDG_STATE_HOME must be an absolute user-local path.');
    }
    return typeof stateHome === 'string' && stateHome.length > 0
        ? join(localState, 'ChangeBudget-Authority', 'registry-v1.json')
        : join(localState, 'registry-v1.json');
}
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (value === null || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, nested]) => [key, stableValue(nested)]));
}
function serializeSnapshot(snapshot) {
    return Buffer.from(`${JSON.stringify(stableValue(snapshot), null, 2)}\n`, 'utf8');
}
function cloneSnapshot(snapshot) {
    return JSON.parse(serializeSnapshot(snapshot).toString('utf8'));
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value, keys, label) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
        throw new AuthorityRegistryError('CORRUPT', `${label} contains missing or unknown fields.`);
    }
}
function requireUuid(value, label) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw new AuthorityRegistryError('CORRUPT', `${label} is not a canonical opaque ID.`);
    }
}
function requireText(value, label, maximum = 512) {
    if (typeof value !== 'string' || value.length === 0 || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new AuthorityRegistryError('CORRUPT', `${label} is empty, oversized, or contains control characters.`);
    }
}
function requireNullableText(value, label, maximum = 512) {
    if (value !== null)
        requireText(value, label, maximum);
}
function requireTimestamp(value, label) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
        throw new AuthorityRegistryError('CORRUPT', `${label} is not a canonical UTC timestamp.`);
    }
}
function requirePositiveInteger(value, label) {
    if (!Number.isSafeInteger(value) || value <= 0) {
        throw new AuthorityRegistryError('CORRUPT', `${label} must be a positive safe integer.`);
    }
}
function requireDigest(value, label) {
    if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) {
        throw new AuthorityRegistryError('CORRUPT', `${label} is not a canonical SHA-256 digest.`);
    }
}
function validatePhysicalIdentity(value) {
    if (!isRecord(value))
        throw new AuthorityRegistryError('CORRUPT', 'Physical identity is not an object.');
    exactKeys(value, ['provider', 'platform', 'volume_id', 'file_id', 'generation'], 'Physical identity');
    if (value.provider !== 'node-lstat-bigint-v1') {
        throw new AuthorityRegistryError('CORRUPT', 'Physical identity provider is unsupported.');
    }
    if (typeof value.platform !== 'string' || !['win32', 'linux', 'darwin', 'freebsd', 'openbsd', 'sunos', 'aix', 'android', 'cygwin', 'netbsd'].includes(value.platform)) {
        throw new AuthorityRegistryError('CORRUPT', 'Physical identity platform is invalid.');
    }
    for (const field of ['volume_id', 'file_id', 'generation']) {
        if (typeof value[field] !== 'string' || !/^[1-9][0-9]*$/u.test(value[field])) {
            throw new AuthorityRegistryError('CORRUPT', `Physical identity ${field} is unavailable or unreliable.`);
        }
    }
}
function validateRepositoryBinding(value) {
    if (!isRecord(value))
        throw new AuthorityRegistryError('CORRUPT', 'Repository binding is not an object.');
    exactKeys(value, ['repository_reference_id', 'anchor_kind', 'binding_epoch', 'physical_identity', 'created_at', 'updated_at'], 'Repository binding');
    requireUuid(value.repository_reference_id, 'Repository reference');
    if (value.anchor_kind !== REPOSITORY_ANCHOR_KIND)
        throw new AuthorityRegistryError('CORRUPT', 'Repository anchor kind is unsupported.');
    requirePositiveInteger(value.binding_epoch, 'Repository binding epoch');
    validatePhysicalIdentity(value.physical_identity);
    requireTimestamp(value.created_at, 'Repository created_at');
    requireTimestamp(value.updated_at, 'Repository updated_at');
}
function validateWorkBinding(value) {
    if (!isRecord(value))
        throw new AuthorityRegistryError('CORRUPT', 'Work binding is not an object.');
    exactKeys(value, [
        'work_id', 'repository_reference_id', 'authority_id', 'contract_id', 'task_id',
        'work_activation_id', 'work_activation_epoch', 'contract_revision_digest', 'scope_digest', 'created_at',
    ], 'Work binding');
    requireUuid(value.work_id, 'Work ID');
    requireUuid(value.repository_reference_id, 'Work repository reference');
    requireUuid(value.authority_id, 'Authority ID');
    if (value.contract_id !== null && (typeof value.contract_id !== 'string' || !CONTRACT_ID_PATTERN.test(value.contract_id))) {
        throw new AuthorityRegistryError('CORRUPT', 'Contract ID is not a canonical ChangeBudget contract identifier.');
    }
    requireNullableText(value.task_id, 'Task ID', 256);
    requireUuid(value.work_activation_id, 'Work activation ID');
    requirePositiveInteger(value.work_activation_epoch, 'Work activation epoch');
    requireDigest(value.contract_revision_digest, 'Contract revision digest');
    requireDigest(value.scope_digest, 'Scope digest');
    requireTimestamp(value.created_at, 'Work created_at');
}
function validateSubjectBinding(value) {
    if (!isRecord(value))
        throw new AuthorityRegistryError('CORRUPT', 'Subject binding is not an object.');
    exactKeys(value, ['subject_id', 'repository_reference_id', 'work_id', 'subject_label', 'created_at'], 'Subject binding');
    requireUuid(value.subject_id, 'Subject ID');
    requireUuid(value.repository_reference_id, 'Subject repository reference');
    requireUuid(value.work_id, 'Subject work ID');
    requireNullableText(value.subject_label, 'Subject label', 256);
    requireTimestamp(value.created_at, 'Subject created_at');
}
function validateLifecycleRecord(value) {
    if (!isRecord(value))
        throw new AuthorityRegistryError('CORRUPT', 'Lifecycle record is not an object.');
    exactKeys(value, ['grant_id', 'lifecycle', 'terminal_event_id', 'updated_at'], 'Lifecycle record');
    requireUuid(value.grant_id, 'Lifecycle grant ID');
    if (!['ACTIVE', 'CONSUMED', 'REVOKED'].includes(String(value.lifecycle))) {
        throw new AuthorityRegistryError('CORRUPT', 'Lifecycle state is invalid.');
    }
    if (value.lifecycle === 'ACTIVE') {
        if (value.terminal_event_id !== null)
            throw new AuthorityRegistryError('CORRUPT', 'Active lifecycle record has terminal metadata.');
    }
    else {
        requireUuid(value.terminal_event_id, 'Terminal lifecycle event ID');
    }
    requireTimestamp(value.updated_at, 'Lifecycle updated_at');
}
function validateAuditRecord(value) {
    if (!isRecord(value))
        throw new AuthorityRegistryError('CORRUPT', 'Registry audit is not an object.');
    exactKeys(value, [
        'event_id', 'revision', 'kind', 'event_type', 'grant_id', 'grant_digest', 'target_ids', 'recorded_at',
    ], 'Registry audit');
    requireUuid(value.event_id, 'Registry audit event ID');
    requirePositiveInteger(value.revision, 'Registry audit revision');
    const eventTypeByKind = {
        BINDINGS: 'BINDINGS_COMMITTED',
        LIFECYCLE_RECORDS: 'LIFECYCLE_RECORDS_COMMITTED',
        BINDINGS_AND_LIFECYCLE_STORAGE: 'BINDINGS_AND_LIFECYCLE_STORAGE_COMMITTED',
        GRANT_CREATED: 'GRANT_CREATED',
        GRANT_REVOKED: 'GRANT_REVOKED',
        GRANT_USE_RECORDED: 'GRANT_USE_RECORDED',
        GRANT_CONSUMED: 'GRANT_CONSUMED',
        GRANT_USE_REJECTED: 'GRANT_USE_REJECTED',
    };
    if (!Object.hasOwn(eventTypeByKind, String(value.kind))) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry audit kind is invalid.');
    }
    if (value.event_type !== eventTypeByKind[value.kind]) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry audit semantic event type does not match its transaction kind.');
    }
    const isGrantEvent = value.kind === 'GRANT_CREATED'
        || value.kind === 'GRANT_REVOKED'
        || value.kind === 'GRANT_USE_RECORDED'
        || value.kind === 'GRANT_CONSUMED'
        || value.kind === 'GRANT_USE_REJECTED';
    if (isGrantEvent) {
        requireUuid(value.grant_id, 'Registry audit grant ID');
        requireDigest(value.grant_digest, 'Registry audit grant digest');
    }
    else if (value.grant_id !== null || value.grant_digest !== null) {
        throw new AuthorityRegistryError('CORRUPT', 'Non-grant registry audit contains grant-specific fields.');
    }
    if (!Array.isArray(value.target_ids) || value.target_ids.length === 0 || value.target_ids.length > MAX_RECORDS) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry audit target list is empty or oversized.');
    }
    value.target_ids.forEach((id, index) => requireUuid(id, `Registry audit target ${index}`));
    if (new Set(value.target_ids).size !== value.target_ids.length) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry audit target IDs are duplicated.');
    }
    if (isGrantEvent && !value.target_ids.includes(value.grant_id)) {
        throw new AuthorityRegistryError('CORRUPT', 'Grant audit does not name its grant as a target.');
    }
    if ((value.kind === 'GRANT_USE_RECORDED'
        || value.kind === 'GRANT_CONSUMED'
        || value.kind === 'GRANT_USE_REJECTED')
        && (value.target_ids.length !== 1 || value.target_ids[0] !== value.grant_id)) {
        throw new AuthorityRegistryError('CORRUPT', 'Grant-use evidence must target exactly its canonical grant.');
    }
    requireTimestamp(value.recorded_at, 'Registry audit recorded_at');
}
function validateSnapshot(value) {
    if (!isRecord(value))
        throw new AuthorityRegistryError('CORRUPT', 'Registry snapshot is not an object.');
    if (value.schema_version !== AUTHORITY_REGISTRY_SCHEMA_VERSION) {
        throw new AuthorityRegistryError('UNSUPPORTED_VERSION', 'Registry snapshot version is unsupported.');
    }
    exactKeys(value, [
        'schema_version', 'revision', 'repository_bindings', 'work_bindings',
        'subject_bindings', 'grants', 'grant_lifecycle', 'audit',
    ], 'Registry snapshot');
    if (!Number.isSafeInteger(value.revision) || value.revision < 0) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry revision is invalid.');
    }
    for (const field of ['repository_bindings', 'work_bindings', 'subject_bindings', 'grants', 'grant_lifecycle', 'audit']) {
        const entries = value[field];
        const limit = field === 'audit' ? MAX_AUDIT_RECORDS : field === 'grants' ? MAX_GRANTS : MAX_RECORDS;
        if (!Array.isArray(entries) || entries.length > limit) {
            throw new AuthorityRegistryError('CORRUPT', `Registry ${field} is missing or oversized.`);
        }
    }
    const snapshot = value;
    snapshot.repository_bindings.forEach(validateRepositoryBinding);
    snapshot.work_bindings.forEach(validateWorkBinding);
    snapshot.subject_bindings.forEach(validateSubjectBinding);
    snapshot.grants.forEach((grant) => {
        try {
            validateCanonicalGrantRecord(grant);
        }
        catch (error) {
            throw new AuthorityRegistryError('CORRUPT', 'Canonical grant body is malformed or has an invalid digest.', { cause: error });
        }
    });
    snapshot.grant_lifecycle.forEach(validateLifecycleRecord);
    snapshot.audit.forEach(validateAuditRecord);
    if (Buffer.byteLength(JSON.stringify(stableValue(snapshot)), 'utf8') > MAX_REGISTRY_BYTES) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry snapshot exceeds its byte limit.');
    }
    const repositoryIds = snapshot.repository_bindings.map((binding) => binding.repository_reference_id);
    const physicalIdentities = snapshot.repository_bindings.map((binding) => JSON.stringify(stableValue(binding.physical_identity)));
    const workIds = snapshot.work_bindings.map((binding) => binding.work_id);
    const subjectIds = snapshot.subject_bindings.map((binding) => binding.subject_id);
    const activationIds = snapshot.work_bindings.map((binding) => binding.work_activation_id);
    const grantIds = snapshot.grants.map((grant) => grant.grant_id);
    const lifecycleGrantIds = snapshot.grant_lifecycle.map((record) => record.grant_id);
    const eventIds = snapshot.audit.map((record) => record.event_id);
    for (const [label, ids] of [
        ['repository reference', repositoryIds], ['physical repository identity', physicalIdentities],
        ['work', workIds], ['subject', subjectIds],
        ['work activation', activationIds], ['grant', grantIds], ['grant lifecycle', lifecycleGrantIds], ['audit event', eventIds],
    ]) {
        if (new Set(ids).size !== ids.length)
            throw new AuthorityRegistryError('CORRUPT', `Duplicate ${label} ID.`);
    }
    const repositorySet = new Set(repositoryIds);
    const workById = new Map(snapshot.work_bindings.map((binding) => [binding.work_id, binding]));
    for (const work of snapshot.work_bindings) {
        if (!repositorySet.has(work.repository_reference_id))
            throw new AuthorityRegistryError('CORRUPT', 'Work references a missing repository binding.');
    }
    for (const subject of snapshot.subject_bindings) {
        const work = workById.get(subject.work_id);
        if (!work || work.repository_reference_id !== subject.repository_reference_id) {
            throw new AuthorityRegistryError('CORRUPT', 'Subject binding does not match its repository/work binding.');
        }
    }
    const grantById = new Map(snapshot.grants.map((grant) => [grant.grant_id, grant]));
    const lifecycleByGrant = new Map(snapshot.grant_lifecycle.map((record) => [record.grant_id, record]));
    const auditByEvent = new Map(snapshot.audit.map((event) => [event.event_id, event]));
    for (const grant of snapshot.grants) {
        const repository = snapshot.repository_bindings.find((binding) => binding.repository_reference_id === grant.repository_reference_id);
        const work = workById.get(grant.work_id);
        const subject = snapshot.subject_bindings.find((binding) => binding.subject_id === grant.subject_id);
        const lifecycle = lifecycleByGrant.get(grant.grant_id);
        if (!repository
            || repository.binding_epoch !== grant.repository_binding_epoch
            || !work
            || work.repository_reference_id !== grant.repository_reference_id
            || work.authority_id !== grant.authority_id
            || work.work_activation_id !== grant.work_activation_id
            || work.work_activation_epoch !== grant.work_activation_epoch
            || work.contract_id !== grant.contract_id
            || work.task_id !== grant.task_id
            || work.contract_revision_digest !== grant.contract_revision_digest
            || work.scope_digest !== grant.scope_digest
            || !subject
            || subject.repository_reference_id !== grant.repository_reference_id
            || subject.work_id !== grant.work_id
            || subject.subject_label !== grant.subject_label
            || !lifecycle) {
            throw new AuthorityRegistryError('CORRUPT', 'Canonical grant does not match its immutable bindings or lifecycle record.');
        }
        const created = auditByEvent.get(grant.issuer.audit_correlation_id);
        if (!created
            || created.event_type !== 'GRANT_CREATED'
            || created.grant_id !== grant.grant_id
            || created.grant_digest !== grant.grant_digest) {
            throw new AuthorityRegistryError('CORRUPT', 'Canonical grant has no matching colocated creation audit event.');
        }
        if (lifecycle.lifecycle === 'REVOKED') {
            const revoked = auditByEvent.get(lifecycle.terminal_event_id);
            if (!revoked
                || revoked.event_type !== 'GRANT_REVOKED'
                || revoked.grant_id !== grant.grant_id
                || revoked.grant_digest !== grant.grant_digest) {
                throw new AuthorityRegistryError('CORRUPT', 'Revoked grant has no matching colocated revocation audit event.');
            }
        }
        if (lifecycle.lifecycle === 'CONSUMED') {
            const consumed = auditByEvent.get(lifecycle.terminal_event_id);
            if (grant.mode !== 'ONE_SHOT'
                || !consumed
                || consumed.kind !== 'GRANT_CONSUMED'
                || consumed.grant_id !== grant.grant_id
                || consumed.grant_digest !== grant.grant_digest
                || !consumed.target_ids.includes(grant.grant_id)) {
                throw new AuthorityRegistryError('CORRUPT', 'Consumed grant lacks matching one-shot terminal use evidence.');
            }
        }
    }
    for (const event of snapshot.audit) {
        if (event.kind !== 'GRANT_CREATED'
            && event.kind !== 'GRANT_REVOKED'
            && event.kind !== 'GRANT_USE_RECORDED'
            && event.kind !== 'GRANT_CONSUMED'
            && event.kind !== 'GRANT_USE_REJECTED')
            continue;
        const grant = grantById.get(event.grant_id);
        if (!grant || grant.grant_digest !== event.grant_digest) {
            throw new AuthorityRegistryError('CORRUPT', 'Grant audit refers to a missing or different canonical grant.');
        }
        if (event.kind === 'GRANT_CREATED' && grant.issuer.audit_correlation_id !== event.event_id) {
            throw new AuthorityRegistryError('CORRUPT', 'Grant creation provenance does not correlate to its audit event.');
        }
        if (event.kind === 'GRANT_USE_RECORDED' && grant.mode !== 'REUSABLE') {
            throw new AuthorityRegistryError('CORRUPT', 'Reusable-use evidence cannot refer to a one-shot grant.');
        }
        if (event.kind === 'GRANT_USE_RECORDED') {
            const lifecycle = lifecycleByGrant.get(grant.grant_id);
            if (lifecycle?.lifecycle === 'REVOKED') {
                const revoked = auditByEvent.get(lifecycle.terminal_event_id);
                if (!revoked || event.revision >= revoked.revision) {
                    throw new AuthorityRegistryError('CORRUPT', 'Reusable-use evidence must precede terminal revocation.');
                }
            }
        }
        if (event.kind === 'GRANT_REVOKED') {
            const lifecycle = lifecycleByGrant.get(grant.grant_id);
            if (lifecycle?.lifecycle !== 'REVOKED'
                || lifecycle.terminal_event_id !== event.event_id) {
                throw new AuthorityRegistryError('CORRUPT', 'Revocation evidence does not match a revoked lifecycle record.');
            }
        }
        if (event.kind === 'GRANT_CONSUMED') {
            const lifecycle = lifecycleByGrant.get(grant.grant_id);
            if (grant.mode !== 'ONE_SHOT'
                || lifecycle?.lifecycle !== 'CONSUMED'
                || lifecycle.terminal_event_id !== event.event_id) {
                throw new AuthorityRegistryError('CORRUPT', 'One-shot use evidence does not match a consumed lifecycle record.');
            }
        }
    }
    if (snapshot.audit.length !== snapshot.revision)
        throw new AuthorityRegistryError('CORRUPT', 'Audit history and registry revision are incoherent.');
    snapshot.audit.forEach((event, index) => {
        if (event.revision !== index + 1)
            throw new AuthorityRegistryError('CORRUPT', 'Audit revisions are not contiguous.');
    });
    const terminalAudit = new Map(snapshot.audit.map((event) => [event.event_id, event]));
    for (const record of snapshot.grant_lifecycle) {
        if (record.lifecycle === 'ACTIVE')
            continue;
        const event = terminalAudit.get(record.terminal_event_id);
        const canonicalGrant = grantById.get(record.grant_id);
        const validGenericLifecycleEvent = grantById.get(record.grant_id) === undefined
            && event !== undefined
            && (event.kind === 'LIFECYCLE_RECORDS' || event.kind === 'BINDINGS_AND_LIFECYCLE_STORAGE')
            && event.target_ids.includes(record.grant_id);
        const validGrantRevocationEvent = canonicalGrant !== undefined
            && event !== undefined
            && event.kind === 'GRANT_REVOKED'
            && event.grant_id === canonicalGrant.grant_id
            && event.grant_digest === canonicalGrant.grant_digest
            && event.target_ids.includes(record.grant_id);
        const validGrantConsumptionEvent = canonicalGrant !== undefined
            && canonicalGrant.mode === 'ONE_SHOT'
            && event !== undefined
            && event.kind === 'GRANT_CONSUMED'
            && event.grant_id === canonicalGrant.grant_id
            && event.grant_digest === canonicalGrant.grant_digest
            && event.target_ids.includes(record.grant_id);
        if ((record.lifecycle === 'CONSUMED' && !validGenericLifecycleEvent && !validGrantConsumptionEvent)
            || (record.lifecycle === 'REVOKED' && !validGenericLifecycleEvent && !validGrantRevocationEvent)) {
            throw new AuthorityRegistryError('CORRUPT', 'Terminal lifecycle state has no matching colocated audit evidence.');
        }
    }
}
function parseSnapshot(bytes) {
    if (bytes.length > MAX_REGISTRY_BYTES)
        throw new AuthorityRegistryError('CORRUPT', 'Registry snapshot exceeds its byte limit.');
    let parsed;
    try {
        parsed = JSON.parse(bytes.toString('utf8'));
    }
    catch (error) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry snapshot is malformed JSON.', { cause: error });
    }
    validateSnapshot(parsed);
    const canonical = serializeSnapshot(parsed);
    if (!canonical.equals(bytes)) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry snapshot is not canonical stable JSON or contains duplicate keys.');
    }
    return cloneSnapshot(parsed);
}
export function parseAuthorityRegistryObservation(bytes) {
    return parseSnapshot(bytes);
}
function isNotFound(error) {
    return typeof error === 'object' && error !== null && error.code === 'ENOENT';
}
function normalizeRegistryPath(registryPath) {
    if (typeof registryPath !== 'string' || registryPath.length === 0 || !pathIsAbsolute(registryPath)) {
        throw new AuthorityRegistryError('UNSAFE_PATH', 'Registry path must be an absolute file path.');
    }
    const absolute = resolve(registryPath);
    if (!basename(absolute) || absolute === parse(absolute).root) {
        throw new AuthorityRegistryError('UNSAFE_PATH', 'A filesystem root cannot be a registry target.');
    }
    return absolute;
}
async function readSnapshot(registryPath) {
    const parent = dirname(registryPath);
    let parentStats;
    try {
        parentStats = await lstat(parent, { bigint: true });
    }
    catch (error) {
        if (isNotFound(error))
            return createEmptyAuthorityRegistrySnapshot();
        throw error;
    }
    if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
        throw new AuthorityRegistryError('UNSAFE_PATH', 'Registry parent is not a normal directory.');
    }
    try {
        await resolvePhysicalObjectIdentity(parent);
    }
    catch (error) {
        throw new AuthorityRegistryError('UNSAFE_PATH', 'Registry parent physical identity is unavailable or ambiguous.', { cause: error });
    }
    let before;
    try {
        before = await lstat(registryPath, { bigint: true });
    }
    catch (error) {
        if (isNotFound(error))
            return createEmptyAuthorityRegistrySnapshot();
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink()) {
        throw new AuthorityRegistryError('UNSAFE_PATH', 'Registry target is not a regular non-link file.');
    }
    if (before.size > BigInt(MAX_REGISTRY_BYTES))
        throw new AuthorityRegistryError('CORRUPT', 'Registry snapshot exceeds its byte limit.');
    const bytes = await readFile(registryPath);
    const after = await lstat(registryPath, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.birthtimeNs !== after.birthtimeNs) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry target changed during read.');
    }
    return parseSnapshot(bytes);
}
export async function inspectAuthorityRegistry(registryPath = getDefaultAuthorityRegistryPath()) {
    return readSnapshot(normalizeRegistryPath(registryPath));
}
async function syncDirectoryDefault(directoryPath) {
    const before = await resolvePhysicalObjectIdentity(directoryPath);
    // Windows FlushFileBuffers needs write access even for a directory flush; a
    // read-only handle fails with EPERM. POSIX retains its read-only directory handle.
    const handle = await open(directoryPath, process.platform === 'win32' ? 'r+' : 'r');
    try {
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    const after = await resolvePhysicalObjectIdentity(directoryPath);
    if (!samePhysicalIdentity(before, after)) {
        throw new AuthorityRegistryError('PERSISTENCE_FAILED', 'Directory identity changed during the persistence barrier.');
    }
}
async function ensureRegistryDirectory(directoryPath, hooks) {
    const absolute = resolve(directoryPath);
    const root = parse(absolute).root;
    if (!root)
        throw new AuthorityRegistryError('UNSAFE_PATH', 'Registry directory is not absolute.');
    let current = root;
    for (const component of absolute.slice(root.length).split(/[\\/]+/u).filter(Boolean)) {
        const next = join(current, component);
        try {
            const stats = await lstat(next, { bigint: true });
            if (!stats.isDirectory() || stats.isSymbolicLink()) {
                throw new AuthorityRegistryError('UNSAFE_PATH', 'Registry directory contains a non-directory or link component.');
            }
            await resolvePhysicalObjectIdentity(next);
        }
        catch (error) {
            if (!isNotFound(error))
                throw error;
            try {
                await mkdir(next);
            }
            catch (mkdirError) {
                if (!isAlreadyExists(mkdirError))
                    throw mkdirError;
            }
            await (hooks.syncDirectory ?? syncDirectoryDefault)(current);
            await resolvePhysicalObjectIdentity(next);
        }
        current = next;
    }
    await resolvePhysicalObjectIdentity(absolute);
}
function isAlreadyExists(error) {
    return typeof error === 'object' && error !== null && error.code === 'EEXIST';
}
async function acquireLock(registryPath, hooks) {
    const lockPath = `${registryPath}.lock`;
    const parent = dirname(registryPath);
    const token = randomUUID();
    const payload = JSON.stringify({ schema_version: 1, pid: process.pid, token });
    let handle;
    try {
        handle = await open(lockPath, 'wx', 0o600);
    }
    catch (error) {
        if (isAlreadyExists(error)) {
            throw new AuthorityRegistryError('LOCK_BUSY', 'Registry lock exists; ownership is not reclaimed automatically.', { cause: error });
        }
        throw new AuthorityRegistryError('PERSISTENCE_FAILED', 'Unable to create the exclusive registry lock.', { cause: error });
    }
    try {
        await handle.writeFile(payload, 'utf8');
        await handle.sync();
        const stats = await handle.stat({ bigint: true });
        if (stats.dev <= 0n || stats.ino <= 0n) {
            throw new AuthorityRegistryError('LOCK_OWNERSHIP_UNCERTAIN', 'The operating system did not provide a stable lock-file identity.');
        }
        await (hooks.syncDirectory ?? syncDirectoryDefault)(parent);
        return {
            path: lockPath,
            payload,
            device: stats.dev,
            fileId: stats.ino,
            handle,
            closed: false,
        };
    }
    catch (error) {
        await handle.close().catch(() => undefined);
        throw new AuthorityRegistryError('LOCK_OWNERSHIP_UNCERTAIN', 'Registry lock creation or sync was uncertain; the lock is retained.', { cause: error });
    }
}
async function closeOwnedLock(lock) {
    if (lock.closed)
        return;
    await lock.handle.close();
    lock.closed = true;
}
async function releaseOwnedLock(lock, directoryPath, hooks) {
    await closeOwnedLock(lock);
    let stats;
    try {
        stats = await lstat(lock.path, { bigint: true });
    }
    catch (error) {
        throw new AuthorityRegistryError('LOCK_OWNERSHIP_UNCERTAIN', 'Registry lock disappeared before verified release.', { cause: error });
    }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.dev !== lock.device || stats.ino !== lock.fileId) {
        throw new AuthorityRegistryError('LOCK_OWNERSHIP_UNCERTAIN', 'Registry lock object identity changed; it is not removed.');
    }
    const currentPayload = await readFile(lock.path, 'utf8');
    if (currentPayload !== lock.payload) {
        throw new AuthorityRegistryError('LOCK_OWNERSHIP_UNCERTAIN', 'Registry lock owner token changed; it is not removed.');
    }
    await unlink(lock.path);
    await (hooks.syncDirectory ?? syncDirectoryDefault)(directoryPath);
}
async function removeOwnedTemporary(temporaryPath, device, fileId) {
    try {
        const stats = await lstat(temporaryPath, { bigint: true });
        if (stats.isFile() && !stats.isSymbolicLink() && stats.dev === device && stats.ino === fileId) {
            await unlink(temporaryPath);
        }
    }
    catch (error) {
        if (!isNotFound(error))
            throw error;
    }
}
function sameStable(left, right) {
    return JSON.stringify(stableValue(left)) === JSON.stringify(stableValue(right));
}
function requireUnchangedRows(before, after, key, label) {
    const afterById = new Map(after.map((record) => [key(record), record]));
    for (const previous of before) {
        const current = afterById.get(key(previous));
        if (current === undefined || !sameStable(previous, current)) {
            throw new AuthorityRegistryError('CORRUPT', `Existing ${label} records are immutable and cannot be removed or rewritten.`);
        }
    }
}
function changedIds(before, after, key) {
    const oldById = new Map(before.map((record) => [key(record), record]));
    return after
        .filter((record) => !sameStable(oldById.get(key(record)), record))
        .map(key)
        .sort();
}
function ensureMutationBounded(current, proposed, mutation, context) {
    if (proposed.schema_version !== current.schema_version
        || proposed.revision !== current.revision
        || !sameStable(proposed.audit, current.audit)) {
        throw new AuthorityRegistryError('CORRUPT', 'A registry mutation cannot rewrite version, revision, or audit.');
    }
    let changed;
    const assertBindingRowsAppendOnly = () => {
        requireUnchangedRows(current.repository_bindings, proposed.repository_bindings, (row) => row.repository_reference_id, 'repository binding');
        requireUnchangedRows(current.work_bindings, proposed.work_bindings, (row) => row.work_id, 'work binding');
        requireUnchangedRows(current.subject_bindings, proposed.subject_bindings, (row) => row.subject_id, 'subject binding');
        return [
            ...changedIds(current.repository_bindings, proposed.repository_bindings, (row) => row.repository_reference_id),
            ...changedIds(current.work_bindings, proposed.work_bindings, (row) => row.work_id),
            ...changedIds(current.subject_bindings, proposed.subject_bindings, (row) => row.subject_id),
        ].sort();
    };
    const changedGrantIds = changedIds(current.grants, proposed.grants, (row) => row.grant_id);
    const changedLifecycleIds = changedIds(current.grant_lifecycle, proposed.grant_lifecycle, (row) => row.grant_id);
    if (mutation.kind === 'BINDINGS') {
        if (!sameStable(proposed.grant_lifecycle, current.grant_lifecycle)) {
            throw new AuthorityRegistryError('CORRUPT', 'A binding transaction cannot modify lifecycle storage records.');
        }
        if (!sameStable(proposed.grants, current.grants)) {
            throw new AuthorityRegistryError('CORRUPT', 'A binding transaction cannot modify canonical grants.');
        }
        changed = assertBindingRowsAppendOnly();
    }
    else if (mutation.kind === 'LIFECYCLE_RECORDS') {
        if (!sameStable(proposed.repository_bindings, current.repository_bindings)
            || !sameStable(proposed.work_bindings, current.work_bindings)
            || !sameStable(proposed.subject_bindings, current.subject_bindings)) {
            throw new AuthorityRegistryError('CORRUPT', 'A lifecycle-storage transaction cannot modify bindings.');
        }
        if (!sameStable(proposed.grants, current.grants)) {
            throw new AuthorityRegistryError('CORRUPT', 'A lifecycle-storage transaction cannot modify canonical grants.');
        }
        requireUnchangedRows(current.grant_lifecycle, proposed.grant_lifecycle, (row) => row.grant_id, 'lifecycle');
        changed = changedLifecycleIds;
    }
    else if (mutation.kind === 'BINDINGS_AND_LIFECYCLE_STORAGE') {
        if (!sameStable(proposed.grants, current.grants)) {
            throw new AuthorityRegistryError('CORRUPT', 'A binding/lifecycle-storage transaction cannot modify canonical grants.');
        }
        const bindingIds = assertBindingRowsAppendOnly();
        requireUnchangedRows(current.grant_lifecycle, proposed.grant_lifecycle, (row) => row.grant_id, 'lifecycle');
        changed = [...new Set([
                ...bindingIds,
                ...changedLifecycleIds,
            ])].sort();
    }
    else if (mutation.kind === 'GRANT_CREATED') {
        const bindingIds = assertBindingRowsAppendOnly();
        requireUnchangedRows(current.grants, proposed.grants, (row) => row.grant_id, 'canonical grant');
        requireUnchangedRows(current.grant_lifecycle, proposed.grant_lifecycle, (row) => row.grant_id, 'lifecycle');
        if (changedGrantIds.length !== 1 || changedLifecycleIds.length !== 1 || changedGrantIds[0] !== changedLifecycleIds[0]) {
            throw new AuthorityRegistryError('CORRUPT', 'A grant creation must append one immutable body and its ACTIVE lifecycle together.');
        }
        const grant = proposed.grants.find((row) => row.grant_id === changedGrantIds[0]);
        const lifecycle = proposed.grant_lifecycle.find((row) => row.grant_id === changedLifecycleIds[0]);
        if (!grant
            || !lifecycle
            || lifecycle.lifecycle !== 'ACTIVE'
            || lifecycle.terminal_event_id !== null
            || lifecycle.updated_at !== context.recorded_at
            || grant.issuer.audit_correlation_id !== context.event_id) {
            throw new AuthorityRegistryError('CORRUPT', 'Grant creation provenance and ACTIVE state must correlate to the same transaction.');
        }
        changed = [...new Set([...bindingIds, ...changedGrantIds, ...changedLifecycleIds])].sort();
    }
    else if (mutation.kind === 'GRANT_REVOKED') {
        if (!sameStable(proposed.repository_bindings, current.repository_bindings)
            || !sameStable(proposed.work_bindings, current.work_bindings)
            || !sameStable(proposed.subject_bindings, current.subject_bindings)
            || !sameStable(proposed.grants, current.grants)
            || proposed.grant_lifecycle.length !== current.grant_lifecycle.length
            || changedLifecycleIds.length !== 1) {
            throw new AuthorityRegistryError('CORRUPT', 'A grant revocation may change exactly one existing ACTIVE lifecycle record.');
        }
        const changedGrantId = changedLifecycleIds[0];
        const before = current.grant_lifecycle.find((row) => row.grant_id === changedGrantId);
        const after = proposed.grant_lifecycle.find((row) => row.grant_id === changedGrantId);
        if (!before
            || !after
            || before.lifecycle !== 'ACTIVE'
            || after.lifecycle !== 'REVOKED'
            || after.terminal_event_id !== context.event_id
            || after.updated_at !== context.recorded_at) {
            throw new AuthorityRegistryError('CORRUPT', 'Grant lifecycle permits only ACTIVE -> REVOKED with matching transaction evidence.');
        }
        changed = changedLifecycleIds;
    }
    else if (mutation.kind === 'GRANT_CONSUMED') {
        if (!sameStable(proposed.repository_bindings, current.repository_bindings)
            || !sameStable(proposed.work_bindings, current.work_bindings)
            || !sameStable(proposed.subject_bindings, current.subject_bindings)
            || !sameStable(proposed.grants, current.grants)
            || proposed.grant_lifecycle.length !== current.grant_lifecycle.length
            || changedLifecycleIds.length !== 1) {
            throw new AuthorityRegistryError('CORRUPT', 'One-shot consumption may change exactly one existing lifecycle row.');
        }
        const changedGrantId = changedLifecycleIds[0];
        const before = current.grant_lifecycle.find((row) => row.grant_id === changedGrantId);
        const after = proposed.grant_lifecycle.find((row) => row.grant_id === changedGrantId);
        const grant = current.grants.find((row) => row.grant_id === changedGrantId);
        if (!before
            || !after
            || !grant
            || grant.mode !== 'ONE_SHOT'
            || before.lifecycle !== 'ACTIVE'
            || after.lifecycle !== 'CONSUMED'
            || after.terminal_event_id !== context.event_id
            || after.updated_at !== context.recorded_at) {
            throw new AuthorityRegistryError('CORRUPT', 'Only a ONE_SHOT ACTIVE grant may atomically transition to CONSUMED.');
        }
        changed = changedLifecycleIds;
    }
    else {
        if (!sameStable(proposed.repository_bindings, current.repository_bindings)
            || !sameStable(proposed.work_bindings, current.work_bindings)
            || !sameStable(proposed.subject_bindings, current.subject_bindings)
            || !sameStable(proposed.grants, current.grants)
            || !sameStable(proposed.grant_lifecycle, current.grant_lifecycle)) {
            throw new AuthorityRegistryError('CORRUPT', 'Grant-use evidence transactions cannot modify bindings, grants, or lifecycle.');
        }
        const requested = mutation.target_ids === undefined ? [] : [...mutation.target_ids];
        if (requested.length !== 1) {
            throw new AuthorityRegistryError('CORRUPT', 'Grant-use evidence must target exactly one canonical grant.');
        }
        const grant = current.grants.find((row) => row.grant_id === requested[0]);
        if (!grant
            || (mutation.kind === 'GRANT_USE_RECORDED' && grant.mode !== 'REUSABLE')) {
            throw new AuthorityRegistryError('CORRUPT', 'Grant-use evidence does not match a supported canonical grant mode.');
        }
        changed = requested;
    }
    const requested = mutation.target_ids === undefined
        ? (mutation.kind === 'GRANT_CREATED'
            || mutation.kind === 'GRANT_REVOKED'
            || mutation.kind === 'GRANT_CONSUMED'
            ? changed
            : [])
        : [...mutation.target_ids];
    if (requested.some((id) => !UUID_PATTERN.test(id)) || new Set(requested).size !== requested.length) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry mutation target IDs are invalid or duplicated.');
    }
    if (JSON.stringify([...requested].sort()) !== JSON.stringify(changed)) {
        throw new AuthorityRegistryError('CORRUPT', 'Registry mutation target list does not exactly match changed records.');
    }
    if (changed.length === 0)
        throw new AuthorityRegistryError('CORRUPT', 'A no-op registry transaction is not committed.');
    return changed;
}
export async function transactAuthorityRegistry(registryPath, mutation, options = {}) {
    const normalizedPath = normalizeRegistryPath(registryPath);
    const directoryPath = dirname(normalizedPath);
    const hooks = options.hooks ?? {};
    await ensureRegistryDirectory(directoryPath, hooks);
    let lock;
    let lockReleased = false;
    let temporaryHandle;
    let temporaryPath;
    let temporaryIdentity;
    let replaceAttempted = false;
    try {
        lock = await acquireLock(normalizedPath, hooks);
        await hooks.onStage?.('lock-acquired');
        const current = await readSnapshot(normalizedPath);
        if (current.revision >= Number.MAX_SAFE_INTEGER || current.audit.length >= MAX_AUDIT_RECORDS) {
            throw new AuthorityRegistryError('CORRUPT', 'Registry revision or audit capacity is exhausted.');
        }
        const context = {
            event_id: randomUUID(),
            revision: current.revision + 1,
            recorded_at: new Date().toISOString(),
        };
        const proposed = await mutation.apply(cloneSnapshot(current), context);
        const targets = ensureMutationBounded(current, proposed, mutation, context);
        const eventTypeByKind = {
            BINDINGS: 'BINDINGS_COMMITTED',
            LIFECYCLE_RECORDS: 'LIFECYCLE_RECORDS_COMMITTED',
            BINDINGS_AND_LIFECYCLE_STORAGE: 'BINDINGS_AND_LIFECYCLE_STORAGE_COMMITTED',
            GRANT_CREATED: 'GRANT_CREATED',
            GRANT_REVOKED: 'GRANT_REVOKED',
            GRANT_USE_RECORDED: 'GRANT_USE_RECORDED',
            GRANT_CONSUMED: 'GRANT_CONSUMED',
            GRANT_USE_REJECTED: 'GRANT_USE_REJECTED',
        };
        const grantForAudit = mutation.kind === 'GRANT_CREATED'
            ? proposed.grants.find((grant) => !current.grants.some((previous) => previous.grant_id === grant.grant_id))
            : mutation.kind === 'GRANT_REVOKED'
                || mutation.kind === 'GRANT_USE_RECORDED'
                || mutation.kind === 'GRANT_CONSUMED'
                || mutation.kind === 'GRANT_USE_REJECTED'
                ? current.grants.find((grant) => targets.includes(grant.grant_id))
                : undefined;
        const next = {
            ...proposed,
            revision: context.revision,
            audit: [
                ...current.audit,
                {
                    event_id: context.event_id,
                    revision: context.revision,
                    kind: mutation.kind,
                    event_type: eventTypeByKind[mutation.kind],
                    grant_id: grantForAudit?.grant_id ?? null,
                    grant_digest: grantForAudit?.grant_digest ?? null,
                    target_ids: targets,
                    recorded_at: context.recorded_at,
                },
            ],
        };
        validateSnapshot(next);
        const expectedBytes = serializeSnapshot(next);
        if (expectedBytes.length > MAX_REGISTRY_BYTES) {
            throw new AuthorityRegistryError('CORRUPT', 'Registry snapshot exceeds its byte limit.');
        }
        await hooks.onStage?.('before-temp-create');
        temporaryPath = join(directoryPath, `.${basename(normalizedPath)}.${randomUUID()}.tmp`);
        temporaryHandle = await open(temporaryPath, 'wx', 0o600);
        const temporaryStats = await temporaryHandle.stat({ bigint: true });
        temporaryIdentity = { dev: temporaryStats.dev, ino: temporaryStats.ino };
        await hooks.onStage?.('temp-created');
        await (hooks.writeTemporary ?? ((handle, bytes) => handle.writeFile(bytes)))(temporaryHandle, expectedBytes);
        await hooks.onStage?.('temp-written');
        await (hooks.syncFile ?? ((handle) => handle.sync()))(temporaryHandle);
        await temporaryHandle.close();
        temporaryHandle = undefined;
        await hooks.onStage?.('file-synced');
        await hooks.onStage?.('before-replace');
        const beforeReplaceValidation = mutation.validateBeforeReplace?.();
        if (beforeReplaceValidation !== undefined)
            await beforeReplaceValidation;
        replaceAttempted = true;
        await (hooks.replace ?? ((temporary, target) => rename(temporary, target)))(temporaryPath, normalizedPath);
        await hooks.onStage?.('replaced');
        await (hooks.syncDirectory ?? syncDirectoryDefault)(directoryPath);
        await hooks.onStage?.('directory-synced');
        const readbackBytes = await (hooks.readback ?? ((path) => readFile(path)))(normalizedPath);
        const readback = parseSnapshot(readbackBytes);
        if (!readbackBytes.equals(expectedBytes) || !sameStable(readback, next)) {
            throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Registry readback does not match the committed snapshot.');
        }
        await hooks.onStage?.('readback-validated');
        await mutation.validateBeforeAck?.(readback);
        await hooks.onStage?.('before-ack');
        await releaseOwnedLock(lock, directoryPath, hooks);
        lockReleased = true;
        return cloneSnapshot(readback);
    }
    catch (error) {
        if (temporaryHandle !== undefined) {
            await temporaryHandle.close().catch(() => undefined);
            temporaryHandle = undefined;
        }
        if (!replaceAttempted && temporaryPath !== undefined && temporaryIdentity !== undefined) {
            try {
                await removeOwnedTemporary(temporaryPath, temporaryIdentity.dev, temporaryIdentity.ino);
            }
            catch {
                // A temporary cleanup failure cannot justify removing any other path or reporting success.
            }
        }
        if (lock !== undefined && !lockReleased) {
            if (replaceAttempted) {
                await closeOwnedLock(lock).catch(() => undefined);
            }
            else {
                try {
                    await releaseOwnedLock(lock, directoryPath, hooks);
                    lockReleased = true;
                }
                catch (releaseError) {
                    throw new AuthorityRegistryError('LOCK_OWNERSHIP_UNCERTAIN', 'Registry lock could not be safely released; no retry is attempted.', { cause: releaseError });
                }
            }
        }
        if (replaceAttempted) {
            throw error instanceof AuthorityRegistryError && error.code === 'COMMIT_UNCERTAIN'
                ? error
                : new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Registry replacement was attempted; reconcile the exact snapshot read-only before any new action.', { cause: error });
        }
        if (error instanceof AuthorityRegistryError)
            throw error;
        throw new AuthorityRegistryError('PERSISTENCE_FAILED', 'Registry transaction did not complete its persistence barrier.', { cause: error });
    }
    finally {
        if (temporaryHandle !== undefined)
            await temporaryHandle.close().catch(() => undefined);
        if (lock !== undefined && !lock.closed && !lockReleased && replaceAttempted) {
            await closeOwnedLock(lock).catch(() => undefined);
        }
    }
}
//# sourceMappingURL=registry.js.map