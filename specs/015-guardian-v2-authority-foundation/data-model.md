# Data Model: Guardian V2 Authority Foundation

**Status**: Phase 1 design contract; not a persistence schema or implementation evidence.
**Scope**: Local repository binding, bounded work/subject contexts, canonical grants, durable lifecycle/replay/audit, and a structured V2 reference. Serialization details below are design-level logical fields; strict versioned storage is required, but the final byte-level schema remains an implementation contract to validate.

## Model boundaries

- The user-local registry is the only canonical store for HARD authority. It is outside the repository and local to the user/runtime.
- The repo-local public reference is an opaque locator to a registry-owned repository binding. It contains no grant body, identity proof, issuer assertion, or authority bits. Copying it cannot copy authority.
- The physical ChangeBudget anchor is associated with Git's common directory. Its OS object identity, not its path or contents, binds linked worktrees into a local repository authority domain.
- ChangeBudget `contract_id` and optional `task_id` are useful local handles/correlation values. Neither is `work_id` proof.
- Host metadata and V2 permission/session fields may locate or describe a request, but only trusted local providers supply repository, work, subject, and administrator context.
- Audit evidence explains actions and supports replay rejection. It never issues, widens, or satisfies a grant.

## Entities and relationships

### Repository Authority Binding

| Field | Meaning / validation |
|---|---|
| `binding_schema_version` | Required supported binding-format version; unknown versions fail closed. |
| `repository_reference_id` | Opaque random locator stored in the repo-local public reference and user-local registry. Locator equality is not proof. |
| `physical_identity` | Provider result for the persistent anchor object associated with Git common-dir: provider/platform namespace, volume/device identity, stable file-object identity, and a trustworthy generation value where available. Never use path or anchor UUID/content as a fallback. |
| `anchor_kind` | Fixed ChangeBudget anchor type/version; validates that the observed object is the expected regular anchor. |
| `binding_epoch` | Monotonic identity-binding epoch; explicit human rebind changes it and invalidates grants. |
| `created_at`, `updated_at` | Canonical timestamps for traceability; not identity sources. |

The observed common-directory path is transient discovery data only. Resolve Git common-dir to find and validate the anchor, but do not persist/equate repositories by that path. Symlink/reparse ambiguity, missing or changed identity, uncertain ID reuse, unproved move behavior, and unsupported/sync filesystems yield no HARD binding.

### Repo-local Public Reference

| Field | Meaning / validation |
|---|---|
| `reference_schema_version` | Strict supported format version. |
| `repository_reference_id` | Opaque locator only. It is not a grant ID, signing key, physical ID, or proof. |

No grants, subject/work claims, permissions, ceilings, OS identity, or audit history are stored in this file. Missing/malformed references do not cause registry creation, identity fallback, or rebind.

### Work Binding and `WorkContext`

| Field | Meaning / validation |
|---|---|
| `work_id` | Generated immutable opaque ID, created by ChangeBudget for one validated active-contract activation. Never accepted from request metadata. |
| `repository_reference_id` | Joins to the locally verified repository binding. |
| `authority_id` | ChangeBudget-owned authority context identifier for the governing work/contract authority; distinct from `grant_id`. |
| `contract_id` | Coherence handle used to load the active contract; does not by itself establish work identity. |
| `activation_id` / `activation_epoch` | Generated activation identity and monotonic freshness epoch; a new activation does not silently reuse the previous work. |
| `contract_revision_digest` | Deterministic digest over the governing coherent contract revision/scope and authority-relevant policy, not ordinary Git content/HEAD. |
| `scope_digest` | Deterministic digest of canonical paths, deny/protected semantics, ceilings, and capability flags governing the work. |
| `task_id` | Optional correlation only; explicitly excluded from identity and authorization. |
| `created_at` | Traceability only. |

`WorkContextResolver` must load/validate the current lifecycle pointer and active contract coherently under the existing state-before-contract lock order, verify the physical repository binding, then find/create the activation's `work_id`. Incoherent state, mismatched contract/status, missing activation proof, or failed provider checks return no context. Contract scope/revision changes, activation changes, identity rebind, or authority-epoch changes make older grants stale; normal HEAD movement does not.

### `TrustedSubjectContext`

| Field | Meaning / validation |
|---|---|
| `subject_id` | Stable exact subject identifier returned by an authenticated runtime/session adapter. |
| `provider_id` | Identifies the trusted adapter implementation; it is not itself proof. |
| `authentication_epoch` | Provider-issued session/identity freshness value, when available. |
| `session_binding` | Opaque provider-owned binding to the authenticated runtime session; never populated from untrusted metadata alone. |

Absent, ambiguous, expired, or unauthenticated subject context cannot create or verify a grant successfully. OpenCode `sessionID`, optional `agent`, prompts, resource metadata, task IDs, environment values, and executable identity are not accepted as the subject proof. The persisted grant stores the canonical `subject_id`, not secrets or a host credential.

### `OperatorAdminContext`

Ephemeral provider-issued proof that a specific explicit ChangeBudget administration action was initiated and confirmed outside governed Runtime Guard execution. It carries an action identifier, adapter/provenance identifier, action kind, and confirmation timestamp as appropriate. It is not a serializable user-supplied boolean, `--actor` string, first-party executable check, or cryptographic human identity claim. Missing/invalid context rejects create/revoke and any future authority-changing operation. Read-only list/inspect do not require a mutation context and do not write state.

### Canonical Grant

| Field | Meaning / validation |
|---|---|
| `grant_schema_version` | Required strict schema version; unknown versions fail closed, with no implicit migration. |
| `grant_id` | Opaque unique lookup ID; not authority absent a valid registry record and exact verification. |
| `lifecycle` | `ACTIVE`, `CONSUMED`, or `REVOKED`; consumed/revoked are terminal and durable. Expiry is determined from the validity window without inspection-side mutation. |
| `mode` | `REUSABLE` or `ONE_SHOT`; mode is immutable. |
| `repository_reference_id` | Exact current verified repository binding. |
| `authority_id`, `work_id` | Exact governing authority and generated work binding. |
| `subject_id` | Exact intended subject; request-time subject comes from `SubjectContextProvider`. |
| `operations` / `capabilities` | Explicit allowed operation and capability set; no capability implies another. |
| `path_scope` | Canonical existing-path scope using existing path-pattern semantics; deny and protected paths remain stronger. |
| `ceilings` | Optional nonnegative safe-integer maxima for supported budgets. Request values are checked against, never replaced by, the ceiling. |
| `permissions` | Independent booleans: `allow_new_files`, `allow_dependencies`, `allow_migrations`, `allow_configuration`, `allow_public_api`. |
| `valid_from`, `expires_at` | Required coherent validity interval; malformed or expired grants reject. |
| `freshness` | Contract revision/scope digest, activation epoch, authority epoch, repository binding epoch, and authority/schema revision required for current use. Normal HEAD is excluded. |
| `issuer` | ChangeBudget-native admin action/provenance record and adapter/action identifier. It documents provenance but does not claim cryptographic human proof. |
| `created_at`, `updated_at` | Canonical trace timestamps. |
| `consumption` | For one-shot only: durable consume event ID, time, and result evidence; absent until the atomic terminal transition. |
| `revocation` | For revoked state: durable revocation event ID, time, and admin action evidence. |
| `grant_digest` | Deterministic digest over canonical immutable grant content and schema version; not a signature or independent authority. |

### Grant Audit Event

Append-only event in the same durable registry snapshot as the related authority mutation. It has a unique event ID, event kind (`CREATED`, audited verification/use, `CONSUMED`, `REVOKED`, or `REJECTED`), grant/repository/work references when known, bounded operation summary, result/reason code, authority revision, timestamp, and relevant admin/use provenance. Do not store credentials, raw prompt text, or arbitrary host metadata. Audit evidence is explanatory only. Failed durable writes fail the operation closed. Permission-hook evaluation itself remains read-only; it may not append audit records.

## Relationships

```text
Repo-local Public Reference --locator only--> user-local Repository Authority Binding
Repository Authority Binding --verified OS object--> Git common-dir ChangeBudget Anchor
Repository Authority Binding --1:n--> Work Binding (work_id per coherent activation)
Work Binding --1:n--> Canonical Grant (each also binds exact subject and authority)
Canonical Grant --1:n--> Grant Audit Event
One-shot Canonical Grant: ACTIVE --durable audited use--> CONSUMED (terminal)
Any ACTIVE Canonical Grant --durable admin revoke--> REVOKED (terminal)
```

## Validation and canonicalization rules

1. Reject unknown schema versions, duplicate IDs, malformed JSON/duplicate object keys, missing required fields, unknown authority-bearing fields, invalid timestamps, unsafe integers, non-canonical enum values, and conflicting lifecycle/consumption/revocation fields. Do not repair data while reading or inspecting.
2. Resolve repo reference through the user-local registry and re-prove the physical anchor identity at each authority boundary. A copied locator, stale registry row, missing anchor, or failed provider is not authority.
3. Resolve work locally from a coherent active contract/activation; compare generated `work_id`, `authority_id`, contract/scope digests, activation, and binding epochs. Treat `task_id` as correlation only.
4. Resolve subject from the trusted adapter and compare exact canonical `subject_id`; reject caller-provided replacements.
5. Canonicalize a requested repository-relative path exactly once with `/` separators. Reject absolute/outside/traversing paths, unresolved symlinks/reparse escapes, sibling-prefix lookalikes, and unsupported case ambiguity. Apply protected and deny rules before grant allow rules. A matched path does not confer new-file permission.
6. Validate each operation/capability, each independent sensitive flag, and each requested numeric value independently. Keep requested values unchanged when they are narrower than grant ceilings (e.g. 18 remains 18 under 60).
7. Check not-before/expiry, revocation/consumption, authority/schema revision, repository binding, activation/scope epoch and digest. Do not freshness-bind routine HEAD changes.
8. `REUSABLE` verification is repeatable only while all bindings remain valid. `ONE_SHOT` must serialize competing use attempts and durably commit one `ACTIVE -> CONSUMED` transition with evidence before returning one successful-use result. Every loser/restart/replay rejects. `REVOKED`/`CONSUMED` never return to `ACTIVE`.
9. Listing/inspection are read-only. Creation, revocation, verification/use, and rejection evidence follow the durable transaction requirements in `research.md`; any required persistence or lock uncertainty returns no success.

## Status

This model is a planning contract, not an implemented schema. Physical identity, authenticated subject/admin providers, atomic durable registry commits, concurrency, audit integration, and host transport remain implementation gates. No managed lifecycle ALLOW is represented here.
