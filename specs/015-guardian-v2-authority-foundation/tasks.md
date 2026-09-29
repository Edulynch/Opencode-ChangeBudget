---

description: "Integrated implementation tasks for SPEC-015 Guardian V2 Authority Foundation"
---

# Tasks: Guardian V2 Authority Foundation

**Input**: Design documents in `specs/015-guardian-v2-authority-foundation/`.

**Prerequisites**: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/admin-api.md`, `contracts/authority-transport.md`, `quickstart.md`, and `.specify/memory/constitution.md`.

**Review status**: **Independent Vera task-plan review passed with no findings; the task plan is READY_FOR_IMPLEMENTATION.** This status is task-plan readiness only—not evidence of code implementation or test execution, provider/durability/platform/security runtime proof, implementation acceptance, or release readiness. All implementation and runtime acceptance gates remain open.

**Tests**: Required. SPEC-015 explicitly requires focused identity, grant, replay, transport, fault-injection, platform, regression, package/runtime, and independent-review evidence. Write focused tests before the corresponding implementation and prove the intended fail-closed cases.

**Organization**: US1–US4 are all P1 and form one cumulative foundation batch. Their matrices are independently testable, but none is independently shippable as an authority-enabled feature. No user story may add managed lifecycle permissions. Groups A–I cross phases as needed while checklist items remain in template story phases.

**Implementation boundaries**:

- Keep provider-neutral internal authority operations in `src/core/authority/authority-service.ts`; do not add a package-root/public SDK export, dependency, service, database, cloud registry, migration, or new provider-specific authority semantics.
- The existing CLI routes through `src/cli/index.ts` and `src/cli/help.ts` into `src/cli/commands/`. Use that established routing shape for the reviewed human-facing adapter at `src/cli/commands/authority.ts`. The command spelling is an implementation-local choice, not a contract; neither a first-party executable, process path, `--actor`, prompt text, environment value, nor OpenCode host permission proves human authority.
- Keep the V2 permission hook read-only. A valid reference is only a non-consuming, non-upgrading preflight; do not call persistence-bearing `authorizeUse` from the hook. Until the out-of-hook audit route and trusted runtime contexts are proven, transport cannot claim audited authority use.
- Do not claim OneDrive/cloud-sync, reparse/symlink, Windows, POSIX, or other filesystem support without separate direct proof. In particular, OneDrive remains unsupported absent evidence; never fall back to path, remote, name, branch, copied UUID, executable identity, or host allow.
- No managed START/AMEND/CLOSE ALLOW, force-close/reconcile-head, issue #29/#47, EvoSpec, Phase C+, stable 2.0.0 release, beta publication, or inferred stable-1.x behavior change.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm existing owners and boundaries; do not initialize a project, change dependencies, or create product files in this phase.

- [ ] T001 Confirm the existing Node/TypeScript/node:test and validation owners in `package.json`, `scripts/test-phase-a-focused.mjs`, `tests/integration/opencode-plugin-runtime-hook.spec.ts`, and `tests/integration/package-contents.test.ts`; preserve these paths and add no dependencies or release scripts.
- [ ] T002 Confirm the existing CLI dispatch/help convention in `src/cli/index.ts` and `src/cli/help.ts`; place only the internal provider-neutral service at `src/core/authority/authority-service.ts` and the human-facing adapter in the existing `src/cli/commands/` layout, without treating CLI identity as proof of a human.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: G0 provider feasibility. This is a hard stop before binding, registry, grant, or verification work can claim HARD authority.

**⚠️ CRITICAL**: No G1–G6 work may claim successful authority unless G0 establishes real providers and durable local primitives. Test doubles may support unit tests only; they are not runtime/platform evidence.

### Group A — Physical identity and trusted-provider feasibility tests

- [ ] T003 Write fail-first G0 tests in `tests/unit/authority-identity.test.ts`, `tests/unit/authority-context.test.ts`, `tests/acceptance/authority-platform-matrix.test.ts`, `tests/integration/cli/authority.test.ts`, and `tests/integration/opencode-plugin-runtime-hook.spec.ts` for actual physical-object/common-directory association, unreliable or unavailable identity, trusted subject, an action-bound one-use outside-runtime operator context, non-interactive/forged/serialized/reused context rejection, governed-agent create/expand/revoke denial even when incoming host effect is `allow`/saved-always, exclusive cross-process lock, file sync, atomic replace, parent-directory sync, and injected capability failures; assert unsupported cases return unavailable, not a fallback identity or success.

### Group D — Real action-bound operator-admin context source (G0 prerequisite)

- [ ] T004 Implement and validate the real no-mutation `OperatorAdminContext` source in `src/core/authority/subject-context.ts` and the established CLI adapter path `src/cli/commands/authority.ts`, reusing the G0 tests in `tests/unit/authority-context.test.ts` and `tests/integration/cli/authority.test.ts`: issue only an ephemeral context after explicit local interactive-terminal confirmation bound to the exact typed admin action and immutable request digest; validate issuance through a private in-process `WeakMap`/issuer capability, expire it promptly, and consume it once for that same action/request. Reject absent/non-interactive, mismatched, expired, serialized, forged, or reused contexts. Do not mint context from `--actor`, prose/prompt claims, OpenCode ASK/once/always, environment, metadata, executable identity, or repository references; the terminal confirmation is action provenance, not a grant or trusted request field. Keep the issuer private to the local CLI adapter. In `opencode-plugin/src/changebudget-command.ts`, unconditionally classify future authority-changing CLI actions as blocked before invocation so the governed Runtime Guard rejects them even for incoming `allow`/saved-always; verify in `tests/integration/opencode-plugin-runtime-hook.spec.ts`. Validate the real source with `npm run compile && node --test dist/tests/unit/authority-context.test.js dist/tests/integration/cli/authority.test.js dist/tests/integration/opencode-plugin-runtime-hook.spec.js` and one no-op context-issuance smoke through the local CLI adapter from an actual terminal outside OpenCode, recorded in `tests/integration/cli/authority.test.ts`. Do not create, list, inspect, revoke, or otherwise mutate grants in this task; if real terminal provenance or the governed-agent deny cannot be demonstrated, leave G0 blocked.

### Group H — Windows/POSIX and filesystem gate

- [ ] T005 Implement the real `PhysicalIdentityProvider` in `src/core/authority/physical-identity.ts` and authenticated `SubjectContextProvider` in `src/core/authority/subject-context.ts`, preserving and reusing the vetted T004 operator-context issuer rather than introducing another admin source; then run G0 with `npm run compile && node --test dist/tests/unit/authority-identity.test.js dist/tests/unit/authority-context.test.js dist/tests/integration/cli/authority.test.js dist/tests/integration/opencode-plugin-runtime-hook.spec.js && node --test dist/tests/acceptance/authority-platform-matrix.test.js` on the exact named runtime/filesystem. Record proof and unsupported cases in `tests/acceptance/authority-platform-matrix.test.ts`. STOP before G1 if real subject/admin context, governed-agent denial, physical-ID reliability, common-dir association, safe locking, file+directory durability, or failure behavior is unproven; explicitly reject OneDrive until directly validated.

**G0 exit gate**: T004 must first provide and validate the real action-bound local operator-admin source, no-op terminal issuance, and governed-agent block, without any grant mutation. T005 must then demonstrate that source together with real physical identity, trusted subject, lock safety, and file/replace/directory durability including failure injection on one named filesystem/runtime. Otherwise HARD authority remains unavailable; do not substitute a test double or weaker provider.

---

## Phase 3: User Story 1 — Bind authority to the actual repository and work (Priority: P1)

**Goal**: G1 binds a local authority domain to the verified physical common-directory anchor while keeping generated work and trusted subject exact.

**Independent Test**: Against disposable repositories/worktrees, evaluate same-domain and mismatched physical IDs, work IDs, and subjects. This is an identity matrix, not a separately shippable authority feature.

### Group A — Repository/work binding

> Write the mismatch and fail-closed tests first. Descriptive repository attributes and correlation IDs are never identity proof.

- [ ] T006 [US1] Add the US1 identity/work matrix to `tests/unit/authority-identity.test.ts` and `tests/unit/authority-context.test.ts`: linked worktrees sharing common-dir share only the repository domain; distinct generated `work_id` and subject remain distinct; content/HEAD changes do not rebind; same-filesystem move preserves identity only when proven; clone/full copy/cross-machine copy/same-path replacement reject; copied, missing, malformed, or unknown public references never create/rebind a registry binding; equal path/remote/name/branch and copied UUID never match; task/contract/session/agent values are not identity proof.
- [ ] T007 [US1] Implement opaque repo-reference resolution, physical-anchor binding, coherent activation-to-generated immutable work binding, and freshness epochs in `src/core/authority/repository-binding.ts` and `src/core/authority/work-context.ts`; persist no grant in the repository reference, treat `task_id` as correlation only, and fail closed on changed/unavailable identity, incoherent active contract, missing activation, stale scope, or untrusted subject.
- [ ] T008 [US1] Validate G1 with `npm run compile && node --test dist/tests/unit/authority-identity.test.js dist/tests/unit/authority-context.test.js` and the relevant disposable-repository cases in `tests/unit/authority-identity.test.ts`; demonstrate common-dir sharing without work/subject rebinding and zero descriptive-identity fallback before proceeding to G2.

**Checkpoint**: G1 binding/context matrices pass on the G0-qualified filesystem only. Other platforms/filesystems remain unsupported until their own G6 evidence.

---

## Phase 4: User Story 2 — Administer bounded grants without widening intent (Priority: P1)

**Goal**: G2–G3 provide a strict durable local registry and provider-neutral human-owned create/list/inspect/revoke for exact immutable grants.

**Independent Test**: Using only the vetted T004 action-bound context source, create and inspect a human-authorized grant, verify exact and narrower bounds, read-only listing/inspection, revocation, context single-use/action binding, and agent denial even for generic allow/saved-always. This matrix is part of the cumulative batch.

### Group B — Registry and persistence

- [ ] T009 [P] [US2] Write fail-first snapshot/transaction tests in `tests/unit/authority-registry.test.ts` and `tests/integration/authority-registry.test.ts` for strict versions/fields, malformed or conflicting state, duplicate IDs/keys, read-only byte-for-byte list/inspect (including corrupt state), lock contention/uncertain ownership, temp/write/file-sync/replace/directory-sync/readback failures, and restart persistence; assert durable `CREATED`, verification/use, `REJECTED`, `CONSUMED`, and `REVOKED` evidence is explanatory only and never an authority source, with explicit fault-injection seams that do not weaken production checks.

### Group C — Canonical grants and independent capabilities

- [ ] T010 [P] [US2] Write fail-first canonical-grant boundary tests in `tests/unit/authority-grants.test.ts` for exact and narrower requests, 18 remaining 18 below ceiling 60, over-ceiling rejection, canonical path traversal/prefix sibling/case ambiguity/symlink escape, deny and protected `.changebudget/**`, existing path versus `allow_new_files`, and every independent dependency/migration/configuration/public-API permission combination.

### Group B — Durable registry implementation

- [ ] T011 [US2] Implement the single strict versioned user-local snapshot, conservative cross-process lock, durable same-directory temp/write/file-sync/atomic-replace/parent-sync/readback barrier, and same-transaction audit evidence in `src/core/authority/registry.ts` and `src/core/authority/audit.ts`; list/inspect must never repair or rewrite, unknown/corrupt state never migrates, and any unproven durability fails closed.

### Group C — Canonical grant implementation

- [ ] T012 [US2] Implement immutable strict grant validation and provider-neutral create/list/inspect/revoke operations in `src/core/authority/grants.ts` and `src/core/authority/authority-service.ts`; bind each grant to verified repository, `authority_id`, `work_id`, trusted subject, operations/capabilities, exact paths, ceilings, independent flags, validity/freshness, issuer evidence, and lifecycle. Creation/revocation plus audit must commit durably; no expand/update/rebind operation; 18 stays 18 under 60.

### Group D — Human administration and lifecycle

- [ ] T013 [US2] Write CLI administration contract tests in `tests/integration/cli/authority.test.ts` for create/list/inspect/revoke through the T004 outside-governed-runtime source, exact grant summary, immutable creation, terminal revocation, absent/invalid/mismatched/replayed operator context rejection, and no `--actor`/executable/env/prose/metadata shortcut; measure the provisional up-to-100-grant list/inspect and create/inspect/revoke usability targets without treating them as baselines.
- [ ] T014 [US2] Implement the human-facing administration operations in `src/cli/commands/authority.ts` and route/help them through `src/cli/index.ts` and `src/cli/help.ts`; reuse and consume only the exact one-use `OperatorAdminContext` source vetted in T004—do not introduce another context constructor, human-proof path, or context fallback. Keep list/inspect read-only, validate input, and never infer human authorization from `changebudget`, a first-party executable, `--actor`, host ask/once/always, environment, metadata, prompt text, or agent claims.

### Group G — Governed-agent administration and read-only inspection

- [ ] T015 [US2] Write fail-first governed-runtime cases in `tests/unit/opencode-runtime-projection.test.ts` and `tests/integration/opencode-plugin-runtime-hook.spec.ts`: generic host allow/saved-always cannot invoke create/expand/revoke, malformed authority commands block, and list/inspect remain read-only without consuming, repairing, creating, widening, or revoking authority.
- [ ] T016 [US2] Extend the Phase A command classifier in `opencode-plugin/src/changebudget-command.ts` to allow only well-formed authority list/inspect as read-only while preserving T004's unconditional block for authority-changing and unknown administration forms in the governed Runtime Guard path; retain the rule that first-party command identity proves only executable identity and never a human.

### Group D — Grant-administration acceptance checkpoint

- [ ] T017 [US2] Validate G3 create/list/inspect/revoke and persistence behavior with `npm run compile && node --test dist/tests/unit/authority-grants.test.js dist/tests/unit/authority-registry.test.js dist/tests/integration/authority-registry.test.js dist/tests/integration/cli/authority.test.js`; verify listing/inspection leave registry/audit bytes unchanged, create/revoke never report success before durable evidence, and record the provisional list/inspect-under-2-seconds and human create/inspect/revoke-under-2-minutes measurements as future observations only.

**G2–G3 exit gate**: Registry and human-authorized grant administration work only on G0/G1-qualified local storage/context. If the human adapter cannot issue action-bound context outside governed execution, stop; do not enable create/revoke through a fake provider.

---

## Phase 5: User Story 3 — Reject stale, replayed, malformed, or out-of-scope authority (Priority: P1)

**Goal**: G4 performs exact deterministic verification and durable reusable/one-shot state transitions, including restart, revocation, races, and crash/failure behavior.

**Independent Test**: Check matching and invalid bindings, ceilings, scope, freshness, expiry, revocation, malformed state, replay, races, and restart. `authorizeUse` is an internal authority-use outcome only, never a lifecycle operation.

### Group E — Exact verifier, freshness, audit, and replay

- [ ] T018 [US3] Write fail-first G4 tests in `tests/unit/authority-grants.test.ts` and `tests/integration/authority-registry.test.ts` for repo/work/subject/operation/capability mismatch, contract/scope/activation/authority/binding revision or digest staleness, expiry/revocation/consumption, malformed/unknown persisted state, path/ceiling denial reasons, reusable repeats, at-least-two-process one-shot races, crashes before commit/after durable consume-before-downstream completion/after success, restart, and separately injected audit-write and replay-state/lock/sync failures during create/revoke and `authorizeUse`; no fake success when a durable record is missing.
- [ ] T019 [US3] Implement exact deterministic verification and reusable-evidence or atomic one-shot `ACTIVE -> CONSUMED` plus matching success-evidence commit in `src/core/authority/grants.ts`, `src/core/authority/authority-service.ts`, `src/core/authority/registry.ts`, and `src/core/authority/audit.ts`; serialize cross-process contenders, give at most one `USE_ACCEPTED`, preserve consumed/revoked terminal state across restart, and fail closed if required state/evidence cannot persist.
- [ ] T020 [US3] Validate the G4 first-usable milestone with `npm run compile && node --test dist/tests/unit/authority-grants.test.js dist/tests/unit/authority-registry.test.js dist/tests/integration/authority-registry.test.js`: on one named G0–G3-qualified filesystem prove physical identity, a persistent human-created grant using only the vetted T004 one-use context source, exact verification, restart, revocation, reusable status, and at-most-one internal one-shot `authorizeUse` with durable consume/success evidence. Do not invoke effectful managed START/AMEND/CLOSE and do not produce lifecycle ALLOW; stop if any success lacks durable evidence.

**First usable milestone G0–G4**: A single explicitly named, proven local filesystem/runtime supports validated physical identity, the same vetted T004 action-bound human-admin context source (with no alternate context issuer), durable create/inspect/revoke, exact verification, restart persistence, and at-most-one durable internal one-shot consumption. This milestone is **not** transport acceptance and never authorizes managed START, AMEND, or CLOSE ALLOW. No other filesystem inherits the claim.

---

## Phase 6: User Story 4 — Carry existing authority safely through OpenCode V2 (Priority: P1)

**Goal**: G5 parses only existing grant references and preserves the Phase A effect; absent references pass through, present invalid references block, and valid references never mint or upgrade authority.

**Independent Test**: Compare absent, valid, malformed, unknown, stale, revoked, replayed, mismatched, and tampered references against generic allow/always and more restrictive prior effects, while proving the permission hook performs zero ChangeBudget writes.

### Group F — Restrictive V2 transport

- [ ] T021 [US4] Write fail-first logical and hook-level transport cases in `tests/integration/authority-transport.test.ts` and `tests/integration/opencode-plugin-runtime-hook.spec.ts` for absent versus present-invalid distinction, valid exact reference preserving the Phase A result, malformed/unknown/extra-authority-field/oversized/tampered payloads, wrong repo/work/subject/authority/operation/capability/path/ceiling/freshness, revoked/expired/consumed/replay, untrusted session/agent/location/metadata/first-party claims, generic allow/always bypass, stricter incoming effect, explicit host deny outside hook invocation, no mint/widen/rebind, 18-under-60, zero hook writes, and zero lifecycle ALLOW.
- [ ] T022 [US4] Implement the namespaced metadata parser and restrictive non-consuming V2 adapter in `opencode-plugin/src/authority-reference.ts` and integrate it in `opencode-plugin/src/index.ts`; derive all trust locally, compare untrusted descriptors to actual action/resources, preserve absent Phase A output and stricter effects, block present-invalid references, and never call persistence-bearing `authorizeUse` or change a valid result to ALLOW.
- [ ] T023 [US4] Validate G5 with `npm run compile && node --test dist/tests/integration/authority-transport.test.js dist/tests/integration/opencode-plugin-runtime-hook.spec.js`; prove the hook remains byte-for-byte read-only and valid preflight does not claim audited use. If a reviewed out-of-hook ChangeBudget audit route or trusted runtime context is missing, keep transport reliance blocked; retain only absent pass-through and invalid-reference block.

**G5 exit gate**: No V2 request may rely on a valid-looking reference as authority until trusted context and ChangeBudget-owned out-of-hook audit evidence are proven without violating the Phase A read-only hook contract. Generic host allow/always is never an override.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: G6 actual platform, regression, package/runtime, and independent correctness/security acceptance. No publication, version bump, or lifecycle permission rollout.

### Group H — Windows/POSIX and filesystem acceptance

- [ ] T024 Run `node --test dist/tests/acceptance/authority-platform-matrix.test.js` on each separately claimed Windows and POSIX runtime/filesystem using disposable repositories; cover common-dir/worktree equality, changed contents, verified same-filesystem move, clone/full-copy/cross-machine transfer, same-path replacement, ID reuse/unreliable IDs, symlink/reparse/case behavior, lock/durability faults, and equal path/remote with different physical IDs. Record exact OS/filesystem/results in `tests/acceptance/authority-platform-matrix.test.ts`; leave every unproven filesystem, including OneDrive, explicitly unsupported.

### Group I — Package/runtime and security gates

- [ ] T025 Extend the existing package-content and installed-runtime acceptance owners in `tests/integration/package-contents.test.ts` and `tests/integration/opencode-plugin-runtime-hook.spec.ts`; verify the intended core/CLI/plugin runtime closure is packaged and loads from an installed artifact, existing Phase A hooks remain compatible, and no spec/test/dev files or authority state enter the package.
- [ ] T026 Run the ordered final gates using `package.json`, `scripts/test-phase-a-focused.mjs`, `tests/integration/package-contents.test.ts`, and `tests/integration/opencode-plugin-runtime-hook.spec.ts`: focused Phase B matrices, `npm run test:phase-a`, `npm test`, `npm run typecheck`, `npm run compile`, package-content/installed Runtime Guard loading, and `git diff --check`. Record each actual command/result; these are future implementation checks, not results of task generation.
- [ ] T027 Obtain independent security/correctness review of `src/core/authority/physical-identity.ts`, `src/core/authority/repository-binding.ts`, `src/core/authority/work-context.ts`, `src/core/authority/subject-context.ts`, `src/core/authority/registry.ts`, `src/core/authority/grants.ts`, `src/core/authority/authority-service.ts`, `src/core/authority/audit.ts`, `src/cli/commands/authority.ts`, `opencode-plugin/src/authority-reference.ts`, and the existing `opencode-plugin/src/index.ts`; trace issuer/subject/work/physical identity, exact path/ceiling/deny precedence, audit+consumption ordering, lock/crash behavior, agent blocks, read-only hook, packaging, and all G0–G6 evidence. Keep acceptance pending until every finding and stop gate is resolved; no stable release or beta publication.

---

## Dependencies & Execution Order

### Phase and gate dependencies

- **Setup (T001–T002)**: No implementation dependency; confirm existing owners and allowed adapter locations.
- **G0 / Foundational (T003–T005)**: T003 writes fail-first source/provider and agent-block tests; T004 implements/tests the real action-bound outside-runtime operator-context source and pre-invocation Runtime Guard block without grant mutations; T005 implements physical identity and trusted subject, then proves all context, platform, lock, and durability requirements. T005 is the hard stop: no G1 if any proof is missing.
- **G1 / US1 (T006–T008)**: Depends on G0. Establish verified repository binding and coherent generated work context; path/remote/content/correlation values never substitute for physical identity/work/subject.
- **G2 / US2 registry (T009, T011)**: Depends on G1. Strict local registry, one durable transaction boundary, audit, and read-only inspection.
- **G3 / US2 grants/admin (T010, T012–T017)**: Depends on G1 and G2. Exact grant fields and capabilities, human admin adapter, revocation, and governed-agent blocking.
- **G4 / US3 verifier/replay (T018–T020)**: Depends on G0–G3. First usable milestone; the only successful use is durable internal `authorizeUse`, not a managed lifecycle action.
- **G5 / US4 transport (T021–T023)**: Depends on G4 and must additionally pass the out-of-hook audit/trusted-context gate. If not proven, transport reliance remains blocked.
- **G6 / Polish (T024–T027)**: Depends on all implementation gates; qualify each actual platform independently, run regression/package gates, and receive independent review.

**Critical path**: `T003 → T004 (real action-bound admin source + agent block) → T005 (remaining G0 providers + proof gate) → T006 → T007 → T008 (G1) → (T009 || T010, parallel tests) → T011 (G2 registry) → T012 (G3 grants/service; requires T010 and T011) → T013 → T014 (reuse T004 source) → T015 → T016 → T017 (G3) → T018 → T019 → T020 (G4 first usable milestone) → T021 → T022 → T023 (G5) → T024 → T025 → T026 → T027 (G6)`.

### Parallel opportunities

- Only T009 and T010 are marked `[P]`: after G1, registry-failure tests in `tests/unit/authority-registry.test.ts` and grant-boundary tests in `tests/unit/authority-grants.test.ts` are disjoint and can be authored in parallel; both must finish before T011/T012 implementation respectively.
- No provider, binding, durable transaction, grant lifecycle, replay, transport, or final-gate tasks are parallelized across unmet dependencies. The security DAG is a forward chain, not independently shippable subsystems.
- After G4, the separate transport contract suite `tests/integration/authority-transport.test.ts` may be authored without changing core authority policy, but G5 still waits for the G4 milestone and its read-only/audit boundary.

### Parallel Example: US2 test-first work

```text
Task T009: Write registry transaction/read-only/fault tests in tests/unit/authority-registry.test.ts and tests/integration/authority-registry.test.ts
Task T010: Write independent grant/path/capability/ceiling tests in tests/unit/authority-grants.test.ts
```

Run these only after G1; implement registry/grants only after the corresponding tests exist and fail for the intended missing behavior.

---

## Implementation Strategy

### Cumulative batch and stop gates

1. Complete Setup and G0. If actual physical identity, authenticated subject, outside-runtime human-admin provenance, common-dir binding, or full local durability cannot be proven, stop with HARD unavailable; do not substitute a fake or weaker provider.
2. Complete G1–G3 in order. Tests must show exact physical/work/subject binding; persistent human-created grant; immutable scope/ceilings and independent capabilities; read-only inspection; durable revocation; and governed-agent create/expand/revoke blocking despite generic host allow/always.
3. Complete G4 and validate the first usable milestone on exactly one named supported filesystem/runtime. Demonstrate restart/revocation and exactly-once internal one-shot consumption with durable evidence. Do not run effectful managed START/AMEND/CLOSE or produce lifecycle ALLOW.
4. Complete G5 only after the non-consuming adapter, trusted local context, hook read-only invariant, and out-of-hook audit route are all proven. Absent reference preserves Phase A; present invalid reference blocks; valid reference preserves Phase A unchanged.
5. Complete G6 on each claimed platform and run all package/regression gates plus independent review. Passing one filesystem never implies support for another. No release/publication is in these tasks.

### Future validation commands (not run while writing tasks)

```powershell
npm run compile
node --test dist/tests/unit/authority-identity.test.js dist/tests/unit/authority-context.test.js dist/tests/unit/authority-grants.test.js dist/tests/unit/authority-registry.test.js
node --test dist/tests/integration/authority-registry.test.js dist/tests/integration/authority-transport.test.js dist/tests/integration/cli/authority.test.js
node --test dist/tests/acceptance/authority-platform-matrix.test.js
npm run test:phase-a
node --test dist/tests/integration/package-contents.test.js dist/tests/integration/opencode-plugin-runtime-hook.spec.js
npm test
npm run typecheck
npm run compile
git diff --check
```

Run platform tests on the actual target OS/filesystem and package/runtime tests on the installed artifact, not only a workspace-linked module. This task-generation session runs no project tests and claims no implementation or platform result.

---

## Security Invariant & Acceptance Traceability

Every SPEC-015 functional requirement, security acceptance scenario, measurable success criterion, and plan test-matrix/gate area maps to at least one task. The mapped IDs are implementation obligations, not evidence that any check has passed.

### Functional requirements

| Requirement / invariant | Task IDs |
|---|---|
| FR-001 user-local canonical registry, opaque repo-local reference, physical anchor; reference alone is not authority | T003–T007, T009, T011 |
| FR-002 common-dir shared domain, exact work/subject, stable content changes, verified move only, no clone/copy/cross-machine or descriptive fallback | T003–T008, T024 |
| FR-003 every canonical grant binds repo/authority/work/subject/op/capability/path/ceiling/independent flags/validity/freshness/provenance/lifecycle | T010, T012, T018 |
| FR-004 only ChangeBudget-owned human admin creates authority; prompts, host permissions, agent, env, repo refs, audit never mint/widen | T003–T005, T012–T016, T027 |
| FR-005 provider-neutral create/list/inspect/revoke, read-only inspection, governed agent cannot administer | T004, T012–T017 |
| FR-006 exact repository/work/subject/op/capability/path/ceiling checks, narrower values preserved, no implicit new-file or independent permission | T010, T012, T018 |
| FR-007 reusable vs one-shot, at-most-one concurrent successful use, durable use evidence, expiry/revocation/consumption across restart | T018–T020 |
| FR-008 malformed/expired/revoked/stale/replayed/cross-bound/over-ceiling/out-of-scope state fails closed, never permissive fallback | T003, T009–T012, T018–T023 |
| FR-009 durable registry/grant/revocation/replay/audit, crash/fault behavior, no success without evidence, audit is not authority | T003–T005, T009, T011, T018–T020, T027 |
| FR-010 structured V2 carries only existing reference and bounded context; transport cannot mint/expand/revoke/rebind | T021–T023 |
| FR-011 absent reference preserves owning Phase A ASK/BLOCK, present invalid blocks, generic allow cannot bypass, no managed lifecycle ALLOW | T004, T015–T016, T021–T023 |
| FR-012 deterministic provider-neutral local policy, reuse local primitives, no remote service/cloud registry/new dependency/1.x behavior change | T001–T005, T009–T012, T021–T027 |

### User-story acceptance scenarios

| Scenario | Task IDs |
|---|---|
| US1-1 linked worktrees share repository domain but not work/subject grants | T006–T008, T024 |
| US1-2 content changes retain verified common-dir identity without rebind | T006–T008 |
| US1-3 verified same-filesystem move only; unavailable/unreliable identity fails closed, never descriptive fallback | T003–T008, T024 |
| US1-4 clone/full copy/cross-machine/same-path replacement does not inherit authority despite matching path/remote | T006–T008, T024 |
| US2-1 human-created grant inspection shows exact repository/work/subject/authority/scope/ceiling/freshness/provenance | T010, T012–T014, T017 |
| US2-2 exact and narrower requests remain within grant; narrower value is not widened | T010, T012, T018 |
| US2-3 existing path does not imply new files; dependency/migration/config/public API flags independent | T010, T012, T018 |
| US2-4 reusable within validity; consumed one-shot rejects replay | T018–T020 |
| US2-5 concurrent one-shot has at most one successful use with durable consume and success evidence | T018–T020 |
| US2-6 create/revoke/consume/audit persistence failure fails closed, uncommitted and not reported successful | T009, T011, T018–T020 |
| US2-7 read-only inspection has no authority side effect; governed agent mutation is blocked regardless of host allow/always | T004, T009, T013–T017 |
| US3-1 malformed/expired/revoked/stale/consumed/cross-bound authority rejects without prompt or weaker fallback | T018–T020 |
| US3-2 ceiling, path, sibling/prefix, and missing-capability violations reject with boundary reason | T010, T012, T018 |
| US3-3 malformed/unavailable persistence fails closed; valid reusable and consumed state survive restart | T009, T011, T018–T020 |
| US3-4 race/restart gives at most one use and exactly one durable consumption/evidence pair | T018–T020 |
| US3-5 required audit/replay persistence failure prevents commit/success | T009, T011, T018–T020 |
| US3-6 pre-durable crash is not success; post-consumption crash stays consumed; uncertain state fails closed | T018–T020 |
| US3-7 evidence records outcomes but never creates, expands, or satisfies authority | T009, T011, T018–T020 |
| US4-1 V2 context verifies exact local repository/work/subject/scope/freshness binding | T021–T023 |
| US4-2 absent reference retains owning ASK/BLOCK; absence never upgrades to ALLOW | T021–T023 |
| US4-3 present malformed/unknown/stale/revoked/replayed/mismatched reference blocks, never treated as absent | T021–T023 |
| US4-4 valid verification alone cannot authorize managed START/AMEND/CLOSE ALLOW | T020–T023, T027 |

### Success criteria and plan acceptance gates

| Criterion / plan matrix area | Task IDs |
|---|---|
| SC-001 physical identity matrix is repeatable, including worktree, move, copy, replacement, equal path/remote, and unreliable IDs | T003–T008, T024 |
| SC-002 all exact-boundary requests accepted only within grant; all mismatch/stale/revoked/malformed/expired/replay cases rejected | T010, T012, T018–T020 |
| SC-003 restart preserves reusable/revoked/consumed state and malformed/unavailable state never grants | T009, T011, T018–T020 |
| SC-004 absent/present-invalid transport distinction, no generic allow bypass, zero lifecycle ALLOW | T021–T023 |
| SC-005 provisional list/inspect/create-inspect-revoke timing measured only as future usability evidence, never claimed as baseline | T012–T014, T017, T027 |
| SC-006 independent review finds no authority path from prompt/host permission/agent/repo ref/transport/audit | T003–T005, T013–T016, T021–T023, T027 |
| SC-007 concurrent one-shot has one maximum accepted outcome with prior durable evidence | T018–T020 |
| SC-008 injected audit/consumption persistence failures and crash/restart never report unevidenced success or revive consumption | T009, T011, T018–T020 |
| Plan physical identity and work/subject/admin provenance matrix | T003–T008, T013–T016, T024 |
| Plan strict grant schema/path/capability/ceiling/freshness/lifecycle matrix | T009–T012, T018 |
| Plan registry lock/fsync/replace/directory-sync/readback/audit/crash matrix | T003–T005, T009, T011, T018–T020 |
| Plan multi-process one-shot concurrency/restart matrix | T018–T020 |
| Plan V2 absent/invalid/valid-effect/deny/generic-allow/hook-read-only matrix | T015–T016, T021–T023 |
| Plan Windows/POSIX/OneDrive stop gates and per-filesystem proof | T003–T005, T024 |
| Plan trusted-subject and outside-runtime human-admin provider stop gates | T003–T005, T013–T017, T027 |
| Plan out-of-hook ChangeBudget audit route and read-only-hook compatibility stop gate | T021–T023, T027 |
| Plan platform path/symlink/case and current revision/digest freshness stop gate | T010, T012, T018, T021–T024 |
| Plan MUST_FIX risks: physical-ID reuse/copy/replacement; one-shot races/crashes; host allow or executable/metadata proving authority; durability/audit failure; missing out-of-hook audit | T003–T005, T013–T016, T018–T023, T027 |
| Plan Phase A regression, full suite, typecheck, compile, package/runtime loading, diff check, independent review | T001, T025–T027 |

---

## Notes

- Story tasks are cumulative and must retain exact `[US1]`–`[US4]` labels; Setup, Foundational, and Polish tasks intentionally have no story label.
- `[P]` means independent files and no unmet prerequisites; only the two disjoint US2 test tasks are parallelized.
- Future commands are implementation acceptance instructions. No command here authorizes implementation, test execution, Git commit/push, hook execution, release, or publication during task generation.
- Tests must prove fail-closed outcomes at the actual boundary; an interface, mock, CLI executable identity, successful rename, workspace-linked plugin, or audit log alone is not proof of human authority, physical identity, durability, transport acceptance, or downstream operation success.
