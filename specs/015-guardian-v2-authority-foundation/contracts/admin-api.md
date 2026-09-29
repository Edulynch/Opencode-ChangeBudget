# Provider-Neutral Grant Administration Contract

**Status**: Logical Phase B interface contract for review. It does not choose a CLI command spelling, final exported TypeScript API, storage format, interactive UX, or host authentication mechanism.

## Purpose and trust boundaries

This is a ChangeBudget-owned service boundary for human administration of local grants. The same core rules apply regardless of whether a future human-facing adapter is a CLI or another explicitly approved local interface. OpenCode, prompts, agent tools, saved host permissions, `--actor`, first-party executable recognition, and repo-local references cannot mint or mutate canonical grants.

An authority-changing call requires an ephemeral `OperatorAdminContext` issued by a trusted adapter for an explicit human action outside governed Runtime Guard execution. It is provenance for the local workflow, not cryptographic proof of a human or an assertion derived from an executable name. If the context is missing, ambiguous, stale, or not bound to the requested action, the operation fails closed. No agent-facing admin tool is introduced.

The service obtains repository/work binding and the current governing revision from trusted local providers. An admin request cannot choose or override `repository_reference_id`, `work_id`, `authority_id`, activation epoch, physical identity, current scope digest, or trusted runtime subject. `GrantDraft.subject_id` is the exact intended beneficiary selected by the human administrator; it is only a target label and must later equal the subject returned by `SubjectContextProvider` at verification. It is not runtime authentication proof.

## Logical types

```ts
type GrantMode = 'REUSABLE' | 'ONE_SHOT';
type GrantLifecycle = 'ACTIVE' | 'CONSUMED' | 'REVOKED';

interface GrantDraft {
  readonly subject_id: string;
  readonly operations: readonly string[];
  readonly capabilities: readonly string[];
  readonly path_scope: readonly string[];
  readonly ceilings: {
    readonly max_files?: number;
    readonly max_changed_lines?: number;
  };
  readonly permissions: {
    readonly allow_new_files: boolean;
    readonly allow_dependencies: boolean;
    readonly allow_migrations: boolean;
    readonly allow_configuration: boolean;
    readonly allow_public_api: boolean;
  };
  readonly mode: GrantMode;
  readonly valid_from: string;
  readonly expires_at: string;
}

interface GrantSummary {
  readonly grant_id: string;
  readonly lifecycle: GrantLifecycle;
  readonly mode: GrantMode;
  readonly subject_id: string;
  readonly operations: readonly string[];
  readonly capabilities: readonly string[];
  readonly path_scope: readonly string[];
  readonly ceilings: GrantDraft['ceilings'];
  readonly permissions: GrantDraft['permissions'];
  readonly valid_from: string;
  readonly expires_at: string;
  readonly freshness_status: 'CURRENT' | 'STALE' | 'EXPIRED' | 'UNAVAILABLE';
}

interface AdminOperationResult<T> {
  readonly status: 'SUCCESS' | 'REJECTED';
  readonly value?: T;
  readonly error?: AdminError;
}
```

The names/types are logical, not a frozen public SDK. The final implementation must use strong types, validate unknown input at its boundary, and avoid exporting storage/provider internals as public API.

## Operations

### `create(draft, operatorContext)`

Creates one immutable canonical grant for the currently resolved local repository binding, coherent active `WorkContext`, authority/scope revision, and human-selected subject. The service canonicalizes scope, validates each independent capability and numeric ceiling, validates validity/mode, assigns `grant_id`, captures issuer provenance and freshness, and atomically commits the grant plus `CREATED` evidence under the registry transaction lock. Return `SUCCESS` only after durable file and containing-directory persistence/readback barriers have passed. A failed lock, provider, audit, sync, rename, directory sync, or validation returns `REJECTED`; it never leaves a grant reported successful without the matching evidence.

Creation is not amendment of an existing grant. There is no generic `expand`, `update`, or `rebind` operation in this interface. Any changed boundary requires a separately authorized new grant; repo rebind is a separate human-admin path with its own old/new binding evidence and is not part of this call.

### `list(filter?)`

Returns summaries from a valid supported local registry. It is read-only with respect to grants and audit: it does not create, widen, consume, revoke, expire, migrate, repair, or rewrite state. A malformed, unsupported-version, or unavailable registry returns a stable error and remains unchanged. Filters only narrow returned records; they are not authority inputs.

### `inspect(grant_id)`

Returns one summary and bounded provenance/lifecycle details, including whether the stored freshness bindings are current. It is read-only and never attempts repair or rebind. It does not reveal raw OS identity handles or credentials. Unknown IDs return `NOT_FOUND`; malformed backing state returns `CORRUPT_STATE` rather than a partial grant.

### `revoke(grant_id, operatorContext)`

Under the registry lock, revalidate the grant and operator context, then atomically transition only `ACTIVE -> REVOKED` and append its revocation evidence. Return success only after the durable persistence barrier. `CONSUMED` and already-`REVOKED` are terminal: do not resurrect or rewrite them. Repeated revocation may return an idempotent `ALREADY_REVOKED` rejection/result but must not create a second authority transition. Any storage/audit uncertainty yields no success.

## Provider-neutral verification boundary

```ts
interface AuthorityUseRequest {
  readonly grant_reference_id: string;
  readonly requested_operation: string;
  readonly requested_capabilities: readonly string[];
  readonly requested_paths: readonly string[];
  readonly requested_ceilings: {
    readonly max_files?: number;
    readonly max_changed_lines?: number;
  };
}

type AuthorityUseResult =
  | { readonly status: 'USE_ACCEPTED'; readonly grant: GrantSummary; readonly audit_event_id: string }
  | { readonly status: 'USE_REJECTED'; readonly reason: AuthorityFailureCode; readonly audit_event_id?: string };
```

`authorizeUse` is a ChangeBudget-core operation, not an OpenCode permission effect. It receives separately resolved, provider-issued repository, work, and subject contexts; callers cannot construct trusted contexts from metadata. It checks exact bindings, freshness, validity, paths, each capability, and ceilings. For `REUSABLE`, append the required verification evidence durably before `USE_ACCEPTED`. For `ONE_SHOT`, serialize contenders and commit `ACTIVE -> CONSUMED` plus matching use evidence in one durable registry transaction before one `USE_ACCEPTED`; all later or losing calls reject. Required rejection evidence is persisted where the service owns the request. If the durable rejection record itself cannot be committed, fail closed with `AUDIT_UNAVAILABLE`, not a successful or unaudited use.

`USE_ACCEPTED` means only that one bounded authority-use outcome was durably accepted. It is not a promise that a downstream file/lifecycle operation committed. If later operation outcome is uncertain, the grant remains consumed; do not retry by making it active. No result in this interface changes the existing V2 projection or introduces managed START/AMEND/CLOSE ALLOW.

The Phase A `permission.evaluate` hook remains read-only. It must not call a persistence-bearing `authorizeUse` implementation unless a reviewed design proves a ChangeBudget-owned audit path that preserves the no-hook-side-effect contract. The separate V2 transport document records this compatibility stop gate.

## Stable failure classes

`INVALID_REQUEST`, `ADMIN_CONTEXT_REQUIRED`, `ADMIN_CONTEXT_INVALID`, `WORK_CONTEXT_UNAVAILABLE`, `SUBJECT_CONTEXT_UNAVAILABLE`, `REPOSITORY_IDENTITY_UNAVAILABLE`, `NOT_FOUND`, `CORRUPT_STATE`, `UNSUPPORTED_SCHEMA`, `STALE_AUTHORITY`, `EXPIRED`, `REVOKED`, `CONSUMED`, `REPLAY`, `REPOSITORY_MISMATCH`, `WORK_MISMATCH`, `SUBJECT_MISMATCH`, `OPERATION_MISMATCH`, `CAPABILITY_MISMATCH`, `PATH_MISMATCH`, `CEILING_EXCEEDED`, `LOCK_BUSY`, `LOCK_UNVERIFIABLE`, `AUDIT_UNAVAILABLE`, and `STORAGE_UNAVAILABLE` are stable logical categories. Human-readable diagnostics may add context but never omit the failed boundary or turn a failure into permission.

## Required invariants

1. Only a separately trusted explicit human-admin adapter can produce `OperatorAdminContext`; `--actor`, process path, host `ask`/`always`, user prose, agent/model claims, and metadata cannot substitute.
2. Read-only `list`/`inspect` do not mutate grant, replay, audit, or registry bytes.
3. Create, revoke, reusable verification, one-shot consumption, and required evidence commit atomically under one cross-process registry transaction.
4. A narrower request stays narrower than its ceiling (18 under 60 remains 18); capability booleans never imply one another.
5. No invalid, stale, corrupt, untrusted, or insufficiently durable state returns `USE_ACCEPTED` or admin success.
6. Audit and public references never become a grant source. No HTTP, cloud, account, database, or remote service is required.
