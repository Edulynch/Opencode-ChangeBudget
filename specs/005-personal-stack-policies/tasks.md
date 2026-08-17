# Tasks: Personal Stack Policies

**Input**: Design documents from `/specs/005-personal-stack-policies`

**Prerequisites**: `plan.md` (required), `spec.md` (required), `research.md`, `data-model.md`.

**Tests**: Unit/integration tasks below are included where behavior is testable with the existing command surface.

**Format**: `[ ]` for pending, `[x]` for completed; `[P]` for tasks that can run in parallel; `[US#]` maps to user stories.

## Phase 1: Foundation

- [x] T001 [P] `src/models/change-contract.ts` includes stack surface fields/types (`stack_profile`, `disabled_stack_rules`, `StackProfile`, `STACK_PROFILES`) so contracts can persist profile intent.
- [x] T002 `src/core/state/state.ts` declares `STACK_POLICY_OVERRIDES_FILE` and `getStackPolicyOverridesFilePath` for `.changebudget/stack-policy-overrides.json`.
- [x] T003 `src/models/check-result.ts` extends result model with `StackPolicySummary` and `stackProfileRule`/`CBS-*` result support.
- [x] T004 `src/cli/parsers/contract-input.ts` recognizes `--stack-profile` and `--disable-stack-rule|--disable-stack-rules` flags.
- [x] T005 `src/core/validation/contract-validator.ts` validates stack profile enum and duplicate/empty `disabled_stack_rules` tokens.
- [x] T006 `src/cli/commands/start.ts` preserves normalized stack fields through contract creation and draft/active contract persistence.

## Phase 2: User Story 1 (Priority: P1) — Select stack policy profile at start

- [x] T007 [US1] Parser/validator rejects unknown stack profile values with deterministic user-facing errors (`stack-profile` and `stack_profile`).
- [x] T008 [US1] Contract lifecycle command can start with `--stack-profile <android|flutter|spring-boot|node-ts>` and stores it on the active contract.
- [x] T008a [US1] `src/cli/commands/check.ts` resolves stack policy only when a stack profile exists in the active contract/draft.
- [x] T009 [US1] `tests/unit/contract-validation.test.ts` covers valid/invalid `--stack-profile` parse paths and unknown value rejection.
- [x] T010 [US1] `tests/integration/check-budget-engine.spec.ts` includes Android profile check case with repeated deterministic `CBS-ANDROID-SIGNING` output.

## Phase 3: User Story 2 (Priority: P1) — Deterministic profile rule packs

- [x] T011 [US2] `src/core/check/stack-policy.ts` defines deterministic builtin profile packs for Android, Flutter, Spring Boot, and Node-TS.
- [x] T012 [US2] `src/cli/commands/check.ts` and `src/core/check/rules.ts` pass and apply effective rule set through evaluation.
- [x] T013 [US2] `src/core/check/rules.ts` emits stack policy violations as `rule: 'stack_profile_rule'` with deterministic `CBS-*` reason codes.
- [x] T014 [US2] `tests/integration/check-budget-engine.spec.ts` validates Flutter override behavior plus Android rule output for deterministic profile matching.
- [x] T015 [US2] `src/cli/index.ts` prints stack rule reasons in check JSON/CLI output and keeps `reason_codes` alias stable.
- [x] T016 [US2] Add explicit integration coverage for `spring-boot` and `node-ts` sensitive scenarios through `check --json` reason-code assertions to satisfy SC-001 per-profile exercise.
- [x] T017 [US2] Add deterministic ordering test around mixed stack profiles in a single repo (node-ts vs spring-boot fixtures) to assert stable `stackPolicySummary.effectiveRuleIds` ordering.

## Phase 4: User Story 3 (Priority: P2) — Repository-level overrides

- [x] T018 [US3] `src/core/check/stack-policy.ts` loads and validates `.changebudget/stack-policy-overrides.json` with profile-scoped `disable_rule_ids` and `added_rules` semantics.
- [x] T019 [US3] Effective rule set builder resolves precedence as builtin profile rules -> repository-added rules -> repository disablements -> contract disablements.
- [x] T020 [US3] `resolveStackPolicy()` validates added/target patterns via existing pattern compiler and throws deterministic input errors for malformed patterns.
- [x] T021 [US3] `tests/integration/check-budget-engine.spec.ts` validates repository-level Flutter disablement removes `flutter/configuration` and keeps other rules active.
- [x] T022 [US3] Add integration coverage for repository-level `added_rules` and ensure added rules can match during `check --json`.
- [x] T023 [US3] Add cross-repository isolation test confirming override file changes do not leak between repositories.

## Phase 5: User Story 4 (Priority: P2) — Per-contract disablement

- [x] T024 [US4] `src/cli/parsers/contract-input.ts` supports repeated and comma-separated disablement inputs.
- [x] T025 [US4] `src/core/check/stack-policy.ts` removes contract-disabled IDs and marks them as `disabled` in `stackPolicySummary.statusByRuleId`.
- [x] T026 [US4] `src/cli/index.ts` and status output printers include stack policy summary for active stack-profile contracts.
- [x] T027 [US4] `tests/unit/check-rules.test.ts` confirms stack summary propagation and active/disabled-like behavior when summary is passed through evaluation input.
- [x] T028 [US4] Add `runStart`-time validation call so malformed contract disablement is rejected before writing a contract.
- [x] T029 [US4] Add start-time validation tests that unknown/cross-profile `--disable-stack-rule` values fail with explicit `InputValidationError` while contract write is blocked.
- [x] T030 [US4] Add test for `--stack-profile` unset + `--disable-stack-rule` input to enforce FR-013b.
- [x] T031 [US4] Add contract-level disablement regression test showing only the target contract loses behavior and subsequent contracts restore defaults (US4 leak check).

## Phase 6: User Story 5 (Priority: P2) — Policy discoverability in output

- [x] T032 [US5] `src/core/check/rules.ts` returns `stackPolicySummary` in `BudgetCheckResult` payload and includes it in CLI JSON printers.
- [x] T033 [US5] `src/cli/commands/status.ts` passes stack summary through budget path and preserves check semantics in `status --budget --json`.
- [x] T034 [US5] `tests/integration/lifecycle-init-start-status-check.spec.ts` verifies stack summary in status JSON for node-ts profile and shared reason alignment with check.
- [x] T035 [US5] Add non-JSON status/check human output assertions for stack profile and per-rule status to satisfy UX discoverability in default mode.

## Phase 7: Completion & Compatibility

- [x] T036 [P] Confirm SPEC-001..004 behavior is unchanged when `stack_profile` is absent (`stackPolicySummary` remains absent; base budget/path checks unchanged).
- [x] T037 [P] Confirm SPEC-004 runtime hooks continue to consume policy results without new startup dependency.
- [x] T038 [P] Add explicit regression for FR-013 start-time validation (`disabled_stack_rules` + unknown profile/override IDs) and add test case IDs/notes to `FR-013` evidence table.
- [x] T039 [P] Create/refresh `quickstart.md` or replace with explicit test checklist since quickstart/contract artifacts are currently absent for this feature.

## Completion Summary

- Total tasks: 39
- Completed: 39
- Pending: 0

### FR-013 evidence

- `T029` (`tests/unit/start-command.test.ts: start command rejects unknown disabled stack rule IDs for selected profile`) — start-time reject for cross-profile `--disable-stack-rule`.
- `T029` (`tests/unit/start-command.test.ts: start command rejects disable ids from non-active profile overrides`) — cross-profile validation for override-defined IDs.
- `T030` (`tests/unit/start-command.test.ts: start command rejects disabled stack rules when no stack profile is set`) — start-time enforce FR-013b.
- `T038` (`tests/unit/start-command.test.ts: start command rejects unknown stack profiles before contract persistence`) — unknown profile ID is rejected deterministically.
- `T038` (`tests/unit/start-command.test.ts: start command rejects override-defined disabled rule IDs for selected profile`) — override-only invalid IDs fail before contract creation.

### SPEC boundary check

- Feature changes are currently confined to `src/` and `tests/`; no unrelated runtime or config pipeline behavior touched.
- Existing lifecycle and SPEC-001..004 flows appear preserved, with stack policy behavior gated behind `stack_profile` presence.
