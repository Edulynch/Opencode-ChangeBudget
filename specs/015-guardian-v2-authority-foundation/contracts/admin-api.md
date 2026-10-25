# Provider-Neutral Grant Administration Contract

**Status (current 2026-10-19)**: Logical Phase B interface contract, not a frozen public SDK. T001–T016/G1–G3 are user-confirmed complete/reviewed; offline G4 T018–T020 is narrowly accepted on the previously G1/G2-qualified C: NTFS volume only. G0 FINAL/T017 remains **UNVERIFIED** (0/24 native cases executed); CHK016 is pending. G0 FINAL, accepted G4, and trusted-context/out-of-hook-audit proof are jointly required before later real OpenCode HARD integration. This contract does not freeze exported TypeScript signatures, registry container format, or UX.

## Purpose and trust boundaries

This is a focused ChangeBudget service boundary for local grant administration. Direct execution outside the supported governed Runtime Guard path is an explicit execution-boundary trust premise, not proof of human identity. ChangeBudget does not authenticate the operator. OpenCode, prompts, TTY/interactivity, process ancestry, environment values, agent tools, saved host permissions, `--actor`, first-party executable recognition, and repo-local references do not establish human identity or change grant authority.

Direct grant create and revoke execute outside the supported governed Runtime Guard path and use the same durable registry transaction and audit as the grant mutation. The supported governed Runtime Guard path must block grant create, grant revoke, and reserved rebind before execution, regardless of host allow/always. Executable identity is used only to classify supported operations, not to authenticate an operator. Unsupported routes and malicious same-user OS bypass are outside the protection claim. No generic authentication/session/credential/security framework or agent-facing admin tool is introduced.

Creation rejects `expires_at <= now()` on entry, after asynchronous context resolution, and again immediately before an absent locator is initialized after the registry/reference reads. It rechecks expiry under the registry transaction, immediately before replacement, and before acknowledging `CURRENT`. The final clock sample and the subsequent asynchronous locator-file write cannot be atomic: if expiry crosses during that write, the create fails closed before grant commit, but the newly visible locator may remain inert/dangling. The service must not delete or repair a locator whose persistence outcome may be visible. If time advances past expiry during the durable registry commit, the operation returns an uncertain failure rather than a current-grant success; any already-persisted grant remains structurally readable, inspection reports `EXPIRED`, and direct revocation remains available. Canonical snapshot validation is intentionally time-independent so records do not become corrupt merely as the clock advances.

G1 establishes context sources and binding representation without persisting canonical bindings. The G2 user-local registry is the first and only canonical persistence for repository/work/subject bindings. The service resolves active-contract context locally where it exists. For a new pre-contract work item, the direct administrative operation requires an explicitly selected descriptive `subject_label`; the label identifies the intended beneficiary for this operation but is not a credential, proof of identity, or canonical identifier. ChangeBudget generates the opaque `work_id` and canonical subject identifier as needed, then persists the binding in the G2 registry. Agent prose, host session/agent values, transport metadata, and caller-supplied IDs cannot mint or override that binding. A first grant may create the binding in the same registry transaction as the grant and audit; a separate registration workflow or temporary binding store is not required.

## Logical types

The G3 implementation stores the opaque public locator only at `<repositoryRoot>/.changebudget/authority-reference.json`, using exactly `reference_schema_version` and `repository_reference_id` in canonical JSON. Only explicit grant creation initializes an absent file; normal resolution/list/inspect/revoke reject missing, malformed, unsupported, or dangling references without repair. The locator is written durably before the repository/work/subject binding, grant body, and matching semantic audit are committed in one v2 registry transaction.

```ts
type GrantMode = 'REUSABLE' | 'ONE_SHOT';
type GrantLifecycle = 'ACTIVE' | 'CONSUMED' | 'REVOKED';

interface GrantDraft {
  readonly subject_label?: string;
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
  readonly grant_digest: string;
  readonly lifecycle: GrantLifecycle;
  readonly mode: GrantMode;
  readonly subject_label?: string;
  readonly subject_id: string;
  readonly work_id: string;
  readonly authority_id: string;
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

The names/types are logical, not a frozen public SDK. Grant inputs are strictly validated at their boundary. `GrantDraft.subject_label` is descriptive operator-selected data; the service resolves or generates the canonical `subject_id` and `work_id` from ChangeBudget-owned bindings. `GrantSummary.subject_id` is canonical, while its label remains descriptive. `CREATE_GRANT` includes the complete `GrantDraft`; `REVOKE_GRANT` names the grant ID and expected current grant digest so a stale revoke request cannot silently target changed grant content. Repository/work/subject/authority/scope context is inserted by trusted ChangeBudget resolution, not accepted as caller-selected identity. Avoid exporting registry/storage internals as public API.

## Operations

### `create(draft)`

This direct ChangeBudget administration operation runs outside the supported governed Runtime Guard path as an explicit execution-boundary trust premise; it does not authenticate a human. Resolve the physical repository, binding epoch, work/subject, authority/work-activation/scope freshness facts locally; the caller cannot override canonical identifiers. For a new pre-contract work item, require an explicitly selected `subject_label`, treat it as descriptive input only, and generate the canonical opaque `work_id` and subject identifier internally. Validate the complete `GrantDraft`, exact scope, independent capabilities/ceilings, validity/mode, and freshness. Assign a grant ID and audit correlation. Under the cross-process G2 registry transaction, create any first work/subject binding, the immutable grant, and matching creation evidence in the same durable snapshot. G1 context resolution does not persist bindings; no temporary registry or separate registration operation is required. Return success only after the complete persistence barrier. Any malformed request, stale context, audit/storage failure, or uncertain lock yields no reported success or partial mutation. Creation is not amendment; no generic `expand`, `update`, or `rebind` operation exists.

### `list(filter?)`

Returns summaries from a valid supported local registry. It is read-only with respect to grants and audit: it does not create, widen, consume, revoke, expire, migrate, repair, or rewrite state. A malformed, unsupported-version, or unavailable registry returns a stable error and remains unchanged. Filters only narrow returned records; they are not authority inputs.

### `inspect(grant_id)`

Returns one summary and bounded provenance/lifecycle details, including whether the stored freshness bindings are current. It is read-only and never attempts repair or rebind. It does not reveal raw OS identity handles or credentials. Unknown IDs return `NOT_FOUND`; malformed backing state returns `CORRUPT_STATE` rather than a partial grant.

### `revoke(grant_id, expected_grant_digest)`

Under the registry transaction, re-resolve repository/work/subject and authority/work-activation/scope context, compare the current grant to `expected_grant_digest`, and transition only `ACTIVE -> REVOKED`. Commit the grant change and matching revocation evidence in one durable snapshot. Return success only after the persistence barrier. `CONSUMED` and already-`REVOKED` grants are terminal; do not resurrect them. A stale digest, malformed grant, or storage/audit uncertainty yields no success or partial mutation. Direct execution remains the administrative trust premise, not proof of human identity.

### Governed-path denial boundary

The supported governed OpenCode V2 Runtime Guard path MUST block, before execution, grant create, grant revoke, and reserved rebind even when the incoming host permission is `allow`/saved `always`. The specified forms are verified ChangeBudget shim, canonical Node invocation, `npm exec -- changebudget ...`, and `npx changebudget ...`; tests must exercise each form and fail closed for ambiguous routes within that declared boundary. Existing Phase A first-party identity proves executable identity only and currently has no SPEC-015 grant-admin command contract; the feature extends its classifier and tests. Unsupported routes outside the declared boundary and malicious same-user OS bypass are not claimed as protected. Read-only list/inspect can remain available only if independently classified and proven state-read-only. These denial rules do not mediate direct execution outside the governed path.

## Internal verification and durable-use boundary

`verifyGrant` is the strictly read-only preflight: it checks exact bindings, freshness, validity, scope, and lifecycle without writing audit/registry state, consuming a one-shot grant, or returning `USE_ACCEPTED`. For `file.write`, the service derives new-file need from authoritative filesystem state: a missing target (including a missing parent) or an explicit new-file request requires both the grant and current contract to allow new files; a caller-false request flag cannot override an observed missing target. An existing target with no explicit new-file request does not create that requirement. The distinct `authorizeUse` operation below is an internal ChangeBudget-core durable-use operation, not a new public API implementation. It resolves fresh context and persisted canonical IDs under the existing state -> contract -> registry lock order; it must not generate or substitute random candidate IDs. Before commit it freshly revalidates the authority, path state, current context, persisted canonical bindings, grant lifecycle, and all relevant authority/context revisions inside the transaction and at the awaited pre-replace boundary. A read-only preview does not authorize a later commit if filesystem state has changed.

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

`authorizeUse` is a ChangeBudget-core operation, not an OpenCode permission effect or downstream operation. It receives fresh repository, work, and subject context resolved from ChangeBudget-owned persisted bindings; callers cannot construct trusted contexts from metadata. It checks exact bindings, freshness, validity, paths, each capability, ceilings, lifecycle, and revisions again inside the transaction. For `REUSABLE`, persist matching use evidence in the existing registry/audit structure before `USE_ACCEPTED`, without consuming the grant. For `ONE_SHOT`, serialize contenders and atomically commit `ACTIVE -> CONSUMED` plus matching use evidence in that same existing structure before one `USE_ACCEPTED`; all later or losing calls reject. Required rejection evidence is persisted where the service owns the request. If the durable rejection record itself cannot be committed, fail closed with `AUDIT_UNAVAILABLE`, not a successful or unaudited use. An ambiguous commit never returns `USE_ACCEPTED` and never restores a possibly consumed grant; resolve only from authoritative persisted state. Any downstream file/lifecycle operation is outside G4, and uncertain downstream outcome does not make a consumed grant reusable.

`USE_ACCEPTED` means only that one bounded authority-use outcome was durably accepted. It is not a promise that a downstream file/lifecycle operation committed. If later operation outcome is uncertain, the grant remains consumed; do not retry by making it active. No result in this interface changes the existing V2 projection or introduces managed START/AMEND/CLOSE ALLOW.

The Phase A `permission.evaluate` hook remains strictly read-only and may perform only `verifyGrant` preflight. It never calls persistence-bearing `authorizeUse`, writes audit/state, consumes a grant, or returns `USE_ACCEPTED`. Any later real OpenCode HARD integration requires an independently reviewed out-of-hook `authorizeUse`/audit path, accepted G0 FINAL, accepted G4, and trusted context; the separate V2 transport document records this stop gate.

## Stable failure classes

`INVALID_REQUEST`, `DUPLICATE_FIELD`, `WORK_CONTEXT_UNAVAILABLE`, `SUBJECT_CONTEXT_UNAVAILABLE`, `REPOSITORY_IDENTITY_UNAVAILABLE`, `NOT_FOUND`, `CORRUPT_STATE`, `UNSUPPORTED_SCHEMA`, `STALE_AUTHORITY`, `EXPIRED`, `REVOKED`, `CONSUMED`, `REPLAY`, `REPOSITORY_MISMATCH`, `WORK_MISMATCH`, `SUBJECT_MISMATCH`, `OPERATION_MISMATCH`, `CAPABILITY_MISMATCH`, `PATH_MISMATCH`, `CEILING_EXCEEDED`, `LOCK_BUSY`, `LOCK_UNVERIFIABLE`, `AUDIT_UNAVAILABLE`, and `STORAGE_UNAVAILABLE` are stable logical categories. `REPLAY` applies to grant verification, not an intermediate admin mechanism. Human-readable diagnostics may add context but never omit the failed boundary or turn a failure into permission.

## Required invariants

1. Direct execution outside the supported governed Runtime Guard path is an administrative trust premise; no service or record claims human identity. TTY/interactivity, process path/ancestry, environment, host `ask`/`always`, user prose, agent/model claims, metadata, and executable identity do not authenticate the operator.
2. G1 establishes trusted-context feasibility and binding representation but does not persist canonical bindings. G2's registry is the first and only canonical persistence for repository/work/subject bindings; no temporary registry is used.
3. ChangeBudget resolves repository/work/subject binding itself. A pre-contract `subject_label` is descriptive selection data only; ChangeBudget generates canonical IDs, caller DTOs cannot override them, and agent prose/transport cannot mint them. A first grant may create its work/subject binding in the same G2 transaction.
4. Successful direct create/revoke atomically commits the exact grant mutation and matching evidence under one cross-process registry transaction; no intermediate admin authorization record exists.
5. Wrong repo/work/subject, stale grant state, malformed input, or unsupported operation fails closed and does not mutate a grant. Reserved rebind remains blocked until separately designed.
6. Crash/concurrency/restart/ambiguous acknowledgement cannot report a partial mutation as success; reconcile only from authoritative registry and audit state, not by assuming an unrecorded outcome.
7. Read-only `list`/`inspect` do not mutate grant, replay, audit, or registry bytes.
8. Read-only `verifyGrant` does not persist evidence or consume. Reusable `authorizeUse` evidence, and one-shot consumption plus matching use evidence, persist under the existing cross-process registry transaction; one-shot success is atomic and durable.
9. A narrower request stays narrower than its ceiling (18 under 60 remains 18); capability booleans never imply one another.
10. No invalid, stale, corrupt, untrusted, or insufficiently durable state returns `USE_ACCEPTED` or admin success.
11. Audit and public references never become a grant source. No HTTP, cloud, account, database, generic auth framework, or remote service is required.
