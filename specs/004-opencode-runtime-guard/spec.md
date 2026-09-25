# Feature Specification: OpenCode V2 Runtime Guard

**Feature Branch**: `004-opencode-runtime-guard`

**Created**: 2026-08-16

**Status**: Draft — **READY_FOR_TASKS (planning only; implementation validation pending)**

**Input**: User description: "Create the next ChangeBudget specification: SPEC-004 — native OpenCode V2 Runtime Guard"

## Clarifications

### Session 2026-08-16

- Q: How should SPEC-004 represent policy results versus runtime control? → A: Use `policyDecision` for ChangeBudget (`PASS`, `REPAIR`, `HUMAN_REVIEW`) and `runtimeAction` for OpenCode (`allow`, `ask`, `block`) as a deterministic projection of policy and operation context.
- Q: Can an OpenCode `ask` establish canonical ChangeBudget authority or persist contract changes? → Historical A (2026-08-16): a one-shot host approval applied to one operation only. Current Guardian V2 decision: OpenCode `ask` is operational permission only; it is never native ChangeBudget approval, canonical HARD authority, or a grant create/expand event.
- Q: Can one mutation proceed when repository is already `REPAIR`? → Historical A (2026-08-16; superseded for Guardian V2): No. `REPAIR` state defaulted to safe fail-stop for all mutating actions by OpenCode. Current product direction permits continuation when the concrete operation is within valid authority.
- Q: Is persistent audit logging required for this spec? → Historical A (2026-08-16): no audit requirement for enforcement. **Superseded for Guardian V2 MVP** by the 2026-09-24 requirement for retained, structured evidence of autonomous authority-consuming operations. This does not prescribe an audit store or make plugin permission-hook side effects responsible for persistence.
- Q: Can SPEC-004 introduce stack-specific policy packs or deep shell behavior prediction? → A: No. SPEC-004 only uses existing generic contract controls and explicit shell/path-safety limits.

> **Historical-rule notice (2026-09-24):** Earlier blanket `REPAIR` blocking, one-ask-per-recognized-CLI-operation, and universal out-of-scope/sensitive-category asks are superseded as Guardian runtime rules. The original 2026-08-16 clarifications remain historical context unless expressly reaffirmed below. Product direction is READY_FOR_TASKS for planning only; current runtime behavior is not thereby approved or certified.

### Session 2026-09-24 (initial same-day approval; superseded by the Guardian V2 resolution below where more specific)

- Q: Should every `.changebudget/**` mutation be denied, including ChangeBudget CLI lifecycle commands? → A: Direct `.changebudget/**` writes remain blocked in every repository state. Only a recognized ChangeBudget CLI invocation is eligible for lifecycle handling; the prior rule that every recognized mutation necessarily receives a one-operation `ask` is **OBSOLETE - REQUIRES REVISION**. Force execution through the agent path requires separate verified fresh native ChangeBudget authorization and blocks without it; host `ask` is not that authorization.
- Q: What happens before initialization? → A: Ordinary passive operations retain FR-004's no-op/allow behavior, except direct `.changebudget/**` mutations remain blocked and unknown, malformed, unsafe, or unrecognized wrapped ChangeBudget invocations fail closed. The initial same-day instruction not to infer recognized CLI lifecycle effects was provisional; the later Guardian V2 section resolves product conditions for the listed lifecycle cases without defining a new runtime schema.
- This clarification records present product direction, not retrospective approval of earlier implementation or releases. The prior per-operation CLI ask mapping and blanket `REPAIR`/`HUMAN_REVIEW` mutation blocks are **OBSOLETE - REQUIRES REVISION**; this does not redefine SPEC-002/003 policy decisions. SPEC-004 is READY_FOR_TASKS for planning only; implementation and validation evidence remain pending.

### Guardian V2 product direction (2026-09-24; normative)

**Outcome and delta.** A direct, explicit human premise authorizes pursuing its exact requested outcome (for example, Docker + Redis Cluster + three instances). Never substitute a smaller outcome to reduce implementation footprint. Do not add optional tests, refactors, or infrastructure not needed for that outcome. Minimize implementation and authority expansion, never the requested outcome. Human prose conveys intent but is not unlimited structured authority.

**Soft estimates and hard authority.** Planner/agent `expected_files` and `expected_changed_lines` are soft drift estimates; exceeding an estimate alone is not an ASK or BLOCK and must not silently constrain the outcome. `max_files` and `max_changed_lines` are HARD ceilings only when supported by qualifying human/policy provenance. A hard-ceiling overage requires new authority. SPEC-002 FR-009/FR-010/FR-021 and SPEC-003 FR-002/FR-003/FR-004/FR-007 preserve owner semantics and deterministic legacy classification: exact authorized ceiling is HARD, a verifiable unadopted recommendation is SOFT, and unknown/ambiguous provenance is UNRESOLVED and HUMAN_REVIEW when material. No schema migration or inferred retroactive grant is introduced.

**Canonical authority and native approval.** Keep separate (a) exact human intent, (b) a ChangeBudget-canonical structured grant, and (c) the verified native ChangeBudget authorization event establishing or changing that grant. The selected model is **CHANGEBUDGET_NATIVE_APPROVAL_REQUIRED**. A ChangeBudget administrative action that creates, expands, revokes, or rebinds canonical authority, when invoked by an agent through the guarded Runtime Guard path, MUST BLOCK regardless of saved OpenCode `always`/allow rules. An agent may prepare only a minimum concrete proposal and user-facing instructions; a human executes the ChangeBudget-owned administrative action outside governed agent execution. A new material HARD authority proposal therefore BLOCKS the governed operation pending that separate native action. The proposal/request is user-facing communication, not runtime `ask`.

An OpenCode `ask`/`once`/`always` remains operational permission only. It never creates or expands a canonical grant, establishes HARD authority, or acts as a native ChangeBudget authorization event. Ordinary OpenCode ASK may still apply to normal host operations; it must not be conflated with ChangeBudget administration or new HARD authority. The orchestrator may consume/reference a canonical grant but MUST NOT issue one; only the orchestrator receives its canonical identifier/reference, while agents receive exact bounded work instructions. A grant binds exact paths, capabilities, ceilings, repository/work, authority/schema version, provenance, and lifecycle. EvoSpec/other transport may carry/reference prior authority but cannot issue or expand it.

Native grant administration retains ChangeBudget-owned lifecycle audit evidence. This rule governs canonical Guardian grant administration and does not alter SPEC-002/003 check-level classification of numeric ceilings using trusted exact policy provenance; such classification alone does not let an agent administer a canonical grant.

**Local repository binding.** Repository authority uses a user-owned registry outside the repository, a repo-local public reference, and a physical ChangeBudget anchor associated with the Git common directory. The registry is user-local, not a cloud/global grant database; the repo-local reference is public and is not authority by itself. Linked worktrees sharing one common directory share a local repository authority domain, but grants remain work-bound.

HARD binding fails closed when genuine physical identity is unavailable or unreliable; routine operations not relying on HARD authority may continue. Do not fall back to a path, remote, or copied UUID. An unchanged common-directory instance is the same repository instance despite changed working contents; Git baseline/contract rules govern content. A same-path replacement is a new instance only when the Git common-directory instance changes. Moves preserve HARD authority only with verified physical identity. Clones, full copies, and cross-machine transfers do not inherit HARD authority. Rebind is an explicit human ChangeBudget administrative action, audited with old/new binding, and never silently migrates grants.

The threat boundary excludes a malicious unrestricted same-user OS actor able to tamper with the external registry, repository, physical anchor, or admin path. No cryptographic federation or OS sandbox is claimed. Physical-ID availability/reliability, file-ID reuse, common-dir association, linked-worktree, move/copy, POSIX/Windows, and OneDrive behavior are implementation validation; no new identity proof is claimed.

**Workflow order.** Preserve the exact premise; CONTINUE within current authority; use the mechanically implied minimum concrete delta; use the minimum delta already covered by a valid grant; REFOCUS independently verified optional/oversized approaches before escalation; then present a minimum proposal for new material HARD authority and BLOCK pending separate native action. Invalid, stale, unknown, unsafe, denied, or protected work BLOCKS. A `REPAIR` result is not a blanket stop. `HUMAN_REVIEW` is a check result, not authority. A host ASK is never a substitute for canonical authority. Force execution in the agent path without separate verified fresh native authorization MUST BLOCK; host `ask`/`once` and saved `always` are not that authorization.

The principles remain: “Reject the oversized solution, not the task.” “Refocus before escalation.” “Minimize implementation expansion, never the user's requested outcome.” ChangeBudget does not ask for repeated consent to authority already granted. Minimality measures authority delta, not architectural necessity.

**Policy-result interpretation.** `REPAIR` alone neither grants authority nor stops work: repair within current authority may CONTINUE; a minimum covered concrete delta may proceed; optional work REFOCUSES; new material HARD authority is proposed and BLOCKED pending native action; invalid/unsafe work BLOCKS. `HUMAN_REVIEW` reasons distinguish optional expansion, unresolved check evidence, and invalid/unsafe authority, without turning the check result into runtime authorization. Preserve SPEC-002/003 decisions and fatal prerequisite semantics.

**Lifecycle and routine autonomy.** Routine autonomy covers clean first-time `init` in an eligible repository with no conflicting state or protected/pre-existing overwrite and with a direct setup request or verified parent premise; narrow `start` covered by premise/grant; localized edits to the requested task surface, relevant tests, and mechanical changes; within-authority repair; minimum covered `amend`; and normal `close` after `PASS` and required completion. It never silently authorizes protected/unrequested paths, dependencies, migrations, configuration, public API, force, unrelated roots, or administration. A raw CLI invocation alone is not authorization. Direct `.changebudget/**` writes BLOCK in every state. `integrate opencode --dry-run`, `update --check`, and a proven-owned wrapper refresh may be autonomous; real integration and package update require explicit user request. Force execution in the agent path without separate verified fresh native authorization BLOCKS; even valid force authorization is limited to that exact operation and never authorizes direct protected writes.

**Audit MVP.** ChangeBudget-owned lifecycle handling retains structured evidence for every autonomous authority-consuming operation and every native grant administration action (create/expand/revoke/rebind): requested operation, current authority/grant/premise and provenance, exact paths/capabilities/ceilings, work/repository/version/lifecycle, minimum delta, subset/boundary checks, rationale, old/new binding for rebind, and outcome. This supersedes the earlier no-audit clarification. The local registry is not a cloud/global grant store. Permission-hook evaluation MUST NOT persist evidence. Audit-write failure prevents the authority-consuming or administrative operation from committing. This requirement does not claim current code records evidence.

**MVP scope and deferrals.** MVP includes provenance, covered START/AMEND/REPAIR/CLOSE, REFOCUS, canonical grants with native administration, local registry/reference/physical-anchor binding, replay/staleness/rebind audit, and structured lifecycle evidence. Defer cloud/distributed authorization, arbitrary third-party issuers, organization grants, cryptographic federation, OS sandboxing, and LLM compliance judgments as enforcement authority.

**Runtime boundary.** Direct `.changebudget/**` file/edit/shell/Git writes BLOCK in every state. REFOCUS is not a command, exit code, runtime action, enum, state, public API, field, or schema. Existing runtime source/tests are historical behavior evidence only; product decisions are not claimed implemented. OpenCode operational `ask` does not authorize canonical ChangeBudget administration or new HARD authority.

**Owner-spec alignment.** SPEC-002 FR-009/FR-010/FR-021 and SPEC-003 FR-002/FR-003/FR-004/FR-007 remain authoritative for numeric provenance and check outcomes. SPEC-002 FR-011/FR-012 retain allow-list and hard-deny semantics; path mismatch alone is not a universal ASK and no denied/protected path is authorized. Check-level HUMAN_REVIEW for material unresolved provenance remains distinct from runtime BLOCK when an operation relies on that unresolved authority. Existing contracts remain readable without migration; no new owner-spec field or reason code is claimed.

**Planning status.** Product decisions are finalized and this feature is **READY_FOR_TASKS — planning only**. This is not an implementation baseline or evidence of runtime conformance. Remaining work is implementation design/validation: projection without a new public API/schema; native admin interception; local physical identity and filesystem behavior; lifecycle/audit persistence; supported integration-unavailable feedback; and installed-host interception. POSIX/Windows file-ID reuse/OneDrive, multi-target, out-of-repository, and historical beta.7 cases are implementation validation, not planning blockers. Beta.7 is **SEPARATE_RUNTIME_INVESTIGATION**. No host ASK trace, once/reject experiment, physical identity proof, or runtime hook conformance is required for task generation or claimed here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stop forbidden writes before they land *(Priority: P1)*

As a developer, when an OpenCode session attempts to write a file that the active contract explicitly denies, I need the attempt to be prevented before the file is changed.

**Why this priority**: This is the core value of SPEC-004 and the primary reason for adding runtime guardrails.

**Independent Test**: In a repository with an active contract and a denied file under `deny_paths`, trigger a write-like tool action from OpenCode and verify it is blocked before the write is applied.

**Acceptance Scenarios**:

1. **Given** a contract with `deny_paths: ["config/**", "secrets/**"]`, **When** OpenCode attempts to modify `config/ci.yml`, **Then** the guard blocks the action before persistence and shows the matching rule, observed path, and recovery hint.
2. **Given** the same contract, **When** OpenCode attempts to modify `src/app.ts`, **Then** the action is not blocked when no deny rule or active blocking sensitivity applies.

---

### User Story 2 - Preserve the requested outcome within authority *(Priority: P1)*

As a developer, I want the agent to preserve my explicit requested outcome, use only the minimum necessary implementation delta, and seek new authority only when the work truly requires it.

**Why this priority**: It adds control without over-blocking and keeps workflow fast for normal in-scope work.

**Independent Test**: In a disposable repository, compare an operation already covered by the developer's requested outcome and human-granted authority with optional work and genuine new-authority work; verify the workflow direction does not substitute a smaller outcome for the authorized request.

**Acceptance Scenarios**:

1. **Given** a task whose explicit outcome is larger than a soft file/line estimate, **When** the proposed solution satisfies that outcome without adding optional work, **Then** the estimate warns about drift but does not alone cause the agent to replace or reduce the requested outcome.
2. **Given** an optional or unnecessary expansion, **When** the work is not needed for the requested outcome, **Then** the workflow refocuses on the original task without asking the developer to authorize the optional work.
3. **Given** current hard authority covers 18 files while a hard ceiling is 60 and one more file is the minimum delta, **When** a new grant is requested, **Then** the proposed authority change is 18→19, not 18→60; minimality is the authority delta, not an architectural-necessity proof.
4. **Given** a valid exact-path grant covers `src/foo.ts`, **When** an amendment is needed, **Then** the grant does not widen to `src/**` without need.
5. **Given** genuinely new material HARD authority is necessary, **When** no valid prior grant covers it, **Then** present only the minimum user-facing proposal and BLOCK the guarded operation pending the separate native ChangeBudget action; do not use runtime `ask` as authority.

---

### User Story 3 - Protect sensitive categories with transparent policy behavior *(Priority: P1)*

As a developer, I want guard behavior for dependency/config/migration/API-sensitive changes to be predictable and understandable so scope-sensitive edits remain explicit decisions, not hidden side effects.

**Why this priority**: Scope creep often happens in these categories even when paths look innocuous.

**Independent Test**: Configure a contract with default-sensitive flags and attempt targeted edits to dependency/config-related files; verify the action decision is shown and policy is consistently mapped before write.

**Acceptance Scenarios**:

1. **Given** a sensitive-category change is minimally necessary for the explicit requested outcome and already within human-granted authority, **When** the workflow evaluates it, **Then** the category label alone does not force an unnecessary scope reduction or a new authorization request.
2. **Given** a sensitive-category change would add new HARD authority, **When** the workflow evaluates it, **Then** it follows the minimum-proposal-and-BLOCK rule pending a separate native ChangeBudget action; exact operational permission projection is implementation planning.
3. **Given** an explicitly requested sensitive category, **When** no novel authority is added, **Then** there is no redundant ask solely because of the category; protected-path and force-operation gates still apply.

---

### User Story 4 - Use bounded lifecycle authority and auditable autonomy *(Priority: P1)*

As a developer, I want lifecycle operations to use only verified, task-bound authority, with a narrow proposed delta and retained evidence when ChangeBudget proceeds autonomously.

**Acceptance Scenarios**:

1. **Given** an eligible repository with no conflicting ChangeBudget state or protected/pre-existing overwrite conflict, **When** a clean first-time CLI `init` is recognized, **Then** it may initialize autonomously; an ordinary direct write to `.changebudget/**` remains blocked in every state.
2. **Given** a valid bounded grant, **When** recognized lifecycle work proceeds through START→AMEND→REPAIR→CLOSE, **Then** its valid grant reference may be reused within that lifecycle but cannot authorize unrelated work after successful CLOSE.
3. **Given** authority is malformed, forged, cross-repository, cross-task, revoked, expired, reported consumed when presented, or stale, **When** it is evaluated, **Then** the operation blocks rather than asking again as if authority were absent; reuse between stages of the one active bounded lifecycle is not treated as consumed replay.
4. **Given** an autonomous authority-consuming operation, **When** it proceeds, **Then** ChangeBudget retains structured evidence of the requested operation, current authority and coverage, minimum delta, boundary checks, no-prompt rationale, and any REFOCUS/ASK/BLOCK decision and reason.
5. **Given** an agent invokes ChangeBudget administration through the guarded Runtime Guard path to create, expand, revoke, or rebind canonical authority, **When** OpenCode has a saved `always` or allow rule, **Then** the operation still BLOCKS; an agent may present a minimum proposal, but only a human executes the native ChangeBudget administrative action outside governed agent execution.
6. **Given** a force operation is attempted in the agent path without separate verified fresh native authorization, **When** the host would otherwise permit it through `ask`/`once`/`always`, **Then** Guardian BLOCKS it because host permission is not native ChangeBudget authorization.

---

### User Story 5 - Respect integration and package-update intent *(Priority: P2)*

As a developer, I want read-only checks and already-owned wrapper refreshes to be autonomous while real setup or package changes require an explicit request.

**Acceptance Scenarios**:

1. **Given** recognized `changebudget integrate opencode --dry-run` or `changebudget update --check`, **When** invoked, **Then** the read-only operation is eligible for autonomous handling.
2. **Given** a proven-owned wrapper refresh, **When** it is recognized, **Then** it is eligible for autonomous handling; first real integration needs an explicit human setup/integration request.
3. **Given** a real package update, **When** it was not explicitly requested by the user, **Then** it is not performed as background coding; it requires an explicit user update request.

---

### User Story 6 - Keep the core CLI independent and report runtime-guard availability honestly *(Priority: P2)*

A developer should keep using the core CLI and local contracts even when OpenCode integration is missing, disabled, or failing.

**Why this priority**: SPEC-003 and earlier milestones should not become dependent on optional runtime wiring.

**Independent Test**: Compare plugin absence or setup/registration failure with a registered permission hook whose evaluation fails. Confirm the core CLI remains unchanged in all cases, and that only an invoked registered hook can deny the intercepted mutation.

**Acceptance Scenarios**:

1. **Given** the optional plugin is absent or disabled, **When** a developer runs core ChangeBudget commands, **Then** they behave exactly as current core behavior and SPEC-004 does not claim that OpenCode mutations are intercepted.
2. **Given** plugin setup or permission-hook registration fails before the permission hook is registered, **When** OpenCode loads, **Then** the integration is surfaced as unavailable through supported host/integration feedback and MUST NOT claim that mutations are blocked; those mutations may not be intercepted. The concrete feedback mechanism is implementation planning/validation, not a new API requirement. Core ChangeBudget CLI behavior stays unchanged.
3. **Given** the permission hook is registered and invoked for a potentially mutating operation, **When** that hook's evaluation fails, **Then** the hook returns a blocking/deny effect for that intercepted operation through the supported permission path. This does not claim coverage for operations that were never intercepted.

### Policy Decision vs OpenCode Runtime Action

- **policyDecision**: The deterministic result from existing ChangeBudget evaluation using SPEC-002/003 semantics (`PASS`, `REPAIR`, `HUMAN_REVIEW`).
- **runtimeAction**: The OpenCode-specific enforcement action emitted by the plugin for a single intercepted operation (`allow`, `ask`, `block`).

### Product decision direction and runtime mapping status

The conceptual workflow directions above are authoritative product intent. The exact projection of existing inputs to `runtimeAction` remains implementation planning, but it must obey those directions. `allow`, `ask`, and `block` remain the existing runtime vocabulary; no `REFOCUS` runtime action or replacement schema is introduced.

The previous deterministic mapping is **OBSOLETE — REQUIRES REVISION** where it required every ordinary `REPAIR`/`HUMAN_REVIEW` mutation to block, every out-of-scope or disallowed-sensitive operation to ask, or every recognized CLI mutation to receive an ask. These are not current binding Guardian V2 requirements. Direct `.changebudget/**` protection in every lifecycle state and fail-closed handling of invalid, protected, forced-without-fresh-approval, forged, or unknown operations remain product requirements. Preserve restrictive incoming effects and existing execution-gate decisions; mapping those existing inputs to the product sequence is implementation planning, not permission to weaken them.

The #36 scanner forms (`git ls-files`, `git check-ignore`, and supported `git status` pathspec/split-resource forms) and restrictive sibling-resource handling are historical source/test evidence for only those supported forms, not proof of universal Git parsing or Guardian V2 conformance. Unknown or mutating sibling resources must not inherit a read-only classification.

The remaining work is implementation design/validation, recorded in `plan.md`, `research.md`, and the implementation backlog: projection consistent with owner semantics; audit-evidence placement without new public API/schema; supported integration-unavailable feedback; physical identity/filesystem behavior; and installed-host interception. The historical beta.7 observation is SEPARATE_RUNTIME_INVESTIGATION, not a planning gate. These are not unresolved alternatives to product decisions. Reviewer-owned conformance evidence is separate from planning readiness; this status does not self-certify runtime behavior.

### Ask Semantics

- OpenCode `ask` is operational permission for one pending host operation only; it does not create/expand a ChangeBudget grant, establish HARD authority, or count as native ChangeBudget approval.
- A host response does not persistently update contract state, budgets, allowed paths, or ChangeBudget authorization evidence. Saved `always` is also not canonical authority.
- New material HARD authority is handled by a minimum user-facing proposal and BLOCK pending a separate human ChangeBudget-native action; this proposal is not a runtime `ask`.
- Force execution in the agent path without separate verified fresh native authorization BLOCKS; a host `ask`/`once` response is not that authorization.
- Ordinary operational ask behavior, if selected by normal host permission rules, is distinct from ChangeBudget administrative authority and is not a live probe required for task generation.

### Edge Cases

- What is reported when a write action has no explicit file path (bulk edits or non-file tool operations)?
- How is a rename/delete operation mapped: as one protected write event, two events, or a special event?
- How is a denied write handled if path matching uses symlinks or case-only path differences?
- What is the decision when the contract is active but missing/malformed in the workspace?
- How should ordinary operational host `ask` prompts for repeated attempts be handled? This does not affect ChangeBudget-native grant authority or task-generation readiness.
- Can the plugin intercept all write-like actions exposed by OpenCode, and how are unsupported actions represented to the user?
- How does the implementation consume canonical grant references and verified human authorization evidence while preserving repository/task/version/lifecycle binding?
- Which existing lifecycle gate exposes the no-prompt audit evidence without adding plugin-hook side effects or a new store contract?
- Does the installed host classify the same ChangeBudget read-only command consistently across launch modes? The beta.7 discrepancy is SEPARATE_RUNTIME_INVESTIGATION; root cause is unknown and caching is not an established explanation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The feature MUST add a minimal, optional native OpenCode V2 plugin package using `@opencode/plugin@2.0.12`, without changing core CLI behavior.
- **FR-002**: The plugin MUST resolve the active ChangeBudget contract from the current workspace and use it as the policy source during interceptable write operations.
- **FR-003**: The plugin MUST evaluate each relevant V2 permission request before persistence through `ctx.permission.hook('evaluate', ...)`.
- **FR-004**: The plugin MUST treat a repository without active ChangeBudget context as no-op/allow for ordinary OpenCode operations, subject to FR-010 direct-state protection, the recognized CLI command rules in FR-021–FR-022, and fail-closed classification of unsupported or unsafe operations.
- **FR-005 [OBSOLETE — REQUIRES REVISION; NOT BINDING]**: Historical rule: if `policyDecision` is `REPAIR` and an ordinary intercepted operation is mutating, return `runtimeAction = block`. A `REPAIR` result alone is not a stop rule; repair within current authority may continue, using the minimum covered delta.
- **FR-006 [OBSOLETE — REQUIRES REVISION; NOT BINDING]**: Historical rule: block all mutating `HUMAN_REVIEW` operations except deterministic read-only operations. `HUMAN_REVIEW` is not authority. Current disposition: optional expansion→REFOCUS; new material HARD authority→minimum proposal plus BLOCK pending native ChangeBudget action; invalid/unsafe authorization or state→BLOCK.
- **FR-007**: In initialized repositories, if an operation touches a path that matches `deny_paths`, the plugin MUST return `runtimeAction = block` before persistence.
- **FR-008 [OBSOLETE — REQUIRES REVISION; NOT BINDING]**: Historical rule: every operation outside `allow_paths` asks. A path mismatch alone does not require repeated consent; evaluate current human premise and valid structured grant, preserve owner-spec path semantics, and for genuinely new material HARD path authority present a minimum proposal and BLOCK pending native ChangeBudget action. Denied/protected paths remain gated.
- **FR-009 [OBSOLETE — REQUIRES REVISION; NOT BINDING]**: Historical rule: every disabled sensitive category asks. A sensitive label alone does not require redundant consent where the exact category is explicitly requested and no new authority is added. Novel expansion is authority-evaluated; protected and force gates remain separate.
- **FR-010**: Any direct OpenCode mutation against `.changebudget/**` (including active contract and state files) MUST return `runtimeAction = block` in every repository state, including before initialization and with no active contract. Recognized ChangeBudget CLI lifecycle operations are governed separately by FR-021 and are not direct file edits.
- **FR-011**: For every intercepted operation that can be deterministically classified, the plugin MUST return exactly one runtimeAction (`allow`, `ask`, `block`) and include a stable machine-readable rule identifier; multiple resources MUST aggregate restrictively.
- **FR-012**: Where ordinary OpenCode operational permission selects `ask`, the outcome MUST include relevant operation context (path where applicable, or recognized operation class when no file target exists), applicable policy rationale, active contract id when present, and a one-line recommendation. A user-facing proposal for new ChangeBudget authority is not an `ask` outcome.
- **FR-013**: An OpenCode `ask` response is operational permission only. It does not persist as a ChangeBudget contract expansion, budget increase, canonical grant, or native ChangeBudget approval. A saved OpenCode `always` rule may affect ordinary host permission behavior but never changes ChangeBudget authority or bypasses its evaluation.
- **FR-014**: Once the permission-evaluation hook is registered and invoked for a potentially mutating operation, an evaluation failure or unavailable/invalid runtime context (including internal evaluation failure, corrupt state, invalid base revision, or unreachable policy source) MUST produce a blocking/deny effect for that intercepted operation through the registered permission path. This requirement does not claim that a write is blocked when setup/registration failed and no hook can intercept it.
- **FR-015**: The plugin MAY be disabled per workspace or not installed without mutating contract state or changing ChangeBudget CLI behavior. Plugin absence means no runtime interception guarantee. If setup or hook registration fails and that failure is observable, the integration MUST be surfaced as unavailable through supported host/integration feedback and MUST NOT be represented as active protection. Selecting the concrete feedback mechanism is implementation planning/validation and does not add an API or schema here.
- **FR-016**: The plugin MUST preserve SPEC-003 policy decisions as source-of-truth and never redefine or replace `PASS`, `REPAIR`, `HUMAN_REVIEW` semantics.
- **FR-017**: Permission-hook evaluation MUST NOT itself write ChangeBudget state, create grants, or persist audit records. ChangeBudget-owned lifecycle handling MUST retain the required structured evidence for each autonomous authority-consuming operation; its storage mechanism is not prescribed here. The feature adds no auto-repair or shell sandbox.
- **FR-018**: The plugin must not claim security guarantees (no sandbox, no anti-malware, no privilege control); it is a workflow guard only.
- **FR-019**: Runtime action decisions and messages must be deterministic for identical repository state, operation context, and contract snapshot.
- **FR-020**: The native plugin MUST register `session.context` and `permission.evaluate` only; no alternate plugin contract, compatibility adapter, or migration path is supported.
- **FR-021 [OBSOLETE AS TO ACTION — REQUIRES REVISION]**: The historical universal one-operation ask for every managed/external/force CLI mutation is **OBSOLETE — NOT BINDING**. Recognition still requires verified executable identity and complete supported grammar, and grants no authority by itself. Product rules: clean eligible first-time `init`; narrow covered `start`; minimum covered `amend`; within-authority repair; and normal `close` after PASS/required completion may be autonomous. New material HARD authority uses a minimum proposal and BLOCK pending separate native ChangeBudget action. Agent-path administration that creates, expands, revokes, or rebinds canonical authority MUST BLOCK regardless of host allow/always. Force execution in the agent path without separate verified fresh native authorization MUST BLOCK; host `ask`/`once`/`always` is not authorization. Read-only `integrate opencode --dry-run` and `update --check` and proven-owned wrapper refresh may be autonomous; real integration/update require explicit user request. Direct `.changebudget/**` writes remain blocked in all states. No final runtime mapping/API/schema is introduced here.
- **FR-022**: Unknown or malformed ChangeBudget commands, invalid satisfaction evidence, shell control operators around an attempted ChangeBudget invocation, and unrecognized wrappers for an attempted ChangeBudget invocation MUST fail closed and MUST NOT receive a managed-mutation ask, in every repository state. An absolute executable path may be trusted only after verifying it is a shim for the installed ChangeBudget package; matching a path/name string is not sufficient. The plugin MUST NOT claim universal Windows wrapper support.
- **FR-023**: The Git scanner MUST recognize only the supported read-only inspection forms established for this feature, including `git ls-files`, `git check-ignore`, and `git status` pathspecs with supported OpenCode split-resource variants. It MUST evaluate unrelated resources separately and fail closed for unknown or mutating resources rather than inheriting a read-only classification. Historical #36 source/test locations are not proof of all-host support.
- **FR-024**: The system MUST distinguish the exact human premise, a ChangeBudget-canonical structured grant, and the native ChangeBudget authorization event establishing or changing that grant. An orchestrator may consume/reference but MUST NOT issue a grant; only the orchestrator receives the canonical grant identifier/reference, while agents receive exact bounded work instructions. Grant evidence MUST bind exact paths, capabilities, numeric ceilings, repository/work, authority/schema version, provenance, and lifecycle. Agent-invoked ChangeBudget administration that creates, expands, revokes, or rebinds canonical authority through the guarded Runtime Guard path MUST BLOCK regardless of saved OpenCode `always`/allow rules. A human performs the ChangeBudget-owned administrative action outside governed agent execution; an agent may prepare only a minimum concrete proposal and user-facing instructions. A grant reported consumed is invalid when presented except permitted stage reuse in its one active bounded START→AMEND→REPAIR→CLOSE lifecycle; after successful close it MUST NOT replay for unrelated work. Malformed, forged, cross-repository/work, revoked, expired, or stale authority MUST BLOCK rather than trigger another ASK.
- **FR-025**: The system MUST preserve the ordered authority response: exact premise; continue within current authority; minimum mechanically implied concrete delta; minimum delta already covered by a valid grant; REFOCUS independently verified optional work before escalation; then, for genuinely new material HARD authority, present the minimum user-facing proposal and BLOCK the guarded operation pending a separate native ChangeBudget action. A user-facing proposal is not a runtime `ask`. Ordinary OpenCode `ask`/`once`/`always` is operational permission only and MUST NOT create/expand canonical authority or satisfy native approval. Force execution in the agent path without separate verified fresh native authorization MUST BLOCK; host ASK and saved rules are not that authorization. Invalid/unsafe/protected/unknown work MUST BLOCK. REFOCUS MUST reject an oversized solution rather than the task, precede escalation, and MUST NOT be represented as a new command, exit code, runtime action, enum, state, public API, or schema.
- **FR-026**: The system MUST distinguish advisory expected file/line estimates from hard `max_files`/`max_changed_lines` ceilings with provenance. Exceeding an estimate alone MUST NOT ASK or BLOCK. A hard ceiling is enforceable only with human/policy provenance; exceeding it requires new authority, for which the guarded agent operation presents a minimum proposal and BLOCKS pending separate native ChangeBudget action. SPEC-002/003 define owner semantics, including legacy unresolved provenance; implementation representation is planning work and this requirement adds no field/schema or final reason code.
- **FR-027**: Sensitive-category work explicitly requested by the human premise MUST NOT trigger redundant consent solely due to its category. Novel material HARD authority follows the minimum-proposal-and-BLOCK rule; direct protected paths and force operations remain separately gated.
- **FR-028**: For each autonomous authority-consuming operation and each native grant administration action (create/expand/revoke/rebind), ChangeBudget-owned lifecycle handling MUST retain structured evidence of the requested operation, current authority/provenance, grant/human-premise coverage, exact scope, work/repository/version/lifecycle, minimal delta, subset/boundary checks, rationale, old/new binding for rebind, and outcome. Audit-write failure MUST prevent the authority-consuming or administrative operation from committing. This is a product evidence requirement, not a claim of current implementation or a requirement to persist it from the plugin permission hook.

### Key Entities

- **Runtime Contract Snapshot**: Local policy context loaded by the plugin.
  - `contract_id`, `task_description`, `base_revision`
  - `allow_paths`, `deny_paths`
  - policy toggles for sensitive categories (`allow_new_dependencies`, `allow_migrations`, `allow_config_changes`, `allow_public_api_changes`)
  - computed `policyDecision`

- **Runtime Decision**: A per-operation outcome produced by the plugin.
  - `operation_id`
  - `operationClass` (read-only, ordinary mutation, recognized managed/external/force-close CLI mutation, unsupported, or unresolved)
  - `path` (or relevant target resource)
  - `policyDecision` (`PASS`, `REPAIR`, `HUMAN_REVIEW`)
  - `runtimeAction` (`allow`, `ask`, `block`)
  - `rule` (policy source identifier)
  - `reason_code` (stable code such as `OCG-DENY-PATH`, `OCG-OUT-SCOPE`, `OCG-SENSITIVE-FLAG`)
  - `message`
  - `contract_id`

- `runtimeOutput`: Human-readable decision text for the active session. It does not define the required ChangeBudget-owned structured lifecycle evidence or prescribe its storage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In at least **20 synthetic OpenCode write attempts**, every attempt resolves to exactly one `allow`/`ask`/`block` decision, and each decision output includes action rationale.
- **SC-002**: In a repo with an active contract, all path-deny operations are blocked before write completion in **100%** of repeatable scenarios.
- **SC-003 [OBSOLETE — REQUIRES REVISION]**: Historical measurable criterion required `ask` for every out-of-scope operation; it conflicts with within-authority work, optional work to REFOCUS, and genuine new authority.
- **SC-004**: Ordinary OpenCode permission responses do not establish canonical ChangeBudget authority. A host `once` is limited to its pending operation; a saved `always` rule may persist host permission behavior but MUST NOT bypass ChangeBudget evaluation. A live once/reject probe is not required for task generation.
- **SC-005 [OBSOLETE — REQUIRES REVISION]**: Historical measurable criterion required every ordinary mutation in `REPAIR` to block. A `REPAIR` result alone does not stop work; current-authority repair may continue.
- **SC-006**: In at least **20 mixed mutation scenarios** where the permission-evaluation hook is registered and invoked, evaluator failures or missing/corrupt contract state return fail-safe blocking results for potentially mutating operations in **100%** of runs. Setup/registration failure is an unavailable-integration condition, not evidence of blocked mutations.
- **SC-007**: Runtime decision text and actions for mutations do not depend on or create external network calls and remain deterministic.
- **SC-008**: Core command behavior defined in SPEC-001 to SPEC-003 is unchanged in at least **20 non-OpenCode invocations** while plugin integration is unavailable.
- **SC-009**: Direct mutations to `.changebudget/**` are blocked before persistence in every lifecycle state, including an uninitialized disposable repository.
- **SC-010 [OBSOLETE — REQUIRES REVISION]**: Historical measurable criterion required an ask for every recognized mutating CLI invocation. Recognized lifecycle actions instead follow FR-021 and their stated human-authority conditions; unknown/malformed or unsafe forms still fail closed.
- **SC-011**: In deterministic scenarios, each invalid/cross-boundary/stale grant blocks without prompting, while a valid bounded grant is accepted only for its bound repository/task and ordered lifecycle; successful close prevents unrelated replay.
- **SC-012**: Every autonomous authority-consuming operation and native grant administration action has retained structured evidence for all FR-028 elements; audit-write failure prevents claiming a conforming committed operation.
- **SC-013**: Agent-invoked ChangeBudget create/expand/revoke/rebind through the guarded Runtime Guard path is BLOCKED regardless of saved OpenCode `always`/allow; no ordinary host ASK can establish native approval or canonical HARD authority.

## Assumptions

- Existing contract path semantics from SPEC-002 apply to runtime decisions.
- OpenCode plugin interception is limited to operations it exposes; unexposed operations are out of scope for this feature.
- Local-only behavior is prioritized over remote or cloud evaluation.
- New material HARD authority is handled by a minimum user-facing proposal and BLOCK pending a separate native ChangeBudget action, not runtime `ask`. Ordinary OpenCode operational `ask` remains distinct; implementation may not substitute redundant consent.
- A non-invasive warning is acceptable when plugin integration capability is unavailable.
- OpenCode `ask` does not modify ChangeBudget contract/grant state. A host `always` rule may be saved for operational permission but is not ChangeBudget authority.
- Unsupported or unsafe operations must fail closed under the existing runtime boundary; this workflow-guard requirement is not a sandbox claim.

## Explicit Non-Goals

- Building a full security sandbox, OS-level isolation, or process-level confinement.
- Full semantic code analysis by language parser (for example, LLM/AST analysis beyond path + contract-rule context).
- Replacing SPEC-001 to SPEC-003 lifecycle and reporting behavior.
- Automatic repair, auto-revert, or forceful rollback from inside OpenCode.
- Enabling multi-agent enforcement in this spec; OpenCode is the first integration target.
- Enforcing policies for non-OpenCode workflows (Git commands, editors, shell tools) outside this runtime feature.
- Cloud/distributed authorization, arbitrary third-party grant issuers, organization-scoped grants, and cryptographic federation.
- Treating LLM compliance judgments as enforcement authority.
- A plugin-owned audit store or permission-hook persistence side effect. Structured evidence retention by ChangeBudget-owned lifecycle handling is in MVP scope; its storage design remains open.

## Compatibility Impact

- **Core CLI compatibility**: SPEC-003 and earlier command contracts remain unchanged when OpenCode is not used.
- **Workspace compatibility**: Active contracts remain readable and authoritative from existing files; no schema migration required.
- **Operational compatibility**: Plugin installation is optional and must not create mandatory runtime dependency on OpenCode.
