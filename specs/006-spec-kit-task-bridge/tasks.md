---

description: "Implementation tasks for the Spec-Kit Task Bridge"

---

# Tasks: Spec-Kit Task Bridge (SPEC-006)

**Input**: Design documents from `/specs/006-spec-kit-task-bridge/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The spec input explicitly requires proportional coverage of parsing, determinism, lifecycle persistence, output, budget precedence, backward compatibility, read-only behavior, and deterministic output. Tests are consolidated (table-driven where possible), not duplicated across equivalent permutations.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root. Project is an existing TypeScript 5.9 / Node 22 ESM monorepo-in-`src/` with tests under `tests/{unit,integration,acceptance}`. No new dependencies; build via `tsc`, test via `node --test`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

N/A — the repository, TypeScript build (`npm run build`, plugin tsconfig), Node test runner, and `tests/` layout already exist from SPEC-001..005. No new packages, no new tooling, no scaffolding is required. Do not add any.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core task domain that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T001 Create `src/models/spec-kit-task.ts` with `SpecKitTaskResolution` (`task_id`, `task_title`, `source_feature`, `source_path`, `budget_default` where `budget_default` is a raw unvalidated annotation string or null), `TaskOutputObject` (`id`, `title`, `source_feature`, `source_path`), `TASK_ID_PATTERN = /^[Tt][0-9]{3,}$/`, `isTaskIdInput(raw): boolean`, and `canonicalizeTaskId(raw): string` (whole-string `.toUpperCase()`; input must already satisfy the pattern). See `specs/006-spec-kit-task-bridge/contracts/task-id-grammar.md`. [FR-001, FR-005, FR-009]
- [x] T002 Create `src/core/spec-kit/tasks.ts` with three pure/leaf exports using only `node:fs/promises` (`readdir`, `readFile`), `node:path`, and `models/errors.js`:
  - `parseTaskLine(line)`: syntax-only line parser for `- <checkbox> <TaskId> [marker]* <title>` with checkbox ∈ `[ ]`/`[x]`/`[X]`; ID token must match `TASK_ID_PATTERN`; extract `[budget:<value>]` as an **unvalidated** annotation string (semantic validation happens in `start` only when it is the effective budget source — do not reject invalid values here); remaining plain text = title; empty title → "empty-title" result; non-task/malformed lines → `null`.
  - `discoverTaskSources(repositoryRoot)`: `readdir('specs/', { withFileTypes: true })`, candidates restricted to real non-symlink directories, `localeCompare`-sorted, each with a present `tasks.md` (`pathExists`), returning `{ feature, relativePath }` with forward-slash repository-relative paths.
  - `resolveSpecKitTask(repositoryRoot, taskId)`: exact-match aggregation in deterministic order (see `data-model.md` Resolution algorithm); throws `InputValidationError` for not-found (names scanned sources), ambiguity (more than one distinct source path or duplicate within one file; lists every distinct source path sorted), empty-title-only, and invalid-effective-annotation is NOT handled here (deferred to US4); throws `IOStateError` for an unreadable `tasks.md`. Never reads `.specify/feature.json`. [FR-002, FR-003, FR-004, FR-013, FR-017]
- [x] T003 Create `tests/unit/spec-kit-tasks.test.ts` — table-driven unit tests for `src/core/spec-kit/tasks.ts`: valid line parsing, `[x]`/`[X]` markers, marker stripping, `[budget:...]` extraction, empty-title entries, non-task/malformed lines (missing checkbox, no ID token, bad grammar like `T31`/`T031x`), discovery ordering (lexicographic, nested/non-dir entries ignored), exact-match resolution, unknown-ID error listing scanned sources, multi-source and same-file ambiguity errors, and forward-slash path output.

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Start a contract associated with a Spec-Kit task (Priority: P1) 🎯 MVP

**Goal**: `changebudget start T031 --tiny` opens a contract that already carries the task ID, resolved title, source feature, and `tasks.md` path, without Spec-Kit ceremony.

**Independent Test**: In a fixture with `specs/006-example-feature/tasks.md` containing `- [ ] T031 Implement task bridge`, run `changebudget init` then `changebudget start T031 --tiny`, then read `.changebudget/contracts/<id>.json` and assert the persisted contract has `task_id=T031`, `task_title='Implement task bridge'`, `task_source_feature='006-example-feature'`, `task_source_path='specs/006-example-feature/tasks.md'`, `preset='tiny'`, and `task_description` defaulting to `task_title` when `--task` was not given.

### Implementation for User Story 1

- [ ] T004 [US1] Add the flat nullable task fields to `src/models/change-contract.ts`: `task_id`, `task_title`, `task_source_feature`, `task_source_path` on `ChangeContract`; make them **optional** (`?: string | null`) on `ParsedContractInput` (so `check.ts` construction sites keep compiling) and nullable required on `ValidatedContractInput`; set them in `createDraftContract` from input. [FR-005, FR-016]
- [ ] T005 [P] [US1] Extend `src/cli/parsers/contract-input.ts`:
  - Accept at most one positional argument instead of rejecting all positionals: it must satisfy `TASK_ID_PATTERN`, is canonicalized via `canonicalizeTaskId`, and stored as `parsed.task_id`; any other positional keeps the existing `Unexpected positional argument` error. Grammar details in `specs/006-spec-kit-task-bridge/contracts/task-id-grammar.md`.
  - Add `--tiny`/`--normal`/`--free` as exact aliases for `--preset tiny|normal|free`; combining any shorthand with `--preset` throws the existing deterministic input error. [FR-001, FR-011]
- [ ] T006 [US1] Extend `src/core/validation/contract-validator.ts` and `normalizeValidatedContractInput` to accept and normalize the four optional task fields (defaulting missing/`null` to `null`) without blocking legacy contracts, and update `tests/unit/contract-validation.test.ts` with a table-driven case set covering task-field presence/absence. [FR-016]
- [ ] T007 [US1] Integrate task start in `src/cli/commands/start.ts` `runStart`: when `parsed.task_id` is present, call `resolveSpecKitTask(repositoryRoot, parsed.task_id)` **before** `assertInputIsValid`; if `task_description` is null (no `--task`), default it to the resolved `task_title`; attach the four resolved fields to the contract object before the existing `writeContract`/`transitionToActive`/`writeLifecycleState` flow. All resolution failures must throw before any contract or lifecycle write (no partial state). Do NOT implement budget-default annotation precedence yet (US4). [FR-003, FR-004, FR-005, FR-006, FR-015]
- [ ] T008 [US1] Extend `tests/unit/start-command.test.ts` with focused command-level cases: task start persists all four fields, `task_description` defaults to title (and explicit `--task` overrides it while `task_title` is still stored), and failed starts (unknown ID, ambiguous ID, invalid grammar positional, no `specs/`) leave the `.changebudget/` directory byte-identical to before the command. [FR-003, FR-004, FR-005, FR-006, FR-015]

**Checkpoint**: At this point, User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Resolve tasks deterministically and safely (Priority: P1)

**Goal**: Unknown and ambiguous task IDs fail clearly and reproducibly; Spec-Kit files stay untouched and unread-once-unused.

**Note**: The resolution engine, error surface, and read-only guarantees are implemented in Phase 2 (T002) and exercised command-level in T008 (US1). This phase adds the remaining safety/determinism verification that no other task covers.

**Independent Test**: `tests/unit/spec-kit-tasks.test.ts` (T009) runs green for canonicalization equivalence, unreadable-file handling, symlink exclusion, and byte-stable repeated resolution.

### Tests for User Story 2

- [ ] T009 [US2] Extend `tests/unit/spec-kit-tasks.test.ts` (table-driven) for resolution safety and determinism: lowercase input resolves identically to canonical (`t031` ≡ `T031`); an unreadable `tasks.md` yields `IOStateError` (never a silent not-found); symlinked directories under `specs/` are excluded; repeated `resolveSpecKitTask` calls produce byte-identical error messages and source lists; asserting no file writes occur via the resolver (e.g. working tree untouched). [FR-003, FR-004, FR-013, FR-017]

**Checkpoint**: At this point, User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - See task context in status, check, and close (Priority: P2)

**Goal**: Task identity follows the contract through its lifecycle and is visible in human and machine-readable output.

**Independent Test**: Start a task-tied contract, then run `status`, `check --json`, and `close`, and assert each output carries the same task ID/source; assert a task-free contract omits all task output.

### Implementation for User Story 3

- [ ] T010 [US3] Add optional nullable `task?: TaskOutputObject | null` to `BudgetCheckResult` in `src/models/check-result.ts`; add optional `task?: TaskOutputObject | null` to `CheckEvaluationInput` in `src/core/check/rules.ts`; pass it through in `evaluateBudgetCheck` so the result carries the input task unchanged. [FR-009]
- [ ] T011 [US3] In `src/cli/commands/check.ts`, derive the `TaskOutputObject` from the parsed contract payload for both the active and `--draft` paths and supply it to `buildContractEvaluationInput`; leave `task` unset/null in the failure-result and status failure builders. [FR-009]
- [ ] T012 [P] [US3] Extend `src/cli/commands/close.ts`: add the closed `ChangeContract` (or its task fields) to `CloseResult` by reusing the contract returned from `closeContractInPlace` so the printer can emit task context without reading the file again. [FR-010]
- [ ] T013 [US3] Extend printers in `src/cli/index.ts`:
  - `status` human output: when a displayed contract (active or last-closed) carries `task_id`, print `Task: <task_id>` and `Source: <task_source_path>`; when it does not, keep the existing `Task: <task_description>` line with no `Source:` line.
  - `close`: after `Contract closed.`, when the closed contract has `task_id`, print `Task:` and `Source:` lines per `contracts/human-output.md`.
  - `printCheckResultJson` and `printStatusResultJson`: include the structured `task` object (`id`, `title`, `source_feature`, `source_path`) **only when present**, and omit the key entirely otherwise — the payload must remain byte-identical to the SPEC-001..005 baseline for task-free contracts (`contracts/json-output.md`). Do not add a `task: null` key.
  - `src/cli/commands/status.ts` needs no change beyond the result already carrying contract objects; confirm the last-closed path surfaces task fields. [FR-008, FR-009, FR-010, FR-016]
- [ ] T014 [P] [US3] Extend `tests/unit/status-check-close.test.ts` (table-driven) covering: `status` `Task:`/`Source:` lines for task-tied active and last-closed contracts; legacy `Task: <description>` preserved for task-free contracts; `check --json` and `status --budget --json` include `task` for task-tied and omit it for task-free contracts (asserting byte-identical payloads otherwise); `close` output mentions task ID + source only when present. [FR-008, FR-009, FR-010, FR-016, FR-017]

**Checkpoint**: At this point, User Stories 1, 2, AND 3 work independently.

---

## Phase 6: User Story 4 - Fast path with explicit budget default per task (Priority: P2)

**Goal**: Explicit `[budget:<preset>]` annotations give task starts a deterministic budget default; an explicit CLI budget flag always wins; shorthands work without ceremony.

**Independent Test**: `tests/unit/start-command.test.ts` (T016) covers the annotation/CLI precedence matrix, shorthand↔preset equivalence, and mutual exclusion.

### Implementation for User Story 4

- [ ] T015 [US4] Implement budget-default precedence in `src/cli/commands/start.ts` after `resolveSpecKitTask` and before validity checks: if the user passed no CLI budget flag (`--preset`/`--tiny`/`--normal`/`--free`) and the resolution carries a `[budget:<value>]` annotation, validate `<value>` against `{tiny, normal, free}` and set `parsed.preset`; an invalid value throws `InputValidationError` before any persistence; if a CLI budget flag is present, the annotation is ignored entirely (even if invalid). Alias/shorthand semantics already parsed in T005. [FR-011, FR-012, FR-015]
- [ ] T016 [US4] Extend `tests/unit/start-command.test.ts` (table-driven) for budget default: valid annotation sets preset with no CLI flag; `--normal` overrides an annotation; `--preset` vs shorthand equivalence (`--tiny` ≡ `--preset tiny`); shorthand + `--preset` → deterministic input error; invalid annotation (e.g. `[budget:custom]`) fails without persisting when it would be the effective source; invalid annotation is silently ignored when a CLI flag is present. [FR-011, FR-012, FR-015]

**Checkpoint**: At this point, User Stories 1, 2, 3, AND 4 work independently.

---

## Phase 7: User Story 5 - Preserve behavior for repositories without Spec-Kit (Priority: P2)

**Goal**: Every non-Spec-Kit workflow keeps working unchanged; the bridge is strictly additive, and the OpenCode guard projection is untouched.

**Independent Test**: `tests/integration/spec-kit-task-bridge.spec.ts` (T017) runs the full lifecycle in a repo with no `specs/` and asserts outputs/persisted contracts are byte-identical to the SPEC-001..005 baseline; T018 asserts the guard projection is unchanged by task fields.

### Tests for User Story 5 (and cross-story end-to-end coverage)

- [ ] T017 [US5] Create `tests/integration/spec-kit-task-bridge.spec.ts` (mirrors `tests/integration/lifecycle-init-start-status-check.spec.ts` style, real git fixtures plus the compiled CLI): full task lifecycle `init → start T031 --tiny → status (Task:/Source: lines) → check --json (task object) → close (task lines)` retains identical task metadata; unknown `T999` and ambiguous `T031` (two features) fail with stable errors and leave `.changebudget/` byte-identical; read-only proof that `git status --short` and raw `tasks.md` bytes are unchanged after task-based starts (no completion marking); budget precedence end-to-end (annotation default, `--normal` override); a no-Spec-Kit fixture runs the full lifecycle and its human output/JSON/persisted contract are byte-identical to the SPEC-001..005 baseline. [US1-US5; FR-002..FR-017; seeds SC-001..SC-006]
- [ ] T018 [US5] Extend the OpenCode guard tests (`tests/unit/opencode-runtime-projection.test.ts` and/or `tests/integration/opencode-plugin-runtime-hook.spec.ts`) to assert the guard projection is identical whether or not the evaluated contract carries the four task fields. [FR-007, SC-004]

**Checkpoint**: All user stories complete and independently verified.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Acceptance metrics, gates, and end-to-end validation affecting all stories

- [ ] T019 Create `tests/acceptance/spec006-task-bridge-metrics.test.ts` in the SPEC-005 acceptance style, implementing SC-001..SC-006 and writing `specs/006-spec-kit-task-bridge/acceptance-metrics.md`: at least 50 mixed `start → status → check → close` task-tied scenarios retaining identical metadata (SC-001); at least 20 unknown-ID runs leaving state byte-identical with a stable error (SC-002); at least 20 ambiguous-ID runs listing all sources with zero guesses (SC-003); 100% task-free/no-Spec-Kit outputs byte-identical to baseline (SC-004); at least 20 task-based starts with `git status --short` and `tasks.md` byte-identical (SC-005); and the fast path `start T031 --tiny → check → close` with no tasks.md/completion/spec-kit ceremony (SC-006). [SC-001..SC-006]
- [ ] T020 Run the validation gate: `npm run build`, full `npm test`, and execute the `specs/006-spec-kit-task-bridge/quickstart.md` scenarios (fast path, unknown, ambiguous, budget precedence, no-Spec-Kit, read-only, lifecycle guard) in disposable fixtures; confirm no new runtime dependencies were introduced, output orderings are deterministic (FR-017), and none of the SPEC-001..005 behaviors regressed. [FR-017; quickstart]

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: N/A — already satisfied by the existing repository.
- **Foundational (Phase 2)**: No dependencies — can start immediately. **BLOCKS all user stories** (T001 → T002 → T003).
- **User Stories (Phase 3+)**: All depend on Foundational completion.
  - US1 (Phase 3) is the MVP and can start immediately after Phase 2 (T014 does not need to wait for US3 wiring).
  - US2 (Phase 4): depends on Foundational (T003) + US1 command-level coverage (T008).
  - US3 (Phase 5): depends on US1 (contract fields exist on read contracts); `status` human lines depend on US1-start contracts.
  - US4 (Phase 6): depends on US1 (T007 start wiring) and T005 shorthands; can be implemented after US1 without US2/US3.
  - US5 (Phase 7): depends on US1-US4 being functional (exercises the whole lifecycle).
- **Polish (Phase 8)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Foundational (Phase 2) only — no dependency on other stories.
- **User Story 2 (P1)**: Foundational + US1 command coverage — no dependency on US3-5.
- **User Story 3 (P2)**: US1 — requires task fields to be readable on contracts before output can surface them.
- **User Story 4 (P2)**: US1 + T005 (shorthands) — independent of US2/US3.
- **User Story 5 (P2)**: US1-US4 — end-to-end compatibility harness.

### Within Each User Story

- Implementation before consolidated table-driven tests; each story is complete before the next priorities.
- T005, T012, T014 are marked [P]: different files / independent slices.

### Parallel Opportunities

- **Phase 2**: T001 then T002 must be sequenced (T002 imports T001 types); T003 after both.
- **Phase 3**: T004 and T005 can run in parallel (different files); T006 after T004; T007 after T004/T005/T006; T008 after T007.
- **Phase 5**: T010, T012 are independent of each other (different files); T011 after T010; T013 after T011/T012; T014 after T013.
- **Phase 8**: T019 and T020 are sequential (gate after metrics), both after all user stories.

---

## Parallel Example: First Block (Phase 2)

```bash
# Sequenced block to complete first (same turn is fine — small edits):
Task: "T001 Create src/models/spec-kit-task.ts"
Task: "T002 Create src/core/spec-kit/tasks.ts (depends on T001 types)"
Task: "T003 Create tests/unit/spec-kit-tasks.test.ts (after T001+T002)"
```

```bash
# Phase 3 parallel slice after T001 completes:
Task: "T004 Extend src/models/change-contract.ts"
Task: "T005 Extend src/cli/parsers/contract-input.ts"
```

---

## Implementation Strategy

### Recommended First Block

1. **T001 + T002 + T003 together** (one turn): the model file and the leaf resolution module are small and form one compile boundary; their table-driven unit tests verify the whole domain before any user story starts. Run `npm run build` + the unit tests (`node --test dist/tests/unit/spec-kit-tasks.test.js`) to confirm green.
2. Continue with US1 (T004 → T005 → T006 → T007 → T008).

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001-T003)
2. Complete Phase 3: User Story 1 (T004-T008)
3. **STOP and VALIDATE**: `npm run build`, run unit tests; verify a fixture `start T031 --tiny` persists all four task fields (read the contract JSON). MVP delivered: test→contract→implement→check→close fast path works with explicit `--tiny/--normal/--free` and no budget-default annotation yet.

### Incremental Delivery

1. Foundational complete → domain ready
2. Add US1 (start from Txxx) → MVP → validate independently
3. Add US2 (determinism/safety verification) → US3 (output across lifecycle) → US4 (budget defaults) → each independently then together
4. Add US5 (backward-compat + read-only integration) → Polish (acceptance metrics + gate)
5. Each story adds value without breaking previous stories; the fast path is preserved throughout.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps task to the primary user story; FRs from other stories are called out in the description where a task serves multiple requirements.
- Each user story is independently completable and testable; tests are consolidated/table-driven and never duplicated across equivalent permutations.
- Commit after each task or logical group (the `git` extension's `/speckit.git.commit` is available).
- Stop at any checkpoint to validate the story independently.
- Avoid vague tasks, same-file conflicts, cross-story dependencies that break independence.
- Out of scope (do NOT implement in this feature): `tasks.md` writes, `[x]` completion marking or inference, `/speckit.*` invocation, LLM interpretation, automatic stack detection, SPEC-007 budget advice, other spec frameworks, remote/cloud state, and unrelated refactors (spec `.specify/feature.json` must never be read for resolution).