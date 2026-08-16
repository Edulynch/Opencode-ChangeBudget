# Feature Specification: Local Change Contract Lifecycle

**Feature Branch**: `001-change-contract-lifecycle`

**Created**: 2026-08-15

**Status**: Draft

**Input**: User description: "Implement the first roadmap specification for ChangeBudget: SPEC-001 — Local Change Contract Lifecycle"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Initialize ChangeBudget in a repository (Priority: P1)

A developer can initialize ChangeBudget in an existing Git repository and get a clear, local lifecycle workspace.

**Why this priority**: Without initialization there is no safe place to persist contracts, so this enables the entire SPEC-001 flow.

**Independent Test**: In an existing Git repository, run `changebudget init` and immediately verify that local ChangeBudget state files appear.

**Acceptance Scenarios**:

1. **Given** a Git repository without previous ChangeBudget state, **When** `changebudget init` is run, **Then** state storage is created locally and `status` reports "initialized".
2. **Given** a Git repository already initialized, **When** `changebudget init` is run again, **Then** initialization is handled deterministically (either no state change or explicit safe failure message) and no contract data is lost.

---

### User Story 2 - Start and inspect one active contract (Priority: P1)

A developer can define one active contract, inspect it, and know exactly what scope controls are in force.

**Why this priority**: This is the core behavior of SPEC-001 and the foundation for later specs.

**Independent Test**: Starting from `initialized` state, run `changebudget start` with contract input and then `changebudget status` and `changebudget check`.

**Acceptance Scenarios**:

1. **Given** an initialized repository with no active contract, **When** `changebudget start` is called with valid contract data, **Then** lifecycle state becomes `active` and status shows the saved contract details.
2. **Given** an active contract exists, **When** `changebudget status` is run, **Then** the contract name, lifecycle state, base revision, and configured constraints are shown.

---

### User Story 3 - Enforce single active contract (Priority: P2)

A developer receives a clear error when trying to open a second contract while one is already active.

**Why this priority**: Prevents ambiguous scope and keeps enforcement deterministic.

**Independent Test**: Create one active contract and immediately run `changebudget start` again.

**Acceptance Scenarios**:

1. **Given** an active contract, **When** a new `changebudget start` command is issued, **Then** command exits with an explicit error that includes the active contract id and why a second contract is blocked.

---

### User Story 4 - Close and recover lifecycle deterministically (Priority: P3)

A developer can end an active contract and keep an auditable local record of that closure.

**Why this priority**: Makes the lifecycle finite and supports reliable handoff to later validation and reporting specs.

**Independent Test**: Start a contract, close it, and then verify that no active contract remains while close metadata is still preserved.

**Acceptance Scenarios**:

1. **Given** an active contract exists, **When** `changebudget close` is called, **Then** lifecycle becomes `closed`, `status` returns to no active contract state, and close metadata is persisted.
2. **Given** no active contract exists, **When** `changebudget close` is called, **Then** command fails with a clear actionable error and does not create partial state.

### Edge Cases

- What happens when `changebudget check` is run in `uninitialized` state?
- What happens when a contract field is missing or has an invalid value (for example, negative file limit or empty task description)?
- What happens if `changebudget init` is run in a repository that is not a Git working tree or is not writable?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST support `changebudget init` for local lifecycle initialization.

- **FR-002**: `changebudget init` MUST require the command to run inside a Git repository.
  If not in a Git repository, it MUST fail with an explicit error and no partial state changes.

- **FR-003**: `changebudget init` MUST create local, human-readable state artifacts under the repository root:
  - `.changebudget/state.json`
  - `.changebudget/contracts/`
  - `.changebudget/contracts/history.json` *(optional per repository)*
  No external service, database, or cloud dependency MUST be required.

- **FR-004**: `changebudget init` MUST be deterministic.
  A repeated call after successful initialization MUST either:
  - report "already initialized" and preserve existing content, or
  - fail with a specific, documented conflict message.

- **FR-005**: The system MUST support `changebudget start` in `initialized` state.
  The command MUST accept at least the following contract fields:
  `task_description`, `base_revision`, `allow_paths`, `deny_paths`,
  `max_files`, `max_changed_lines`, `allow_new_files`, `allow_new_dependencies`,
  `allow_migrations`, `allow_config_changes`, `allow_public_api_changes`, and `preset`.

- **FR-006**: `changebudget start` MUST validate contract structure before persisting.
  Validation MUST include:
  - required `task_description` and `base_revision` non-empty
  - numeric limits are non-negative integers when present
  - toggles are booleans
  - path arrays contain non-empty strings
  - `preset`, if provided, is one of `tiny`, `normal`, `free`, or `custom`

- **FR-007**: A valid `changebudget start` MUST:
  - persist the contract under `.changebudget/contracts/`
  - set lifecycle state to `active`
  - store the active contract ID in state metadata
  - expose `created_at`, `created_by`, and `status` fields.

- **FR-008**: `changebudget start` MUST reject contracts when state is not `initialized`
  (including `uninitialized` or already-`active` state).
  Rejection MUST be explicit, mention current lifecycle state, and must not mutate contract data.

- **FR-009**: The system MUST support `changebudget status` and return deterministic output with:
  - repository initialization state
  - lifecycle state (`uninitialized`, `initialized`, `active`, `closed`)
  - active contract summary when applicable
  - the last close reason/metadata when no active contract exists.

- **FR-010**: The system MUST support `changebudget check` for contract/configuration validation.
  It MUST validate either the active contract or a provided draft file, and provide
  actionable error messages for all failures.

- **FR-011**: The system MUST support `changebudget close` and transition deterministically
  from `active` to `closed` with closure metadata (timestamp, reason, actor).

- **FR-012**: `changebudget close` MUST fail safely when no active contract exists and
  must not create or modify an active contract file in that case.

- **FR-013**: The command set MUST persist lifecycle state across CLI process restarts.

- **FR-014**: The system MUST keep all lifecycle artifacts inside the repository and must not require network calls for SPEC-001 operations.

- **FR-015**: Lifecycle transitions MUST be deterministic and must only follow:
  - `uninitialized` -> `initialized` (via `init`)
  - `initialized` -> `active` (via `start`)
  - `active` -> `closed` (via `close`)
  - `closed` -> `initialized` (via explicit next `start` or re-initialization behavior)

- **FR-016**: The system MUST not implement full diff-based budget enforcement, PASS/REPAIR/HUMAN_REVIEW decisioning,
  OpenCode interception, Spec-Kit task integration, advisor behavior, platform-specific policy engines,
  telemetry, or remote synchronization in this specification.

### Key Entities

- **Change Contract**: A persisted authorization object for one task.
  - `id` (required, unique)
  - `task_description` (required)
  - `base_revision` (required Git reference)
  - `allow_paths` (array, default `[]`)
  - `deny_paths` (array, default `[]`)
  - `max_files` (integer, nullable)
  - `max_changed_lines` (integer, nullable)
  - `allow_new_files` (boolean)
  - `allow_new_dependencies` (boolean)
  - `allow_migrations` (boolean)
  - `allow_config_changes` (boolean)
  - `allow_public_api_changes` (boolean)
  - `preset` (`tiny`, `normal`, `free`, `custom`)
  - `status` (`draft`, `active`, `closed`)
  - `created_at`, `updated_at`, `closed_at` timestamps

- **Lifecycle State**: Repository-scoped state record under `.changebudget/state.json`.
  - `lifecycle_state` (`uninitialized`, `initialized`, `active`, `closed`)
  - `active_contract_id`
  - `last_closed_contract_id`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can initialize SPEC-001 flow in an existing Git repository in under **10 seconds** on a normal local machine.
- **SC-002**: Starting from the same repository and same command sequence, lifecycle output (`status`, `check`) is identical across runs (deterministic behavior).
- **SC-003**: A second `changebudget start` is rejected in at least **100%** of cases when another contract is active.
- **SC-004**: Contract transition accuracy reaches **100%** for the defined transitions: `initialized`→`active`→`closed` in all validated scenarios.
- **SC-005**: At least **95%** of invalid contract inputs tested with `changebudget check` return a specific reason tied to the failed field.
- **SC-006**: In manual local validation, at least **99%** of active commands (`init`, `status`, `start`, `close`, `check`) complete without requiring external service calls.

## Assumptions

- Repository root is a normal local Git checkout, and path input values are relative to that root.
- `check` validates only contract structure and command consistency, not file diff budgets.
- Preset values (`tiny`, `normal`, `free`, `custom`) are accepted labels; their full semantic budgets are defined in later specs.
- `allow_paths` and `deny_paths` are treated as path patterns using consistent CLI-visible matching semantics defined during implementation planning.
- Closing a contract may include an optional reason but does not require one.

## Explicit Non-Goals

This specification does **not** implement:

- changed-line calculation and enforcement
- changed-file enforcement
- PASS / REPAIR / HUMAN_REVIEW decision engine beyond structure/config validity
- OpenCode runtime interception or plugin behavior
- Spec-Kit task auto-integration
- automatic task complexity estimation or advisor features
- Android / Flutter / Spring Boot policy sets
- CI pipeline features, dashboards, SaaS functionality, accounts, telemetry, multi-agent support, or web/mobile UI
