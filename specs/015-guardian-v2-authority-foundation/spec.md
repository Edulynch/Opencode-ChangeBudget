# Feature Specification: Guardian V2 Authority Foundation

**Feature Branch**: `015-guardian-v2-authority-foundation`

**Created**: 2026-09-29

**Status (current 2026-10-21)**: Documentation closeout only. T001–T016 remain complete/reviewed; offline G4 T018–T020 remains narrowly accepted on the previously G1/G2-qualified C: NTFS. Independent offline G5 validation is 91/91 and Vera review is PASS, but formal G5 acceptance remains **BLOCKED**; it does not establish native controls or HARD readiness. Privacy-barrier/schema/legacy-13-row proof review is **PASS only** and does not establish complete functional coverage, current-run native coverage, or Block A readiness. The actual isolated OpenCode 2.1.2 case failed before host startup/pin receipt/permission controls on a producer/schema mismatch; it is a prehost/harness failure, not a product denial-case failure. Native controls remain **NOT RUN**; G0 FINAL is **UNVERIFIED** (0/24 pass, 0 case failures, 24 unverified), T017 and CHK016 remain pending, T021–T023 remain unchecked, and T024–T027 remain untouched. The closing `latest` query observed 2.1.2; that isolated runtime is not native-host certified. `HARD_AUTHORITY_ENABLED:NO`; no lifecycle ALLOW or HARD reliance is accepted; G6 is blocked/not started. See `dist/spec015-batch-20261021/final-closeout.md`.

**Earlier offline runner correction (2026-10-20; chronology)**: The fixture separated config/Agent.Get candidate evidence from actual session-actor proof. Agent.List was discovery-only; explicit Session.Create and public Session.Get receipts were required before saved-rule setup/assertions. Rule 60 used documented V2 actions and whole-value wildcard applicability, while unknown provenance stayed unknown. Saved-always preparation used bounded resources rather than a global shell wildcard. The then-current offline validation passed 14 tests with 1 native test skipped; no native host/API run occurred in that validation. Later session proof and native attempt are recorded below; this earlier offline result is not current native acceptance.

**Input**: User description: "Specify Guardian V2 Phase B repository identity, canonical HARD authority, reusable and one-shot grants, replay/stale protection, and structured OpenCode V2 transport."

## Problem Statement

Guardian V2 needs a trustworthy foundation for deciding which local repository, bounded work, and subject a HARD authority grant applies to. Without that binding and exact verification, copied or stale authority could be accepted for the wrong work, broader capability, or repeated operation. Grant administration uses the existing Phase A Runtime Guard boundary: supported governed invocations of grant create, grant revoke, and reserved rebind are blocked before execution. Direct execution outside that governed runtime is the administrative trust premise, not proof of human identity. Executable identity is used only to classify an operation, never to authenticate its operator. Prompts, saved host permissions, agent claims, and transport metadata never become authority.

Here, **HARD authority** means an explicit, canonical ChangeBudget authorization with checkable boundaries; it is not a request, prompt, or host permission.

This is one foundation batch: establish repository/work identity, grant ownership and boundaries, durable validity/replay state, and structured V2 carriage or reference of existing grants. It does not roll out managed lifecycle permissions or change stable 1.x behavior.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bind authority to the actual repository and work (Priority: P1)

As a developer, I need HARD authority to be recognized only for the local repository instance and bounded work for which it was granted, so a clone, copy, or neighboring task cannot inherit it.

**Why this priority**: Repository and work identity are prerequisites for every later grant decision. A false identity match can turn an otherwise exact grant into authority over the wrong work.

**Independent Test**: Create disposable repository instances and linked worktrees, then present the same grant against matching and mismatching physical identities, work identifiers, and subjects. Verify the defined identity relationship and fail-closed results without changing production lifecycle behavior.

**Acceptance Scenarios**:

1. **Given** two linked worktrees share the same Git common-directory instance, **When** each is evaluated, **Then** they belong to the same local repository authority domain but a grant for one `work_id` is not accepted for a different work or subject.
2. **Given** the Git common-directory instance remains the same while working contents change, **When** identity is evaluated, **Then** it remains the same repository instance; content or path changes do not silently rebind grants.
3. **Given** a same-filesystem move preserves verified physical identity, **When** the repository is evaluated, **Then** identity may be preserved; if identity is unavailable, unreliable, or changed, **Then** HARD binding fails closed rather than falling back to path, URL/remote, copied UUID, repository name, or branch.
4. **Given** a clone, full copy, cross-machine transfer, or same-path replacement with a different common-directory instance, **When** it presents the old public reference or grant, **Then** it does not inherit the original HARD authority even if path or remote text matches.

---

### User Story 2 - Administer bounded grants without widening intent (Priority: P1)

As a developer, I need bounded grants to be created and revoked through ChangeBudget's existing local authority registry, while the governed Runtime Guard path blocks supported administrative commands before execution.

**Why this priority**: Canonical grants require an exact, durable authorization transaction. Host prompts and interaction signals provide no authority; direct execution is an explicit trust premise, while supported governed routes are denied.

**Independent Test**: Exercise direct grant create and revoke outside the governed Runtime Guard path and verify each registry mutation and its audit evidence commit together. Exercise the supported governed invocation forms with generic host allow/always and verify create, revoke, and reserved rebind are blocked before execution. Do not treat direct execution or executable identity as proof of human identity.

**Acceptance Scenarios**:

1. **Given** a grant create or revoke is invoked directly outside the supported governed Runtime Guard path, **When** ChangeBudget processes the operation, **Then** it uses the locally resolved repository/work/subject bindings and the existing registry transaction/audit boundary. For a new pre-contract work item, a directly selected subject label is descriptive input only; ChangeBudget generates canonical opaque work/subject identifiers and stores their binding in the sole registry. A first grant may create that binding in the same transaction. The label is not identity proof, and agent prose cannot mint trusted work identity. The direct-execution boundary is a trust premise only; ChangeBudget does not prove who initiated it.
2. **Given** a request exactly matches a valid grant, **When** the request is checked, **Then** it remains bounded by the grant; a narrower request remains narrower and is not expanded to the grant's maximum.
3. **Given** a grant covers an existing path, **When** a new-file request is made without explicit `allow_new_files` authority, **Then** it is not covered. Dependency, migration, configuration, and public-API permissions are independently checked and do not imply one another.
4. **Given** a reusable grant is valid for its bound work, **When** separate matching operations are presented within its validity, **Then** reuse is allowed only within that grant's exact bounds; **Given** a one-shot grant has been consumed, **When** it is presented again, **Then** it is rejected as replay.
5. **Given** the same one-shot grant is presented concurrently, **When** the competing requests are resolved, **Then** at most one may be accepted as a successful one-shot authority use or consuming operation; its consumption and success evidence must be durably recorded before success, and every other attempt is rejected or remains uncommitted.
6. **Given** grant creation, revocation, consumption, replay state, or required audit evidence cannot be durably written, **When** an administrative or consuming operation is attempted, **Then** it fails closed and is not committed or reported successful.
7. **Given** a direct grant create or revoke request is processed, **When** its registry transaction completes, **Then** the exact grant mutation and matching audit evidence are committed together or neither is reported successful. No intermediate admin authorization record is required or created.
8. **Given** a governed OpenCode V2 Runtime Guard event attempts grant create, grant revoke, or reserved rebind, **When** the invocation uses a supported verified shim, canonical Node, `npm exec`, or `npx` form, **Then** it is blocked before execution regardless of generic host allow/always. Ambiguous routes within the supported boundary fail closed. Unsupported routes outside that declared boundary and malicious same-user OS bypass are not protected or claimed as covered.
9. **Given** a user lists or inspects grants, **When** the request is read-only, **Then** it does not create, widen, consume, or revoke authority.

---

### User Story 3 - Reject stale, replayed, malformed, or out-of-scope authority (Priority: P1)

As a developer, I need invalid authority to fail closed with an understandable reason, so stale or manipulated state cannot silently authorize an operation.

**Why this priority**: Grant reuse must not weaken exact boundaries or let old, revoked, consumed, or corrupt authority regain validity.

**Independent Test**: Exercise valid, invalid, and tampered grants across repository, work, subject, operation, capability, path, ceiling, revision/digest, expiry, revocation, consumption, and restart boundaries. Verify each rejection is recorded as evidence and never becomes an authorization source.

**Acceptance Scenarios**:

1. **Given** a grant is malformed, expired, revoked, stale against its bound authority revision/digest, consumed as one-shot, or bound to a different repository/work/subject/operation/capability, **When** it is checked, **Then** it is rejected without being converted into a fresh prompt or weaker authority.
2. **Given** a request exceeds a numeric ceiling or targets an unauthorized path, sibling/prefix collision, or ungranted capability, **When** it is checked, **Then** it is rejected and identifies the failed boundary.
3. **Given** persisted grant or replay state is malformed or unavailable after restart, **When** HARD authority is checked, **Then** the system fails closed; valid reusable state and one-shot consumption/replay state otherwise survive restart.
4. **Given** a one-shot grant is submitted concurrently, **When** all submissions race, **Then** no more than one submission returns a successful authority-use outcome or commits a consuming operation, and that use has one durable consumption record and matching success evidence; a losing submission cannot succeed after a process restart.
5. **Given** a consuming or authority-changing administrative operation cannot persist its required audit evidence or consumption/replay state, **When** persistence fails, **Then** the operation fails closed without committing or reporting success.
6. **Given** a process crashes before durable consumption and success evidence exist, **When** it restarts, **Then** the attempt is not considered successful and no consuming effect may be treated as committed. **Given** consumption is durable but the process crashes before the consuming operation completes, **Then** the grant remains consumed and cannot be replayed; indeterminate or malformed state fails closed.
7. **Given** creation, verification, consumption, revocation, or rejection occurs, **When** evidence is retained, **Then** it records the relevant event and result for review but is not itself authority to create, expand, or satisfy a grant.

---

### User Story 4 - Carry existing authority safely through OpenCode V2 (Priority: P1)

As a developer using OpenCode V2, I need structured runtime context to refer to an existing grant and verify it exactly, so host permission behavior cannot mint or broaden ChangeBudget authority.

**Why this priority**: Transport is a boundary where a valid grant reference can be confused with user intent or a generic host allow unless the verifier preserves the canonical authority model.

**Independent Test**: Present valid, absent, malformed, unknown, mismatched, stale, replayed, revoked, and tampered grant references through the structured V2 transport. Compare results with an ordinary generic host allow and verify none creates, widens, or bypasses canonical authority.

**Acceptance Scenarios**:

1. **Given** structured V2 context identifies `work_id`, subject, `authority_id`, requested capability, and ceiling, **When** it refers to an existing grant, **Then** the exact repository/work/subject/scope/freshness binding is verified before any decision relies on it. These are logical data elements, not a prescribed wire schema.
2. **Given** the transport contains no grant reference, **When** the runtime decision is made, **Then** the owning policy may select or retain ASK or BLOCK, and absence itself never upgrades the decision to ALLOW.
3. **Given** a malformed, unknown, stale, revoked, replayed, or mismatched reference is present, **When** it is evaluated, **Then** it is rejected as invalid (not treated as absent), fails closed, and never upgrades to ALLOW or bypasses a stricter existing BLOCK.
4. **Given** a grant verifies successfully, **When** it is carried through V2, **Then** verification alone does not authorize managed START, AMEND, or CLOSE ALLOW behavior; the transport cannot mint, expand, or rebind authority.

### Edge Cases

- The physical identity provider is unavailable, unreliable, or reports an identity that cannot be associated with the Git common directory; HARD authority must fail closed.
- Linked worktrees share a common directory but present different `work_id` or subject values; repository-domain equality must not erase work/subject binding.
- Two repositories have equal paths, remotes, names, or branches but different physical/common-directory identity; those descriptive values must not establish equality.
- Repository contents change without changing the common-directory instance, or the repository moves while physical identity is either preserved or lost.
- A stored grant is syntactically readable but has stale revision/digest, ambiguous provenance, conflicting fields, or an invalid lifecycle state.
- A valid path grant is used for a sibling path, a prefix lookalike, or a new file; `allow_new_files` and each sensitive-category permission are independently absent or present.
- A reusable grant is reused after expiry or revocation, or a consumed one-shot grant is submitted concurrently or after process restart.
- Registry, grant, or replay state is interrupted or malformed during restart; partial state must not be interpreted as valid authority.
- Two concurrent submissions race to consume the same one-shot grant; no more than one consuming operation may succeed.
- Required audit, grant, or consumption/replay-state persistence fails during administration or consumption; the operation must not commit or be reported successful.
- A crash occurs before persistence, after durable consumption/evidence but before the consuming operation completes, or after successful completion; restart must preserve the recorded outcome and never revive a consumed grant.
- A V2 request supplies a valid grant ID but mismatching work, subject, capability, ceiling, repository, revision, or status; a generic OpenCode allow must not override the mismatch.
- A supported governed invocation attempts grant create, grant revoke, or reserved rebind under host `allow`/saved `always`; each is classified deterministically and blocked before execution.
- Direct administration outside the supported governed runtime is trusted only as an execution-boundary premise; it does not establish human identity. Unsupported routes and malicious same-user OS bypass are outside the protection claim.
- V2 transport has no grant reference versus a present but invalid/stale/mismatched reference; the absent case leaves ASK/BLOCK to the owning policy, while invalid authority is not treated as absence and never upgrades to ALLOW.
- Read-only inspection is requested while persisted authority state is malformed; inspection must not repair or rewrite it as a side effect.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST bind local HARD authority through a user-local registry outside the repository, a repo-local public reference, and a physical ChangeBudget anchor associated with the Git common-directory instance. The public reference alone MUST NOT establish authority; the registry MUST remain user-local, not a cloud or global grant database, and MUST be the first and only canonical persistence for repository/work/subject bindings.
- **FR-002**: The system MUST treat linked worktrees sharing a Git common directory as one repository authority domain while binding grants to their exact work and subject. It MUST recognize unchanged common-directory identity as the same repository despite content changes, preserve a same-filesystem move only when physical identity is verified, and MUST NOT inherit authority across clones, full copies, cross-machine transfers, or a changed common-directory instance. If physical identity is unavailable or unreliable, HARD binding MUST fail closed. Path, URL/remote, UUID copied with repository contents, name, and branch MUST NOT be fallback identity.
- **FR-003**: Every canonical grant MUST bind the repository identity, `authority_id`, `work_id`, subject, operation/capability, exact allowed paths or scope, numeric ceiling(s), `allow_new_files`, independent dependency/migration/configuration/public-API permissions, validity/freshness, authority revision or digest, issuer/provenance, and lifecycle/consumption status. The specification defines these logical facts, not a serialized schema or validation algorithm.
- **FR-004**: Direct grant administration outside the supported governed Runtime Guard path is an explicit execution-boundary trust premise, not human-identity proof. The existing Phase A Runtime Guard MUST block supported governed grant create, grant revoke, and reserved rebind before execution. Executable identity MAY identify the ChangeBudget operation for classification only; it MUST NOT authenticate an operator. Prompts, TTY/interactivity, environment, process ancestry, OpenCode ASK/once/always, model/agent claims, shell comments, repository references, and audit evidence MUST NOT establish operator identity or create/expand/revoke authority. Unsupported routes and malicious same-user OS bypass are explicitly outside the protection claim.
- **FR-005**: The ChangeBudget-owned administration surface MUST support direct grant create/revoke plus read-only list/inspection under the existing registry transaction/audit boundary. For a new pre-contract work item, the direct administrative operation MUST require an explicitly selected descriptive subject label; it is neither a credential nor proof of identity or authority. ChangeBudget MUST generate the canonical opaque `work_id` and subject identifier as needed, and persist their binding only in the G2 registry. A first grant MAY create a new binding in the same registry transaction; no separate registration workflow is required. Caller labels, agent prose, and transport data MUST NOT supply canonical identifiers or mint trusted work identity. For supported governed Runtime Guard invocations, deterministic command classification MUST deny grant create, grant revoke, and reserved rebind regardless of generic host allow/always. The required tested command forms are verified ChangeBudget shim, canonical Node, `npm exec`, and `npx`; ambiguous routes within that boundary fail closed. Unsupported routes outside the tested boundary are not claimed as protected. Read-only inspection MUST not mutate authority.
- **FR-006**: Grant verification MUST accept only requests within the grant's exact repository, work, subject, operation/capability, path/scope, and numeric ceiling. A narrower request MUST remain narrower; a grant for a path MUST NOT imply new-file authority; and the dependency, migration, configuration, and public-API permissions MUST remain independent.
- **FR-007**: The system MUST distinguish reusable grants from one-shot grants. A reusable grant may be reused only while valid and within its bound work and limits. Concurrent presentations of one one-shot grant MUST result in at most one successful authority-use outcome or consuming operation. Its consumption state and matching success evidence MUST be durably and consistently recorded before that use is considered successful; losing or replayed presentations MUST NOT succeed. Expiration, revocation, and consumption MUST be enforced across process restarts.
- **FR-008**: The system MUST reject malformed, expired, revoked, stale-revision/digest, replayed, consumed one-shot, cross-repository, cross-work, cross-subject, cross-operation/capability, over-ceiling, and out-of-scope authority. Rejections MUST fail closed rather than silently falling back to a more permissive ASK or generic ALLOW.
- **FR-009**: The G2 registry MUST be the first and only canonical persistence for repository/work/subject bindings, grants, revocation, and consumption/replay state, and these MUST persist across restart. Malformed, incomplete, unavailable, or conflicting persisted authority state MUST NOT be accepted as valid HARD authority. Grant creation/revocation and consuming operations MUST fail closed and MUST NOT commit or be reported successful when required authority state or audit evidence cannot be durably persisted. A crash or failed commit MUST NOT produce successful use without recorded consumption and success evidence; an indeterminate one-shot outcome MUST remain fail-closed, never reset to unused. The system MUST retain auditable evidence of creation, verification, consumption, revocation, and rejection; such evidence is explanatory and MUST NOT itself grant authority.
- **FR-009 clarification**: G4 `verifyGrant` is a strictly read-only preflight, not an audited authority use: it writes no evidence/state, consumes nothing, and never returns `USE_ACCEPTED`. The durable verification/use/rejection evidence required above belongs to the distinct internal `authorizeUse`/service-owned transaction; a read-only permission-hook preflight cannot satisfy that audit requirement.
- **FR-010**: Structured OpenCode V2 transport MUST carry or refer only to an existing canonical grant and provide enough logical context to verify `work_id`, subject, `authority_id`, requested capability, ceiling, repository binding, and freshness. Transport MUST NOT mint, expand, revoke, or rebind a grant. No transport schema or new public API shape is prescribed here.
- **FR-011**: If a V2 request has no grant reference, the owning policy MAY select or retain ASK or BLOCK; absence itself MUST NOT upgrade the decision to ALLOW. A present malformed, unknown, stale, revoked, replayed, or mismatched reference MUST be treated as invalid rather than absent and MUST fail closed without upgrading to ALLOW, even when generic host permission is permissive. A valid verification result alone MUST NOT introduce managed START/AMEND/CLOSE ALLOW behavior.
- **FR-012**: Grant verification and administration MUST be provider-neutral and deterministic for equal persisted authority and equal request context. The implementation SHOULD reuse existing local project primitives where practical. This foundation MUST NOT change stable 1.x behavior or require a remote service, account, or cloud registry.

### Key Entities *(include if feature involves data)*

- **Repository Authority Binding**: The relationship among the user-local registry, public repository reference, physical anchor, and Git common-directory instance. It identifies a local repository authority domain without relying on descriptive path or remote values.
- **Work and Subject**: The exact bounded unit of work and actor to which a grant applies. Work identity is distinct even when multiple worktrees share one repository domain.
- **Canonical Grant**: ChangeBudget-owned authority for a bounded repository, work, subject, operation/capability, scope, ceiling, permissions, freshness, provenance, and lifecycle.
- **Authority Revision/Digest**: The version or content identity against which grant freshness is verified; it is not a source of authority by itself.
- **Consumption and Replay Evidence**: State and records indicating whether a one-shot grant was consumed and documenting verification outcomes. Evidence supports explanation and replay rejection but cannot mint or widen a grant.
- **Structured V2 Authority Reference**: Runtime-carried or referenced logical grant context (`work_id`, subject, `authority_id`, capability, and requested ceiling) submitted for exact verification, not an issuer or independent authority.

### Explicit Non-Goals

- Enabling managed START, AMEND, or CLOSE ALLOW behavior or changing lifecycle execution policy; this batch provides foundation only.
- Reconcile-head/rebaseline behavior, issue #29, issue #47, Phase C or later work, or EvoSpec-specific semantics/bridging.
- Any stable 1.x behavior or contract compatibility change, or an inferred migration of existing authority.
- Cloud, distributed, organization-wide, cross-machine, or federated grants; an OS sandbox; cryptographic proof of human presence; or protection against a malicious unrestricted same-user OS actor able to tamper with or bypass local ChangeBudget/repository boundaries.
- Defining the full registry persistence layout, transport wire schema, frozen public API signature, or new provider-specific authority semantics.
- Protecting unsupported execution routes or a malicious same-user OS actor capable of bypassing the governed Runtime Guard or tampering with local ChangeBudget state.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the required repository-identity matrix, every case produces the specified same-instance, shared-domain, distinct-work, non-inheritance, or fail-closed result in 100% of repeatable runs.
- **SC-002**: In the required grant-boundary matrix, 100% of matching requests remain within exact grant bounds, and 100% of mismatched, over-ceiling, stale, revoked, malformed, expired, replayed, or consumed one-shot requests are rejected.
- **SC-003**: Across process restarts, 100% of valid reusable-grant state, revocations, and one-shot consumption/replay outcomes retain their prior status; malformed or unavailable persisted state never yields HARD authority.
- **SC-004**: In the required transport matrix, 100% of absent-reference cases preserve the owning policy's current ASK/BLOCK outcome, with no absence-based conversion to ALLOW. 100% of present invalid, stale, revoked, replayed, or mismatched references are rejected as BLOCK and never treated as absent; no generic host allow bypasses verification; and valid verification causes zero managed lifecycle ALLOW outcomes by itself.
- **SC-005**: For a local registry containing up to 100 grants, listing or inspecting one selected grant completes within a provisional 2-second target, and a user can complete one direct create/inspect/revoke journey within a provisional 2-minute target. These are usability assumptions for future measurement, not measured baselines or claims.
- **SC-006**: Independent security and correctness review finds no operator-authentication or grant-mutation authority from prompts, TTY/interactivity, environment, process ancestry, saved host permissions, executable identity, agent claims, repository references, transport, or audit evidence. Every supported governed-path grant create/revoke/rebind attempt is blocked regardless of host allow/always; unsupported routes and malicious same-user OS bypass remain outside the claim.
- **SC-007**: In concurrent one-shot tests, at most one presentation returns a successful authority-use outcome or commits a consuming operation, and every successful use has matching durable consumption and success evidence before it is reported successful.
- **SC-008**: In 100% of injected required audit or consumption/replay-state persistence failures, grant administration and consuming operations fail closed without commit or success. Across crash/restart cases, no success is reported without durable evidence and no durably consumed grant is replayed.
- **SC-009**: After G3, direct grant create/revoke conformance demonstrates that each successful mutation and its matching audit evidence commit in the same durable registry transaction, and injected persistence failures never yield reported success or partial mutation. This proves transaction behavior, not operator identity; no intermediate admin authorization record exists.

### Implementation Acceptance Evidence

The following are future implementation gates for this feature, not checks performed while writing this specification:

- **Acceptance sequencing**: T018–T020 (offline G4 verifier/replay) depend on completed G1/G2/G3 and a G1/G2-qualified storage/durability barrier, not on G0 FINAL/T017. G0 FINAL remains a separate native conformance gate after G3; it is mandatory, together with accepted G4 and trusted-context/out-of-hook-audit proof, before any later real OpenCode HARD integration. Offline fixtures do not certify a real adapter, and G4 acceptance does not enable managed START/AMEND/CLOSE ALLOW.

- The focused Phase B identity, grant, replay, and transport matrix MUST cover: common-directory equality and linked worktrees; changed contents; verified same-filesystem move; clone/full-copy/cross-machine transfer; same-path replacement; unavailable/unreliable identity; and equal path/remote with different physical identity.
- Grant tests MUST cover create, exact match, narrower request, over-ceiling, sibling/prefix collision, new-file denial, independent permission combinations, repository/work/subject/operation/capability mismatch, malformed/stale/expired/revoked state, reusable and one-shot behavior, replay, restart persistence, revocation, and agent administration attempts.
- Concurrent one-shot tests MUST race at least two presentations of the same grant and assert at most one successful authority-use outcome or committed consuming operation, one durable consumption, and matching durable success evidence. Crash/restart coverage MUST include a crash before durable records, after durable consumption/evidence but before operation completion, and after successful completion; no consumed grant may be replayed, and no operation may be considered successful without its records.
- Fault-injection tests MUST separately fail required audit-evidence persistence and consumption/replay-state persistence during authority-changing administration and consumption. Each failure MUST leave the operation uncommitted and not reported successful, consistently with the existing Phase A audit-write barrier.
- Direct grant-administration tests MUST cover exact repository/work/subject binding, create/revoke mutation and audit in one registry transaction, read-only list/inspection, malformed/stale grant state, storage/audit failure, restart, and governed create/revoke/reserved-rebind denial across tested shim, Node, npm-exec, and npx forms even with generic host allow/always. No intermediate admin authorization artifact or lifecycle exists; grant one-shot replay remains a separate verifier test.
- Transport tests MUST distinguish absent authority (the owning policy may retain/select ASK or BLOCK; absence cannot upgrade to ALLOW) from a present invalid, stale, or mismatched reference (fail closed, never treated as absent or upgraded to ALLOW). Also cover valid, malformed, unknown, wrong-repository, wrong-work/subject, replayed, revoked, and tampered references; generic-allow bypass attempts; attempted minting/widening; and the prohibition on lifecycle ALLOW from verification alone.
- Before implementation acceptance, run focused Phase B validation, focused Phase A canonical-authority validation, full `npm test`, `npm run typecheck`, `npm run compile`, package-content validation, packaged Runtime Guard loading, `git diff --check`, and independent security/correctness review. Only if all required checks pass may the implementation change be consolidated into one commit; do not beta-publish this feature.
- No test, package, runtime-load, review, or commit result is claimed by this specification.

## Assumptions

- Phase A's first-party executable identity is used only to classify a supported ChangeBudget operation; it does not prove who initiated it or authenticate an administrator. SPEC-015 extends the existing classifier to deny supported governed grant create/revoke and reserved rebind operations.
- ChangeBudget's existing local-first policy and authority semantics remain authoritative. Direct operator action outside the supported governed path is an explicit trust premise, not cryptographic human-presence evidence; OpenCode V2 is a transport/consumer, not an issuer.
- A local physical identity may not be available or reliable on every filesystem. In that case, HARD binding is unavailable rather than inferred from descriptive identifiers.
- The user-local registry and repo-local public reference are sufficient for this local feature; there is no remote identity provider or global grant service.
- Unsupported invocation routes and a malicious unrestricted same-user OS actor capable of bypassing the governed runtime or altering local state are outside the protection claim.
- The provisional usability targets in SC-005 are assumptions to confirm against future implementation, not existing performance measurements.

## Historical certification checkpoint — global OpenCode 2.0.32 preflight (2026-10-20; superseded)

At this earlier checkpoint, the global executable reported OpenCode 2.0.32 instead of the required 2.0.29, so that preflight stopped before runner launch. This is retained as history, not the current blocker: a later separately isolated 2.0.29 attempt passed the pin gate and is recorded below. No G0 FINAL case ran at the earlier checkpoint. The old evidence did not classify native Rule 60 behavior or establish a native event/session. Do not infer T017, T021–T023, CHK016, or G6 completion from that earlier preflight. The bounded `authorizeUse` service contract review remains narrow and does not establish native integration.

## Earlier terminal certification closeout — isolated OpenCode 2.0.29 attempt (2026-10-20)

This is the earlier pre-session attempt record and is superseded as to effective-session proof and current native outcomes by the later evidence below. It remains valid history for that attempt only: the selected test failed before session creation, G0 FINAL was unverified, and no permission assertion or matrix case ran. It is not current evidence that the effective session agent remains blocked.

## Terminal documentation/evidence closeout — session proof and native controls (2026-10-20)

The selected effective session agent is **PASS**: actual public POST/GET receipts for the selected canonical `spec015-conformance` agent matched the session, project, location, nonblank IDs, current configuration, and supported permission overrides. In the same loaded phase, List and Get both matched the target. The cause of the earlier List/Get difference remains **UNKNOWN**; it is not established as filtering. This proves session selection only, not ChangeBudget human identity, a grant, or HARD authority.

The isolated native attempt formally **FAILED** before a second host spawn because the restart receipt was undefined. This is a harness failure, not a failed ChangeBudget denial case. Thirteen real ASK/reply/saved-rule rows survived reload, but only as preparation: no registered ChangeBudget hook was present and no hook-correlated benign ASK control passed. Native ASK, saved-always behavior, and admin-denial behavior remain unverified; post-restart saved-rule use was not run. Admin hook-reason/no-effect controls were not run. The 24-case matrix was **NOT STARTED** (0/24 pass, 0 case failures, 24 unverified); G0 FINAL remains **UNVERIFIED**. Rule 60 remains a projected ordinal: action `OTHER` is lossy and exact action unknown; effect deny; resource kind universal string; 27 local shell-literal projections are nonmatches; source is unknown with zero unique source matches; native matching was not executed. No host/test-source origin or native per-rule applicability is proven.

The original native result remains formally **FAILED**, with its recorded status/outcomes and original SHA-256 `033af658d8be10e86e34212a42861d075d0a1aec4c664b1d1b45d2367ab2c69f`. A separate authorized derivative is recorded at [`dist/spec015-evidence/2b7ce480d3f6419a8e26c905b17adf43.json`](../../dist/spec015-evidence/2b7ce480d3f6419a8e26c905b17adf43.json), SHA-256 `2c96fbf0a311b3db6270d86374b03274d82e01ab19742a1a5437ee5a2d47bf0c`. The correction2 redaction record reports `APPLIED_AFTER_CAPTURE`, `native_result_preserved: true`, and 523 changed field paths. Only preparation-row indices 1, 2, 4, 5, 7, 8, 10, and 11 of 13 are shown changed; indices 0, 3, 6, 9, and 12 are not shown changed or validated raw-free. Privacy review is **BLOCKING / CHANGES_REQUIRED** until the full derivative is validated. Do not describe the derivative as fully sanitized or accepted, or infer that the recorded original bytes were rewritten. No actual secret exposure or exfiltration is asserted. No new native attempt is authorized by this closeout.

The offline restart-receipt source correction is complete, passed its caller check, and passed verified-pin review, but was not natively retested. Latest supplied offline results are focused 5/5; full runner 17 passed, 0 failed, 2 skipped; gated redaction 1 passed; typecheck, compile, and diff check exited 0; 168 production hashes were unchanged. These results do not clear the privacy gate or certify G0. Earlier 14-pass/1-skip and gate 4-pass results are chronology only; prior Phase A/package/G4 counts (350/52/69) are not new batch totals. No fresh Phase A, package, or G4 run was made because production was unchanged.

Owned host PID 28940 received SIGTERM; the port was closed, PID absent, and OS listeners absent for the old and reserved restart ports. The failure occurred before the second spawn. An auxiliary PowerShell `ConnectAsync` to the old port timed out after two seconds and disposed its `TcpClient`, but shell output supplied no exit/PID/task settlement. Its execution state is **UNKNOWN**—not proof of running or finished. No further probe was performed; do not claim that nothing is running globally.

No task IDs or checklist markers changed: T017, T021–T023, and CHK016 remain pending; T024–T027 remain untouched; the checklist remains 16/17. Preserve accepted G4 and non-enabling G5. `HARD_AUTHORITY_ENABLED:NO`; G6 is not started; no lifecycle ALLOW, G0 acceptance, or HARD reliance is claimed. Next state is **BLOCKED** on complete derivative privacy validation and an independently reviewed resolution. No code, native retry, Git mutation, policy/runtime change, cleanup, or out-of-scope work occurred.

## Terminal conditional batch closeout — 2026-10-21

The canonical evidence/provenance, exact 2.1.2 blocker, validation limitations, process reconciliation, and current gates are in `dist/spec015-batch-20261021/final-closeout.md`. The present privacy-barrier/schema/legacy-13-row proof review is **PASS only**—not complete functional/current-run coverage or Block A readiness. Offline G5 has independent Nox **91/91 PASS** and Vera **PASS**, but formal G5 remains **BLOCKED** by native prerequisites. The isolated 2.1.2 filtered case failed before host startup, pin receipt, and permission controls because the initial producer value `saved_always_diagnostic.authority_state_before_fixture_initialization='NOT_CAPTURED'` does not meet the object-only schema. First-write validation precedes mkdir/fixture initialization; the later object capture does not repair initial state. The case failed closed without unsafe persisted data and is not a product denial-case failure. No correction or retry was performed.

Native controls remain **NOT RUN**; G0 FINAL remains **UNVERIFIED** (0/24 pass, 0 case failures, 24 unverified); T017/CHK016 remain pending, T021–T023 unchecked, T024–T027 untouched; G6 is blocked/not started. Latest registry `latest` query observed 2.1.2, but the isolated installation is not native-host certified. Preserve `HARD_AUTHORITY_ENABLED:NO`, no lifecycle ALLOW, and no HARD reliance. No source or task/checklist marker changes were made.
