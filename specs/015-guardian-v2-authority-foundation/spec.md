# Feature Specification: Guardian V2 Authority Foundation

**Feature Branch**: `015-guardian-v2-authority-foundation`

**Created**: 2026-09-29

**Status**: Draft — READY_FOR_TASKS (specification only; implementation validation pending)

**Input**: User description: "Specify Guardian V2 Phase B repository identity, canonical HARD authority, reusable and one-shot grants, replay/stale protection, and structured OpenCode V2 transport."

## Problem Statement

Guardian V2 needs a trustworthy foundation for deciding which local repository, bounded work, and subject a HARD authority grant applies to. Without that binding and exact verification, copied or stale authority could be accepted for the wrong work, broader capability, or repeated operation. The foundation must let a human administer and inspect ChangeBudget-owned grants while preventing ordinary prompts, saved host permissions, agent claims, or transport metadata from becoming authority.

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

As a developer, I need a provider-neutral, ChangeBudget-owned way to create, list, inspect, and revoke grants, so I can deliberately authorize only the work and capabilities I intend.

**Why this priority**: Reusable authority is useful only when its owner, exact limits, and lifecycle are explicit and human-governed.

**Independent Test**: Through the provider-neutral administration surface, create a grant with a known repository, work, subject, operation, capability, path scope, numeric ceiling, and independent permissions. Verify exact and narrower matching requests, inspection, revocation, and attempted agent administration separately.

**Acceptance Scenarios**:

1. **Given** a human-authorized ChangeBudget administration action creates a grant, **When** its details are inspected, **Then** the grant is bound to its repository, `work_id`, subject, `authority_id`, operation/capability, exact scope and ceilings, validity/freshness, authority revision or digest, and issuer/provenance evidence.
2. **Given** a request exactly matches a valid grant, **When** the request is checked, **Then** it remains bounded by the grant; a narrower request remains narrower and is not expanded to the grant's maximum.
3. **Given** a grant covers an existing path, **When** a new-file request is made without explicit `allow_new_files` authority, **Then** it is not covered. Dependency, migration, configuration, and public-API permissions are independently checked and do not imply one another.
4. **Given** a reusable grant is valid for its bound work, **When** separate matching operations are presented within its validity, **Then** reuse is allowed only within that grant's exact bounds; **Given** a one-shot grant has been consumed, **When** it is presented again, **Then** it is rejected as replay.
5. **Given** the same one-shot grant is presented concurrently, **When** the competing requests are resolved, **Then** at most one may be accepted as a successful one-shot authority use or consuming operation; its consumption and success evidence must be durably recorded before success, and every other attempt is rejected or remains uncommitted.
6. **Given** grant creation, revocation, consumption, replay state, or required audit evidence cannot be durably written, **When** an administrative or consuming operation is attempted, **Then** it fails closed and is not committed or reported successful.
7. **Given** a user lists or inspects grants, **When** the request is read-only, **Then** it does not create, widen, consume, or revoke authority. **Given** a governed OpenCode agent attempts grant administration, **Then** create, expand, revoke, and other authority-changing administration are blocked regardless of host allow/always settings.

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
- V2 transport has no grant reference versus a present but invalid/stale/mismatched reference; the absent case leaves ASK/BLOCK to the owning policy, while invalid authority is not treated as absence and never upgrades to ALLOW.
- Read-only inspection is requested while persisted authority state is malformed; inspection must not repair or rewrite it as a side effect.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST bind local HARD authority through a user-local registry outside the repository, a repo-local public reference, and a physical ChangeBudget anchor associated with the Git common-directory instance. The public reference alone MUST NOT establish authority; the registry MUST remain user-local, not a cloud or global grant database.
- **FR-002**: The system MUST treat linked worktrees sharing a Git common directory as one repository authority domain while binding grants to their exact work and subject. It MUST recognize unchanged common-directory identity as the same repository despite content changes, preserve a same-filesystem move only when physical identity is verified, and MUST NOT inherit authority across clones, full copies, cross-machine transfers, or a changed common-directory instance. If physical identity is unavailable or unreliable, HARD binding MUST fail closed. Path, URL/remote, UUID copied with repository contents, name, and branch MUST NOT be fallback identity.
- **FR-003**: Every canonical grant MUST bind the repository identity, `authority_id`, `work_id`, subject, operation/capability, exact allowed paths or scope, numeric ceiling(s), `allow_new_files`, independent dependency/migration/configuration/public-API permissions, validity/freshness, authority revision or digest, issuer/provenance, and lifecycle/consumption status. The specification defines these logical facts, not a serialized schema or validation algorithm.
- **FR-004**: The system MUST accept canonical HARD authority only from an authorized ChangeBudget-owned human administration event. User prose, prompts, OpenCode ASK/once/always, model or agent claims, environment values, shell comments, repository references, and audit evidence MUST NOT create or expand a grant.
- **FR-005**: A provider-neutral administration surface MUST support human-authorized grant creation, listing, inspection, and revocation. Listing and inspection MUST be read-only with respect to authority. An agent acting through the governed Runtime Guard path MUST be blocked from creating, expanding, revoking, or otherwise administering canonical authority, using the Phase A agent identity.
- **FR-006**: Grant verification MUST accept only requests within the grant's exact repository, work, subject, operation/capability, path/scope, and numeric ceiling. A narrower request MUST remain narrower; a grant for a path MUST NOT imply new-file authority; and the dependency, migration, configuration, and public-API permissions MUST remain independent.
- **FR-007**: The system MUST distinguish reusable grants from one-shot grants. A reusable grant may be reused only while valid and within its bound work and limits. Concurrent presentations of one one-shot grant MUST result in at most one successful authority-use outcome or consuming operation. Its consumption state and matching success evidence MUST be durably and consistently recorded before that use is considered successful; losing or replayed presentations MUST NOT succeed. Expiration, revocation, and consumption MUST be enforced across process restarts.
- **FR-008**: The system MUST reject malformed, expired, revoked, stale-revision/digest, replayed, consumed one-shot, cross-repository, cross-work, cross-subject, cross-operation/capability, over-ceiling, and out-of-scope authority. Rejections MUST fail closed rather than silently falling back to a more permissive ASK or generic ALLOW.
- **FR-009**: Registry, canonical grants, revocation, and consumption/replay state MUST persist across restart. Malformed, incomplete, unavailable, or conflicting persisted authority state MUST NOT be accepted as valid HARD authority. Grant creation/revocation and consuming operations MUST fail closed and MUST NOT commit or be reported successful when required authority state or audit evidence cannot be durably persisted. A crash or failed commit MUST NOT produce successful use without recorded consumption and success evidence; an indeterminate one-shot outcome MUST remain fail-closed, never reset to unused. The system MUST retain auditable evidence of creation, verification, consumption, revocation, and rejection; such evidence is explanatory and MUST NOT itself grant authority.
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
- Cloud, distributed, organization-wide, cross-machine, or federated grants; an OS sandbox; or protection against a malicious unrestricted same-user OS actor able to tamper with local files.
- Defining a final wire/persistence schema, validation algorithm, public API signature, or new provider-specific authority semantics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the required repository-identity matrix, every case produces the specified same-instance, shared-domain, distinct-work, non-inheritance, or fail-closed result in 100% of repeatable runs.
- **SC-002**: In the required grant-boundary matrix, 100% of matching requests remain within exact grant bounds, and 100% of mismatched, over-ceiling, stale, revoked, malformed, expired, replayed, or consumed one-shot requests are rejected.
- **SC-003**: Across process restarts, 100% of valid reusable-grant state, revocations, and one-shot consumption/replay outcomes retain their prior status; malformed or unavailable persisted state never yields HARD authority.
- **SC-004**: In the required transport matrix, 100% of absent-reference cases preserve the owning policy's current ASK/BLOCK outcome, with no absence-based conversion to ALLOW. 100% of present invalid, stale, revoked, replayed, or mismatched references are rejected as BLOCK and never treated as absent; no generic host allow bypasses verification; and valid verification causes zero managed lifecycle ALLOW outcomes by itself.
- **SC-005**: For a local registry containing up to 100 grants, listing or inspecting one selected grant completes within a provisional 2-second target, and a user can complete one authorized create/inspect/revoke journey within a provisional 2-minute target. These are usability assumptions for future measurement, not measured baselines or claims.
- **SC-006**: Independent security and correctness review finds no authority path from prompts, saved host permissions, agent claims, repository references, transport, or audit evidence that can create or widen a canonical grant.
- **SC-007**: In concurrent one-shot tests, at most one presentation returns a successful authority-use outcome or commits a consuming operation, and every successful use has matching durable consumption and success evidence before it is reported successful.
- **SC-008**: In 100% of injected required audit or consumption/replay-state persistence failures, grant administration and consuming operations fail closed without commit or success. Across crash/restart cases, no success is reported without durable evidence and no durably consumed grant is replayed.

### Implementation Acceptance Evidence

The following are future implementation gates for this feature, not checks performed while writing this specification:

- The focused Phase B identity, grant, replay, and transport matrix MUST cover: common-directory equality and linked worktrees; changed contents; verified same-filesystem move; clone/full-copy/cross-machine transfer; same-path replacement; unavailable/unreliable identity; and equal path/remote with different physical identity.
- Grant tests MUST cover create, exact match, narrower request, over-ceiling, sibling/prefix collision, new-file denial, independent permission combinations, repository/work/subject/operation/capability mismatch, malformed/stale/expired/revoked state, reusable and one-shot behavior, replay, restart persistence, revocation, and agent administration attempts.
- Concurrent one-shot tests MUST race at least two presentations of the same grant and assert at most one successful authority-use outcome or committed consuming operation, one durable consumption, and matching durable success evidence. Crash/restart coverage MUST include a crash before durable records, after durable consumption/evidence but before operation completion, and after successful completion; no consumed grant may be replayed, and no operation may be considered successful without its records.
- Fault-injection tests MUST separately fail required audit-evidence persistence and consumption/replay-state persistence during authority-changing administration and consumption. Each failure MUST leave the operation uncommitted and not reported successful, consistently with the existing Phase A audit-write barrier.
- Transport tests MUST distinguish absent authority (the owning policy may retain/select ASK or BLOCK; absence cannot upgrade to ALLOW) from a present invalid, stale, or mismatched reference (fail closed, never treated as absent or upgraded to ALLOW). Also cover valid, malformed, unknown, wrong-repository, wrong-work/subject, replayed, revoked, and tampered references; generic-allow bypass attempts; attempted minting/widening; and the prohibition on lifecycle ALLOW from verification alone.
- Before implementation acceptance, run focused Phase B validation, focused Phase A canonical-authority validation, full `npm test`, `npm run typecheck`, `npm run compile`, package-content validation, packaged Runtime Guard loading, `git diff --check`, and independent security/correctness review. Only if all required checks pass may the implementation change be consolidated into one commit; do not beta-publish this feature.
- No test, package, runtime-load, review, or commit result is claimed by this specification.

## Assumptions

- Phase A supplies the agent identity used to block governed agent administration; Phase B consumes that identity and does not replace it.
- ChangeBudget's existing local-first policy and authority semantics remain authoritative. Human grant administration occurs through ChangeBudget outside governed agent execution; OpenCode V2 is a transport/consumer, not an issuer.
- A local physical identity may not be available or reliable on every filesystem. In that case, HARD binding is unavailable rather than inferred from descriptive identifiers.
- The user-local registry and repo-local public reference are sufficient for this local feature; there is no remote identity provider or global grant service.
- The threat model excludes a malicious unrestricted same-user OS actor capable of altering the registry, repository, anchor, or administration path.
- The provisional usability targets in SC-005 are assumptions to confirm against future implementation, not existing performance measurements.
