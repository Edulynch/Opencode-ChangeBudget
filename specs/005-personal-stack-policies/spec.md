# Feature Specification: Personal Stack Policies

**Feature Branch**: `005-personal-stack-policies`

**Created**: 2026-08-16

**Status**: Draft

**Input**: User description: "Implement SPEC-005 — Personal Stack Policies"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Select an explicit stack policy profile before starting a contract *(Priority: P1)*

As a developer, before I begin a task I want to choose a known stack policy profile so ChangeBudget applies rules that match my project type.

**Why this priority**: This feature enables deterministic stack-aware behavior without manually maintaining repetitive path and sensitivity settings.

**Independent Test**: In a repository started with a fresh contract, select `--stack-profile android`, then run `changebudget check` against a change touching `AndroidManifest.xml` and verify the decision is the same on repeated runs.

**Acceptance Scenarios**:

1. **Given** a contract is started with `stack_profile: "android"`, **When** a file matching an Android sensitive path is touched, **Then** policy evaluation reports it as a review-required event with a stable rule identifier.
2. **Given** a repo without a stack profile selected, **When** the same change is evaluated, **Then** only previously configured base contract rules apply and no new stack-specific review reasons are emitted.

---

### User Story 2 - Apply deterministic stack presets for Android, Flutter, Spring Boot, and Node/TypeScript *(Priority: P1)*

As a developer, I want stable preset definitions for my main stacks so enforcement is predictable and reusable.

**Why this priority**: This is the concrete scope of SPEC-005 and the reason this feature exists.

**Independent Test**: For each supported stack, use a small fixture with one known sensitive path and verify the resolved effective rules include only deterministic pattern matches for that stack.

**Acceptance Scenarios**:

1. **Given** `stack_profile: "flutter"`, **When** a write targets `pubspec.yaml`, **Then** evaluation marks the exact stack rule for dependency file sensitivity as the active reason.
2. **Given** `stack_profile: "spring-boot"`, **When** a write touches `application-dev.yml`, **Then** a stack-specific review reason is produced and is distinct from generic path-deny reasons.
3. **Given** `stack_profile: "node-ts"`, **When** a change modifies `tsconfig.json`, **Then** stack rules classify the change under config-sensitive scope before generic path checks are finalized.

---

### User Story 3 - Extend or override stack rules per repository without changing global presets *(Priority: P2)*

As a maintainer, I need repository-level adjustments so my exact stack implementation can tune the defaults while keeping the same global profile contract.

**Why this priority**: Real projects differ from defaults; this reduces false positives and supports the personal workflow goal.

**Independent Test**: In a repo with a Flutter project and strict default rule set, add a repository override that excludes a noisy path, then verify the override is used only in that repo.

**Acceptance Scenarios**:

1. **Given** global Flutter preset flags `flutter/configuration` as review-required, **When** repository override disables that specific rule, **Then** the same configuration change no longer produces a review-required stack reason in that repository.
2. **Given** a different repository without that override, **When** the same file change happens, **Then** the default Flutter preset still applies.

---

### User Story 4 - Disable individual rules per task, with clear override audit trail *(Priority: P2)*

As a developer, I want to disable one sensitive rule for a specific contract only, while keeping the stack profile and other rules active.

**Why this priority**: This preserves stack intent and avoids binary all-or-nothing profile changes.

**Independent Test**: Start a contract with `stack_profile: "android"`, disable only `android/signing` rule, then verify only that rule is muted for this contract.

**Acceptance Scenarios**:

1. **Given** only `android/signing` is disabled in the active contract, **When** editing `.github/workflows/release.yml`, **Then** stack rule behavior for non-signing-sensitive items remains unchanged and deterministic.
2. **Given** a subsequent contract keeps all defaults, **When** the same `.github` change is evaluated, **Then** full Android preset behavior resumes and no previous per-contract disablement leaks across contracts.

### User Story 5 - Keep policy behavior explicit, visible, and readable *(Priority: P2)*

As a user, I need a concise view of effective stack policy so I can understand why a change was marked for review.

**Why this priority**: Explainability is required for trust and for reducing noisy rule tuning loops.

**Independent Test**: In an active contract, request the status output and confirm it includes stack profile and per-rule status (active, overridden, disabled).

**Acceptance Scenarios**:

1. **Given** contract starts with `stack_profile: "node-ts"` and one repository override, **When** `changebudget status --json` runs, **Then** it returns the effective profile summary, active rule IDs, overridden rule IDs, and disabled rule IDs, with per-rule status distinguishing `active`, `overridden`, and `disabled`.
2. **Given** a stack rule is triggered in checks or runtime interception, **Then** output includes the stable stack rule ID and human-readable rationale.

## Clarifications

### Session 2026-08-16

- Q: For contracts that set `disabled_stack_rules`, should rule-id validation happen at contract creation or only when evaluating checks?
- A: **Model A** — validate at contract creation (`start`) using the effective policy for the selected profile.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support explicit stack profile selection with values: `android`, `flutter`, `spring-boot`, and `node-ts`.
- **FR-002**: If no profile is selected, stack-specific policy is not added and behavior remains the existing non-stack baseline from SPEC-001 through SPEC-004.
- **FR-003**: Built-in profiles MUST include deterministic sensitive rule sets with clear categories per stack.
- **FR-004**: A stack profile MUST map to deterministic rules, not heuristics. Each rule MUST include:
  - path-level patterns (`target_patterns`),
  - a rule action via `severity` (`review` or `deny`),
  - a stable reason identifier (`id`).
- **FR-005**: Preset activation MUST produce stable rule identifiers that can be shown in check/runtime output and status reports.
- **FR-006**: A contract-specific override MUST be able to disable at least one individual stack rule without disabling all stack rules for that contract.
- **FR-007**: A repository-level override MUST be able to extend or reduce a built-in profile for that repository only.
- **FR-008**: Repository-level overrides MUST NEVER affect other repositories by default.
- **FR-009**: When both repository-level and contract-level stack overrides exist, contract-level overrides MUST have higher precedence.
- **FR-010**: Rule conflict resolution for stack profiles and profile overrides MUST be deterministic and stable between runs.
- **FR-011**: Selecting a stack profile must keep non-stack controls (`max_files`, `max_changed_lines`, `allow_paths`, `deny_paths`) unaffected unless explicitly overridden.
- **FR-012**: Violations introduced by stack profiles MUST emit deterministic reason codes and be distinguishable from generic budget/path reasons. Stack violations use the fixed rule marker `stack_profile_rule` and reason codes in the dedicated `CBS-*` family, distinct from the generic `CBV-*` budget/path reason codes.
- **FR-013**: During `start`, malformed stack policy configuration MUST fail with an explicit deterministic error and keep contract creation blocked.
- **FR-013a**: During `start`, when `stack_profile` is set, each `disabled_stack_rules` entry MUST map to an effective rule ID for that selected profile and repository; unknown IDs, unknown profiles, duplicate IDs, and cross-profile IDs are contract-creation errors.
- **FR-013b**: During `start`, when `stack_profile` is unset, `disabled_stack_rules` MUST be empty.
- **FR-013c**: During `start`, repository override files must be resolved before final validation so override-defined IDs can be accepted only when active for the selected profile.
- **FR-014**: The system MUST provide a non-intrusive way to disable a stack rule per contract and document that disabling in readable output.
- **FR-015**: The feature MUST be discoverable in existing workflows (status output, check result context) without mandatory plugin mode or background services.

### Key Entities

- **Stack Profile**: Named deterministic policy template.
  - `profile_id`
  - `category`
  - `stable_rule_id`
  - `scope`
  - `default_state`
  - `source` (`builtin` | `repo` | `contract_override`)

- **Stack Rule**:
  - `id` (stable identifier)
  - `category` (for example `dependencies`, `migrations`, `configuration`, `public_api`, `release_artifacts`)
  - `target` (path pattern list or tokenized scope)
  - `severity` (`review` | `deny`)
  - `message` (human-readable rule text)

- **Policy Resolution Context**:
  - selected `stack_profile`
  - repository overrides
  - contract overrides
  - resolved effective rules
  - override provenance (`builtin` / `repo` / `contract`)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For each supported stack (`android`, `flutter`, `spring-boot`, `node-ts`), at least one deterministic sensitive category is resolved and reported in at least **100** mixed checks/decision scenarios with stable rule IDs.
- **SC-002**: In repeated evaluation of the same repository, same contract, and same file set, stack-policy resolution results are byte-stable in output across at least **20 runs**.
- **SC-003**: In a repository with only stack profile defaults, **100%** of edits that match a configured review rule produce the corresponding stack reason code in policy output.
- **SC-004**: In at least **90%** of stack-sensitive scenarios on real repos, repository overrides reduce false positives without decreasing detection of the same class of high-impact changes.
- **SC-005**: Contract-level rule disabling affects only the current contract and not adjacent contracts by default in at least **20** independent contract cycles.
- **SC-006**: Stack profile selection and override resolution completes in non-interactive mode within the existing command timeout for contract operations (no new background service dependency).

## Assumptions

- Stack profiles are rule packs for path/sensitivity classification, not language compilers.
- OpenCode runtime interception continues to use existing projection rules from SPEC-004.
- Users prefer explicit selection over automatic language detection for initial adoption.
- Rule authoring and override files remain small and local-first, stored in repository scope.

## Edge Cases

- What if a repository override file is malformed or missing required rule metadata?
- What if a contract disables all rules of one stack profile?
- What if a user selects unknown `stack_profile` or a repository profile mismatch exists?
- What happens when `disabled_stack_rules` references a built-in ID, an override ID, or an unknown/other-profile ID?
- What happens when `disabled_stack_rules` is set while `stack_profile` is unset?
- What happens when repository override and contract override both disable different rules in the same stack category?
- How are duplicate rule IDs handled across built-in and override packs during validation and precedence checks?
- How are symlinked or case-variant paths normalized before stack rule matching?
- How are generated files in sensitive folders (for example, `build/`, `dist/`) treated by stack patterns?

## Explicit Non-Goals

- Automatic stack detection from files.
- Full semantic analysis by language parser for rule matching.
- Any cloud service, API, or shared cross-repository policy marketplace in this specification.
- Automatic mutation of stack profiles during runtime.
- Automatically changing existing budgets or path policy unless user explicitly overrides them.
- Preset-driven auto-creation of migration scripts, schema changes, or code refactors.

## Compatibility Impact

- **SPEC-001 to SPEC-004 compatibility**: Existing lifecycle and check contracts continue unchanged unless a stack profile is explicitly chosen.
- **Core CLI compatibility**: Existing commands remain functional even when no profile is selected.
- **Plugin compatibility**: Runtime interception continues to use existing action model and now includes stack-profile rule identifiers when applicable.
- **Storage compatibility**: Existing `start`/`check`/`status` payloads accept optional stack fields; legacy contracts remain valid.
