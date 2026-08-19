# Feature Specification: Spec-Kit Task Bridge

**Feature Branch**: `006-spec-kit-task-bridge`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "Implement SPEC-006 — Spec-Kit Task Bridge"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start a contract associated with a Spec-Kit task *(Priority: P1)*

As a developer, I want to open a Change Contract directly from a Spec-Kit task identifier so the contract already knows what task it belongs to and its human-readable context.

**Why this priority**: This is the core value of SPEC-006: turning `Txxx` into a small, traceable contract without repeating task context by hand.

**Independent Test**: In a repository with a compatible `specs/<feature>/tasks.md`, run `changebudget start T031 --tiny`, then `changebudget status` and verify the active contract reports the task ID, its title, the source feature, and the source `tasks.md` path without any Spec-Kit ceremony.

**Acceptance Scenarios**:

1. **Given** a repository with `specs/006-example-feature/tasks.md` containing `- [ ] T031 <title>`, **When** `changebudget start T031 --tiny` runs, **Then** the active contract retains `task_id=T031`, the resolved task title, `task_source_feature`, `task_source_path=specs/006-example-feature/tasks.md`, and `preset=tiny`.
2. **Given** the task association above, **When** `changebudget status` runs, **Then** output includes a `Task:` line with `T031` and a `Source:` line with the `tasks.md` path.
3. **Given** the same task, **When** `changebudget start T031 --tiny` runs and `--task` is not provided, **Then** the contract `task_description` defaults to the resolved task title.

---

### User Story 2 - Resolve tasks deterministically and safely *(Priority: P1)*

As a developer, I want unknown or ambiguous task IDs to fail clearly so I never get a silently wrong task association, and I want Spec-Kit files to stay untouched.

**Why this priority**: Deterministic, read-only resolution is a hard requirement of SPEC-006 and protects the git working tree.

**Independent Test**: In a controlled fixture, run `changebudget start T999 --tiny` (unknown), then a fixture with the same ID in two features (ambiguous), and verify both fail with explicit deterministic errors and leave lifecycle state unchanged.

**Acceptance Scenarios**:

1. **Given** an ID that exists in no `tasks.md`, **When** `start` is run with that ID, **Then** the command fails with a clear, stable error naming the scanned sources and no contract or lifecycle state is written.
2. **Given** the same ID in two different `specs/<feature>/tasks.md` files, **When** `start` is run with that ID, **Then** the command fails with a deterministic ambiguity error listing both source paths and does not guess.
3. **Given** a task-based start, **When** resolution succeeds or fails, **Then** the `tasks.md` files and the git working tree are never modified, no task is marked complete, and no Spec-Kit command is invoked.

---

### User Story 3 - See task context in status, check, and close *(Priority: P2)*

As a developer, I want task identity to follow the contract through its lifecycle so reports are traceable back to the Spec-Kit task.

**Why this priority**: Traceability is what makes the bridge useful; it must be visible in both human and machine-readable output.

**Independent Test**: Start a task-tied contract, then run `status`, `check --json`, and `close`, and verify each output carries the same task ID and source.

**Acceptance Scenarios**:

1. **Given** an active task-tied contract, **When** `changebudget status` runs, **Then** the `Task:` and `Source:` lines match the stored task metadata.
2. **Given** an active task-tied contract with a working-tree change, **When** `changebudget check --json` runs, **Then** the JSON payload includes a structured task object with `id`, `title`, `source_feature`, and `source_path`.
3. **Given** `status --budget --json`, **When** an active task-tied contract exists, **Then** the JSON payload includes the same structured task object.
4. **Given** a task-tied contract being closed, **When** `changebudget close` runs, **Then** output mentions the task ID and its source path.

---

### User Story 4 - Fast path with explicit budget default per task *(Priority: P2)*

As a developer, I want a low-friction path for small tasks that includes a deterministic budget without extra configuration ceremony.

**Why this priority**: The constitution's fast path (`contract → implement → targeted validation → check → close`) must be the default for small tasks, and budget defaults must stay explicit, not inferred.

**Independent Test**: For a task line annotated with an explicit `[budget:tiny]` token and no CLI budget, start the contract and verify `preset=tiny`; then start the same task with `--normal` and verify the CLI value wins.

**Acceptance Scenarios**:

1. **Given** a task line containing `[budget:tiny]` and no CLI budget flag, **When** `changebudget start T031` runs, **Then** the contract uses `preset=tiny`.
2. **Given** the same annotated task, **When** `changebudget start T031 --normal` runs, **Then** the contract uses `preset=normal` (explicit CLI overrides the annotation).
3. **Given** `changebudget start T031 --tiny`, **When** the command runs, **Then** `--tiny` behaves exactly as `--preset tiny` and is mutually exclusive with `--preset`.
4. **Given** a task annotation with an invalid budget value, **When** `changebudget start T031` runs, **Then** start fails with a deterministic input error before any contract is written.

---

### User Story 5 - Preserve behavior for repositories without Spec-Kit *(Priority: P2)*

As a maintainer, I want every existing non-Spec-Kit workflow to keep working unchanged so the bridge is strictly additive.

**Why this priority**: SPEC-001 through SPEC-005 behavior, including the OpenCode runtime guard, is the stable core and must not regress.

**Independent Test**: In a repository with no `specs/` structure, run the full existing lifecycle (`init`, `start`, `status`, `check`, `close`) and verify output and JSON are identical to the pre-SPEC-006 baseline.

**Acceptance Scenarios**:

1. **Given** a repository without any `specs/<feature>/tasks.md`, **When** `changebudget start --task "some task"` runs, **Then** behavior and persisted contract are identical to SPEC-001..005 (all new task fields are `null`).
2. **Given** an active contract with no task metadata, **When** `status`, `check --json`, and `close` run, **Then** no task lines or task objects appear and no OpenCode guard projection changes.

## Clarifications

### Session 2026-08-17

- Q: How is a task resolved when the same ID exists in multiple features? → A: Deterministic failure listing every source path. `.specify/feature.json` is **not** consulted as a tiebreaker; ChangeBudget never guesses.
- Q: Does ChangeBudget consult `.specify/feature.json` or any other Spec-Kit state? → A: No. Resolution scans only `specs/<feature>/tasks.md` files directly under `specs/`, read-only.
- Q: May a contract be started for a task already marked `[x]`? → A: Yes. Completion markers are ignored for resolution; ChangeBudget never blocks on them and never updates them.
- Q: How is a budget default selected per task? → A: Only by an explicit `[budget:<tiny|normal|free>]` token in the task line or by an explicit CLI budget flag; the CLI always wins; there are no heuristics. Budget recommendation is SPEC-007 scope.
- Q: Where is task context exposed in machine output? → A: An optional structured `task` object in `check --json` and `status --budget --json`, and human-readable `Task:`/`Source:` lines in `status` and `close`.
- Q: What happens when `--task` is provided together with a task ID? → A: `task_description` uses the explicit `--task` text; the resolved `task_title` is still stored separately.
- Q: What happens when both `--preset` and a shorthand like `--tiny` are passed? → A: Deterministic input error; they are mutually exclusive.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `start` command MUST accept at most one optional positional argument that matches the task ID grammar `^[Tt][0-9]{3,}$`; the ID MUST be canonicalized to uppercase `T` + digits, and any other positional argument MUST be rejected with the existing deterministic argument error.
- **FR-002**: When a task ID is provided, resolution MUST scan only `specs/<feature>/tasks.md` files located directly under the repository `specs/` directory, in lexicographic feature order, and MUST be read-only.
- **FR-003**: Resolution MUST be an exact match on the canonical task ID. A task ID found in zero sources MUST fail with a clear, deterministic error before any contract or lifecycle state is written.
- **FR-004**: A task ID found in more than one source MUST fail with a deterministic ambiguity error listing every source path; ChangeBudget MUST NOT guess or use `.specify/feature.json` as a tiebreaker.
- **FR-005**: On successful resolution, the contract MUST persist `task_id`, `task_title` (the human-readable task text), `task_source_feature`, and `task_source_path` (the resolved `tasks.md` path relative to the repository root).
- **FR-006**: When a task is resolved and `--task` is not provided, `task_description` MUST default to the resolved `task_title`; when `--task` is provided, `task_description` MUST use the explicit value and `task_title` MUST still be stored.
- **FR-007**: Adding task metadata MUST NOT change any existing lifecycle, budget, path-policy, stack-policy, reporting, exit-code, or OpenCode runtime-guard behavior; task fields are strictly additive metadata.
- **FR-008**: `changebudget status` MUST print `Task:` and `Source:` lines when the active (or last-closed) contract carries task metadata, and MUST print nothing task-related otherwise.
- **FR-009**: `check --json` and `status --budget --json` MUST include an optional structured `task` object (`id`, `title`, `source_feature`, `source_path`) derived from the evaluated contract, and MUST omit it when absent.
- **FR-010**: `changebudget close` MUST include the task ID and source path in its output when the closed contract carries task metadata.
- **FR-011**: Budget selection MUST support fast-path shorthand flags `--tiny`, `--normal`, and `--free` as exact aliases for `--preset tiny|normal|free`; shorthand and `--preset` are mutually exclusive and combining them is a deterministic input error.
- **FR-012**: When a task is resolved and no CLI budget flag is given, an explicit `[budget:<tiny|normal|free>]` token in the task line MAY set the contract preset; an explicit CLI budget flag MUST override the annotation; an invalid annotation value MUST fail deterministically before contract persistence.
- **FR-013**: Reading `tasks.md` MUST never modify the file, the working tree, or git state; MUST never mark a task complete; MUST never infer completion from a ChangeBudget `PASS`; and MUST never invoke Spec-Kit commands.
- **FR-014**: Task association MUST survive the full `start → status → check → close` lifecycle because it is persisted on the contract.
- **FR-015**: Invalid task resolution (unknown, ambiguous, malformed, or invalid annotation) MUST NOT leave partial contract or lifecycle state; all task resolution and validation MUST complete before any persistence.
- **FR-016**: Backward compatibility: repositories without a `specs/` structure, and `start` invocations without a task ID, MUST behave exactly as SPEC-001 through SPEC-005 (all new fields `null`, no task output, no guard changes).
- **FR-017**: All task resolution results, error messages, and output orderings MUST be byte-stable between runs for the same repository state.

### Key Entities

- **SpecKitTaskResolution**: Result of resolving a task ID against local `tasks.md` files.
  - `task_id` (canonical `T<digits>`)
  - `task_title` (human-readable text after the ID and any markers)
  - `source_feature` (feature directory under `specs/`)
  - `source_path` (repository-relative path of the `tasks.md` file)
  - optional `budget_default` (from an explicit `[budget:<preset>]` annotation)

- **ChangeContract task surface** (additive, all nullable):
  - `task_id`
  - `task_title`
  - `task_source_feature`
  - `task_source_path`

- **Task budget annotation**: Optional, explicit, deterministic marker in a `tasks.md` task line: a bracketed token `[budget:tiny]`, `[budget:normal]`, or `[budget:free]`.

- **Task output object**: Structured machine-readable task context (`id`, `title`, `source_feature`, `source_path`) emitted by `check --json` and `status --budget --json`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In at least **50** mixed `start → status → check → close` scenarios on task-tied contracts, the task ID, title, source feature, and source path are retained and reported identically at every stage.
- **SC-002**: In at least **20** scenarios, an unknown task ID fails with the same deterministic error and leaves lifecycle state byte-identical to before the command.
- **SC-003**: In at least **20** scenarios, an ambiguous (duplicate) task ID fails deterministically listing every source, with zero guessed resolutions.
- **SC-004**: For repositories without Spec-Kit structure and for task-free `start` calls, **100%** of outputs and persisted contracts are identical to the SPEC-001..005 baseline.
- **SC-005**: In at least **20** task-based `start` runs, `git status --short` and `tasks.md` content are byte-identical before and after the command (read-only guarantee).
- **SC-006**: The fast path `changebudget start T031 --tiny → implement → check → close` completes with no tasks.md changes, no completion marking, and no Spec-Kit ceremony.

## Assumptions

- The Spec-Kit structure is `specs/<feature>/tasks.md` directly under `specs/`; other layouts are out of scope for SPEC-006.
- `tasks.md` files use the existing task-line convention: `- [ ] Txxx [markers] <text>` with `[x]`/`[X]` for completed tasks; task completion markers are metadata only.
- Users prefer strict resolution over convenience: unknown and ambiguous IDs are errors, not best-effort matches.
- Budget defaults are explicit and deterministic; any future budget recommendation belongs to SPEC-007.
- OpenCode guard projections consume only policy decisions, paths, and sensitivity flags; additive task metadata does not change projection inputs.

## Edge Cases

- What if a task ID is not found in any `tasks.md`? → Clear, stable error; no state change.
- What if the same task ID exists in two features? → Deterministic ambiguity error listing both sources; no guessing.
- What if the ID is lowercase (`t031`) or has more than three digits (`T12345`)? → Canonicalized/resolved deterministically per the grammar.
- What if a positional argument is not a task ID (for example `T031x`, `T31`, or a file name)? → Existing deterministic argument error; no fuzzy matching.
- What if the task line has an empty title after the ID and markers? → The entry is not resolvable for association and the start fails deterministically if it is the only match.
- What if the task is already marked `[x]`? → Resolution ignores the completion marker; starting is allowed; nothing is changed.
- What if `specs/` does not exist or no `tasks.md` exists? → Task-based start fails clearly; non-task start is unaffected.
- What if a `tasks.md` exists but cannot be read? → Task-based start fails deterministically rather than risk a wrong "not found".
- What if the task line carries both `[budget:...]` and a CLI budget flag? → The CLI flag wins; the annotation is ignored, not an error.
- What if the task line carries an invalid `[budget:...]` value or `[budget:custom]`? → Deterministic input error before persistence.
- What if both `--preset` and `--tiny`/`--normal`/`--free` are passed? → Deterministic input error.
- What if `start T031` runs while another contract is active? → Existing active-contract conflict error is unchanged; task resolution does not bypass lifecycle rules.
- How are feature directories ordered? → Lexicographically by directory name; file lines in file order; results are stable between runs.
- How are paths represented? → Repository-relative, forward-slash normalized paths, consistent with the rest of the CLI.

## Explicit Non-Goals

- Modifying `tasks.md` in any way.
- Checking `[x]` automatically or deciding that a task is completed.
- Inferring task completion from a ChangeBudget `PASS`.
- Invoking `/speckit.*` commands or replacing `/speckit.implement`.
- Semantic/LLM analysis of task descriptions.
- SPEC-007 diagnose/budget-advisor functionality.
- Generalized integrations for other specification frameworks.
- Remote/cloud Spec-Kit state.
- Task management UI.
- Automatic stack detection.
- Reading or trusting `.specify/feature.json` for task disambiguation.

## Compatibility Impact

- **SPEC-001 to SPEC-005 compatibility**: Lifecycle, budget, path policy, stack policy, reporting, and exit codes are unchanged when no task ID is used; all new contract fields are optional and `null` by default, so legacy contracts remain valid.
- **Storage compatibility**: Contracts gain nullable task fields; existing persisted contracts remain readable and unchanged.
- **Core CLI compatibility**: `start` gains an optional positional task ID and budget shorthands; all existing flags remain valid.
- **Plugin compatibility**: The OpenCode runtime guard continues to consume policy decisions, paths, and sensitivity flags; task metadata does not alter projection inputs or runtime actions.
- **Spec-Kit compatibility**: Only read access to `specs/<feature>/tasks.md`; no file writes, no completion state changes, no command invocation.
