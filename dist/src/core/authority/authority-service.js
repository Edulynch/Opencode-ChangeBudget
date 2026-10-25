import { randomUUID } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ensureGitRepository } from '../git/repo.js';
import { isChangeBudgetPath } from '../check/literal-path.js';
import { compilePathPatterns, matchPathPattern } from '../check/patterns.js';
import { AuthorityRegistryError, getDefaultAuthorityRegistryPath, inspectAuthorityRegistry, transactAuthorityRegistry, } from './registry.js';
import { createCanonicalGrantRecord, grantMatchesPathScope, normalizeGrantDraft, normalizeAuthorityUseRequest, } from './grants.js';
import { initializeAbsentRepositoryReference, readRepositoryPublicReference, } from './repository-reference.js';
import { samePhysicalIdentity } from './physical-identity.js';
import { resolveRepositoryBindingCandidate } from './repository-binding.js';
import { resolveWorkContextCandidate, withAuthorityReadObservation, withWorkContextCandidate, } from './work-context.js';
const AUTHORITY_REVISION = 1;
const GRANT_LIMIT = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
export class AuthorityServiceError extends Error {
    code;
    constructor(code, message, options) {
        super(message, options);
        this.name = 'AuthorityServiceError';
        this.code = code;
    }
}
function hasUuid(value, label) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
        throw new AuthorityServiceError('GRANT_NOT_FOUND', `${label} must be a canonical opaque ID.`);
    }
}
function grantIsUnexpired(expiresAt, now) {
    return Date.parse(expiresAt) > now().getTime();
}
function matchesStableWork(binding, candidate, referenceId) {
    return binding.repository_reference_id === referenceId
        && binding.contract_id === candidate.work.contract_id
        && binding.work_activation_epoch === candidate.work.work_activation_epoch
        && binding.contract_revision_digest === candidate.work.contract_revision_digest
        && binding.scope_digest === candidate.work.scope_digest;
}
function resolveCanonicalBindings(snapshot, candidate, referenceId, subjectLabel, recordedAt, allowCreate) {
    const repository = snapshot.repository_bindings.find((binding) => binding.repository_reference_id === referenceId);
    if (!repository) {
        throw new AuthorityServiceError('REFERENCE_DANGLING', 'Repository reference does not resolve to a canonical registry binding.');
    }
    const workMatches = snapshot.work_bindings.filter((binding) => matchesStableWork(binding, candidate, referenceId));
    if (workMatches.length > 1) {
        throw new AuthorityServiceError('WORK_BINDING_AMBIGUOUS', 'Multiple canonical work bindings match the current coherent context.');
    }
    let work = workMatches[0];
    let addedWork;
    if (!work) {
        if (!allowCreate)
            throw new AuthorityServiceError('WORK_CONTEXT_UNAVAILABLE', 'No current canonical work binding matches this grant.');
        work = {
            work_id: candidate.work.work_id,
            repository_reference_id: referenceId,
            authority_id: candidate.work.authority_id,
            contract_id: candidate.work.contract_id,
            task_id: candidate.work.task_id,
            work_activation_id: candidate.work.work_activation_id,
            work_activation_epoch: candidate.work.work_activation_epoch,
            contract_revision_digest: candidate.work.contract_revision_digest,
            scope_digest: candidate.work.scope_digest,
            created_at: recordedAt,
        };
        addedWork = work;
    }
    const subjectsForWork = snapshot.subject_bindings.filter((binding) => binding.work_id === work.work_id);
    let subject;
    if (subjectLabel !== null) {
        const matches = subjectsForWork.filter((binding) => binding.subject_label === subjectLabel);
        if (matches.length > 1) {
            throw new AuthorityServiceError('SUBJECT_BINDING_AMBIGUOUS', 'Multiple canonical subject bindings match the descriptive selection.');
        }
        subject = matches[0];
    }
    else if (subjectsForWork.length === 1) {
        subject = subjectsForWork[0];
    }
    else if (subjectsForWork.length > 1) {
        throw new AuthorityServiceError('SUBJECT_BINDING_AMBIGUOUS', 'A subject label is required to select among existing subject bindings.');
    }
    let addedSubject;
    if (!subject) {
        if (!allowCreate)
            throw new AuthorityServiceError('SUBJECT_CONTEXT_UNAVAILABLE', 'No current canonical subject binding matches this grant.');
        subject = {
            subject_id: candidate.subject.subject_id,
            repository_reference_id: referenceId,
            work_id: work.work_id,
            subject_label: subjectLabel,
            created_at: recordedAt,
        };
        addedSubject = subject;
    }
    if (subject.repository_reference_id !== referenceId || subject.work_id !== work.work_id) {
        throw new AuthorityServiceError('SUBJECT_CONTEXT_UNAVAILABLE', 'Canonical subject binding does not match the selected repository and work.');
    }
    return {
        repository,
        work,
        subject,
        ...(addedWork === undefined ? {} : { addedWork }),
        ...(addedSubject === undefined ? {} : { addedSubject }),
    };
}
function createRepositoryBinding(snapshot, candidate, referenceId, recordedAt) {
    const byReference = snapshot.repository_bindings.find((binding) => binding.repository_reference_id === referenceId);
    if (byReference) {
        if (!samePhysicalIdentity(byReference.physical_identity, candidate.repository.physical_identity)) {
            throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository physical identity does not match its registry binding.');
        }
        return { binding: byReference };
    }
    if (snapshot.repository_bindings.some((binding) => samePhysicalIdentity(binding.physical_identity, candidate.repository.physical_identity))) {
        throw new AuthorityServiceError('REFERENCE_DANGLING', 'The physical repository already has a different locator; implicit reference replacement is forbidden.');
    }
    const binding = {
        repository_reference_id: referenceId,
        anchor_kind: candidate.repository.anchor_kind,
        binding_epoch: 1,
        physical_identity: candidate.repository.physical_identity,
        created_at: recordedAt,
        updated_at: recordedAt,
    };
    return { binding, added: binding };
}
async function readLocalRepositoryState(repositoryRootHint, registryPath, allowInitialReference, workCandidate, beforeInitializeReference) {
    const root = await ensureGitRepository(repositoryRootHint);
    const repositoryCandidate = workCandidate?.repository ?? await resolveRepositoryBindingCandidate(root);
    const snapshot = await inspectAuthorityRegistry(registryPath);
    let reference = await readRepositoryPublicReference(root);
    let repositoryBinding;
    if (reference === undefined) {
        if (!allowInitialReference) {
            throw new AuthorityServiceError('REFERENCE_REQUIRED', 'Repository authority reference is missing; read/list/revoke never initialize it.');
        }
        if (snapshot.repository_bindings.some((binding) => samePhysicalIdentity(binding.physical_identity, repositoryCandidate.physical_identity))) {
            throw new AuthorityServiceError('REFERENCE_DANGLING', 'A registry binding exists without its public reference; explicit cleanup/reinitialization is required.');
        }
        // This narrows the async pre-init gap; the clock cannot be atomic with the locator file write that follows.
        beforeInitializeReference?.();
        reference = await initializeAbsentRepositoryReference(root, randomUUID());
    }
    else {
        repositoryBinding = snapshot.repository_bindings.find((binding) => binding.repository_reference_id === reference.repository_reference_id);
        if (!repositoryBinding) {
            throw new AuthorityServiceError('REFERENCE_DANGLING', 'Repository locator has no registry binding; it will not be automatically rebound.');
        }
        if (!samePhysicalIdentity(repositoryBinding.physical_identity, repositoryCandidate.physical_identity)) {
            throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository locator belongs to a different physical Git common-directory object.');
        }
    }
    if (repositoryBinding === undefined && reference !== undefined) {
        repositoryBinding = snapshot.repository_bindings.find((binding) => binding.repository_reference_id === reference.repository_reference_id);
        if (repositoryBinding) {
            if (!samePhysicalIdentity(repositoryBinding.physical_identity, repositoryCandidate.physical_identity)) {
                throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository locator belongs to a different physical Git common-directory object.');
            }
        }
    }
    const verifiedAgain = await resolveRepositoryBindingCandidate(root);
    if (!samePhysicalIdentity(verifiedAgain.physical_identity, repositoryCandidate.physical_identity)) {
        throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository physical identity changed during reference and registry resolution.');
    }
    return {
        root,
        snapshot,
        repositoryBinding: repositoryBinding ?? {
            repository_reference_id: reference.repository_reference_id,
            anchor_kind: repositoryCandidate.anchor_kind,
            binding_epoch: 1,
            physical_identity: repositoryCandidate.physical_identity,
            created_at: new Date(0).toISOString(),
            updated_at: new Date(0).toISOString(),
        },
        referenceId: reference.repository_reference_id,
    };
}
function lifecycleFor(snapshot, grantId) {
    const lifecycle = snapshot.grant_lifecycle.find((record) => record.grant_id === grantId);
    if (!lifecycle)
        throw new AuthorityRegistryError('CORRUPT', 'Canonical grant has no lifecycle record.');
    return lifecycle;
}
function summarizeGrant(grant, lifecycle, freshnessStatus) {
    return {
        grant_id: grant.grant_id,
        grant_digest: grant.grant_digest,
        lifecycle: lifecycle.lifecycle,
        mode: grant.mode,
        ...(grant.subject_label === null ? {} : { subject_label: grant.subject_label }),
        subject_id: grant.subject_id,
        work_id: grant.work_id,
        authority_id: grant.authority_id,
        operations: grant.operations,
        capabilities: grant.capabilities,
        path_scope: grant.path_scope,
        ceilings: grant.ceilings,
        permissions: grant.permissions,
        valid_from: grant.valid_from,
        expires_at: grant.expires_at,
        freshness_status: freshnessStatus,
    };
}
function matchesCurrentContext(grant, snapshot, candidate, referenceId) {
    const workMatches = snapshot.work_bindings.filter((binding) => matchesStableWork(binding, candidate, referenceId));
    if (workMatches.length !== 1 || workMatches[0]?.work_id !== grant.work_id)
        return false;
    const work = workMatches[0];
    if (work.authority_id !== grant.authority_id
        || work.work_activation_id !== grant.work_activation_id
        || work.work_activation_epoch !== grant.work_activation_epoch)
        return false;
    const subjects = snapshot.subject_bindings.filter((binding) => binding.work_id === work.work_id
        && binding.subject_id === grant.subject_id
        && binding.repository_reference_id === referenceId
        && binding.subject_label === grant.subject_label);
    return subjects.length === 1;
}
function sameResolvedMutationContext(initial, current) {
    return initial.source === current.source
        && initial.repository.anchor_kind === current.repository.anchor_kind
        && samePhysicalIdentity(initial.repository.physical_identity, current.repository.physical_identity)
        && initial.subject.subject_label === current.subject.subject_label
        && initial.work.contract_id === current.work.contract_id
        && initial.work.task_id === current.work.task_id
        && initial.work.work_activation_epoch === current.work.work_activation_epoch
        && initial.work.contract_revision_digest === current.work.contract_revision_digest
        && initial.work.scope_digest === current.work.scope_digest;
}
function requireStableMutationContext(initial, current) {
    if (!samePhysicalIdentity(initial.repository.physical_identity, current.repository.physical_identity)) {
        throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository physical identity changed during the authority transaction.');
    }
    if (!sameResolvedMutationContext(initial, current)) {
        throw new AuthorityServiceError('WORK_CONTEXT_UNAVAILABLE', 'Work or subject context changed during the authority transaction.');
    }
}
async function requireRepositoryReference(root, referenceId) {
    const currentReference = await readRepositoryPublicReference(root);
    if (currentReference?.repository_reference_id !== referenceId) {
        throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository authority reference changed during the authority transaction.');
    }
}
async function freshnessStatus(root, snapshot, grant, referenceId, now) {
    if (Date.parse(grant.expires_at) <= now.getTime())
        return 'EXPIRED';
    try {
        const candidate = await resolveWorkContextCandidate(root, {
            ...(grant.subject_label === null ? {} : { subjectLabel: grant.subject_label }),
        });
        return matchesCurrentContext(grant, snapshot, candidate, referenceId) ? 'CURRENT' : 'STALE';
    }
    catch {
        return 'UNAVAILABLE';
    }
}
function requireGrantForRepository(snapshot, referenceId, grantId) {
    const grant = snapshot.grants.find((record) => record.grant_id === grantId);
    if (!grant || grant.repository_reference_id !== referenceId) {
        throw new AuthorityServiceError('GRANT_NOT_FOUND', 'Grant does not exist in this locally bound repository.');
    }
    return grant;
}
class UsePreconditionError extends AuthorityRegistryError {
    reason;
    constructor(reason) {
        super('PERSISTENCE_FAILED', `Authority use precondition failed: ${reason}.`);
        this.name = 'UsePreconditionError';
        this.reason = reason;
    }
}
function failureFromError(error) {
    if (error instanceof AuthorityServiceError) {
        switch (error.code) {
            case 'GRANT_NOT_FOUND': return 'NOT_FOUND';
            case 'GRANT_EXPIRED': return 'EXPIRED';
            case 'GRANT_STALE': return 'STALE_AUTHORITY';
            case 'WORK_CONTEXT_UNAVAILABLE':
            case 'WORK_BINDING_AMBIGUOUS': return 'WORK_CONTEXT_UNAVAILABLE';
            case 'SUBJECT_CONTEXT_UNAVAILABLE':
            case 'SUBJECT_BINDING_AMBIGUOUS': return 'SUBJECT_CONTEXT_UNAVAILABLE';
            case 'REPOSITORY_MISMATCH':
            case 'REFERENCE_DANGLING':
            case 'REFERENCE_REQUIRED': return 'REPOSITORY_MISMATCH';
            case 'GRANT_TERMINAL': return 'CONSUMED';
            case 'GRANT_LIMIT': return 'AUDIT_UNAVAILABLE';
        }
    }
    if (error instanceof AuthorityRegistryError) {
        switch (error.code) {
            case 'LOCK_BUSY': return 'LOCK_BUSY';
            case 'LOCK_OWNERSHIP_UNCERTAIN': return 'LOCK_UNVERIFIABLE';
            case 'COMMIT_UNCERTAIN':
            case 'PERSISTENCE_FAILED': return 'AUDIT_UNAVAILABLE';
            case 'CORRUPT': return 'CORRUPT_STATE';
            case 'UNSUPPORTED_VERSION': return 'UNSUPPORTED_SCHEMA';
            case 'UNSAFE_PATH': return 'REPOSITORY_IDENTITY_UNAVAILABLE';
        }
    }
    if (error instanceof Error && /subject/i.test(error.message))
        return 'SUBJECT_CONTEXT_UNAVAILABLE';
    return 'WORK_CONTEXT_UNAVAILABLE';
}
function useRejected(reason, auditEventId) {
    return {
        status: 'USE_REJECTED',
        reason,
        ...(auditEventId === undefined ? {} : { audit_event_id: auditEventId }),
    };
}
function pathIsContained(root, target) {
    const relativePath = relative(root, target);
    return relativePath === ''
        || (!isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith(`..${sep}`));
}
async function authorityPathIsSafe(repositoryRoot, repositoryRelativePath) {
    try {
        const root = await realpath(repositoryRoot);
        const resolvedRoot = resolve(repositoryRoot);
        const canonicalRoot = process.platform === 'win32' ? root.toLowerCase() : root;
        const lexicalRoot = process.platform === 'win32' ? resolvedRoot.toLowerCase() : resolvedRoot;
        if (canonicalRoot !== lexicalRoot)
            return { safe: false };
        const components = repositoryRelativePath.split('/');
        let current = root;
        let existingCount = 0;
        let missing = false;
        for (let index = 0; index < components.length; index += 1) {
            current = resolve(current, components[index]);
            try {
                const stats = await lstat(current, { bigint: true });
                const attributes = stats.attributes;
                const reparsePoint = process.platform === 'win32'
                    && typeof attributes === 'number'
                    && (attributes & 0x400) !== 0;
                if (missing || stats.isSymbolicLink() || reparsePoint)
                    return { safe: false };
                if (index < components.length - 1 && !stats.isDirectory())
                    return { safe: false };
                existingCount += 1;
            }
            catch (error) {
                if (error.code !== 'ENOENT')
                    return { safe: false };
                missing = true;
            }
        }
        const existingPath = existingCount === 0
            ? root
            : resolve(root, ...components.slice(0, existingCount));
        const physicalExistingPath = await realpath(existingPath);
        if (!pathIsContained(root, physicalExistingPath))
            return { safe: false };
        const physicalRelative = relative(root, physicalExistingPath).split(sep).join('/');
        if (isChangeBudgetPath(physicalRelative))
            return { safe: false };
        if (process.platform === 'win32') {
            const requestedPrefix = components.slice(0, existingCount).join('/');
            if (requestedPrefix.toLowerCase() === physicalRelative.toLowerCase() && requestedPrefix !== physicalRelative) {
                return { safe: false };
            }
        }
        return { safe: true, targetExists: !missing };
    }
    catch {
        return { safe: false };
    }
}
function currentContractPermissions(candidate) {
    return {
        allow_new_files: candidate.contract?.allow_new_files ?? false,
        allow_dependencies: candidate.contract?.allow_new_dependencies ?? false,
        allow_migrations: candidate.contract?.allow_migrations ?? false,
        allow_configuration: candidate.contract?.allow_config_changes ?? false,
        allow_public_api: candidate.contract?.allow_public_api_changes ?? false,
    };
}
function contextFailure(grant, snapshot, candidate, referenceId) {
    const repository = snapshot.repository_bindings.find((binding) => binding.repository_reference_id === referenceId);
    if (!repository || grant.repository_reference_id !== referenceId)
        return 'REPOSITORY_MISMATCH';
    if (repository.binding_epoch !== grant.repository_binding_epoch)
        return 'STALE_AUTHORITY';
    if (!samePhysicalIdentity(repository.physical_identity, candidate.repository.physical_identity)) {
        return 'REPOSITORY_MISMATCH';
    }
    if (grant.authority_revision !== AUTHORITY_REVISION)
        return 'STALE_AUTHORITY';
    const matchingWork = snapshot.work_bindings.filter((binding) => matchesStableWork(binding, candidate, referenceId));
    if (matchingWork.length > 1)
        return 'WORK_MISMATCH';
    const work = matchingWork[0];
    if (!work)
        return 'STALE_AUTHORITY';
    if (work.work_id !== grant.work_id
        || work.authority_id !== grant.authority_id
        || work.work_activation_id !== grant.work_activation_id
        || work.work_activation_epoch !== grant.work_activation_epoch)
        return 'WORK_MISMATCH';
    const subjects = snapshot.subject_bindings.filter((binding) => binding.work_id === work.work_id
        && binding.subject_id === grant.subject_id
        && binding.repository_reference_id === referenceId
        && binding.subject_label === grant.subject_label);
    if (subjects.length !== 1)
        return 'SUBJECT_MISMATCH';
    return undefined;
}
async function authorityUseFailure(repositoryRoot, snapshot, grant, expectedDigest, lifecycle, candidate, referenceId, request, now, expectedLifecycle = 'ACTIVE') {
    if (grant.grant_digest !== expectedDigest)
        return 'STALE_AUTHORITY';
    const bindingFailure = contextFailure(grant, snapshot, candidate, referenceId);
    if (bindingFailure !== undefined)
        return bindingFailure;
    if (!matchesCurrentContext(grant, snapshot, candidate, referenceId))
        return 'STALE_AUTHORITY';
    if (lifecycle !== expectedLifecycle) {
        if (lifecycle === 'REVOKED')
            return 'REVOKED';
        return grant.mode === 'ONE_SHOT' ? 'REPLAY' : 'CONSUMED';
    }
    const time = now.getTime();
    if (!Number.isFinite(time))
        return 'STORAGE_UNAVAILABLE';
    if (Date.parse(grant.valid_from) > time)
        return 'NOT_YET_VALID';
    if (Date.parse(grant.expires_at) <= time)
        return 'EXPIRED';
    if (grant.operations.indexOf(request.requested_operation) < 0)
        return 'OPERATION_MISMATCH';
    if (!request.requested_capabilities.every((capability) => grant.capabilities.includes(capability))) {
        return 'CAPABILITY_MISMATCH';
    }
    const contract = candidate.contract;
    if (contract === null)
        return 'PATH_MISMATCH';
    const contractAllow = compilePathPatterns(contract.allow_paths);
    const contractDeny = compilePathPatterns(contract.deny_paths);
    let fileWriteNeedsNewFilePermission = request.requested_permissions.allow_new_files;
    for (const path of request.requested_paths) {
        if (isChangeBudgetPath(path)
            || !grantMatchesPathScope(grant, path)
            || matchPathPattern(`/${path}`, contractDeny)
            || !matchPathPattern(`/${path}`, contractAllow))
            return 'PATH_MISMATCH';
        const assessment = await authorityPathIsSafe(repositoryRoot, path);
        if (!assessment.safe)
            return 'PATH_MISMATCH';
        if (request.requested_operation === 'file.write' && !assessment.targetExists) {
            fileWriteNeedsNewFilePermission = true;
        }
    }
    const contractPermissions = currentContractPermissions(candidate);
    for (const field of [
        'allow_new_files', 'allow_dependencies', 'allow_migrations', 'allow_configuration', 'allow_public_api',
    ]) {
        const required = request.requested_permissions[field]
            || (field === 'allow_new_files'
                && request.requested_operation === 'file.write'
                && fileWriteNeedsNewFilePermission);
        if (required
            && (!grant.permissions[field] || !contractPermissions[field]))
            return 'CAPABILITY_MISMATCH';
    }
    const currentCeilings = {
        max_files: contract.max_files,
        max_changed_lines: contract.max_changed_lines,
    };
    for (const field of ['max_files', 'max_changed_lines']) {
        if (!Object.hasOwn(request.requested_ceilings, field))
            return 'CEILING_EXCEEDED';
        const requested = request.requested_ceilings[field];
        const granted = grant.ceilings[field];
        const current = currentCeilings[field];
        if (granted === undefined
            || current === null
            || !Number.isSafeInteger(current)
            || requested > granted
            || requested > current)
            return 'CEILING_EXCEEDED';
    }
    return undefined;
}
function lifecycleForRequired(snapshot, grantId) {
    const lifecycle = snapshot.grant_lifecycle.find((record) => record.grant_id === grantId);
    if (!lifecycle)
        throw new AuthorityRegistryError('CORRUPT', 'Canonical grant has no lifecycle record.');
    return lifecycle;
}
function hasUseAudit(snapshot, eventId, eventType, grant) {
    return snapshot.audit.some((event) => event.event_id === eventId
        && event.event_type === eventType
        && event.grant_id === grant.grant_id
        && event.grant_digest === grant.grant_digest
        && event.target_ids.length === 1
        && event.target_ids[0] === grant.grant_id);
}
export function createAuthorityService(options = {}) {
    const registryPath = options.registryPath ?? getDefaultAuthorityRegistryPath();
    const now = options.now ?? (() => new Date());
    const transactionOptions = options.registryHooks === undefined ? {} : { hooks: options.registryHooks };
    const recordUseRejection = async (local, grant, reason) => {
        try {
            const committed = await transactAuthorityRegistry(registryPath, {
                kind: 'GRANT_USE_REJECTED',
                target_ids: [grant.grant_id],
                apply: (current) => {
                    const currentGrant = requireGrantForRepository(current, local.referenceId, grant.grant_id);
                    if (currentGrant.grant_digest !== grant.grant_digest) {
                        throw new UsePreconditionError('STALE_AUTHORITY');
                    }
                    return current;
                },
                validateBeforeAck: (readback) => {
                    const event = readback.audit.at(-1);
                    const currentGrant = requireGrantForRepository(readback, local.referenceId, grant.grant_id);
                    if (!event
                        || event.kind !== 'GRANT_USE_REJECTED'
                        || event.grant_id !== currentGrant.grant_id
                        || event.grant_digest !== currentGrant.grant_digest
                        || event.target_ids.length !== 1
                        || event.target_ids[0] !== currentGrant.grant_id) {
                        throw new Error('Durable rejection evidence does not match its canonical grant.');
                    }
                },
            }, transactionOptions);
            const event = committed.audit.at(-1);
            if (!event || event.kind !== 'GRANT_USE_REJECTED' || event.grant_id !== grant.grant_id) {
                throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Rejected-use evidence was not present in its durable readback.');
            }
            return useRejected(reason, event.event_id);
        }
        catch (error) {
            if (error instanceof AuthorityRegistryError && error.code === 'COMMIT_UNCERTAIN')
                throw error;
            if (error instanceof AuthorityRegistryError && error.code === 'LOCK_OWNERSHIP_UNCERTAIN') {
                return useRejected('LOCK_UNVERIFIABLE');
            }
            return useRejected('AUDIT_UNAVAILABLE');
        }
    };
    return {
        async createGrant(repositoryRootHint, draftValue) {
            const draft = normalizeGrantDraft(draftValue);
            if (!grantIsUnexpired(draft.expires_at, now)) {
                throw new AuthorityServiceError('GRANT_EXPIRED', 'Grant has expired (expires_at must be later than the current time at creation).');
            }
            const root = await ensureGitRepository(repositoryRootHint);
            return withWorkContextCandidate(root, {
                ...(draft.subject_label === undefined ? {} : { subjectLabel: draft.subject_label }),
            }, async (candidate, refresh) => {
                if (!grantIsUnexpired(draft.expires_at, now)) {
                    throw new AuthorityServiceError('GRANT_EXPIRED', 'Grant expired before its repository locator could be initialized.');
                }
                const local = await readLocalRepositoryState(root, registryPath, true, candidate, () => {
                    if (!grantIsUnexpired(draft.expires_at, now)) {
                        throw new AuthorityServiceError('GRANT_EXPIRED', 'Grant expired before its absent repository locator could be initialized.');
                    }
                });
                if (local.snapshot.grants.length >= GRANT_LIMIT) {
                    throw new AuthorityServiceError('GRANT_LIMIT', `Repository authority registry is limited to ${GRANT_LIMIT} grants.`);
                }
                let proposedSnapshot;
                let proposedGrant;
                let transactionEventId;
                const created = await transactAuthorityRegistry(registryPath, {
                    kind: 'GRANT_CREATED',
                    apply: async (current, context) => {
                        if (!grantIsUnexpired(draft.expires_at, now)) {
                            throw new AuthorityRegistryError('PERSISTENCE_FAILED', 'Grant expired before its registry transaction committed; no grant was committed, and any newly initialized locator remains inert.');
                        }
                        const currentCandidate = await refresh();
                        requireStableMutationContext(candidate, currentCandidate);
                        await requireRepositoryReference(local.root, local.referenceId);
                        if (!samePhysicalIdentity(currentCandidate.repository.physical_identity, local.repositoryBinding.physical_identity)) {
                            throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository physical identity changed before grant creation.');
                        }
                        const repo = createRepositoryBinding(current, candidate, local.referenceId, context.recorded_at);
                        if (current.grants.length >= GRANT_LIMIT) {
                            throw new AuthorityServiceError('GRANT_LIMIT', `Repository authority registry is limited to ${GRANT_LIMIT} grants.`);
                        }
                        const withRepository = repo.added === undefined
                            ? current
                            : { ...current, repository_bindings: [...current.repository_bindings, repo.added] };
                        const resolved = resolveCanonicalBindings(withRepository, candidate, local.referenceId, candidate.subject.subject_label, context.recorded_at, true);
                        const binding = {
                            repository_reference_id: local.referenceId,
                            repository_binding_epoch: repo.binding.binding_epoch,
                            authority_id: resolved.work.authority_id,
                            work_id: resolved.work.work_id,
                            work_activation_id: resolved.work.work_activation_id,
                            work_activation_epoch: resolved.work.work_activation_epoch,
                            subject_id: resolved.subject.subject_id,
                            subject_label: resolved.subject.subject_label,
                            contract_id: resolved.work.contract_id,
                            task_id: resolved.work.task_id,
                            contract_revision_digest: resolved.work.contract_revision_digest,
                            scope_digest: resolved.work.scope_digest,
                            authority_revision: AUTHORITY_REVISION,
                        };
                        const grant = createCanonicalGrantRecord(draft, binding, {
                            created_at: context.recorded_at,
                            audit_correlation_id: context.event_id,
                        });
                        const lifecycle = {
                            grant_id: grant.grant_id,
                            lifecycle: 'ACTIVE',
                            terminal_event_id: null,
                            updated_at: context.recorded_at,
                        };
                        const proposed = {
                            ...current,
                            repository_bindings: withRepository.repository_bindings,
                            work_bindings: resolved.addedWork === undefined
                                ? current.work_bindings
                                : [...current.work_bindings, resolved.addedWork],
                            subject_bindings: resolved.addedSubject === undefined
                                ? current.subject_bindings
                                : [...current.subject_bindings, resolved.addedSubject],
                            grants: [...current.grants, grant],
                            grant_lifecycle: [...current.grant_lifecycle, lifecycle],
                        };
                        proposedSnapshot = proposed;
                        proposedGrant = grant;
                        transactionEventId = context.event_id;
                        return proposed;
                    },
                    validateBeforeReplace: async () => {
                        if (!grantIsUnexpired(draft.expires_at, now)) {
                            throw new AuthorityRegistryError('PERSISTENCE_FAILED', 'Grant expired before the registry replacement; no grant transaction was committed.');
                        }
                        const proposed = proposedSnapshot;
                        const grant = proposedGrant;
                        if (proposed === undefined || grant === undefined) {
                            throw new AuthorityRegistryError('PERSISTENCE_FAILED', 'Grant proposal was unavailable at the registry replacement boundary.');
                        }
                        const currentCandidate = await refresh();
                        requireStableMutationContext(candidate, currentCandidate);
                        await requireRepositoryReference(local.root, local.referenceId);
                        if (!samePhysicalIdentity(currentCandidate.repository.physical_identity, local.repositoryBinding.physical_identity)
                            || !matchesCurrentContext(grant, proposed, currentCandidate, local.referenceId)) {
                            throw new AuthorityServiceError('WORK_CONTEXT_UNAVAILABLE', 'Grant bindings no longer match the locked repository/work/subject context.');
                        }
                    },
                    validateBeforeAck: async (readback) => {
                        const grant = proposedGrant;
                        const eventId = transactionEventId;
                        if (grant === undefined || eventId === undefined) {
                            throw new Error('Grant proposal identity was not retained for durable acknowledgement.');
                        }
                        const currentCandidate = await refresh();
                        requireStableMutationContext(candidate, currentCandidate);
                        await requireRepositoryReference(local.root, local.referenceId);
                        const durableGrant = requireGrantForRepository(readback, local.referenceId, grant.grant_id);
                        const lifecycle = lifecycleForRequired(readback, grant.grant_id);
                        const event = readback.audit.find((record) => record.event_id === eventId);
                        if (!samePhysicalIdentity(currentCandidate.repository.physical_identity, local.repositoryBinding.physical_identity)
                            || !matchesCurrentContext(durableGrant, readback, currentCandidate, local.referenceId)
                            || lifecycle.lifecycle !== 'ACTIVE'
                            || !event
                            || event.kind !== 'GRANT_CREATED'
                            || event.event_type !== 'GRANT_CREATED'
                            || event.grant_id !== durableGrant.grant_id
                            || event.grant_digest !== durableGrant.grant_digest
                            || !event.target_ids.includes(durableGrant.grant_id)) {
                            throw new Error('Durable grant readback no longer matches its current context, ACTIVE lifecycle, or creation audit.');
                        }
                        if (!grantIsUnexpired(durableGrant.expires_at, now)) {
                            throw new Error('Grant expired before durable create acknowledgement.');
                        }
                    },
                }, transactionOptions);
                const committed = created.grants.at(-1);
                if (!committed)
                    throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Grant transaction returned without its canonical grant.');
                if (!grantIsUnexpired(committed.expires_at, now)) {
                    throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'The grant expired during durable commit; no current grant success is reported, and the transaction must be reconciled by read-only inspection.');
                }
                let currentCandidate;
                try {
                    currentCandidate = await refresh();
                    requireStableMutationContext(candidate, currentCandidate);
                    await requireRepositoryReference(local.root, local.referenceId);
                }
                catch (error) {
                    throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Repository or work context changed after grant commit; no success is reported.', { cause: error });
                }
                if (!samePhysicalIdentity(currentCandidate.repository.physical_identity, local.repositoryBinding.physical_identity)
                    || !matchesCurrentContext(committed, created, currentCandidate, local.referenceId)) {
                    throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Grant bindings no longer match repository/work/subject context after durable commit; no success is reported.');
                }
                if (!grantIsUnexpired(committed.expires_at, now)) {
                    throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'The grant expired before create acknowledgement; no current grant success is reported.');
                }
                return summarizeGrant(committed, lifecycleFor(created, committed.grant_id), 'CURRENT');
            });
        },
        async listGrants(repositoryRootHint) {
            const local = await readLocalRepositoryState(repositoryRootHint, registryPath, false);
            const records = local.snapshot.grants.filter((grant) => grant.repository_reference_id === local.referenceId);
            const summaries = [];
            for (const grant of records) {
                const freshness = await freshnessStatus(local.root, local.snapshot, grant, local.referenceId, now());
                summaries.push(summarizeGrant(grant, lifecycleFor(local.snapshot, grant.grant_id), freshness));
            }
            return summaries;
        },
        async inspectGrant(repositoryRootHint, grantId) {
            hasUuid(grantId, 'grant_id');
            const local = await readLocalRepositoryState(repositoryRootHint, registryPath, false);
            const grant = requireGrantForRepository(local.snapshot, local.referenceId, grantId);
            const freshness = await freshnessStatus(local.root, local.snapshot, grant, local.referenceId, now());
            return summarizeGrant(grant, lifecycleFor(local.snapshot, grant.grant_id), freshness);
        },
        async revokeGrant(repositoryRootHint, grantId, expectedGrantDigest) {
            hasUuid(grantId, 'grant_id');
            if (typeof expectedGrantDigest !== 'string' || !DIGEST_PATTERN.test(expectedGrantDigest)) {
                throw new AuthorityServiceError('GRANT_STALE', 'expected_grant_digest must be a canonical SHA-256 digest.');
            }
            const initial = await readLocalRepositoryState(repositoryRootHint, registryPath, false);
            const initialGrant = requireGrantForRepository(initial.snapshot, initial.referenceId, grantId);
            return withWorkContextCandidate(initial.root, {
                ...(initialGrant.subject_label === null ? {} : { subjectLabel: initialGrant.subject_label }),
            }, async (candidate, refresh) => {
                const local = await readLocalRepositoryState(initial.root, registryPath, false, candidate);
                const grant = requireGrantForRepository(local.snapshot, local.referenceId, grantId);
                if (grant.grant_digest !== expectedGrantDigest) {
                    throw new AuthorityServiceError('GRANT_STALE', 'Grant digest changed; revoke was not applied.');
                }
                if (lifecycleFor(local.snapshot, grantId).lifecycle !== 'ACTIVE') {
                    throw new AuthorityServiceError('GRANT_TERMINAL', 'Only an ACTIVE grant can transition to REVOKED.');
                }
                if (!matchesCurrentContext(grant, local.snapshot, candidate, local.referenceId)) {
                    throw new AuthorityServiceError('WORK_CONTEXT_UNAVAILABLE', 'Grant is stale against the current local work/subject binding.');
                }
                if (!samePhysicalIdentity(candidate.repository.physical_identity, local.repositoryBinding.physical_identity)) {
                    throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository physical identity changed before the revoke transaction.');
                }
                let transactionSnapshot;
                let transactionEventId;
                const committed = await transactAuthorityRegistry(registryPath, {
                    kind: 'GRANT_REVOKED',
                    target_ids: [grantId],
                    apply: async (current, context) => {
                        const currentGrant = requireGrantForRepository(current, local.referenceId, grantId);
                        if (currentGrant.grant_digest !== expectedGrantDigest) {
                            throw new AuthorityServiceError('GRANT_STALE', 'Grant digest changed before the revoke transaction.');
                        }
                        const currentLifecycle = lifecycleForRequired(current, grantId);
                        if (currentLifecycle.lifecycle !== 'ACTIVE') {
                            throw new AuthorityServiceError('GRANT_TERMINAL', 'Only an ACTIVE grant can transition to REVOKED.');
                        }
                        const currentCandidate = await refresh();
                        requireStableMutationContext(candidate, currentCandidate);
                        await requireRepositoryReference(local.root, local.referenceId);
                        const bindingFailure = contextFailure(currentGrant, current, currentCandidate, local.referenceId);
                        if (bindingFailure !== undefined
                            || !matchesCurrentContext(currentGrant, current, currentCandidate, local.referenceId)) {
                            throw new AuthorityServiceError(bindingFailure === 'REPOSITORY_MISMATCH' ? 'REPOSITORY_MISMATCH' : 'WORK_CONTEXT_UNAVAILABLE', 'Grant is stale against the current repository/work/subject binding.');
                        }
                        if (!samePhysicalIdentity(currentCandidate.repository.physical_identity, local.repositoryBinding.physical_identity)) {
                            throw new AuthorityServiceError('REPOSITORY_MISMATCH', 'Repository physical identity changed before the revoke transaction.');
                        }
                        transactionSnapshot = current;
                        transactionEventId = context.event_id;
                        return {
                            ...current,
                            grant_lifecycle: current.grant_lifecycle.map((record) => record.grant_id === grantId
                                ? {
                                    ...record,
                                    lifecycle: 'REVOKED',
                                    terminal_event_id: context.event_id,
                                    updated_at: context.recorded_at,
                                }
                                : record),
                        };
                    },
                    validateBeforeReplace: async () => {
                        const current = transactionSnapshot;
                        if (current === undefined) {
                            throw new AuthorityRegistryError('PERSISTENCE_FAILED', 'Revoke precondition snapshot was unavailable at replacement.');
                        }
                        const currentGrant = requireGrantForRepository(current, local.referenceId, grantId);
                        if (currentGrant.grant_digest !== expectedGrantDigest
                            || lifecycleForRequired(current, grantId).lifecycle !== 'ACTIVE') {
                            throw new AuthorityServiceError('GRANT_STALE', 'Grant digest or ACTIVE lifecycle changed before revoke replacement.');
                        }
                        const currentCandidate = await refresh();
                        requireStableMutationContext(candidate, currentCandidate);
                        await requireRepositoryReference(local.root, local.referenceId);
                        const bindingFailure = contextFailure(currentGrant, current, currentCandidate, local.referenceId);
                        if (bindingFailure !== undefined
                            || !matchesCurrentContext(currentGrant, current, currentCandidate, local.referenceId)
                            || !samePhysicalIdentity(currentCandidate.repository.physical_identity, local.repositoryBinding.physical_identity)) {
                            throw new AuthorityServiceError(bindingFailure === 'REPOSITORY_MISMATCH' ? 'REPOSITORY_MISMATCH' : 'WORK_CONTEXT_UNAVAILABLE', 'Revoke no longer matches the current repository/work/subject binding.');
                        }
                    },
                    validateBeforeAck: async (readback) => {
                        const eventId = transactionEventId;
                        if (eventId === undefined)
                            throw new Error('Revoke transaction event identity was not retained for acknowledgement.');
                        const revoked = requireGrantForRepository(readback, local.referenceId, grantId);
                        const lifecycle = lifecycleForRequired(readback, grantId);
                        const currentCandidate = await refresh();
                        requireStableMutationContext(candidate, currentCandidate);
                        await requireRepositoryReference(local.root, local.referenceId);
                        const bindingFailure = contextFailure(revoked, readback, currentCandidate, local.referenceId);
                        const event = readback.audit.find((record) => record.event_id === eventId);
                        if (revoked.grant_digest !== expectedGrantDigest
                            || bindingFailure !== undefined
                            || !matchesCurrentContext(revoked, readback, currentCandidate, local.referenceId)
                            || !samePhysicalIdentity(currentCandidate.repository.physical_identity, local.repositoryBinding.physical_identity)
                            || lifecycle.lifecycle !== 'REVOKED'
                            || lifecycle.terminal_event_id !== eventId
                            || !event
                            || event.kind !== 'GRANT_REVOKED'
                            || event.event_type !== 'GRANT_REVOKED'
                            || event.grant_id !== revoked.grant_id
                            || event.grant_digest !== revoked.grant_digest
                            || event.target_ids.length !== 1
                            || event.target_ids[0] !== revoked.grant_id) {
                            throw new Error('Durable revoke readback no longer matches its current context, REVOKED lifecycle, or mutation audit.');
                        }
                    },
                }, transactionOptions);
                const revoked = requireGrantForRepository(committed, local.referenceId, grantId);
                let currentCandidate;
                try {
                    currentCandidate = await refresh();
                    requireStableMutationContext(candidate, currentCandidate);
                    await requireRepositoryReference(local.root, local.referenceId);
                }
                catch (error) {
                    throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Repository or work context changed after revocation commit; no success is reported.', { cause: error });
                }
                const bindingFailure = contextFailure(revoked, committed, currentCandidate, local.referenceId);
                if (bindingFailure !== undefined
                    || !matchesCurrentContext(revoked, committed, currentCandidate, local.referenceId)
                    || !samePhysicalIdentity(currentCandidate.repository.physical_identity, local.repositoryBinding.physical_identity)) {
                    throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Revoked grant bindings no longer match repository/work/subject context after durable commit; no success is reported.');
                }
                const freshness = Date.parse(revoked.expires_at) <= now().getTime()
                    ? 'EXPIRED'
                    : 'CURRENT';
                return summarizeGrant(revoked, lifecycleFor(committed, grantId), freshness);
            });
        },
        async verifyGrant(repositoryRootHint, requestValue) {
            let request;
            try {
                request = normalizeAuthorityUseRequest(requestValue);
            }
            catch {
                return { status: 'REJECTED', match: false, reasons: ['INVALID_REQUEST'] };
            }
            try {
                return await withAuthorityReadObservation(repositoryRootHint, registryPath, async (observation) => {
                    const grant = requireGrantForRepository(observation.registry, observation.reference.repository_reference_id, request.grant_reference_id);
                    const lifecycle = lifecycleForRequired(observation.registry, grant.grant_id);
                    const candidate = observation.candidateForSubjectLabel(grant.subject_label);
                    const reason = await authorityUseFailure(observation.root, observation.registry, grant, grant.grant_digest, lifecycle.lifecycle, candidate, observation.reference.repository_reference_id, request, now());
                    if (reason !== undefined) {
                        return { status: 'REJECTED', match: false, request, reasons: [reason] };
                    }
                    return {
                        status: 'VERIFIED',
                        match: true,
                        grant: summarizeGrant(grant, lifecycle, 'CURRENT'),
                        request,
                        reasons: [],
                    };
                });
            }
            catch (error) {
                return {
                    status: 'REJECTED',
                    match: false,
                    request,
                    reasons: [failureFromError(error)],
                };
            }
        },
        async authorizeUse(repositoryRootHint, requestValue) {
            let request;
            try {
                request = normalizeAuthorityUseRequest(requestValue);
            }
            catch {
                return useRejected('INVALID_REQUEST');
            }
            let initial;
            let selected;
            try {
                initial = await readLocalRepositoryState(repositoryRootHint, registryPath, false);
                selected = requireGrantForRepository(initial.snapshot, initial.referenceId, request.grant_reference_id);
            }
            catch (error) {
                return useRejected(failureFromError(error));
            }
            try {
                return await withWorkContextCandidate(initial.root, {
                    ...(selected.subject_label === null ? {} : { subjectLabel: selected.subject_label }),
                }, async (_candidate, refresh) => {
                    const kind = selected.mode === 'ONE_SHOT' ? 'GRANT_CONSUMED' : 'GRANT_USE_RECORDED';
                    let useEventId;
                    let transactionSnapshot;
                    try {
                        const committed = await transactAuthorityRegistry(registryPath, {
                            kind,
                            target_ids: [selected.grant_id],
                            apply: async (current, context) => {
                                const currentGrant = requireGrantForRepository(current, initial.referenceId, selected.grant_id);
                                const currentCandidate = await refresh();
                                const currentReference = await readRepositoryPublicReference(initial.root);
                                if (currentReference?.repository_reference_id !== initial.referenceId) {
                                    throw new UsePreconditionError('REPOSITORY_MISMATCH');
                                }
                                const lifecycle = lifecycleForRequired(current, currentGrant.grant_id);
                                const reason = await authorityUseFailure(initial.root, current, currentGrant, selected.grant_digest, lifecycle.lifecycle, currentCandidate, initial.referenceId, request, now());
                                if (reason !== undefined)
                                    throw new UsePreconditionError(reason);
                                transactionSnapshot = current;
                                useEventId = context.event_id;
                                if (kind === 'GRANT_USE_RECORDED')
                                    return current;
                                return {
                                    ...current,
                                    grant_lifecycle: current.grant_lifecycle.map((record) => record.grant_id === currentGrant.grant_id
                                        ? {
                                            ...record,
                                            lifecycle: 'CONSUMED',
                                            terminal_event_id: context.event_id,
                                            updated_at: context.recorded_at,
                                        }
                                        : record),
                                };
                            },
                            validateBeforeReplace: async () => {
                                const current = transactionSnapshot;
                                if (current === undefined)
                                    throw new UsePreconditionError('STORAGE_UNAVAILABLE');
                                const currentGrant = requireGrantForRepository(current, initial.referenceId, selected.grant_id);
                                const currentCandidate = await refresh();
                                const currentReference = await readRepositoryPublicReference(initial.root);
                                if (currentReference?.repository_reference_id !== initial.referenceId) {
                                    throw new UsePreconditionError('REPOSITORY_MISMATCH');
                                }
                                const lifecycle = lifecycleForRequired(current, currentGrant.grant_id);
                                const reason = await authorityUseFailure(initial.root, current, currentGrant, selected.grant_digest, lifecycle.lifecycle, currentCandidate, initial.referenceId, request, now());
                                if (reason !== undefined)
                                    throw new UsePreconditionError(reason);
                                const time = now().getTime();
                                if (!Number.isFinite(time))
                                    throw new UsePreconditionError('STORAGE_UNAVAILABLE');
                                if (Date.parse(currentGrant.valid_from) > time)
                                    throw new UsePreconditionError('NOT_YET_VALID');
                                if (Date.parse(currentGrant.expires_at) <= time)
                                    throw new UsePreconditionError('EXPIRED');
                            },
                            validateBeforeAck: async (readback) => {
                                if (useEventId === undefined)
                                    throw new Error('Use transaction event ID was not retained for acknowledgement.');
                                const currentGrant = requireGrantForRepository(readback, initial.referenceId, selected.grant_id);
                                const currentCandidate = await refresh();
                                const currentReference = await readRepositoryPublicReference(initial.root);
                                if (currentReference?.repository_reference_id !== initial.referenceId) {
                                    throw new Error('Repository reference changed before durable use acknowledgement.');
                                }
                                const lifecycle = lifecycleForRequired(readback, currentGrant.grant_id);
                                const expectedLifecycle = kind === 'GRANT_CONSUMED' ? 'CONSUMED' : 'ACTIVE';
                                const reason = await authorityUseFailure(initial.root, readback, currentGrant, selected.grant_digest, lifecycle.lifecycle, currentCandidate, initial.referenceId, request, now(), expectedLifecycle);
                                if (reason !== undefined)
                                    throw new Error(`Use context changed before acknowledgement: ${reason}.`);
                                const expectedType = kind === 'GRANT_CONSUMED' ? 'GRANT_CONSUMED' : 'GRANT_USE_RECORDED';
                                if (!hasUseAudit(readback, useEventId, expectedType, currentGrant)) {
                                    throw new Error('Durable use evidence does not match its canonical grant and digest.');
                                }
                            },
                        }, transactionOptions);
                        if (useEventId === undefined) {
                            throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Durable use commit returned without its event identity.');
                        }
                        const grant = requireGrantForRepository(committed, initial.referenceId, selected.grant_id);
                        const eventType = kind === 'GRANT_CONSUMED' ? 'GRANT_CONSUMED' : 'GRANT_USE_RECORDED';
                        if (!hasUseAudit(committed, useEventId, eventType, grant)) {
                            throw new AuthorityRegistryError('COMMIT_UNCERTAIN', 'Durable use readback does not contain matching grant evidence.');
                        }
                        return {
                            status: 'USE_ACCEPTED',
                            grant: summarizeGrant(grant, lifecycleForRequired(committed, grant.grant_id), 'CURRENT'),
                            audit_event_id: useEventId,
                        };
                    }
                    catch (error) {
                        if (error instanceof UsePreconditionError) {
                            return recordUseRejection(initial, selected, error.reason);
                        }
                        throw error;
                    }
                });
            }
            catch (error) {
                if (error instanceof AuthorityRegistryError
                    && (error.code === 'COMMIT_UNCERTAIN' || error.code === 'PERSISTENCE_FAILED'))
                    throw error;
                if (error instanceof UsePreconditionError) {
                    return recordUseRejection(initial, selected, error.reason);
                }
                return recordUseRejection(initial, selected, failureFromError(error));
            }
        },
    };
}
//# sourceMappingURL=authority-service.js.map