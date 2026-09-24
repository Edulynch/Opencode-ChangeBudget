# Feature Specification: OpenCode V2 Runtime Guard

**Feature Branch**: `004-opencode-runtime-guard`

**Created**: 2026-08-16

**Status**: Draft — READY_FOR_PLANNING

**Input**: User description: "Create the next ChangeBudget specification: SPEC-004 — native OpenCode V2 Runtime Guard"

## Clarifications

### Session 2026-08-16

- Q: How should SPEC-004 represent policy results versus runtime control? → A: Use `policyDecision` for ChangeBudget (`PASS`, `REPAIR`, `HUMAN_REVIEW`) and `runtimeAction` for OpenCode (`allow`, `ask`, `block`) as a deterministic projection of policy and operation context.
- Q: Can `ask` widen policy or persist contract changes automatically? → A: No. `ask` is a one-shot, user-only approval for exactly that single operation, with no contract or permission mutation.
- Q: Can one mutation proceed when repository is already `REPAIR`? → A: No. `REPAIR` state defaults to safe fail-stop for all mutating actions by OpenCode.
- Q: Is persistent audit logging required for this spec? → Historical A (2026-08-16): no audit requirement for enforcement. **Superseded for Guardian V2 MVP** by the 2026-09-24 requirement for retained, structured evidence of autonomous authority-consuming operations. This does not prescribe an audit store or make plugin permission-hook side effects responsible for persistence.
- Q: Can SPEC-004 introduce stack-specific policy packs or deep shell behavior prediction? → A: No. SPEC-004 only uses existing generic contract controls and explicit shell/path-safety limits.

> **Historical-rule notice (2026-09-24):** Earlier blanket `REPAIR` blocking, one-ask-per-recognized-CLI-operation, and universal out-of-scope/sensitive-category asks are superseded as Guardian runtime rules. The original 2026-08-16 clarifications remain historical context unless expressly reaffirmed below. Product direction is READY_FOR_PLANNING; current runtime behavior is not thereby approved or certified.

### Session 2026-09-24 (initial same-day approval; superseded by the Guardian V2 resolution below where more specific)

- Q: Should every `.changebudget/**` mutation be denied, including ChangeBudget CLI lifecycle commands? → A: Direct `.changebudget/**` writes remain blocked in every repository state. Only a recognized ChangeBudget CLI invocation is eligible for lifecycle handling; the prior rule that every recognized mutation necessarily receives a one-operation `ask` is **OBSOLETE - REQUIRES REVISION**. The initial same-day note that force-close effect was unresolved is superseded below: force close/bypass requires EXPLICIT FRESH HUMAN APPROVAL and blocks without it.
- Q: What happens before initialization? → A: Ordinary passive operations retain FR-004's no-op/allow behavior, except direct `.changebudget/**` mutations remain blocked and unknown, malformed, unsafe, or unrecognized wrapped ChangeBudget invocations fail closed. The initial same-day instruction not to infer recognized CLI lifecycle effects was provisional; the later Guardian V2 section resolves product conditions for the listed lifecycle cases without defining a new runtime schema.
- This clarification records present product direction, not retrospective approval of earlier implementation or releases. The prior per-operation CLI ask mapping and blanket `REPAIR`/`HUMAN_REVIEW` mutation blocks are **OBSOLETE - REQUIRES REVISION**; this does not redefine SPEC-002/003 policy decisions. SPEC-004 remains Draft, now READY_FOR_PLANNING for coordinated work as stated above.

### Guardian V2 product direction (2026-09-24; normative)

**Outcome and delta.** A direct, explicit human premise authorizes pursuing its exact requested outcome (for example, Docker + Redis Cluster + three instances). It is not permission to substitute a smaller outcome such as one local Redis instance or in-memory storage merely to lower the implementation footprint. Do not add optional tests, refactors, or infrastructure that are not needed for that outcome. Minimize implementation expansion, never the requested outcome. Prose communicates intent but is not unlimited structured authority.

**Soft estimates and hard authority.** Planner/agent `expected_files` and `expected_changed_lines` are soft estimates that signal drift; exceeding an estimate alone is not an ASK or BLOCK and must not silently constrain the outcome. `max_files` and `max_changed_lines` are hard ceilings only when supported by human/policy authority provenance. An estimate must never be silently treated as a hard cap, nor may a hard cap be silently reclassified as an estimate. Exceeding a provenance-qualified hard ceiling requires new authority. These semantics are aligned in SPEC-002 `spec.md` FR-009/FR-010/FR-021 and SPEC-003 `spec.md` FR-002/FR-003/FR-004/FR-007. SPEC-002's FR-021 also defines deterministic legacy classification: a number, field name, preset, task budget/default, CLI invocation, free-text reason, stored value, or historic check alone proves neither authorized origin nor intent as a ceiling; unresolved provenance is HUMAN_REVIEW when classification is necessary, not a hard violation or PASS. No schema migration or inferred retroactive grant is introduced.

**Minimal authority delta.** Minimize the authority delta, not by proving architectural necessity. If current hard authority is 18 files and a hard ceiling is 60, but the requested operation needs one more file, the proposed delta is 18→19, not 18→60. If a valid path grant needs expansion, grant `src/foo.ts` rather than `src/**` when the exact path suffices. Existing hard deny/protected boundaries remain binding; a grant never permits protected direct writes.

**Authority evidence.** Keep distinct (a) trusted human intent, including the explicit requested-outcome premise; (b) a ChangeBudget-canonical structured grant representing bounded authority; and (c) a verified human authorization event establishing that authority. An orchestrator is a consumer/reference to a grant, not its issuer; prefer a grant identifier/reference rather than inventing a schema here. EvoSpec or another transport may carry/reference authority already granted, but transport does not issue or expand a grant. Authority must bind deterministically to repository identity, work/task identity, authority/schema version, and lifecycle status. Malformed, forged, cross-repository, cross-task, revoked, expired, consumed, or stale authority is invalid and BLOCKS; it does not trigger another ASK as a substitute for validation. A canonical grant reported as consumed is invalid at evaluation; stage-to-stage use of the same grant during its one active bounded START→AMEND→REPAIR→CLOSE lifecycle is not consumption/replay. Successful CLOSE makes that authority unavailable for unrelated future work.

**Workflow order.** Preserve this precedence: (1) preserve the premise; (2) CONTINUE within current authority; (3) use the mechanically implied minimum concrete delta; (4) use the minimum concrete delta covered by a valid grant; (5) REFOCUS an optional/oversized approach and keep seeking a narrower approach to the same requested outcome; (6) ASK for materially new authority, only for the minimum delta; (7) BLOCK invalid authorization, protected/forced operations lacking fresh approval, unknown, or unsafe work. The governing principles are: “Reject the oversized solution, not the task.” “Refocus before escalation.” “Minimize implementation expansion, never the user’s requested outcome.” “ChangeBudget asks for new authority, not repeated consent for authority the human already granted.”

**Policy-result interpretation.** `REPAIR` alone neither grants authority nor stops work: repair inside current authority may CONTINUE; a minimum grant-covered concrete delta may AMEND and continue; optional work REFOCUSES; genuinely required material new authority ASKs; invalid/unsafe work BLOCKS. `HUMAN_REVIEW` is not itself authority. Its reasons must distinguish optional expansion (REFOCUS), genuinely new authority (ASK), and invalid/unsafe authorization or state (BLOCK); no final reason-code names are specified.

**Lifecycle operations.** START is autonomous when no authority beyond the human premise or valid structured grant is needed; create narrow requested contract values, never populate ceilings from maximum grant limits. A clean first-time INIT is autonomous only in an eligible repository with no conflicting ChangeBudget state and no protected/pre-existing overwrite conflict. CLI `init` is distinct from direct `.changebudget/**` mutation, which BLOCKS in every state. Read-only `changebudget integrate opencode --dry-run` and `changebudget update --check` are autonomous. Refresh through a proven-owned wrapper is autonomous. First real integration requires an explicit human setup/integration request; a real package update requires an explicit user update request and is not background coding. A normal CLOSE after PASS and required completion conditions is autonomous. Force close/bypass requires EXPLICIT FRESH HUMAN APPROVAL; an attempted force/bypass without it BLOCKS, and even a valid recognized force operation never permits direct protected writes. Sensitive-category work explicitly requested in the premise does not trigger redundant ASK solely because of its category; novel expansion is authority-evaluated, while protected and force gates remain separate.

**Audit MVP.** Retain structured evidence for every autonomous authority-consuming operation: requested operation, current authority, grant/human-premise coverage, minimal delta, subset/boundary checks, rationale for no prompt, and any REFOCUS/ASK/BLOCK decision and reason. This supersedes the earlier no-audit clarification for this MVP. Evidence is ChangeBudget-owned lifecycle evidence; this spec does not prescribe a storage mechanism and does not turn permission-hook evaluation into an audit-store side effect. This requirement does not claim that current code records the evidence.

**MVP scope and deferrals.** The MVP includes soft/hard provenance distinction; covered START; ChangeBudget-canonical structured grants; minimal numeric and exact-path AMEND; REPAIR autonomy within authority; REFOCUS; normal CLOSE; all-state direct `.changebudget/**` protection; repository/work binding; replay and staleness handling; and structured audit evidence. Defer cloud/distributed authorization, arbitrary third-party grant issuers, organization-scoped grants, cryptographic federation, and use of LLM compliance judgments as enforcement authority. These deferrals do not limit a human's explicitly requested outcome or authorize an implementation to replace it.

**Runtime boundary.** Direct `.changebudget/**` file/edit/shell/Git writes BLOCK in every state. REFOCUS is a planning/workflow concept, not a command, exit code, runtime action, enum, state, public API, field, or schema. Its representation belongs to planning; do not invent final field names, API, schema, lifecycle representation, REFOCUS command/exit code, or reason codes in SPEC-004. Recognized CLI lifecycle handling is distinct from direct state writes. Existing runtime source/tests are old-behavior evidence only; none of these product decisions is claimed implemented.

**Owner-spec alignment.** SPEC-002 FR-009/FR-010 now limit numeric violations to exceeded provenance-qualified hard `max_files`/`max_changed_lines` ceilings; FR-021 defines deterministic HARD/SOFT/UNRESOLVED classification and safe handling of legacy values. SPEC-003 FR-002/FR-003/FR-004/FR-007 preserve path/precondition rules, concrete `REPAIR`, and the `HUMAN_REVIEW` outcome when unresolved provenance is material. Existing contracts remain readable without migration; no source, field, schema, or final provenance reason code is claimed. SPEC-002 FR-011/FR-012 retain allow-list and hard-deny semantics; Guardian must not turn a path mismatch alone into a universal ASK or permit a denied/protected path. These numeric semantics do not weaken separately defined hard path/capability constraints for new files, dependencies, migrations, configuration, or public API, or force/bypass requirements. Check-level HUMAN_REVIEW reports an evaluation precondition; Guardian BLOCKS operations relying on unresolved authority rather than using ASK as its substitute.

**Planning status.** The product decisions above are internally consistent and sufficient for planning; the normative numeric-provenance and decision semantics are now aligned with SPEC-002/003. This documentation-only alignment is not an implementation baseline or evidence of runtime conformance. Remaining work is implementation/planning design and evidence (runtime projection details without new public API, mapping existing inputs and supported provenance evidence, audit persistence placement, availability feedback, host reproduction, and code/test conformance), not an unresolved product choice supplied by this clarification.


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
5. **Given** genuinely new authority is necessary, **When** no valid prior grant covers it, **Then** ask for only the minimum delta rather than treating prose or transported metadata as blanket authorization.

---

### User Story 3 - Protect sensitive categories with transparent policy behavior *(Priority: P1)*

As a developer, I want guard behavior for dependency/config/migration/API-sensitive changes to be predictable and understandable so scope-sensitive edits remain explicit decisions, not hidden side effects.

**Why this priority**: Scope creep often happens in these categories even when paths look innocuous.

**Independent Test**: Configure a contract with default-sensitive flags and attempt targeted edits to dependency/config-related files; verify the action decision is shown and policy is consistently mapped before write.

**Acceptance Scenarios**:

1. **Given** a sensitive-category change is minimally necessary for the explicit requested outcome and already within human-granted authority, **When** the workflow evaluates it, **Then** the category label alone does not force an unnecessary scope reduction or a new authorization request.
2. **Given** a sensitive-category change would add new authority, **When** the workflow evaluates it, **Then** it follows the minimum-delta new-authority ASK rule; exact effect projection is implementation planning.
3. **Given** an explicitly requested sensitive category, **When** no novel authority is added, **Then** there is no redundant ask solely because of the category; protected-path and force-operation gates still apply.

---

### User Story 4 - Use bounded lifecycle authority and auditable autonomy *(Priority: P1)*

As a developer, I want lifecycle operations to use only verified, task-bound authority, with a narrow proposed delta and retained evidence when ChangeBudget proceeds autonomously.

**Acceptance Scenarios**:

1. **Given** an eligible repository with no conflicting ChangeBudget state or protected/pre-existing overwrite conflict, **When** a clean first-time CLI `init` is recognized, **Then** it may initialize autonomously; an ordinary direct write to `.changebudget/**` remains blocked in every state.
2. **Given** a valid bounded grant, **When** recognized lifecycle work proceeds through START→AMEND→REPAIR→CLOSE, **Then** its valid grant reference may be reused within that lifecycle but cannot authorize unrelated work after successful CLOSE.
3. **Given** authority is malformed, forged, cross-repository, cross-task, revoked, expired, reported consumed when presented, or stale, **When** it is evaluated, **Then** the operation blocks rather than asking again as if authority were absent; reuse between stages of the one active bounded lifecycle is not treated as consumed replay.
4. **Given** an autonomous authority-consuming operation, **When** it proceeds, **Then** ChangeBudget retains structured evidence of the requested operation, current authority and coverage, minimum delta, boundary checks, no-prompt rationale, and any REFOCUS/ASK/BLOCK decision and reason.

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

The remaining cross-spec planning/evidence items are recorded explicitly above and in `plan.md`, `research.md`, and `tasks.md`: selecting an implementation representation for owner-defined legacy classification and HUMAN_REVIEW consistent with the existing result/reason surface; runtime projection and audit-evidence placement without new public API/schema; supported integration-unavailable feedback; and reproducing the beta.7 host observation. The owner-spec semantics are aligned, but implementation/planning and evidence remain open. These are not unresolved alternatives to the product rules. The checklist remains reviewer-owned and is not self-certified by this decision.

### Ask Semantics

- `ask` is an explicit single-operation human confirmation, not a policy change.
- The developer confirms one operation only; it does **not** persistently update contract state, budgets, or allowed paths.
- Approval is only valid for that single attempted operation and does not authorize future operations.
- A denied ask remains blocked and must be retried only after user intent is explicit outside the same plugin call.
- These one-operation semantics apply only if the eventual mapping selects `ask`; they do not preserve the obsolete rule that every out-of-scope, sensitive, or recognized CLI mutation necessarily asks.

### Edge Cases

- What is reported when a write action has no explicit file path (bulk edits or non-file tool operations)?
- How is a rename/delete operation mapped: as one protected write event, two events, or a special event?
- How is a denied write handled if path matching uses symlinks or case-only path differences?
- What is the decision when the contract is active but missing/malformed in the workspace?
- How should repeated `ask` prompts for repeated attempts on the same path be handled to avoid prompt fatigue?
- Can the plugin intercept all write-like actions exposed by OpenCode, and how are unsupported actions represented to the user?
- How does the implementation consume canonical grant references and verified human authorization evidence while preserving repository/task/version/lifecycle binding?
- Which existing lifecycle gate exposes the no-prompt audit evidence without adding plugin-hook side effects or a new store contract?
- Does the installed host classify the same ChangeBudget read-only command consistently across launch modes? A beta.7 host discrepancy is pending evidence; the root cause is unknown and caching is not an established explanation.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The feature MUST add a minimal, optional native OpenCode V2 plugin package using `@opencode/plugin@2.0.12`, without changing core CLI behavior.
- **FR-002**: The plugin MUST resolve the active ChangeBudget contract from the current workspace and use it as the policy source during interceptable write operations.
- **FR-003**: The plugin MUST evaluate each relevant V2 permission request before persistence through `ctx.permission.hook('evaluate', ...)`.
- **FR-004**: The plugin MUST treat a repository without active ChangeBudget context as no-op/allow for ordinary OpenCode operations, subject to FR-010 direct-state protection, the recognized CLI command rules in FR-021–FR-022, and fail-closed classification of unsupported or unsafe operations.
- **FR-005 [OBSOLETE — REQUIRES REVISION; NOT BINDING]**: Historical rule: if `policyDecision` is `REPAIR` and an ordinary intercepted operation is mutating, return `runtimeAction = block`. A `REPAIR` result alone is not a stop rule; repair within current authority may continue, using the minimum covered delta.
- **FR-006 [OBSOLETE — REQUIRES REVISION; NOT BINDING]**: Historical rule: block all mutating `HUMAN_REVIEW` operations except deterministic read-only operations. `HUMAN_REVIEW` is not authority. Its product disposition is reason-based: optional expansion→REFOCUS, genuine new authority→ASK, invalid/unsafe authorization or state→BLOCK.
- **FR-007**: In initialized repositories, if an operation touches a path that matches `deny_paths`, the plugin MUST return `runtimeAction = block` before persistence.
- **FR-008 [OBSOLETE — REQUIRES REVISION; NOT BINDING]**: Historical rule: every operation outside `allow_paths` asks. A path mismatch alone does not require repeated consent; evaluate current human premise and valid structured grant, preserve owner-spec path semantics, and request only the minimum new path authority if needed. Denied/protected paths remain gated.
- **FR-009 [OBSOLETE — REQUIRES REVISION; NOT BINDING]**: Historical rule: every disabled sensitive category asks. A sensitive label alone does not require redundant consent where the exact category is explicitly requested and no new authority is added. Novel expansion is authority-evaluated; protected and force gates remain separate.
- **FR-010**: Any direct OpenCode mutation against `.changebudget/**` (including active contract and state files) MUST return `runtimeAction = block` in every repository state, including before initialization and with no active contract. Recognized ChangeBudget CLI lifecycle operations are governed separately by FR-021 and are not direct file edits.
- **FR-011**: For every intercepted operation that can be deterministically classified, the plugin MUST return exactly one runtimeAction (`allow`, `ask`, `block`) and include a stable machine-readable rule identifier; multiple resources MUST aggregate restrictively.
- **FR-012**: `ask` outcomes MUST include relevant operation context (path where applicable, or the recognized CLI operation class where no file target exists), applicable `policyDecision` rationale (`HUMAN_REVIEW` or policy-derived), the contract id when one is active, and a one-line recommendation.
- **FR-013**: A user-approved `ask` grants only that single operation; it does not persist as a contract expansion, budget increase, or auto-updated allow/deny state.
- **FR-014**: Once the permission-evaluation hook is registered and invoked for a potentially mutating operation, an evaluation failure or unavailable/invalid runtime context (including internal evaluation failure, corrupt state, invalid base revision, or unreachable policy source) MUST produce a blocking/deny effect for that intercepted operation through the registered permission path. This requirement does not claim that a write is blocked when setup/registration failed and no hook can intercept it.
- **FR-015**: The plugin MAY be disabled per workspace or not installed without mutating contract state or changing ChangeBudget CLI behavior. Plugin absence means no runtime interception guarantee. If setup or hook registration fails and that failure is observable, the integration MUST be surfaced as unavailable through supported host/integration feedback and MUST NOT be represented as active protection. Selecting the concrete feedback mechanism is implementation planning/validation and does not add an API or schema here.
- **FR-016**: The plugin MUST preserve SPEC-003 policy decisions as source-of-truth and never redefine or replace `PASS`, `REPAIR`, `HUMAN_REVIEW` semantics.
- **FR-017**: Permission-hook evaluation MUST NOT itself write ChangeBudget state, create grants, or persist audit records. ChangeBudget-owned lifecycle handling MUST retain the required structured evidence for each autonomous authority-consuming operation; its storage mechanism is not prescribed here. The feature adds no auto-repair or shell sandbox.
- **FR-018**: The plugin must not claim security guarantees (no sandbox, no anti-malware, no privilege control); it is a workflow guard only.
- **FR-019**: Runtime action decisions and messages must be deterministic for identical repository state, operation context, and contract snapshot.
- **FR-020**: The native plugin MUST register `session.context` and `permission.evaluate` only; no alternate plugin contract, compatibility adapter, or migration path is supported.
- **FR-021 [OBSOLETE AS TO ACTION — REQUIRES REVISION]**: The historical universal one-operation ask for every managed/external/force CLI mutation is **OBSOLETE — NOT BINDING**. Recognition still requires verified executable identity and complete supported grammar, and grants no authority by itself. Product rules: clean first-time CLI `init` may proceed autonomously only in an eligible repository with no conflicting ChangeBudget state or protected/preexisting overwrite; `start` is autonomous when no authority beyond the human premise/valid grant is needed and writes narrow requested contract values rather than grant ceilings; minimally covered `amend` applies only its minimum delta and continues; normal `close` after `PASS` and required completion conditions is autonomous. Force close/bypass requires explicit fresh human approval and blocks without it. Recognized read-only `integrate opencode --dry-run` and `update --check` are autonomous; proven-owned wrapper refresh is autonomous; first real integration requires an explicit human setup/integration request; real package update requires an explicit user update request, not background coding. Direct `.changebudget/**` writes remain blocked in all states. No final runtime mapping/API/schema is introduced by this requirement.
- **FR-022**: Unknown or malformed ChangeBudget commands, invalid satisfaction evidence, shell control operators around an attempted ChangeBudget invocation, and unrecognized wrappers for an attempted ChangeBudget invocation MUST fail closed and MUST NOT receive a managed-mutation ask, in every repository state. An absolute executable path may be trusted only after verifying it is a shim for the installed ChangeBudget package; matching a path/name string is not sufficient. The plugin MUST NOT claim universal Windows wrapper support.
- **FR-023**: The Git scanner MUST recognize only the supported read-only inspection forms established for this feature, including `git ls-files`, `git check-ignore`, and `git status` pathspecs with supported OpenCode split-resource variants. It MUST evaluate unrelated resources separately and fail closed for unknown or mutating resources rather than inheriting a read-only classification. Historical #36 source/test locations are not proof of all-host support.
- **FR-024**: Explicit human premise authorizes pursuit of the exact requested outcome but is not unlimited structured authority. The system MUST distinguish that intent from ChangeBudget-canonical structured grants and verified human authorization events; an orchestrator may consume/reference, but MUST NOT issue, a grant. Grant validity MUST bind deterministically to repository identity, work/task identity, authority/schema version, and lifecycle status. Invalid, malformed, forged, cross-repository, cross-task, revoked, expired, consumed, or stale authority MUST BLOCK rather than trigger a repeated ASK. A consumed grant is blocked when presented; permitted stage-to-stage use in its one active bounded START→AMEND→REPAIR→CLOSE lifecycle is not treated as consumed replay. A valid grant MUST NOT replay for unrelated work after successful close.
- **FR-025**: The system MUST preserve the ordered authority response: exact premise; continue within current authority; minimum mechanically implied concrete delta; minimum valid-grant-covered concrete delta; REFOCUS optional work; ASK for the minimum materially new authority; BLOCK invalid/unsafe/protected/forced-without-fresh-approval/unknown work. REFOCUS MUST reject an oversized solution rather than the task, must precede escalation, and MUST NOT be represented as a new command, exit code, runtime action, enum, state, public API, or schema.
- **FR-026**: The system MUST distinguish advisory expected file/line estimates from hard `max_files`/`max_changed_lines` ceilings with provenance. Exceeding an estimate alone MUST NOT ASK or BLOCK. A hard ceiling is enforceable only with human/policy provenance; exceeding it requires new authority. SPEC-002/003 define the owner semantics, including legacy unresolved provenance; implementation representation is a planning item and this requirement adds no field/schema or final reason code.
- **FR-027**: Sensitive-category work explicitly requested by the human premise MUST NOT trigger a redundant ask solely due to its category. Novel expansion is authority-evaluated; direct protected paths and force operations remain separately gated.
- **FR-028**: For each autonomous authority-consuming operation, ChangeBudget-owned lifecycle handling MUST retain structured evidence of the requested operation, current authority, grant/human-premise coverage, minimal delta, subset/boundary checks, no-prompt rationale, and any REFOCUS/ASK/BLOCK decision and reason. This is a product evidence requirement, not a claim of current implementation or a requirement to persist it from the plugin permission hook.

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
- **SC-004**: In repeated approved `ask` scenarios, each approval applies only to that single operation and the next identical attempt is re-evaluated rather than implicitly persisted.
- **SC-005 [OBSOLETE — REQUIRES REVISION]**: Historical measurable criterion required every ordinary mutation in `REPAIR` to block. A `REPAIR` result alone does not stop work; current-authority repair may continue.
- **SC-006**: In at least **20 mixed mutation scenarios** where the permission-evaluation hook is registered and invoked, evaluator failures or missing/corrupt contract state return fail-safe blocking results for potentially mutating operations in **100%** of runs. Setup/registration failure is an unavailable-integration condition, not evidence of blocked mutations.
- **SC-007**: Runtime decision text and actions for mutations do not depend on or create external network calls and remain deterministic.
- **SC-008**: Core command behavior defined in SPEC-001 to SPEC-003 is unchanged in at least **20 non-OpenCode invocations** while plugin integration is unavailable.
- **SC-009**: Direct mutations to `.changebudget/**` are blocked before persistence in every lifecycle state, including an uninitialized disposable repository.
- **SC-010 [OBSOLETE — REQUIRES REVISION]**: Historical measurable criterion required an ask for every recognized mutating CLI invocation. Recognized lifecycle actions instead follow FR-021 and their stated human-authority conditions; unknown/malformed or unsafe forms still fail closed.
- **SC-011**: In deterministic scenarios, each invalid/cross-boundary/stale grant blocks without prompting, while a valid bounded grant is accepted only for its bound repository/task and ordered lifecycle; successful close prevents unrelated replay.
- **SC-012**: Every autonomous authority-consuming operation has retained structured evidence for all FR-028 elements; absence of any required evidence prevents claiming a conforming autonomous operation.

## Assumptions

- Existing contract path semantics from SPEC-002 apply to runtime decisions.
- OpenCode plugin interception is limited to operations it exposes; unexposed operations are out of scope for this feature.
- Local-only behavior is prioritized over remote or cloud evaluation.
- Prompting is reserved for genuine new authority/material work after refocus and existing-authority checks; the product ordering is fixed, and implementation may not substitute redundant consent.
- A non-invasive warning is acceptable when plugin integration capability is unavailable.
- Approved `ask` outcomes do not modify contract state and do not persist beyond that operation.
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
