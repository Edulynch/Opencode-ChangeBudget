# Feature Specification: Deterministic Git Budget Engine

**Feature Branch**: `002-deterministic-git-budget-engine`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Implement SPEC-002 — Deterministic Git Budget Engine"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Evaluate a live contract against real repository changes (Priority: P1)

A developer can run `changebudget check` for an active contract and receive a deterministic assessment of whether current repository changes respect the active contract budget.

**Why this priority**: This is the first meaningful enforcement step beyond SPEC-001 structure checks and is required for the budget concept to be useful.

**Independent Test**: Start from an initialized repository with one active contract, make one small allowed edit, and run `changebudget check`; the check output must report the effective change budget and whether each rule is respected.

**Acceptance Scenarios**:

1. **Given** an active contract with `max_files: 2`, `max_changed_lines: 40`, `allow_paths: ["src/**"]`, `deny_paths: ["src/secrets/**"]`, **When** one file under `src/` is edited by one small change, **Then** check reports all constraints as satisfied and shows computed totals.
2. **Given** an active contract with `max_files: 1`, **When** two tracked files are modified, **Then** check reports a file-budget violation with deterministic counts and affected file list.

---

### User Story 2 - Measure file and line budgets from Git state (Priority: P1)

A developer can trust that `max_files` and `max_changed_lines` are computed from actual Git state, including staged, unstaged, new, and deleted content.

**Why this priority**: Deterministic budgets must come from repository reality, not user claims.

**Independent Test**: In a repository with an active contract, stage one file, modify one file unstaged, delete one file, and add one new file; then run `changebudget check` and verify each type contributes to the budgets according to this spec.

**Acceptance Scenarios**:

1. **Given** a contract with `max_files: 4`, **When** one file is staged, one file is unstaged, one file is deleted, and one file is new but untracked, **Then** changed file count is at least 4 and unchanged from repeated runs.
2. **Given** a contract with `max_changed_lines: 10`, **When** a file is edited with 6 insertions and 3 deletions, **Then** changed lines total increases by 9 for that file.

---

### User Story 3 - Enforce path control deterministically (Priority: P1)

A developer receives a deterministic list of path policy outcomes when changed files are outside allowed paths or inside denied paths.

**Why this priority**: Without path controls, budget checks can approve changes that violate scope restrictions.

**Independent Test**: Create a contract allowing only `src/**` and denying `src/generated/**`; modify one allowed file and one denied file; `changebudget check` must fail path policy deterministically with explicit file-level reasons.

**Acceptance Scenarios**:

1. **Given** `allow_paths` is empty, **When** any file changes, **Then** path policy does not block changes unless a deny path is matched.
2. **Given** both allow and deny are configured and a file matches both, **When** check runs, **Then** deny has precedence and that file is treated as a violation.

---

### User Story 4 - Handle rename, delete, and binary cases predictably (Priority: P2)

A developer can run `check` on realistic change sets and still receive deterministic outcomes for renames, deletions, and non-text files.

**Why this priority**: Real repos include these patterns, and inconsistent handling makes enforcement unreliable.

**Independent Test**: Rename one tracked file, delete one tracked file, and modify one binary file in a repository with an active contract; `changebudget check` returns stable, deterministic outcomes.

**Acceptance Scenarios**:

1. **Given** a tracked file is renamed and contents change, **When** `check` runs, **Then** it is represented as a deterministic rename event and contributes consistently to budgets.
2. **Given** a binary file is modified or added, **When** `check` runs with a line budget enabled, **Then** line measurement behavior is deterministic and documented as either unsupported-line change handling or explicit line fallback policy.

---

### User Story 5 - Fail safely on unstable git context (Priority: P2)

A developer receives clear, deterministic failure modes when git context is invalid, rather than silently skipping budget checks.

**Why this priority**: Deterministic guardrails require explicit failure over ambiguous pass/skip behavior.

**Independent Test**: Run `changebudget check` from a non-git folder with an active contract file present locally; check returns an explicit safe error and no state mutation.

**Acceptance Scenarios**:

1. **Given** `base_revision` points to a missing/unreachable revision, **When** `check` runs, **Then** the command fails with a specific message including the referenced revision and an invalid base guidance.
2. **Given** git metadata is temporarily unavailable (or repository is not git), **When** `check` runs, **Then** the command does not report PASS and emits a deterministic non-pass result.

### Edge Cases

- What happens when the same file is both modified and renamed by the same change set?
- How are ignored files (`.gitignore`) treated when they become untracked and modified?
- How are symlink changes counted for file budget and line budget?
- How are submodule pointer changes represented in budgets?
- What happens when `max_changed_lines` is `null` and only file budget is set?
- What happens when a contract has neither `max_files` nor `max_changed_lines` defined?
- What is the behavior when the repository root is large and the base revision is far behind `HEAD`?
- What happens if `allow_paths` and `deny_paths` contain malformed or empty patterns?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST extend `changebudget check` to evaluate contract limits using actual repository diffs instead of metadata-only checks.

- **FR-002**: `changebudget check` MUST accept either the active contract or a valid `--draft` contract document and fail with an explicit error if neither source can be resolved.

- **FR-003**: The check engine MUST resolve the contract `base_revision` and compare current repository state against that revision.

- **FR-004**: If the base revision cannot be resolved, `check` MUST fail deterministically and return a specific actionable message containing:
  - the provided base reference,
  - whether it is missing, unreachable, or not a commit,
  - and the recommended next action.

- **FR-005**: The engine MUST compute a canonical changed-file set before any budget rule evaluation. The set MUST include:
  - tracked files changed in working tree (staged and unstaged),
  - tracked file deletions,
  - tracked renames when detectable,
  - newly added files that are not ignored.

- **FR-006**: The engine MUST compute `changed_file_count` as the number of unique repository-relative paths participating in the current set.

- **FR-007**: The engine MUST compute `changed_lines_count` as deterministic line change totals (added + removed lines) for text changes.

- **FR-008**: The engine MUST treat binary-only changes as deterministic file-level changes and apply `max_files`; line-level contributions for such paths MUST be documented as non-text and handled consistently across runs.

- **FR-009**: The engine MUST fail with a deterministic non-pass outcome if `max_files` is set and `changed_file_count` exceeds it.

- **FR-010**: The engine MUST fail with a deterministic non-pass outcome if `max_changed_lines` is set and `changed_lines_count` exceeds it.

- **FR-011**: The engine MUST enforce `allow_paths` as a policy allow-list when provided:
  - when `allow_paths` is non-empty, every changed path must match at least one allow path pattern, unless it is blocked by `deny_paths`.

- **FR-012**: The engine MUST enforce `deny_paths` as a hard block list when provided, and any changed path matching deny rules MUST be reported as a violation regardless of allow rules.

- **FR-013**: The engine MUST support deterministic path pattern semantics for allow/deny values and apply matching against normalized relative paths.

- **FR-014**: For each check run, the result output MUST include:
  - base reference used,
  - measured `changed_file_count`,
  - measured `changed_lines_count`,
  - per-rule pass/fail booleans,
  - a deterministic list of violating paths and reasons.

- **FR-015**: The engine MUST return a deterministic result for identical inputs, including repeated runs with no file changes and unchanged base revision.

- **FR-016**: `check` MUST never modify working tree content, index entries, or `.changebudget` contract/state metadata.

- **FR-017**: The engine MUST include renamed files in output as either rename pairs or explicit remove/add pair consistently, and this representation MUST not vary across repeated runs.

- **FR-018**: The engine MUST treat malformed/invalid path patterns as an explicit user-facing validation issue and continue without partial checks.

- **FR-019**: The engine MUST preserve SPEC-001 contract lifecycle semantics: lifecycle transitions remain `uninitialized` -> `initialized` -> `active` -> `closed`, and no new transitions are introduced by SPEC-002.

- **FR-020**: In a non-git directory, `check` MUST return deterministic safe output and must not fabricate PASS.

### Key Entities

- **Budget Check Result**: Deterministic report for one check run.
  - `base_revision` (string)
  - `changed_file_count` (integer)
  - `changed_lines_count` (integer)
  - `binary_change_count` (integer)
  - `new_file_count` (integer)
  - `deleted_file_count` (integer)
  - `renamed_file_count` (integer)
  - `path_rule_results` (list)
  - `limit_results` (list)
  - `violations` (list)
  - `status` (e.g., PASS / FAIL)
  - `as_of` (timestamp)

- **Budget Violation**: A deterministic reasoned failure element.
   - `rule` (e.g., `max_files`, `max_changed_lines`, `allow_paths`, `deny_paths`)
   - `path` (optional)
   - `message` (required)
   - `expected` (optional)
  - `observed` (optional)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: At least **8** focused fixtures under deterministic test control validate check behavior across: staged change, unstaged change, new file, deleted file, rename, denied path, out-of-budget files, out-of-budget lines, and invalid base revision.
- **SC-002**: For each fixture, duplicate execution of `changebudget check` without content changes must produce byte-identical key metrics (counts and violation IDs) in at least **100%** of runs.
- **SC-003**: In at least **90%** of seeded mixed-change scenarios (modified+added+deleted in same run), file and line budgets must match manual expected values.
- **SC-004**: `check` with an unreachable base revision must fail with a deterministic error containing the revision and reason in **100%** of cases.
- **SC-005**: `check` must not alter working tree files or staged state in **100%** of executions.

## Assumptions

- All paths referenced in contracts and evaluation output are repository-relative, using `/` normalized separators.
- Text/binary classification follows deterministic repository classification rules selected by SPEC-002 and reused for all file types consistently.
- A contract can be evaluated with either active state or `--draft`, and draft-only checks do not mutate lifecycle state.
- `allow_paths` and `deny_paths` are expected as glob-like patterns (not regex) with deterministic matching rules.

## Explicit Non-Goals

This specification does **not** define:

- final exit codes and automation strategy (SPEC-003);
- auto-repair or auto-revert behavior;
- OpenCode runtime interception;
- cloud/remote policy sync;
- stack-specific policy packs (SPEC-005);
- task synchronization with Spec-Kit (SPEC-006).

## Compatibility Impact

- **Backward compatibility for state**: Existing `.changebudget` lifecycle state and contract documents remain valid with no schema migration required in SPEC-002.
- **Behavioral compatibility**: `changebudget check` continues to support structure validation but now produces deterministic budget outputs when an active contract or valid draft is available.
- **Tooling compatibility**: No breaking change to `init/start/status/close` command interfaces is introduced by this spec.
