# Data Model: Guardian V2 Authority Foundation

**Status (current 2026-10-19)**: Design contract; T001–T016/G1–G3 are user-confirmed complete/reviewed. Offline G4 T018–T020 is narrowly accepted on the previously G1/G2-qualified C: NTFS volume only. G0 FINAL/T017 remains **UNVERIFIED** (0/24 native cases executed); CHK016 is pending. G0 FINAL, accepted G4, and trusted-context/out-of-hook-audit proof are jointly required before later real OpenCode HARD integration. G4 adds no schema, public SDK, runtime route, or lifecycle ALLOW.
**Scope**: Local repository binding, bounded work/subject contexts, work-activation freshness, canonical grants, durable grant lifecycle/replay/audit, and a structured V2 grant reference. The registry byte layout remains an implementation contract to validate.

## Model boundaries

- The user-local registry is the only canonical store for HARD authority and the first and only canonical persistence for repository/work/subject bindings. It is outside the repository and local to the user/runtime; G1 requires no persisted binding or temporary registry.
- The repo-local public reference is an opaque locator to a registry-owned repository binding. It contains no grant body, identity proof, issuer assertion, or authority bits. Copying it cannot copy authority.
- The physical ChangeBudget anchor is associated with Git's common directory. Its OS object identity, not its path or contents, binds linked worktrees into a local repository authority domain.
- ChangeBudget `contract_id` and optional `task_id` are useful local handles/correlation values. Neither is `work_id` proof.
- Host metadata and V2 permission/session fields may locate or describe a request, but only ChangeBudget-owned local bindings supply repository, work, and subject context. No host field, TTY, process ancestry, environment, executable identity, or `--actor` value proves a human administrator.
- Direct operator action outside the supported governed Runtime Guard path is an explicit trust premise. ChangeBudget does not cryptographically prove human presence.
- Audit evidence explains actions and supports replay rejection. It never issues, widens, or satisfies a grant.

## Entities and relationships

### Repository Authority Binding

| Field | Meaning / validation |
|---|---|
| `binding_schema_version` | Required supported binding-format version; unknown versions fail closed. |
| `repository_reference_id` | Opaque random locator stored in the repo-local public reference and user-local registry. Locator equality is not proof. |
| `physical_identity` | Provider result for the persistent anchor object associated with Git common-dir: provider/platform namespace, volume/device identity, stable file-object identity, and a trustworthy generation value where available. Never use path or anchor UUID/content as a fallback. |
| `anchor_kind` | Fixed ChangeBudget anchor type/version; validates that the observed object is the expected regular anchor. |
| `binding_epoch` | Monotonic identity-binding epoch; any future designed identity rebind changes it and invalidates grants. The reserved rebind command is blocked and is not implemented here. |
| `created_at`, `updated_at` | Canonical timestamps for traceability; not identity sources. |

The observed common-directory path is transient discovery data only. Resolve Git common-dir to find and validate the anchor, but do not persist/equate repositories by that path. Symlink/reparse ambiguity, missing or changed identity, uncertain ID reuse, unproved move behavior, and unsupported/sync filesystems yield no HARD binding.

G1 establishes and tests the physical-identity result and repository-binding representation without requiring a persisted repository binding. G2's user-local registry is the first and only canonical persistence of that binding. The repo-local anchor and opaque locator support identity resolution but are not a parallel registry or canonical work/subject store.

### Repo-local Public Reference

The G3 implementation path is exactly `<repositoryRoot>/.changebudget/authority-reference.json`, obtained through the existing `getChangeBudgetDirectory` helper. Its canonical UTF-8 JSON contains exactly these two fields (with the repository's stable JSON formatting and final newline):

```json
{
  "reference_schema_version": 1,
  "repository_reference_id": "opaque-locator-uuid"
}
```

Unknown/missing/duplicate fields, noncanonical JSON, invalid locators, and unsupported versions fail closed. Read/list/inspect/revoke never initialize, repair, or rewrite this file. Only explicit direct grant creation may initialize an absent reference: it durably writes the opaque locator first, then commits the repository/work/subject binding, grant, and matching audit in one G2 registry transaction. A locator without its registry binding is inert and dangling; an uncertain transaction is never treated as success or automatically rebound. A present malformed or dangling file requires separately authorized cleanup/reinitialization, which is not implemented in this batch.

| Field | Meaning / validation |
|---|---|
| `reference_schema_version` | Strict supported format version. |
| `repository_reference_id` | Opaque locator only. It is not a grant ID, signing key, physical ID, or proof. |

No grants, subject/work claims, permissions, ceilings, OS identity, or audit history are stored in this file. The reference does not establish physical identity or authority by itself. Missing/malformed references do not cause registry creation, identity fallback, or rebind.

### Work Binding and `WorkContext`

| Field | Meaning / validation |
|---|---|
| `work_id` | Generated immutable opaque ID for one ChangeBudget-owned work item or validated active-contract work activation. ChangeBudget assigns it when the canonical binding is created; it is never accepted from caller text, agent prose, or request metadata. |
| `repository_reference_id` | Joins to the locally verified repository binding. |
| `authority_id` | ChangeBudget-owned authority context identifier for the governing work/contract authority; distinct from `grant_id`. |
| `contract_id` | Coherence handle used to load the active contract; does not by itself establish work identity. |
| `work_activation_id` / `work_activation_epoch` | Generated work-activation identity and monotonic freshness epoch; a new work activation does not silently reuse the previous work. |
| `contract_revision_digest` | Deterministic digest over the governing coherent contract revision/scope and authority-relevant policy, not ordinary Git content/HEAD. |
| `scope_digest` | Deterministic digest of canonical paths, deny/protected semantics, ceilings, and capability flags governing the work. |
| `task_id` | Optional correlation only; explicitly excluded from identity and authorization. |
| `created_at` | Traceability only. |

`WorkContextResolver` must load/validate the current lifecycle pointer and active contract coherently under the existing state-before-contract lock order where an active work contract exists, verify the physical repository identity, and represent the work/subject context. G1 establishes the resolver inputs, binding shape, and feasibility only; it does not persist or require a canonical binding. G2's single user-local registry is the first and only canonical persistence. For pre-contract administration, the direct ChangeBudget administrative operation requires an explicitly selected descriptive subject label; the label describes the intended beneficiary but is not a credential, identity proof, or canonical identifier. ChangeBudget generates the opaque `work_id` and, as needed, a canonical subject identifier internally. A first grant for a new work item may create that binding in the same G2 registry transaction; no separate registration workflow or temporary store is required. Incoherent state, mismatched contract/status, missing required work context, or failed provider checks return no context. Contract scope/revision changes, work activation changes, identity rebind, or authority-epoch changes make older grants stale; normal HEAD movement does not. Work activation is only a work-freshness concept.

### Subject Binding

| Field | Meaning / validation |
|---|---|
| `subject_id` | Stable exact subject identifier in a ChangeBudget-owned local binding. |
| `work_id` | Exact work binding to which this subject applies. |
| `repository_reference_id` | Exact locally verified repository binding. |
| `subject_label` | Optional descriptive label selected in the direct administrative operation; not an identity assertion, credential, or canonical subject identifier. |

An absent, ambiguous, or mismatched local subject binding cannot create or verify a grant successfully. For a new pre-contract work item, ChangeBudget generates the canonical `work_id` and `subject_id`; a directly selected label is descriptive data only and is not proof that a named human exists or is authenticated. OpenCode `sessionID`, optional `agent`, prompts/agent prose, resource metadata, task IDs, environment values, executable identity, and `--actor` cannot create or replace a canonical binding. G1 does not persist bindings; G2's registry does. No generic authentication/session/credential framework is introduced. The persisted grant stores canonical IDs and may retain the descriptive label, not secrets or a host credential.

### Direct Grant Administration

Direct grant create/revoke executes outside the supported governed Runtime Guard path under an explicit execution-boundary trust premise. This does not prove human identity. Resolve the physical repository, work, subject, authority, and current scope from ChangeBudget-owned local bindings; caller-supplied transport, prompt, environment, terminal, process, executable data, or agent prose is not proof of those bindings. For a new pre-contract work item, the direct operation requires a descriptive subject label, while ChangeBudget creates canonical identifiers. Under the G2 registry transaction, validate the requested mutation and commit the exact grant change, any first work/subject binding, and matching audit evidence in the same durable snapshot. No intermediate admin record, separate binding store, or separate registration workflow is required. Grant rebind remains reserved and blocked until separately designed.

### Canonical Grant

The G3 registry snapshot is strict schema version 2. It appends immutable canonical grant bodies in `grants`, while keeping mutable lifecycle records in the separate `grant_lifecycle` array and semantic grant audit fields in the existing append-only `audit` array. Schema v1 is rejected without migration or byte changes. G3 direct administration implements only `ACTIVE -> REVOKED`; the separately accepted offline G4 service adds durable use evidence and `ACTIVE -> CONSUMED` within the existing schema-v2 transaction/audit structure. Creation/revocation audit events are committed in the same registry snapshot as the body/lifecycle change.

| Field | Meaning / validation |
|---|---|
| `grant_schema_version` | Required strict schema version; unknown versions fail closed, with no implicit migration. |
| `grant_id` | Opaque unique lookup ID; not authority absent a valid registry record and exact verification. |
| `mode` | `REUSABLE` or `ONE_SHOT`; mode is immutable. |
| `repository_reference_id` | Exact current verified repository binding. |
| `authority_id`, `work_id` | Exact governing authority and generated work binding. |
| `subject_id` | Exact intended subject; request-time subject comes from the current ChangeBudget-owned subject binding. |
| `operations` / `capabilities` | Explicit allowed operation and capability set; no capability implies another. |
| `path_scope` | Canonical existing-path scope using existing path-pattern semantics; deny and protected paths remain stronger. |
| `ceilings` | Optional nonnegative safe-integer maxima for supported budgets. Request values are checked against, never replaced by, the ceiling. |
| `permissions` | Independent booleans: `allow_new_files`, `allow_dependencies`, `allow_migrations`, `allow_configuration`, `allow_public_api`. |
| `valid_from`, `expires_at` | Required coherent validity interval. Structural validation is time-independent; creation rejects an interval whose `expires_at` is not later than the service clock, while persisted expired grants remain readable and are reported as `EXPIRED`. |
| `freshness` | Contract revision/scope digest, work-activation epoch, authority epoch, repository binding epoch, and authority/schema revision required for current use. Normal HEAD is excluded. |
| `issuer` | ChangeBudget-owned direct administration audit correlation. It records the local mutation and does not claim human identity proof. |
| `created_at` | Canonical trace timestamp inside the immutable body. Lifecycle update time and terminal event ID are separate mutable registry lifecycle fields. |
| `grant_digest` | Deterministic digest over canonical immutable grant content and schema version; not a signature or independent authority. |

### Grant Audit Event

Append-only events share the durable registry snapshot with their related mutation. G3 semantic events carry a unique event ID/revision, transaction kind and event type (`GRANT_CREATED` or `GRANT_REVOKED`), grant ID/digest, exact changed target IDs, and timestamp. They correlate creation provenance and terminal revocation lifecycle to the immutable grant body. Offline G4 verification/use/rejection evidence reuses this existing append-only structure; it adds no schema or parallel audit store. Do not store credentials, raw prompt text, or arbitrary host metadata. Audit evidence is explanatory only. Grant create/revoke and matching audit evidence commit atomically with the grant/lifecycle transition. Failed durable writes fail the operation closed. Permission-hook evaluation itself remains read-only; it may not append audit records.

### G4 verification and durable use boundary

`verifyGrant` is a strictly read-only verifier/preflight. It resolves current canonical context and checks the persisted grant's exact repository/work/subject, operation/capability/path/ceiling, freshness/revision, validity, and lifecycle. It writes no audit or registry state, does not consume a one-shot grant, and never returns `USE_ACCEPTED`; verification alone is not a successful authority use.

The distinct internal `authorizeUse` operation resolves fresh canonical identifiers from the existing G2 bindings (never random candidate IDs) under the existing state -> contract -> registry lock order. Inside the registry transaction/commit it revalidates all authority, context, lifecycle, binding, and revision facts against persisted canonical state. A reusable use durably records its matching use evidence without consumption. A one-shot use atomically commits `ACTIVE -> CONSUMED` and matching evidence in the existing registry/audit structure. At most one contender can receive `USE_ACCEPTED`, and only after the required durable commit. An ambiguous commit never returns `USE_ACCEPTED`; a possibly consumed grant is never restored or reset. Downstream operation execution is outside G4. These are design/acceptance clarifications only: immutable grant bodies, schema v2, and the single G2 registry remain unchanged, and no new API implementation is defined here.

## Relationships

```text
Repo-local Public Reference --locator only--> user-local Repository Authority Binding
Repository Authority Binding --verified OS object--> Git common-dir ChangeBudget Anchor
Repository Authority Binding --1:n--> Work Binding (work_id per coherent work activation)
Work Binding --1:n--> Canonical Grant (each also binds exact subject and authority)
G1: identity/context feasibility and binding representation only; no canonical binding persistence
G2: sole canonical registry persistence for Repository/Work/Subject Bindings
Direct CREATE_GRANT --same G2 transaction/audit--> optional new Work/Subject Binding + Canonical Grant
Direct REVOKE_GRANT --same G2 transaction/audit--> grant state transition
Canonical Grant --1:n--> Grant Audit Event
One-shot Canonical Grant: ACTIVE --durable audited use--> CONSUMED (terminal)
Any ACTIVE Canonical Grant --durable admin revoke--> REVOKED (terminal)
```

## Validation and canonicalization rules

1. Reject unknown schema versions, duplicate IDs/keys, malformed JSON/duplicate object keys, missing required fields, unknown authority-bearing fields, invalid timestamps, unsafe integers, non-canonical enum values, and conflicting lifecycle/consumption/revocation fields. Do not repair data while reading or inspecting.
2. Resolve repo reference through the user-local registry and re-prove the physical anchor identity at each authority boundary. A copied locator, stale registry row, missing anchor, or failed provider is not authority.
3. Resolve work locally from a coherent active contract/work activation where applicable; compare generated `work_id`, `authority_id`, authority epoch/revision digest, scope digest, work-activation and binding epochs. For pre-contract administration, only the direct administrative operation may select a descriptive subject label; ChangeBudget generates canonical IDs and persists the binding only in the G2 registry, possibly with the first grant in one transaction. A label, agent prose, or transport data never supplies a trusted identifier. Treat `task_id` as correlation only.
4. Resolve subject from the current ChangeBudget-owned local binding and compare exact canonical `subject_id`; reject caller-provided replacements.
5. Canonicalize a requested repository-relative path exactly once with `/` separators. Reject absolute/outside/traversing paths, unresolved symlinks/reparse escapes, sibling-prefix lookalikes, and unsupported case ambiguity. Apply protected and deny rules before grant allow rules. A matched path does not confer new-file permission.
6. Validate each operation/capability, each independent sensitive flag, and each requested numeric value independently. Keep requested values unchanged when they are narrower than grant ceilings (e.g. 18 remains 18 under 60).
7. Check not-before/expiry, revocation/consumption, authority/schema revision, repository binding, work-activation/scope epoch and digest. Do not freshness-bind routine HEAD changes.
8. Read-only `verifyGrant` is repeatable only while all bindings remain valid; it writes no audit/state, consumes nothing, and never returns `USE_ACCEPTED`. Internal `authorizeUse` serializes competing uses and durably records reusable-use evidence without consumption or atomically commits one `ACTIVE -> CONSUMED` transition with matching use evidence before one successful-use result. Every loser/restart/replay rejects; ambiguous commit never returns success or restores a possibly consumed grant. `REVOKED`/`CONSUMED` never return to `ACTIVE`.
9. Listing/inspection are read-only. Creation, revocation, verification/use, and rejection evidence follow the durable transaction requirements in `research.md`; any required persistence or lock uncertainty returns no success.
10. Direct grant create/revoke resolves repository/work/subject from ChangeBudget-owned bindings and, under the cross-process registry transaction, commits the exact grant mutation with matching audit evidence. A first grant may commit a new work/subject binding in that same G2 transaction. G1 creates no persisted binding, and no temporary/parallel registry or separate registration workflow is used. Storage, audit, or lock uncertainty never reports success; no intermediate admin authorization record is created.
11. The supported governed Runtime Guard path deterministically denies grant create, grant revoke, and reserved rebind before invocation regardless of host allow/always. The tested scope is the supported verified shim, canonical Node, `npm exec`, and `npx` forms. Unsupported routes and malicious same-user OS bypass are outside the protection claim.

## Status

This document remains a planning contract, but G1/G2, bounded G3 direct create/list/inspect/revoke, and offline G4 verification/use are implemented with evidence in `tasks.md`; G4 has narrow independent security acceptance only on the named qualified C: NTFS volume. The implemented G3 body/lifecycle/audit split remains schema v2; schema v1 is rejected without automatic migration. G0 FINAL/T017 remains UNVERIFIED and is not proved by G4; neither is V2 transport acceptance. The repo-local locator may remain inert/dangling if expiry crosses during its asynchronous initialization write; no automatic rollback/deletion is performed. A descriptive subject label is not identity proof; ChangeBudget generates canonical identifiers, and agent prose cannot mint work identity. Direct execution outside the supported governed path is an explicit trust premise, not human-identity proof. Unsupported routes and malicious same-user OS bypass are not protected. No managed lifecycle ALLOW is represented here.
