# Tasks: Policy Results, Reports & Exit Codes

**Input**: Plan and spec from `/specs/003-policy-results-exit-codes/`

**Prerequisites**: `plan.md` (required), `spec.md` (required), `checklists/requirements.md`, existing implementation baseline

## Phase 1: Setup

- [x] T001 Confirm active feature branch context in `.specify/feature.json` and plan alignment.

## Phase 2: Foundational (Blocking)

- [x] T002 [P] Ensure decision and reason model compatibility in `src/models/check-result.ts` (`DecisionResult`, `ReasonCode`, `BudgetViolation`, `BudgetCheckResult`).
- [x] T003 [P] Define canonical `buildFailureResult` path in `src/cli/commands/check.ts` to return non-mutating `HUMAN_REVIEW` outcomes for known hard-fail scenarios.
- [x] T004 Map evaluation/precondition failures to `ReasonCode` in `src/cli/commands/check.ts` (`CBV-*` taxonomy and base-revision context handling).
- [x] T005 Update violation and limit sorting in `src/core/check/rules.ts` for reproducible output order.

## Phase 3: User Story 1 - Deterministic check decisions (Priority: P1)

**Goal**: Make every check result map to one of `PASS`, `REPAIR`, or `HUMAN_REVIEW` and exit deterministically.

### Tests for User Story 1

- [x] T006 [P] Extend `tests/integration/check-budget-engine.spec.ts` with PASS and REPAIR JSON/exit verification for deterministic decisions.
- [x] T007 [P] Update `tests/integration/lifecycle-init-start-status-check.spec.ts` to assert check returns HUMAN_REVIEW for malformed draft/input preconditions.

### Implementation for User Story 1

- [x] T008 [P] Implement non-throwing human-review path for malformed input, unreadable draft, unresolved base revision, and path-pattern evaluation errors in `src/cli/commands/check.ts`.
- [x] T009 Ensure `src/cli/index.ts` applies `getDecisionExitCode` to human-review results and prints decision in normal mode.

## Phase 4: User Story 2 - Stable machine output for CI parsing (Priority: P1)

**Goal**: Return consistent `--json` payload for checks and status budget with stable reason fields.

### Tests for User Story 2

- [x] T010 [P] Add assertions in `tests/integration/check-budget-engine.spec.ts` for `--json` schema fields, `reason_codes`, and ordered violation payload fields.

### Implementation for User Story 2

- [x] T011 [P] Extend `printCheckResultJson` in `src/cli/index.ts` with `reason_code`, `severity`, and `reason_codes` alias fields.
- [x] T012 [P] Extend `printStatusResultJson` in `src/cli/index.ts` with full budget payload (decision, reasons, counters, limits, paths, violations).
- [x] T013 [P] Add integration coverage in `tests/integration/check-budget-engine.spec.ts` for unresolved base revision producing HUMAN_REVIEW JSON schema.

## Phase 5: User Story 3 and 4 - Explainability and status reuse (Priority: P1/P2)

**Goal**: Keep human output clear and ensure `status --budget` aligns with live check semantics without mutation.

### Tests for User Story 3/4

- [x] T014 [P] Add deterministic ordering assertion in `tests/unit/check-rules.test.ts` for violations by rule, reason, path.
- [x] T015 [P] Run full status budget path checks for non-destructive behavior and reason surfacing (extend integration if needed).

### Implementation for User Story 3/4

- [x] T016 [P] Keep `printCheckResult` and `printStatusBudgetResult` aligned on reason code lines and decision visibility.
- [x] T017 Review `src/cli/commands/status.ts` for any remaining contract-to-decisions propagation gaps and adjust once current checks confirm parity.

## Phase 6: Polish

- [x] T018 Execute targeted TypeScript tests for `check` and status budget flows to verify no regressions.
- [x] T019 Validate no mutation side effects by confirming lifecycle and contract files remain unchanged across failed/human-review check runs.
