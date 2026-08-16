# Tasks: Local Change Contract Lifecycle

**Input**: Design documents from `/specs/001-change-contract-lifecycle`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/`

**Organization**: Tasks are grouped by user story and ordered for incremental delivery.

## Format: `- [ ] [TaskID] [P?] [Story?] Description with file path`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: minimal CLI project bootstrap for SPEC-001 implementation.

- [x] T001 Create the Node.js CLI scaffolding in `package.json`, `tsconfig.json`, and `.gitignore`, including `build`, `typecheck`, and `test` scripts plus package `bin` mapping.
- [x] T002 Create baseline folders (`src/cli`, `src/core`, `src/models`, `tests`) and a command entrypoint skeleton in `src/cli/index.ts`.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: shared primitives required before any user story.

- [x] T003 Add domain models in `src/models/change-contract.ts`, `src/models/lifecycle-state.ts`, and error hierarchy in `src/models/errors.ts`.
- [x] T004 Implement repository path constants and atomic JSON helpers in `src/core/state/state.ts`.
- [x] T005 Implement Git repository detection and revision validation in `src/core/git/repo.ts`.
- [x] T006 Add contract input parsing and normalization in `src/cli/parsers/contract-input.ts` and validation rules in `src/core/validation/contract-validator.ts` (preset and field constraints).
- [x] T007 Implement lifecycle transition and contract persistence operations in `src/core/state/transitions.ts` and `src/core/state/contracts.ts`.
- [x] T008 Add command output and exit-code mapping utilities in `src/cli/output.ts`.

## Phase 3: User Story 1 - Initialize ChangeBudget in a repository (Priority: P1)

**Goal**: A repository can be initialized deterministically once and only in a valid Git context.

- [x] T009 [US1] Implement `changebudget init` in `src/cli/commands/init.ts` with non-git protection, deterministic no-op/explicit-conflict behavior, and `.changebudget/` creation.
- [x] T010 [US1] Implement init persistence in `src/core/state/state.ts` to create `.changebudget/state.json`, set `schema_version`, set `initialized`, and create `.changebudget/contracts/`.

## Phase 4: User Story 2 - Start and inspect one active contract (Priority: P1)

**Goal**: An active contract can be started, queried, and validated.

- [x] T011 [US2] Implement `changebudget start` in `src/cli/commands/start.ts` to validate input, persist `.changebudget/contracts/<id>.json`, and transition `initialized -> active`.
- [x] T012 [US2] Implement `changebudget status` in `src/cli/commands/status.ts`, including active contract summary and last-closed metadata resolution.
- [x] T013 [US2] Implement `changebudget check` in `src/cli/commands/check.ts` to validate the active contract or `--draft` file without mutating state.
- [x] T014 [US2] Wire `init`, `start`, `status`, `check`, and `close` command dispatch and deterministic usage in `src/cli/index.ts`.

## Phase 5: User Story 3 - Enforce single active contract (Priority: P2)

**Goal**: A second active contract request is rejected with explicit reason and active-contract identity.

- [x] T015 [US3] Implement the single-active guard in `src/core/state/transitions.ts` and return `StateConflictError` from `src/cli/commands/start.ts`.

## Phase 6: User Story 4 - Close and recover lifecycle deterministically (Priority: P3)

**Goal**: Active contracts close safely and state remains ready for the next lifecycle cycle.

- [x] T016 [US4] Implement `changebudget close` in `src/cli/commands/close.ts` with actor/reason metadata and `active -> closed` transition.
- [x] T017 [US4] Persist closure metadata and `last_closed_contract_id` atomically in `src/core/state/contracts.ts`, and ensure safe behavior when `close` is called without an active contract.

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: focused validation that keeps the SPEC-001 surface reliable without adding future-spec features.

- [x] T018 [P] Add integration coverage for US1 + US2 in `tests/integration/lifecycle-init-start-status-check.spec.ts`.
- [x] T019 [P] Add integration and unit coverage for US3 + US4 edge cases in `tests/integration/lifecycle-init-start-status-check.spec.ts` and `tests/unit/state-validation.test.ts`.
- [x] T020 [P] Add minimal error-path tests for invalid input and corrupt state in `tests/unit/state-validation.test.ts` and verify deterministic failure messages.

## Dependencies & Execution Order

### User Story Dependencies

- **US1**: no prerequisite other than Setup + Foundational
- **US2**: depends on US1 and Foundational completion
- **US3**: depends on US2
- **US4**: depends on US2

### Within-Story Dependencies

- US2 tasks depend on foundational parsing, state, validation, and transition helpers.
- US3 and US4 are layered on transition behavior and state persistence from US2.

## Parallel Opportunities

- Foundational tasks `T003`, `T004`, `T005`, and `T006` can run in parallel while coordinating exports.
- `T011`, `T012`, and `T013` can run in parallel after foundational state/validation is ready.
- Polish tasks can run after all user stories are implemented.

## Parallel Example: User Story 2

```bash
Task: "T011 Implement changebudget start in src/cli/commands/start.ts"
Task: "T012 Implement changebudget status in src/cli/commands/status.ts"
Task: "T013 Implement changebudget check in src/cli/commands/check.ts"
```

## Implementation Strategy

### MVP First (US1 + US2)

1. Complete Phases 1 and 2.
2. Implement US1 and US2.
3. Validate init/start/status/check end-to-end.
4. Then implement US3 and US4.

### Incremental Delivery

1. Complete Setup + Foundational.
2. Complete US1.
3. Complete US2.
4. Complete US3.
5. Complete US4.
6. Add targeted tests in Polish.
