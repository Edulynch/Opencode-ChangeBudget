# Feature Specification: OpenCode Runtime Guard

**Feature Branch**: `004-opencode-runtime-guard`

**Created**: 2026-08-16

**Status**: Draft

**Input**: User description: "Create the next ChangeBudget specification: SPEC-004 — OpenCode Runtime Guard"

## Clarifications

### Session 2026-08-16

- Q: How should SPEC-004 represent policy results versus runtime control? → A: Use `policyDecision` for ChangeBudget (`PASS`, `REPAIR`, `HUMAN_REVIEW`) and `runtimeAction` for OpenCode (`allow`, `ask`, `block`) as a deterministic projection of policy and operation context.
- Q: Can `ask` widen policy or persist contract changes automatically? → A: No. `ask` is a one-shot, user-only approval for exactly that single operation, with no contract or permission mutation.
- Q: Can one mutation proceed when repository is already `REPAIR`? → A: No. `REPAIR` state defaults to safe fail-stop for all mutating actions by OpenCode.
- Q: Is persistent audit logging required for this spec? → A: Not required for enforcement; only local runtime decision output is required.
- Q: Can SPEC-004 introduce stack-specific policy packs or deep shell behavior prediction? → A: No. SPEC-004 only uses existing generic contract controls and explicit shell/path-safety limits.


## User Scenarios & Testing *(mandatory)*

### User Story 1 - Stop forbidden writes before they land *(Priority: P1)*

As a developer, when an OpenCode session attempts to write a file that the active contract explicitly denies, I need the attempt to be prevented before the file is changed.

**Why this priority**: This is the core value of SPEC-004 and the primary reason for adding runtime guardrails.

**Independent Test**: In a repository with an active contract and a denied file under `deny_paths`, trigger a write-like tool action from OpenCode and verify it is blocked before the write is applied.

**Acceptance Scenarios**:

1. **Given** a contract with `deny_paths: ["config/**", "secrets/**"]`, **When** OpenCode attempts to modify `config/ci.yml`, **Then** the guard blocks the action before persistence and shows the matching rule, observed path, and recovery hint.
2. **Given** the same contract, **When** OpenCode attempts to modify `src/app.ts`, **Then** the action is not blocked when no deny rule or active blocking sensitivity applies.

---

### User Story 2 - Ask before risky-but-not-forbidden writes *(Priority: P1)*

As a developer, if an attempted write is outside the allowed scope but not hard-blocked, I want explicit review before it proceeds so I can decide based on context.

**Why this priority**: It adds control without over-blocking and keeps workflow fast for normal in-scope work.

**Independent Test**: In an active contract with `allow_paths` set, trigger OpenCode write attempts both inside and outside this scope and verify only out-of-scope actions request approval.

**Acceptance Scenarios**:

1. **Given** `allow_paths: ["src/**"]` and `deny_paths` empty, **When** OpenCode attempts to modify `tests/contract.spec.ts`, **Then** the guard presents a clear `ask` prompt, explains the policy reason, and allows the user to cancel or allow the write.
2. **Given** the user approves a prior `ask`, **When** the same path is attempted again, **Then** the behavior is consistent with repository and contract state and does not bypass policy checks.

---

### User Story 3 - Protect sensitive categories with transparent policy behavior *(Priority: P1)*

As a developer, I want guard behavior for dependency/config/migration/API-sensitive changes to be predictable and understandable so scope-sensitive edits remain explicit decisions, not hidden side effects.

**Why this priority**: Scope creep often happens in these categories even when paths look innocuous.

**Independent Test**: Configure a contract with default-sensitive flags and attempt targeted edits to dependency/config-related files; verify the action decision is shown and policy is consistently mapped before write.

**Acceptance Scenarios**:

1. **Given** `allow_new_dependencies = false` and a dependency-related write is attempted with known target, **When** OpenCode evaluates the operation, **Then** the guard emits an `ask` decision and does not proceed without explicit user confirmation.
2. **Given** same contract and a normal source change in `src/feature.ts`, **When** OpenCode attempts the write, **Then** the guard applies only path/deny logic and does not classify it as a dependency-class sensitivity event.

---

### User Story 4 - Keep local-first behavior and fail safe when integration is unavailable *(Priority: P2)*

A developer should keep using the core CLI and local contracts even when OpenCode integration is missing, disabled, or failing.

**Why this priority**: SPEC-003 and earlier milestones should not become dependent on optional runtime wiring.

**Independent Test**: Remove plugin hooks or force an integration failure during an OpenCode session and confirm all existing ChangeBudget CLI commands still run exactly as before.

**Acceptance Scenarios**:

1. **Given** the plugin is not installed in OpenCode, **When** a developer runs `changebudget check` and `changebudget status`, **Then** both commands behave exactly as current core behavior.
2. **Given** plugin runtime throws an error at startup, **When** OpenCode loads, **Then** mutation actions are safe-fail (blocked or not intercepted), while core ChangeBudget CLI behavior stays unchanged.

### Policy Decision vs OpenCode Runtime Action

- **policyDecision**: The deterministic result from existing ChangeBudget evaluation using SPEC-002/003 semantics (`PASS`, `REPAIR`, `HUMAN_REVIEW`).
- **runtimeAction**: The OpenCode-specific enforcement action emitted by the plugin for a single intercepted operation (`allow`, `ask`, `block`).

### Deterministic Mapping (minimal)

- Precondition: if repository has no `.changebudget` state or `lifecycle_state === 'uninitialized'`, no active guard context exists and `runtimeAction` is `allow` for OpenCode mutations.
- For initialized repositories:
  - If an active contract context is missing or invalid, mutating operations resolve to `block` through fail-safe default handling.
  - With a valid context:

1. Compute `policyDecision` for current repository state using existing SPEC-003 behavior.
2. Detect operation context (`op_type` and target path when knowable).
3. Derive `runtimeAction`:
   - `REPAIR` -> `block` for all mutating operations.
   - `HUMAN_REVIEW` -> `block` by default for mutating operations that cannot be evaluated safely.
   - `PASS` -> evaluate target-level rules:
     - target in `deny_paths` -> `block`.
     - target in `.changebudget/**` -> `block`.
     - `allow_paths` non-empty and target not allowed -> `ask`.
     - operation matches a sensitive contract toggle set to `false` (for example `allow_new_dependencies`, `allow_migrations`, `allow_config_changes`, `allow_public_api_changes`) -> `ask`.
     - otherwise -> `allow`.
  - Mutating operation with unknown target context (including unknown shell mutation targets) -> `block` in initialized repositories.
   - Non-mutating operation -> `allow`, except where operation is an unsupported unsafe API invocation.

### Ask Semantics

- `ask` is an explicit single-operation human confirmation, not a policy change.
- The developer confirms one operation only; it does **not** persistently update contract state, budgets, or allowed paths.
- Approval is only valid for that single attempted operation and does not authorize future operations.
- A denied ask remains blocked and must be retried only after user intent is explicit outside the same plugin call.

### Edge Cases

- What is reported when a write action has no explicit file path (bulk edits or non-file tool operations)?
- How is a rename/delete operation mapped: as one protected write event, two events, or a special event?
- How is a denied write handled if path matching uses symlinks or case-only path differences?
- What is the decision when the contract is active but missing/malformed in the workspace?
- How should repeated `ask` prompts for repeated attempts on the same path be handled to avoid prompt fatigue?
- Can the plugin intercept all write-like actions exposed by OpenCode, and how are unsupported actions represented to the user?
- How should read-only tools be handled when contract state is `REPAIR`?
- Can operation-specific `ask` approvals be used to modify `.changebudget/**`?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The feature MUST add a minimal, optional OpenCode plugin package that can be loaded alongside ChangeBudget without changing the core CLI behavior.
- **FR-002**: The plugin MUST resolve the active ChangeBudget contract from the current workspace and use it as the policy source during interceptable write operations.
- **FR-003**: The plugin MUST evaluate each relevant operation before persistence when OpenCode exposes a pre-write interception point.
- **FR-004**: The plugin MUST treat a repository without active ChangeBudget context as no-op for runtime enforcement (`runtimeAction = allow`) and never block normal behavior in that mode.
- **FR-005**: If `policyDecision` is `REPAIR` and an intercepted operation is mutating, the plugin MUST return `runtimeAction = block`.
- **FR-006**: If `policyDecision` is `HUMAN_REVIEW` and the operation is mutating, the plugin MUST return `runtimeAction = block` unless OpenCode operation context can be deterministically handled as read-only.
- **FR-007**: In initialized repositories, if an operation touches a path that matches `deny_paths`, the plugin MUST return `runtimeAction = block` before persistence.
- **FR-008**: In initialized repositories, if `allow_paths` is non-empty and an operation touches a path not matching it, the plugin MUST return `runtimeAction = ask` requiring explicit user consent to continue.
- **FR-009**: In initialized repositories, if an operation matches a sensitive generic contract category and its corresponding flag is false, the plugin MUST return `runtimeAction = ask`; if the flag is true, the plugin continues according to allow/deny/path rules.
- **FR-010**: In initialized repositories, any mutating operation against `.changebudget/**` (including active contract and state files) MUST return `runtimeAction = block` when initiated from OpenCode.
- **FR-011**: For operations with deterministic mutating target context, the plugin MUST return exactly one runtimeAction (`allow`, `ask`, `block`) and include a stable machine-readable rule identifier.
- **FR-012**: `ask` outcomes MUST include path context, applicable policyDecision rationale (`HUMAN_REVIEW` or policy-derived), contract id, and one-line recommendation.
- **FR-013**: A user-approved `ask` grants only that single operation; it does not persist as a contract expansion, budget increase, or auto-updated allow/deny state.
- **FR-014**: The plugin MUST fail safely when runtime context is unavailable (including plugin internal failure, corrupt state, invalid base revision, or unreachable policy source) by not permitting mutating writes via OpenCode unless an explicit, supported decision path can be established.
- **FR-015**: The plugin MAY be disabled per workspace or not installed, without mutating contract state or changing ChangeBudget CLI behavior.
- **FR-016**: The plugin MUST preserve SPEC-003 policy decisions as source-of-truth and never redefine or replace `PASS`, `REPAIR`, `HUMAN_REVIEW` semantics.
- **FR-017**: The plugin MUST avoid introducing file-system side effects, auto-repairs, or shell sandboxing behavior; it only enforces runtime interception decisions.
- **FR-018**: The plugin must not claim security guarantees (no sandbox, no anti-malware, no privilege control); it is a workflow guard only.
- **FR-019**: Runtime action decisions and messages must be deterministic for identical repository state, operation context, and contract snapshot.

### Key Entities

- **Runtime Contract Snapshot**: Local policy context loaded by the plugin.
  - `contract_id`, `task_description`, `base_revision`
  - `allow_paths`, `deny_paths`
  - policy toggles for sensitive categories (`allow_new_dependencies`, `allow_migrations`, `allow_config_changes`, `allow_public_api_changes`)
  - computed `policyDecision`

- **Runtime Decision**: A per-operation outcome produced by the plugin.
  - `operation_id`
  - `path` (or relevant target resource)
  - `policyDecision` (`PASS`, `REPAIR`, `HUMAN_REVIEW`)
  - `runtimeAction` (`allow`, `ask`, `block`)
  - `rule` (policy source identifier)
  - `reason_code` (stable code such as `OCG-DENY-PATH`, `OCG-OUT-SCOPE`, `OCG-SENSITIVE-FLAG`)
  - `message`
  - `contract_id`

- `runtimeOutput`: Human-readable decision text for the active session.
  - displayed for each mutation decision without introducing a persistent log format in this spec.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In at least **20 synthetic OpenCode write attempts**, every attempt resolves to exactly one `allow`/`ask`/`block` decision, and each decision output includes action rationale.
- **SC-002**: In a repo with an active contract, all path-deny operations are blocked before write completion in **100%** of repeatable scenarios.
- **SC-003**: In repeated out-of-scope operations when `allow_paths` is configured, `ask` is emitted in **100%** of runs and approval is required to continue.
- **SC-004**: In repeated approved `ask` scenarios, each approval applies only to that single operation and the next identical attempt is re-evaluated rather than implicitly persisted.
- **SC-005**: In an initialized repository already in `REPAIR`, mutating OpenCode operations are blocked in **100%** of attempts, while read-only operations remain allowed unless explicitly blocked for safety.
- **SC-006**: In at least **20 mixed mutation scenarios**, initialized repositories with evaluator failures or missing contract state return fail-safe results (no unrestricted mutation) in **100%** of runs.
- **SC-007**: Runtime decision text and actions for mutations do not depend on or create external network calls and remain deterministic.
- **SC-008**: Core command behavior defined in SPEC-001 to SPEC-003 is unchanged in at least **20 non-OpenCode invocations** while plugin integration is unavailable.

## Assumptions

- Existing contract path semantics from SPEC-002 apply to runtime decisions.
- OpenCode plugin interception is limited to operations it exposes; unexposed operations are out of scope for this feature.
- Local-only behavior is prioritized over remote or cloud evaluation.
- Users can tolerate occasional prompts for high-risk operations in exchange for reduced scope creep.
- A non-invasive warning is acceptable when plugin integration capability is unavailable.
- Approved `ask` outcomes do not modify contract state and do not persist beyond that operation.
- Shell/tool operations with no deterministic mutation target are treated as non-enforceable for fine-grained policy and therefore default to fail-safe behavior in initialized repositories.

## Explicit Non-Goals

- Building a full security sandbox, OS-level isolation, or process-level confinement.
- Full semantic code analysis by language parser (for example, LLM/AST analysis beyond path + contract-rule context).
- Replacing SPEC-001 to SPEC-003 lifecycle and reporting behavior.
- Automatic repair, auto-revert, or forceful rollback from inside OpenCode.
- Enabling multi-agent enforcement in this spec; OpenCode is the first integration target.
- Enforcing policies for non-OpenCode workflows (Git commands, editors, shell tools) outside this runtime feature.
- Persistent audit trail storage or contract mutation by plugin decisions.

## Compatibility Impact

- **Core CLI compatibility**: SPEC-003 and earlier command contracts remain unchanged when OpenCode is not used.
- **Workspace compatibility**: Active contracts remain readable and authoritative from existing files; no schema migration required.
- **Operational compatibility**: Plugin installation is optional and must not create mandatory runtime dependency on OpenCode.
