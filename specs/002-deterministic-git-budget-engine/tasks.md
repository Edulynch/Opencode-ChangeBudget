# Tasks: Deterministic Git Budget Engine

**Input**: Design documents from `/specs/002-deterministic-git-budget-engine`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/`

**Tests**: Feature requires fixture coverage (SC-001) and deterministic behavior checks; include tests/tasks below.

## Format: `[ ]` for pending, `[x]` for completed; `[P]` indicates parallelizable tasks.

## Phase 1: Shared Implementation Foundations

- [x] T001 Add deterministic check result model with `PASS | FAIL` status and no severity leakage in `src/models/check-result.ts`.
- [x] T002 Implement deterministic path glob compiler and matcher utilities in `src/core/check/patterns.ts`.
- [x] T003 Implement canonical change extraction from staged, unstaged, renamed, deleted, and untracked paths in `src/core/check/diff.ts`.
- [x] T004 Implement deterministic rule evaluation and violation assembly in `src/core/check/rules.ts`.
- [x] T005 [P] Wire deterministic check command input and evaluation flow in `src/cli/commands/check.ts`.
- [x] T006 [P] Preserve `check` as read-only against `.changebudget` lifecycle files and working tree in `src/core/git/repo.ts`, `src/cli/commands/check.ts`, and `src/cli/index.ts`.

## Phase 2: User Story 1 - Live active/draft contract checks (P1)

- [x] T007 [US1] Validate repository context with `ensureGitRepository` before any budget computation.
- [x] T008 [US1] Add active contract resolution from lifecycle state in `src/cli/commands/check.ts`.
- [x] T009 [US1] Add draft contract resolution via `--draft` in `src/cli/commands/check.ts` with path joining and JSON read.
- [x] T010 [US1] Validate `base_revision` with `validateRevision` before collecting diffs in `src/cli/commands/check.ts`.
- [x] T011 [US1] Print deterministic result summary fields in `src/cli/index.ts`.
- [x] T012 [US1] Add integration test for allowed change pass flow and explicit `changed_file_count`/path policy verification in `tests/integration`.
- [x] T013 [US1] Add integration test for file budget violation (`max_files`) and line budget violation (`max_changed_lines`) with stable PASS/FAIL status values.

## Phase 3: User Story 2 - Git-state-derived file + line budgets (P1)

- [x] T014 [US2] Include staged/unstaged diff sources in changed-set builder (`src/core/check/diff.ts`).
- [x] T015 [US2] Include untracked files from `git ls-files --others --exclude-standard` in canonical set.
- [x] T016 [US2] Compute `changed_file_count`, `changed_lines_count`, `binary_change_count`, `new_file_count`, `deleted_file_count`, and `renamed_file_count` in `src/core/check/rules.ts`.
- [x] T017 [US2] Add deterministic test for staged + unstaged + deleted + untracked mix resulting in expected counts.
- [x] T018 [US2] Add deterministic test for text line delta counting using added+removed semantics.
- [x] T019 [US2] Add deterministic stability test for repeated checks with no working-tree changes (byte-identical summary metrics).

## Phase 4: User Story 3 - Deterministic path policy (P1)

- [x] T020 [US3] Implement allow-list matching with empty-allow semantics in `src/core/check/rules.ts` + `src/core/check/patterns.ts`.
- [x] T021 [US3] Implement deny precedence and path-level status generation in `src/core/check/rules.ts`.
- [x] T022 [US3] Keep deterministic ordering for `pathRuleResults` and `violations`.
- [x] T023 [US3] Add unit tests for malformed/invalid path patterns to verify early `InputValidationError` in `src/core/check/patterns.ts`.
- [x] T024 [US3] Add integration tests for allow-empty/deny-only and allow+deny overlap precedence.
- [x] T025 [US3] Add test that denied paths in `src/secrets/**` fail even when matching allow patterns.

## Phase 5: User Story 4 - Rename, delete, and binary stability (P2)

- [x] T026 [US4] Parse rename events from `--name-status --find-renames` and include source/destination data in results.
- [x] T027 [US4] Count deleted files in canonical set and expose `deleted_file_count`.
- [x] T028 [US4] Use deterministic behavior for binary paths (numeric deltas as zero, binary file-level impact tracked).
- [x] T029 [US4] Improve binary detection for untracked file candidates so binary additions are represented in `binary_change_count`.
- [x] T030 [US4] Add fixture for staged rename + tracked delete + binary change with deterministic output assertions.

## Phase 6: User Story 5 - Safe failures on invalid git context (P2)

- [x] T031 [US5] Return explicit `GitEnvironmentError` for non-repo execution in `src/cli/commands/check.ts` via `ensureGitRepository`.
- [x] T032 [US5] Return explicit `GitEnvironmentError` for unresolved base revision before budget evaluation.
- [x] T033 [US5] Add integration test for `check` in non-git directory with no PASS result and no state mutation.
- [x] T034 [US5] Add integration test for missing/unreachable base revision containing revision and reason in error context.

## Phase 7: Polish and Validation

- [x] T035 Verify SPEC-003 boundary (`PASS`/`FAIL` only) and avoid `warn`/`repair` result semantics in `src/models/check-result.ts` and `src/cli/commands/check.ts`.
- [x] T036 [P] Add unit tests for `collectChangedItems` canonical sorting, deduplication, and rename representation stability.
- [x] T037 [P] Add integration fixture for malformed deny pattern to confirm command fails without partial evaluation.
- [x] T038 [P] Add explicit coverage for state non-mutation (`state.json`, contract docs, working tree/index) around `runCheck` execution.
- [x] T039 [P] Add the remaining deterministic scenarios from `quickstart.md` as executable integration tests to satisfy SC-001/SC-002/SC-003.
- [x] T040 Run final verification suite: `npm test`, `npm run typecheck`, `npm run build`.

## Dependencies and Order

- **Foundation tasks**: `T001`–`T006` before all user story tasks.
- **US1**: `T007`–`T011`, then `T012`–`T013`.
- **US2**: `T014`–`T016`, then `T017`–`T019`.
- **US3**: `T020`–`T022`, then `T023`–`T025`.
- **US4**: `T026`–`T028`, then `T029`–`T030`.
- **US5**: `T031`–`T032`, then `T033`–`T034`.
- **Polish**: `T035` before `T036`–`T040` and after story-level changes are stable.
