---

description: "Implementation tasks for SPEC-014 Execution Envelope and Material Decision Gate"

---

# Tasks: Execution Envelope and Material Decision Gate (SPEC-014)

**Input**: Design documents from `specs/014-execution-decision-gate/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/execution-gate.md`, `quickstart.md`, and `checklists/preimplementation.md` with PASS 40/40

**Tests**: Deterministic unit, integration, Runtime Guard, and typed acceptance fixtures are required by SPEC-014. Do not add Docker, GitHub, remote-service, or new test-harness infrastructure.

## Phase 1: Models and Types

**Purpose**: Establish the optional contract-owned Envelope and closed evaluator input and output domains before consumers are changed.

- [ ] T001 [P] [US1] Define optional Execution Envelope, acceptance criterion, satisfaction, material decision, ledger, and authority types in `src/models/execution-gate.ts`
- [ ] T002 [US1] Extend ChangeContract parsing and serialization with optional execution envelope ownership while preserving absent-envelope legacy shape in `src/models/change-contract.ts`
- [ ] T003 [US1] Extend atomic contract state persistence for envelope declarations, satisfaction evidence, and idempotent material ledger entries in `src/core/state/contracts.ts`

## Phase 2: Opt-In Parsing and Validation

**Purpose**: Accept only explicit Envelope, proposal, and evidence inputs, with deterministic invalid-proposal semantics.

- [ ] T004 [US1] Parse optional Envelope, proposal, and satisfaction evidence inputs without inferring governance data in `src/cli/parsers/contract-input.ts`
- [ ] T005 [US1] Validate closed material kinds, authority shapes, criterion mappings, necessity evidence, canonical alternatives, and unavailable Envelopes in `src/core/validation/contract-validator.ts`
- [ ] T006 [US1] After T008 and T011 establish evaluator and satisfaction semantics, wire optional Envelope creation and proposal or evidence submission through existing start inputs without changing unflagged behavior in `src/cli/commands/start.ts`
- [ ] T007 [US1] After T008 and T011 establish evaluator and satisfaction semantics, wire optional proposal and satisfaction evidence evaluation through existing check inputs without changing Git-budget result meanings in `src/cli/commands/check.ts`

## Phase 3: Pure Evaluator Decision Table

**Purpose**: Implement the framework-independent deterministic evaluator and its complete verdict table.

- [ ] T008 [US1] Implement legacy recognition and the ordered structural validity, satisfaction guard, materiality, and governance evaluation flow with authority comparison, criterion mapping, and six-verdict selection in `src/core/execution-gate.ts`
- [ ] T009 [P] [US1] Add deterministic decision-table tests for legacy no-envelope behavior, fast-path continuation, `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, optional HARD `BLOCK`, and necessary irreducible `ESCALATE` in `tests/unit/execution-gate.test.ts`
- [ ] T010 [US1] Add deterministic coverage for all nine `FR-005` material kinds: scope/surface expansion, delegated agent, concurrency increase, reasoning or research escalation, verification expansion, unrequired documentation, infrastructure expansion, external-service expansion, and post-satisfaction work. Repeat each identical declared input and assert an identical result and reason for `SC-003`, alongside invalid-proposal, replay, HARD or SOFT, replacement-precedence, and correctness-preservation tests, including both missing-evidence and unknown-material-kind `INVALID_PROPOSAL` cases, in `tests/unit/execution-gate.test.ts`

## Phase 4: Satisfaction and Invalid Semantics

**Purpose**: Enforce structural validity before satisfaction, irreversible completion, and the exact post-satisfaction allow and block boundary.

- [ ] T011 [US3] Add explicit `SC-007` coverage for irreversible satisfaction latch and required-evidence completion, then structurally valid post-satisfaction refactor, documentation, architecture hardening, infrastructure, and feature proposals that are recognized and blocked before materiality or governance bypass, plus invalid-after-satisfaction, post-satisfaction non-material mutation `BLOCK`, and allowed-operation coverage in `tests/integration/execution-gate.spec.ts`

## Phase 5: Runtime Pre-Action Integration

**Purpose**: Consume explicit structured decisions at the existing permission boundary without conflating governance and runtime or Git-budget results.

- [ ] T012 [US2] After T008 establishes the core evaluator and T011 establishes satisfaction semantics, compose its optional results only for explicit structured material decisions while preserving ordinary runtime projection in `opencode-plugin/src/evaluator.ts`
- [ ] T013 [US2] After T012 composes the core evaluator result, preserve runtime allow, ask, and block precedence while keeping governance verdicts separate from plugin actions and Git-budget results in `opencode-plugin/src/projection.ts`
- [ ] T014 [US3] After T011 and T013, pass structured material decisions through the existing permission.ask boundary and route every valid post-satisfaction operation through the guard in `opencode-plugin/src/index.ts`

## Phase 6: Legacy Compatibility

**Purpose**: Prove no-envelope contracts and unflagged command behavior remain unchanged across lifecycle and Git-budget axes.

- [ ] T015 [US2] Add integration coverage for legacy no-envelope lifecycle behavior, unflagged commands, unchanged `PASS`, `REPAIR`, and `HUMAN_REVIEW` results, and result-domain separation in `tests/integration/execution-gate.spec.ts`

## Phase 7: Docker Fixture Acceptance

**Purpose**: Exercise the self-hosted runner scenario as typed deterministic data, without Docker or remote infrastructure.

- [ ] T016 [P] [US1] After T009 and T010 establish the evaluator fixtures, add the typed Docker-runner decision fixture covering required Linux runner setup and smoke validation, extra worker `REDUCE`, optional Windows runner `BLOCK`, reasoning, documentation, architecture review, and release readiness `DEFER`, full regression `REPLACE`, necessary undeclared infrastructure or service `ESCALATE`, and unchanged Git-budget results. Keep it typed deterministic data with no Docker, GitHub, credential, or remote infrastructure in `tests/acceptance/spec014-execution-decision-gate.test.ts`

## Phase 8: Regression Validation

**Purpose**: Run the approved focused and repository regression sequence without expanding scope.

- [ ] T017 Validate the documented SPEC-014 order, structural validity to satisfaction guard to materiality to governance precedence, focused suites, typecheck, build, full suite, and ChangeBudget check in `specs/014-execution-decision-gate/quickstart.md`; follow T014, T015, and T016

## Dependencies and Execution Order

### Phase Dependencies

- Phase 1 is the prerequisite for every implementation phase.
- Phase 2 depends on the model and persistence shapes from Phase 1. Its command artifacts T006 and T007 are organized here but execute only after Phase 3 task T008 and Phase 4 task T011; T004 and T005 are their input prerequisites and do not authorize those consumers to run earlier.
- Phase 3 depends on validated normalized inputs from Phase 2 for evaluator implementation: T008 follows T004 and T005, T009 and T010 follow T008, and T011 follows T008 plus the persistence contract before T006 or T007 can execute.
- Phase 4 depends on T008 and T003, and must complete before command consumers and post-satisfaction Runtime Guard routing.
- Phase 5 is serial: T012 follows T008 and T011 so it consumes established evaluator and satisfaction semantics, T013 follows T012, and T014 follows T011 and T013 while preserving the existing Runtime Guard boundary.
- Phase 6 depends on T011 and validates the no-envelope path after satisfaction semantics are fixed.
- Phase 7 depends on T009 and T010 evaluator fixtures and may run in parallel with T015 after its prerequisites.
- Phase 8 follows T014, T015, and T016.

### Critical Path

`T001 -> T002 -> T003 -> T004 -> T005 -> T008 -> T009 -> T010 -> T011 -> T012 -> T013 -> T014 -> T015 -> T017`

Completion gates: T006 and T007 each follow T008 and T011; T016 follows T009 and T010; T017 requires T009 and T010 explicitly, as well as T014, T015, and T016.

### Parallel Opportunities

- T006 and T007 can run in parallel with each other only after T008 and T011 because they own separate command files and both consume established evaluator and satisfaction semantics.
- T009 and T010 are sequential because they extend the same test file.
- T012 and T013 are serial because T013 consumes T012's composed result; T014 follows T011 and T013.
- T015 follows T011 because both extend the same integration file; T016 can run in parallel with T015 after T009 and T010 because it owns a separate typed acceptance fixture.
- T017 follows T014, T015, and T016, with T009 and T010 explicit prerequisites for final readiness through the evaluator fixture gate.

## Traceability

- `FR-005`: T010 covers all nine closed material kinds; T016 exercises the existing Docker-runner cases.
- `FR-010`: T008 defines the ordered evaluator flow; T011 covers the satisfaction guard; T012 through T014 preserve Runtime Guard consumption and precedence.
- `FR-016`: T011 covers completion, irreversibility, allowed operations, and post-satisfaction blocking; T014 routes valid operations through the guard.
- `FR-017` and `SC-007`: T011 covers structurally valid refactor, documentation, architecture hardening, infrastructure, and feature proposals blocked before materiality or governance bypass.
- `SC-003`: T010 repeats identical declared inputs for every `FR-005` kind and asserts identical results and reasons.
- Critical precedence, compatibility, and acceptance criteria: T008 and T011 cover structural-to-satisfaction-to-materiality-to-governance order; T013 and T015 cover runtime and Git-budget result separation; T016 covers typed Docker-runner acceptance outcomes; T017 validates the documented sequence and full regression.

## MVP and Incremental Strategy

### MVP First

1. Complete T001 through T010 for the optional model, validated inputs, pure evaluator, and complete deterministic decision table.
2. Complete T011 and T012 through T014 for satisfaction enforcement and the pre-action Runtime Guard path.
3. Run T015 through T017 to prove compatibility, Docker fixture outcomes, and regression safety.

### Incremental Delivery

1. Deliver the evaluator and decision-table coverage without changing legacy behavior.
2. Add satisfaction persistence and post-satisfaction enforcement.
3. Add the existing Runtime Guard consumer and preserve projection precedence.
4. Add legacy, Docker fixture, and full regression validation.

### Scope Boundary

The implementation remains limited to the exact model, validation, evaluator, existing command seams, existing Runtime Guard seam, and listed test paths. It adds no new command, lifecycle, adapter, service, storage domain, policy language, Docker dependency, or remote execution mechanism.
