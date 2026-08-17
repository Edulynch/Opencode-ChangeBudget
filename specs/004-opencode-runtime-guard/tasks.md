# Tasks: OpenCode Runtime Guard

**Input**: Design documents from `/specs/004-opencode-runtime-guard`

**Prerequisites**: `plan.md` (required), `spec.md` (required for user stories), `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`.

**Organization**: Tasks are grouped by user story to support independent implementation and validation.

## Format: `[ ]` for pending, `[x]` for completed; `[P]` where parallelizable; `[US#]` maps task to story.

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 Create plugin package metadata and entrypoint declaration in `opencode-plugin/package.json` (`name`, `main`, `build`, `typecheck`).
- [x] T002 Create plugin compiler configuration in `opencode-plugin/tsconfig.json` with strict TS options and output path to `dist`.
- [x] T003 Create runtime plugin source structure in `opencode-plugin/src/index.ts`, `opencode-plugin/src/evaluator.ts`, and `opencode-plugin/src/projection.ts`.
- [x] T004 Wire plugin package into root orchestration scripts in `package.json` (`build`, `typecheck`).

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T005 Define runtime decision model and deterministic rule constants in `opencode-plugin/src/projection.ts` (`RuntimePolicyDecision`, `RuntimeAction`, `RUNTIME_RULES`).
- [x] T006 Implement policy-to-runtime projection in `opencode-plugin/src/projection.ts` including PASSIVE, REPAIR, HUMAN_REVIEW, path deny/out-of-scope/changebudget/sensitive/fallback ordering.
- [x] T007 [P] Add path normalization, mutation-intent inference, and deterministic command/tool metadata extraction in `opencode-plugin/src/index.ts`.
- [x] T008 [P] Add evaluator context loading in `opencode-plugin/src/evaluator.ts` using existing `runCheck` and contract/state resolvers (`readLifecycleState`, `resolveActiveContract`).
- [x] T009 Add hook adapters and decision emission in `opencode-plugin/src/index.ts` across `tool.execute.before`, `command.execute.before`, and `permission.ask`.
- [x] T010 Add runtime output mapping and metadata enrichment in `opencode-plugin/src/index.ts` (`rule`, `reasonCode`, `runtimeAction`, `policyDecision`, `contractId`, `operationId`, `targetPath`).
- [x] T011 Add unit coverage of projection truth table in `tests/unit/opencode-runtime-projection.test.ts`.
- [x] T012 [P] Add end-to-end hook integration coverage in `tests/integration/opencode-plugin-runtime-hook.spec.ts` for uninitialized allow, scoped allow, out-of-scope ask, unresolved mutation block, dependency ask, and `.changebudget` block.

## Phase 3: User Story 1 - Stop forbidden writes before they land (Priority: P1)

- [x] T013 [US1] Enforce `deny_paths` as an unconditional `block` decision in `opencode-plugin/src/projection.ts` and route `permission.ask` accordingly.
- [x] T014 [US1] Enforce `.changebudget/**` hard-deny in `opencode-plugin/src/index.ts` (via `isChangeBudgetTarget`) and `opencode-plugin/src/projection.ts`.
- [x] T015 [US1] Add tests that show deterministic decision and metadata for denied targets in `tests/unit/opencode-runtime-projection.test.ts` (`RUNTIME_RULES.PATH_DENY`, `RUNTIME_RULES.CHANGEBUDGET`).
- [x] T016 [US1] Add integration coverage for blocked write-like mutation through the hook path in `tests/integration/opencode-plugin-runtime-hook.spec.ts`.

## Phase 4: User Story 2 - Ask before risky-but-not-forbidden writes (Priority: P1)

- [x] T017 [US2] Add out-of-scope path prompting in `opencode-plugin/src/projection.ts` (`OCG-PATH-OUT-SCOPE`) and ensure path-allow list evaluation happens before allow fallback in `opencode-plugin/src/index.ts`.
- [x] T018 [US2] Ensure one-shot prompt behavior is reflected as `ask` via `toRuntimePermissionStatus` and runtime status output in `opencode-plugin/src/projection.ts` and `opencode-plugin/src/index.ts`.
- [x] T019 [US2] Add out-of-scope integration test in `tests/integration/opencode-plugin-runtime-hook.spec.ts` for `tests/contract.spec.ts`-style path.
- [x] T020 [US2] Add explicit test that repeated identical asks are re-evaluated (no persisted per-path/session exception state) in `tests/integration/opencode-plugin-runtime-hook.spec.ts`.

## Phase 5: User Story 3 - Protect sensitive categories with transparent behavior (Priority: P1)

- [x] T021 [US3] Project dependency/migration/config/public API sensitivity from path + contract toggles in `opencode-plugin/src/index.ts` (`buildSensitiveFlags`) and `opencode-plugin/src/projection.ts`.
- [x] T022 [US3] Add dependency and migration category ask assertions in `tests/unit/opencode-runtime-projection.test.ts` and `tests/integration/opencode-plugin-runtime-hook.spec.ts`.
- [x] T023 [US3] Add config and public API category ask coverage in `tests/unit/opencode-runtime-projection.test.ts` and/or `tests/integration/opencode-plugin-runtime-hook.spec.ts`.

## Phase 6: User Story 4 - Keep local-first behavior when integration is unavailable (Priority: P2)

- [x] T024 [US4] Route non-initialized repos to passive allow posture in `opencode-plugin/src/evaluator.ts` and `opencode-plugin/src/projection.ts`.
- [x] T025 [US4] Implement fail-safe for initialized but unresolved runtime context (`isInited` + `contract === null` => unresolved mutation blocks) in `opencode-plugin/src/evaluator.ts` and `opencode-plugin/src/index.ts`.
- [x] T026 [US4] Validate uninitialized, resolved, and mutated/unresolved contexts in `tests/unit/opencode-runtime-projection.test.ts` and `tests/integration/opencode-plugin-runtime-hook.spec.ts`.
- [x] T027 [US4] Add regression test showing core CLI behavior remains unchanged with plugin missing/disabled in `specs/004-opencode-runtime-guard/quickstart.md` and a focused execution checklist.

## Phase 7: Polish & Cross-Cutting Concerns

- [x] T028 [P] Add regression check task list to `specs/004-opencode-runtime-guard/quickstart.md` scenarios 1-8 for manual validation.
- [x] T029 Run `npm test` and keep current count/health in repository baseline at `package.json` scripts verification (`tests/unit` + `tests/integration` plus opencode plugin hooks).
- [x] T030 Run `npm run typecheck` for both CLI and plugin `tsconfig` targets from `package.json`.
- [x] T031 Run `npm run build` for root CLI and plugin packages.

## Dependencies

- **Setup + Foundational**: All `T001`-`T012` before user story phases.
- **US1/US2/US3**: Start once foundational phase is complete.
- **US4**: Depends on `T024`-`T026` and finalizes shared compatibility posture.
- **Polish**: `T028`-`T031` after all applicable story tasks.
