import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { IOStateError, InputValidationError, StateConflictError, StateCorruptionError } from '../../models/errors.js';
const CHANGE_BUDGET_DIR = '.changebudget';
const STATE_LOCK_FILE = 'state.json.lock';
const RECOVERY_AUDIT_FILE = 'lifecycle-lock-recovery.json';
const LOCK_SCHEMA_VERSION = 1;
const RECOVERY_AUDIT_SCHEMA_VERSION = '1.0.0';
let lifecycleLockRecoveryTestHooks;
/** @internal Deterministic seams for lifecycle-lock recovery tests only. */
export function setLifecycleLockRecoveryTestHooks(hooks) {
    const previous = lifecycleLockRecoveryTestHooks;
    lifecycleLockRecoveryTestHooks = hooks;
    return () => {
        lifecycleLockRecoveryTestHooks = previous;
    };
}
export function getLifecycleLockPath(repositoryRoot) {
    return join(repositoryRoot, CHANGE_BUDGET_DIR, STATE_LOCK_FILE);
}
export function getLifecycleLockRecoveryAuditPath(repositoryRoot) {
    return join(repositoryRoot, CHANGE_BUDGET_DIR, RECOVERY_AUDIT_FILE);
}
function errorCode(error) {
    return typeof error === 'object' && error !== null && 'code' in error
        && typeof error.code === 'string'
        ? error.code
        : undefined;
}
function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasExactKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function isValidOwnerMetadata(value) {
    if (!isObject(value) || !hasExactKeys(value, ['lock_schema_version', 'pid', 'token', 'acquired_at'])) {
        return false;
    }
    return value.lock_schema_version === LOCK_SCHEMA_VERSION
        && typeof value.pid === 'number' && Number.isSafeInteger(value.pid) && value.pid > 0
        && typeof value.token === 'string' && value.token.trim().length > 0
        && typeof value.acquired_at === 'string' && !Number.isNaN(Date.parse(value.acquired_at));
}
function probeProcess(pid) {
    const injected = lifecycleLockRecoveryTestHooks?.probeProcess;
    if (injected !== undefined)
        return injected(pid);
    try {
        process.kill(pid, 0);
        return 'LIVE';
    }
    catch (error) {
        const code = errorCode(error);
        if (code === 'ESRCH')
            return 'DEAD';
        // EPERM and every platform-specific or ambiguous failure are not proof of death.
        return 'UNVERIFIABLE';
    }
}
function candidatePid(value) {
    return isObject(value) && typeof value.pid === 'number'
        && Number.isSafeInteger(value.pid) && value.pid > 0
        ? value.pid
        : null;
}
async function lstatOptional(path) {
    try {
        return await lstat(path, { bigint: true });
    }
    catch (error) {
        if (errorCode(error) === 'ENOENT')
            return null;
        throw error;
    }
}
async function ensureChangeBudgetDirectory(repositoryRoot) {
    const directory = join(repositoryRoot, CHANGE_BUDGET_DIR);
    let stats = await lstatOptional(directory);
    if (stats === null) {
        try {
            await mkdir(directory);
        }
        catch (error) {
            if (errorCode(error) !== 'EEXIST')
                throw error;
        }
        stats = await lstatOptional(directory);
    }
    if (stats === null || stats.isSymbolicLink() || !stats.isDirectory()) {
        throw new IOStateError(`ChangeBudget state directory is not a regular directory: ${directory}`, {
            path: directory,
            reason: 'path_anomaly',
        });
    }
}
function identityFromStats(stats) {
    const bigintStats = stats;
    return {
        device: bigintStats.dev.toString(),
        inode: bigintStats.ino.toString(),
        mode: bigintStats.mode.toString(),
        size: bigintStats.size.toString(),
        modified_ns: bigintStats.mtimeNs.toString(),
    };
}
function sameIdentity(left, right) {
    return left !== null && right !== null
        && left.device === right.device
        && left.inode === right.inode
        && left.mode === right.mode
        && left.size === right.size
        && left.modified_ns === right.modified_ns;
}
function parseOwner(content) {
    try {
        const parsed = JSON.parse(content);
        return {
            owner: isValidOwnerMetadata(parsed) ? parsed : null,
            parsed,
            validJson: true,
        };
    }
    catch {
        return { owner: null, parsed: null, validJson: false };
    }
}
/** Inspect only the exact lifecycle state lock; metadata is diagnostic, never authority. */
export async function inspectLifecycleLock(repositoryRoot) {
    const lockPath = getLifecycleLockPath(repositoryRoot);
    const directoryStats = await lstatOptional(dirname(lockPath));
    if (directoryStats !== null && (directoryStats.isSymbolicLink() || !directoryStats.isDirectory())) {
        return {
            classification: 'MALFORMED',
            owner_metadata: null,
            identity: null,
            fingerprint: null,
            liveness: null,
            path_anomaly: true,
            detail: 'state directory is not a regular directory',
        };
    }
    let stats;
    try {
        stats = await lstatOptional(lockPath);
    }
    catch (error) {
        return {
            classification: 'UNVERIFIABLE',
            owner_metadata: null,
            identity: null,
            fingerprint: null,
            liveness: null,
            path_anomaly: false,
            detail: `unable to inspect lock path (${errorCode(error) ?? 'unknown'})`,
        };
    }
    if (stats === null) {
        return {
            classification: 'ABSENT',
            owner_metadata: null,
            identity: null,
            fingerprint: null,
            liveness: null,
            path_anomaly: false,
            detail: null,
        };
    }
    const identity = identityFromStats(stats);
    if (stats.isSymbolicLink() || !stats.isFile()) {
        return {
            classification: 'MALFORMED',
            owner_metadata: null,
            identity,
            fingerprint: null,
            liveness: null,
            path_anomaly: true,
            detail: 'state lock is not a regular file',
        };
    }
    let content;
    try {
        content = await readFile(lockPath, 'utf8');
    }
    catch (error) {
        return {
            classification: 'UNVERIFIABLE',
            owner_metadata: null,
            identity,
            fingerprint: null,
            liveness: null,
            path_anomaly: false,
            detail: `unable to read lock metadata (${errorCode(error) ?? 'unknown'})`,
        };
    }
    const fingerprint = createHash('sha256').update(content, 'utf8').digest('hex');
    const afterReadStats = await lstatOptional(lockPath);
    if (afterReadStats === null || afterReadStats.isSymbolicLink() || !afterReadStats.isFile()
        || !sameIdentity(identity, identityFromStats(afterReadStats))) {
        return {
            classification: 'UNVERIFIABLE',
            owner_metadata: null,
            identity,
            fingerprint,
            liveness: null,
            path_anomaly: true,
            detail: 'state lock identity changed while being inspected',
        };
    }
    if (content.trim().length === 0) {
        return {
            classification: 'UNVERIFIABLE',
            owner_metadata: null,
            identity,
            fingerprint,
            liveness: null,
            path_anomaly: false,
            detail: 'legacy empty lock has no owner metadata',
        };
    }
    const parsed = parseOwner(content);
    if (parsed.owner !== null) {
        const liveness = probeProcess(parsed.owner.pid);
        return {
            classification: liveness ?? 'UNVERIFIABLE',
            owner_metadata: parsed.owner,
            identity,
            fingerprint,
            liveness,
            path_anomaly: false,
            detail: null,
        };
    }
    const pid = parsed.validJson ? candidatePid(parsed.parsed) : null;
    const liveness = pid === null ? null : probeProcess(pid);
    return {
        classification: 'MALFORMED',
        owner_metadata: null,
        identity,
        fingerprint,
        liveness,
        path_anomaly: false,
        detail: parsed.validJson ? 'owner metadata has an invalid structure' : 'owner metadata is not valid JSON',
    };
}
function observationIdentityMatches(expected, actual) {
    return expected.fingerprint !== null
        && expected.fingerprint === actual.fingerprint
        && sameIdentity(expected.identity, actual.identity)
        && expected.path_anomaly === actual.path_anomaly;
}
function createOwnerMetadata() {
    return {
        lock_schema_version: LOCK_SCHEMA_VERSION,
        pid: process.pid,
        token: randomUUID(),
        acquired_at: new Date().toISOString(),
    };
}
async function safeRemoveOwnedLock(repositoryRoot, handle, owner) {
    const lockPath = getLifecycleLockPath(repositoryRoot);
    const openedStats = await handle.stat({ bigint: true });
    await handle.close();
    const pathStats = await lstatOptional(lockPath);
    if (pathStats === null || pathStats.isSymbolicLink() || !pathStats.isFile()) {
        throw new IOStateError(`Lifecycle state lock ownership changed before release at ${lockPath}`, {
            path: lockPath,
            reason: 'owner_identity_changed',
        });
    }
    const pathIdentity = identityFromStats(pathStats);
    const openedIdentity = identityFromStats(openedStats);
    if (!sameIdentity(openedIdentity, pathIdentity)) {
        throw new IOStateError(`Lifecycle state lock identity changed before release at ${lockPath}`, {
            path: lockPath,
            reason: 'owner_identity_changed',
        });
    }
    const current = await inspectLifecycleLock(repositoryRoot);
    if (current.owner_metadata?.token !== owner.token || !sameIdentity(pathIdentity, current.identity)) {
        throw new IOStateError(`Lifecycle state lock owner token changed before release at ${lockPath}`, {
            path: lockPath,
            reason: 'owner_token_changed',
        });
    }
    await rm(lockPath);
}
/** Acquire the state lock with diagnostic owner metadata and token-safe cleanup. */
export async function acquireLifecycleStateLock(repositoryRoot) {
    await ensureChangeBudgetDirectory(repositoryRoot);
    const lockPath = getLifecycleLockPath(repositoryRoot);
    let handle;
    try {
        handle = await open(lockPath, 'wx', 0o600);
    }
    catch (error) {
        if (errorCode(error) !== 'EEXIST') {
            throw new IOStateError(`Unable to acquire lifecycle state lock at ${lockPath}`, {
                path: lockPath,
                cause: error instanceof Error ? error.message : String(error),
            });
        }
        const observed = await inspectLifecycleLock(repositoryRoot);
        if (observed.classification === 'ABSENT') {
            // A concurrent non-adversarial release may have completed between open and inspection.
            try {
                handle = await open(lockPath, 'wx', 0o600);
            }
            catch (retryError) {
                if (errorCode(retryError) !== 'EEXIST')
                    throw retryError;
                return throwLockContention(lockPath, await inspectLifecycleLock(repositoryRoot));
            }
        }
        else {
            return throwLockContention(lockPath, observed);
        }
    }
    const owner = createOwnerMetadata();
    try {
        await handle.writeFile(`${JSON.stringify(owner)}\n`, 'utf8');
        await handle.sync();
    }
    catch (error) {
        // If owner metadata could not be written and synced, retain the lock rather than risk unlinking a replacement.
        await handle.close().catch(() => undefined);
        throw new IOStateError(`Unable to persist lifecycle lock owner metadata at ${lockPath}`, {
            path: lockPath,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    return async () => safeRemoveOwnedLock(repositoryRoot, handle, owner);
}
function throwLockContention(lockPath, observation) {
    if (observation.classification === 'LIVE' || observation.liveness === 'LIVE') {
        throw new StateConflictError(`Lifecycle state is busy: a live process owns ${STATE_LOCK_FILE}${observation.owner_metadata ? ` (PID ${observation.owner_metadata.pid})` : ''}. Wait for it to finish; --force never removes a live lock.`, 'lifecycle_lock', { path: lockPath, classification: 'LIVE', ownerPid: observation.owner_metadata?.pid ?? null });
    }
    throw new StateConflictError(`Lifecycle lock recovery is required for ${STATE_LOCK_FILE} (classification=${observation.classification}). The lock was left intact; an operator must run changebudget recover lifecycle-lock --reason "<non-empty reason>"${observation.classification === 'DEAD' ? '' : ' --force'}.`, 'lifecycle_lock', { path: lockPath, classification: observation.classification, ownerPid: observation.owner_metadata?.pid ?? null });
}
function isValidIdentity(value) {
    return isObject(value)
        && hasExactKeys(value, ['device', 'inode', 'mode', 'size', 'modified_ns'])
        && ['device', 'inode', 'mode', 'size', 'modified_ns'].every((key) => typeof value[key] === 'string');
}
function isValidObservation(value) {
    if (!isObject(value) || !hasExactKeys(value, [
        'classification', 'owner_metadata', 'identity', 'fingerprint', 'liveness', 'path_anomaly', 'detail',
    ]))
        return false;
    const classifications = ['LIVE', 'DEAD', 'UNVERIFIABLE', 'MALFORMED', 'ABSENT'];
    const liveness = ['LIVE', 'DEAD', 'UNVERIFIABLE'];
    return typeof value.classification === 'string' && classifications.includes(value.classification)
        && (value.owner_metadata === null || isValidOwnerMetadata(value.owner_metadata))
        && (value.identity === null || isValidIdentity(value.identity))
        && (value.fingerprint === null || (typeof value.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.fingerprint)))
        && (value.liveness === null || (typeof value.liveness === 'string' && liveness.includes(value.liveness)))
        && typeof value.path_anomaly === 'boolean'
        && (value.detail === null || typeof value.detail === 'string');
}
function isValidRecoveryAuditRecord(value) {
    if (!isObject(value) || !hasExactKeys(value, [
        'audit_schema_version', 'event_id', 'operation', 'reason', 'force', 'observed', 'outcome',
        'recorded_at', 'updated_at', 'recovery_assumption', 'pending_audit_reconciliation', 'reconciliation_error',
    ]))
        return false;
    const outcomes = ['PENDING', 'NOOP', 'REFUSED', 'RECOVERED'];
    const reconciliations = ['not_required', 'completed', 'failed'];
    return value.audit_schema_version === RECOVERY_AUDIT_SCHEMA_VERSION
        && typeof value.event_id === 'string' && value.event_id.trim().length > 0
        && value.operation === 'lifecycle_lock_recovery'
        && typeof value.reason === 'string' && value.reason.trim().length > 0
        && typeof value.force === 'boolean'
        && isValidObservation(value.observed)
        && typeof value.outcome === 'string' && outcomes.includes(value.outcome)
        && typeof value.recorded_at === 'string' && !Number.isNaN(Date.parse(value.recorded_at))
        && typeof value.updated_at === 'string' && !Number.isNaN(Date.parse(value.updated_at))
        && value.recovery_assumption === 'operator_quiescent_repository'
        && typeof value.pending_audit_reconciliation === 'string' && reconciliations.includes(value.pending_audit_reconciliation)
        && (value.reconciliation_error === null || typeof value.reconciliation_error === 'string');
}
function stableValue(value) {
    if (Array.isArray(value))
        return value.map(stableValue);
    if (!isObject(value))
        return value;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}
async function readRecoveryAuditRecords(repositoryRoot) {
    const path = getLifecycleLockRecoveryAuditPath(repositoryRoot);
    const stats = await lstatOptional(path);
    if (stats === null)
        return [];
    if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new StateCorruptionError('Lifecycle lock recovery audit path is not a regular file', { path });
    }
    let payload;
    try {
        payload = JSON.parse(await readFile(path, 'utf8'));
    }
    catch (error) {
        throw new StateCorruptionError('Lifecycle lock recovery audit file is malformed', {
            path,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
    if (!isObject(payload) || !hasExactKeys(payload, ['audit_schema_version', 'records'])
        || payload.audit_schema_version !== RECOVERY_AUDIT_SCHEMA_VERSION
        || !Array.isArray(payload.records)
        || !payload.records.every(isValidRecoveryAuditRecord)
        || new Set(payload.records.map((record) => record.event_id)).size
            !== payload.records.length) {
        throw new StateCorruptionError('Lifecycle lock recovery audit file has invalid structure', { path });
    }
    return payload.records;
}
async function runRecoveryAuditWriteHook(record) {
    await lifecycleLockRecoveryTestHooks?.beforeAuditWrite?.(record);
}
async function writeAuditFileAtomic(repositoryRoot, records) {
    await ensureChangeBudgetDirectory(repositoryRoot);
    const path = getLifecycleLockRecoveryAuditPath(repositoryRoot);
    const existingStats = await lstatOptional(path);
    if (existingStats !== null && (existingStats.isSymbolicLink() || !existingStats.isFile())) {
        throw new StateCorruptionError('Lifecycle lock recovery audit path is not a regular file', { path });
    }
    const tempPath = `${path}.${randomUUID()}.tmp`;
    let tempHandle;
    try {
        tempHandle = await open(tempPath, 'wx', 0o600);
        const stable = stableValue({ audit_schema_version: RECOVERY_AUDIT_SCHEMA_VERSION, records });
        await tempHandle.writeFile(`${JSON.stringify(stable, null, 2)}\n`, 'utf8');
        await tempHandle.sync();
        await tempHandle.close();
        tempHandle = undefined;
        await rename(tempPath, path);
    }
    catch (error) {
        await tempHandle?.close().catch(() => undefined);
        await rm(tempPath, { force: true }).catch(() => undefined);
        throw new IOStateError(`Unable to persist lifecycle lock recovery audit at ${path}`, {
            path,
            cause: error instanceof Error ? error.message : String(error),
        });
    }
}
async function persistRecoveryAuditRecord(repositoryRoot, record) {
    if (!isValidRecoveryAuditRecord(record)) {
        throw new StateCorruptionError('Cannot persist malformed lifecycle lock recovery evidence');
    }
    await runRecoveryAuditWriteHook(record);
    const current = await readRecoveryAuditRecords(repositoryRoot);
    const index = current.findIndex((entry) => entry.event_id === record.event_id);
    const next = [...current];
    if (index < 0)
        next.push(record);
    else
        next[index] = record;
    await writeAuditFileAtomic(repositoryRoot, next);
}
export async function readLifecycleLockRecoveryAudit(repositoryRoot) {
    await ensureChangeBudgetDirectory(repositoryRoot);
    return readRecoveryAuditRecords(repositoryRoot);
}
function refusalMessage(observation, force) {
    if (observation.classification === 'LIVE' || observation.liveness === 'LIVE') {
        return 'A live lifecycle lock owner was observed; --force never removes a live lock.';
    }
    if (observation.path_anomaly) {
        return 'The lifecycle lock path is a symlink or other path anomaly; it was left intact.';
    }
    if ((observation.classification === 'MALFORMED' || observation.classification === 'UNVERIFIABLE') && !force) {
        return `Lifecycle lock metadata is ${observation.classification}; retry only with --force after confirming the repository is quiescent.`;
    }
    return 'Lifecycle lock identity or liveness changed during recovery; it was left intact.';
}
function initialRecord(reason, force, observed) {
    const now = new Date().toISOString();
    return {
        audit_schema_version: RECOVERY_AUDIT_SCHEMA_VERSION,
        event_id: randomUUID(),
        operation: 'lifecycle_lock_recovery',
        reason,
        force,
        observed,
        outcome: 'PENDING',
        recorded_at: now,
        updated_at: now,
        recovery_assumption: 'operator_quiescent_repository',
        pending_audit_reconciliation: 'not_required',
        reconciliation_error: null,
    };
}
function finalRecord(record, outcome, reconciliation = 'not_required', reconciliationError = null) {
    return {
        ...record,
        outcome,
        updated_at: new Date().toISOString(),
        pending_audit_reconciliation: reconciliation,
        reconciliation_error: reconciliationError,
    };
}
async function saveFinalRecord(repositoryRoot, record, outcome, reconciliation = 'not_required', reconciliationError = null) {
    const completed = finalRecord(record, outcome, reconciliation, reconciliationError);
    await persistRecoveryAuditRecord(repositoryRoot, completed);
    return completed;
}
function asResult(record) {
    if (record.outcome === 'PENDING')
        throw new Error('Pending recovery evidence is not a final result');
    return {
        outcome: record.outcome,
        event_id: record.event_id,
        classification: record.observed.classification,
        force: record.force,
        pathAnomaly: record.observed.path_anomaly,
        fingerprintAvailable: record.observed.fingerprint !== null && record.observed.identity !== null,
        pendingAuditReconciliation: record.pending_audit_reconciliation,
        reconciliationError: record.reconciliation_error,
    };
}
/**
 * Recover only `.changebudget/state.json.lock`. Recovery is an operator action
 * performed while lifecycle writers are quiescent; it does not provide atomic
 * conditional unlink against a malicious same-user process racing this command.
 */
export async function recoverLifecycleLock(repositoryRoot, options, reconcilePendingAudits) {
    if (options.reason.trim().length === 0) {
        throw new InputValidationError('A non-empty --reason is required for lifecycle lock recovery', '--reason');
    }
    await ensureChangeBudgetDirectory(repositoryRoot);
    const lockPath = getLifecycleLockPath(repositoryRoot);
    const observed = await inspectLifecycleLock(repositoryRoot);
    let record = initialRecord(options.reason, options.force, observed);
    if (observed.classification === 'ABSENT') {
        record = await saveFinalRecord(repositoryRoot, record, 'NOOP');
        return asResult(record);
    }
    const observedLive = observed.classification === 'LIVE' || observed.liveness === 'LIVE';
    const needsForce = observed.classification === 'MALFORMED' || observed.classification === 'UNVERIFIABLE';
    const cannotSafelyInspect = observed.path_anomaly || observed.identity === null || observed.fingerprint === null;
    if (observedLive || cannotSafelyInspect || (needsForce && !options.force)) {
        record = await saveFinalRecord(repositoryRoot, record, 'REFUSED');
        return asResult(record);
    }
    // The synced write-ahead audit file survives process termination/restart, but
    // without directory fsync this does not cover sudden power loss. PENDING is
    // retained if the process stops between this barrier and final reconciliation.
    await persistRecoveryAuditRecord(repositoryRoot, record);
    const finalObservation = await inspectLifecycleLock(repositoryRoot);
    const finalLive = finalObservation.classification === 'LIVE' || finalObservation.liveness === 'LIVE';
    const sameLock = observationIdentityMatches(observed, finalObservation);
    const normalDeadProof = observed.classification !== 'DEAD'
        || (finalObservation.classification === 'DEAD' && finalObservation.liveness === 'DEAD');
    if (!sameLock || finalLive || finalObservation.path_anomaly || !normalDeadProof) {
        record = await saveFinalRecord(repositoryRoot, record, 'REFUSED');
        return asResult(record);
    }
    try {
        // The final identity/liveness re-read above is conservative, but this is not
        // an OS-level compare-and-unlink primitive; operator quiescence is required.
        await rm(lockPath);
    }
    catch (error) {
        const afterFailure = await inspectLifecycleLock(repositoryRoot);
        if (afterFailure.classification !== 'ABSENT') {
            if (observationIdentityMatches(observed, afterFailure)) {
                record = await saveFinalRecord(repositoryRoot, record, 'REFUSED');
                return asResult(record);
            }
            throw new IOStateError('Lifecycle lock changed while recovery cleanup failed; recovery outcome remains pending.', {
                path: lockPath,
                eventId: record.event_id,
                cause: error instanceof Error ? error.message : String(error),
            });
        }
    }
    let reconciliation = 'completed';
    let reconciliationError = null;
    try {
        await reconcilePendingAudits();
    }
    catch (error) {
        reconciliation = 'failed';
        reconciliationError = error instanceof Error ? error.message : String(error);
    }
    record = await saveFinalRecord(repositoryRoot, record, 'RECOVERED', reconciliation, reconciliationError);
    return asResult(record);
}
export function lifecycleLockRecoveryRefusal(result) {
    const message = result.classification === 'LIVE'
        ? 'Lifecycle lock recovery refused: the owner is live, including when --force is supplied.'
        : result.pathAnomaly
            ? 'Lifecycle lock recovery refused: the state lock path is a symlink or other path anomaly and was left intact.'
            : !result.fingerprintAvailable
                ? 'Lifecycle lock recovery refused: ChangeBudget could not establish the exact lock identity, so it was left intact.'
                : (result.classification === 'MALFORMED' || result.classification === 'UNVERIFIABLE') && !result.force
                    ? `Lifecycle lock recovery refused for ${result.classification} metadata; retry with --force only after confirming the repository is quiescent.`
                    : `Lifecycle lock recovery refused for classification ${result.classification}; identity or liveness changed and the lock was left intact.`;
    return new StateConflictError(message, 'lifecycle_lock_recovery', {
        eventId: result.event_id,
        classification: result.classification,
    });
}
export function lifecycleLockReconciliationFailure(result) {
    return new StateConflictError('Lifecycle lock was removed, but pending lifecycle audit reconciliation failed; inspect the recovery audit and lifecycle state before retrying.', 'lifecycle_audit', {
        eventId: result.event_id,
        reconciliationError: result.reconciliationError,
    });
}
//# sourceMappingURL=lifecycle-lock-recovery.js.map