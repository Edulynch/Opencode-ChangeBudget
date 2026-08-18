---

description: "Implementation tasks for the Diagnose & Budget Advisor"

---

# Tasks: Diagnose & Budget Advisor (SPEC-007)

**Input**: Design documents from `/specs/007-diagnose-budget-advisor/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The spec input requires proportional coverage of the committed decision table, deterministic reason ordering, read-only behavior, Spec-Kit/stack-policy reuse, active-contract independence, and byte-stable human/JSON output. Tests are consolidated and table-driven; full-suite regression runs are reserved for the final gate only.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root. Project is an existing TypeScript 5.9 / Node 22 ESM `src/` layout with tests under `tests/{unit,integration,acceptance}`. No new dependencies; build via `tsc`, test via `node --test`. REUSE existing helpers: `resolveSpecKitTask` (`src/core/spec-kit/tasks.ts`), `getBuiltInStackProfileRules` (`src/core/check/stack-policy.ts`, excludes repository override files), `isStackProfileValue`/`STACK_PROFILES` and `CONTRACT_PRESETS` (`src/models/change-contract.ts`), `compilePathPatterns`/`matchPathPattern` (`src/core/check/patterns.ts`), `runGit` (`src/core/git/repo.ts`), error classes in `src/models/errors.ts`, exit mapping in `src/cli/output.ts`. Do NOT edit resolver, stack-policy, patterns, git, or existing command modules.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

N/A — the repository, TypeScript build (`npm run build`), Node test runner, and `tests/` layout already exist from SPEC-001..005. No new packages, no new tooling, no scaffolding is required. Do not add any.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Diagnosis models + the deterministic advisor core that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T001 Create `src/models/diagnose.ts` with, using only values already typed in `src/models/change-contract.ts` and `spec-kit-task.ts`:
  - `DiagnosisOutcome = 'tiny' | 'normal' | 'free' | 'manual_review'` (do NOT change `CONTRACT_PRESETS`; `manual_review` is advisory-only).
  - `DiagnoseInput` (`task_id: string | null`, `task_description: string | null`, `allow_paths: string[]`, `deny_paths: string[]`, `stack_profile: string | null`, `json: boolean`).
  - `ObservableSignals` (`declared_path_count`, `tracked_file_count: number | null`, `sensitive_categories: string[]`, `task_budget_default: 'tiny' | 'normal' | 'free' | null`).
  - `RecommendationReason` (`{ signal: string; value: string | number }`).
  - `DiagnosisResult` (`recommendation`, `source: 'explicit' | 'inferred'`, `reasons: RecommendationReason[]`, `inputs: DiagnoseInput`).
  - Decision-table constants: `TINY_MAX_TRACKED_FILES = 5`, `TINY_MAX_DECLARED_PATHS = 2`, `NORMAL_MAX_TRACKED_FILES = 50`, `NORMAL_MAX_DECLARED_PATHS = 3`, `HIGH_RISK_CATEGORIES = ['migrations', 'release_artifacts']`, `SENSITIVE_CATEGORIES = ['dependencies', 'migrations', 'configuration', 'public_api', 'release_artifacts']` (spec Key Entities; the `runtime` category is excluded — see 007 research decision 3). [FR-001, FR-003, FR-006, FR-008]
- [x] T002 Create `src/core/diagnose/advisor.ts` (pure, no IO, no git, no filesystem): `evaluateRecommendation(signals: ObservableSignals): DiagnosisResult` implementing the committed decision table in fixed first-match order (`specs/007-diagnose-budget-advisor/data-model.md`):
  1. `task_budget_default` present → that outcome, `source: 'explicit'` (conflicting scope signals never override — FR-007);
  2. `declared_path_count === 0` → `manual_review`, reason `declared_paths: 0`;
  3. `sensitive_categories` ∩ `HIGH_RISK_CATEGORIES` non-empty → `manual_review`, one reason `sensitive_category: <category>`;
  4. `tracked_file_count <= TINY_MAX_TRACKED_FILES && declared_path_count <= TINY_MAX_DECLARED_PATHS && sensitive_categories.length === 0` → `tiny`;
  5. `tracked_file_count <= NORMAL_MAX_TRACKED_FILES && declared_path_count <= NORMAL_MAX_DECLARED_PATHS` → `normal`;
  6. else → `free`;
  7. unreachable fallback → `manual_review`.
  Reasons ordered per FR-010: structural (`declared_paths`, then `tracked_files` when non-null) → task metadata (`task_id`, `task_budget_default`) → one `sensitive_category` reason per category lexicographically. Treated `tracked_file_count === null` as `0` inside branch 4/5 (collection guarantees a lookup only when `P > 0`). No other signals, no heuristics, no semantic interpretation (FR-003, FR-009). [US1, US2, US3; FR-001, FR-003, FR-007, FR-008, FR-009, FR-010]
- [x] T003 Create `tests/unit/diagnose-advisor.test.ts` — table-driven over the FULL committed matrix with ≥30 rows seeding SC-001: annotation `[tiny|normal|free]` explicit source; annotation wins over conflicting larger scope; invalid/absent annotation falls through to inferred; `P=0` → manual_review (with and without task); `C` containing `migrations`; `C` containing `release_artifacts`; `tiny` boundary (`N=5,P=2,C∅`) and just-over (`N=6`); `normal` boundary (`N=50,P=3`) with `C` = `dependencies`/`configuration`; `free` (`N=51` or `P=4`); first-match precedence where overlapping rules resolve to the earlier one; reason ordering fixed structural→task→categories with lexicographic categories; and assert no outcome outside the four, no new preset values. [US1, US2, US3; FR-001, FR-008, FR-010; SC-001]

**Checkpoint**: Foundation ready — user story implementation can now begin.

---

## Phase 3: User Story 1 - Diagnose the right preset before starting a contract (Priority: P1) 🎯 MVP

**Goal**: `changebudget diagnose --allow-path "src/ui/**" --allow-path "tests/ui/**" [--stack-profile <profile>]` prints a deterministic preset recommendation (`tiny`/`normal`/`free`) with the concrete signals that produced it.

**Independent Test**: In a dummy repo with declared paths (and optionally a stack profile), `node dist/src/cli/index.js diagnose --allow-path "src/ui/**"` prints exactly one `Recommendation`, one `Source`, and the ordered reasons from the decision table; run twice → byte-identical (SC-002 seeds).

### Implementation for User Story 1

- [x] T004 [P] [US1] Create `src/cli/parsers/diagnose-input.ts` (pure): `parseDiagnoseArgs(args)` → `DiagnoseInput`, accepting `--task <text>`/`--task-description <text>` (stored verbatim, never interpreted — FR-005), repeated `--allow-path`/`--allow-paths` and `--deny-path`/`--deny-paths` (aliases, one glob value each), `--stack-profile <value>` validated against `STACK_PROFILES` (mirror existing `isStackProfileValue` usage; invalid → `InputValidationError` naming the value — FR-014), and `--json` (boolean; also `--json=true`/`--json=false` per the existing `parseJsonArg` convention in `src/cli/index.ts`). Reject with the existing deterministic `InputValidationError`, before any work: budget flags (`--preset`, `--tiny`, `--normal`, `--free`, `--custom`), unknown flags, and any positional argument (positional `TASK_ID` support arrives in US3, T012). [US1, US2, US4; FR-001, FR-005, FR-014]
- [x] T005 [P] [US1] Create `src/core/diagnose/collect.ts` — `collectObservableSignals(repositoryRoot, input, taskResolution)`:
  - `P`: distinct declared prefixes (allow + deny), stable order (FR-006).
  - `N`: when `P > 0`, ONE read-only `runGit(repositoryRoot, ['ls-files'])` subprocess; count lines matched by `matchPathPattern` against `compilePathPatterns(declaredPrefixes)` (index count, NOT a diff — FR-011). When `P === 0`, `N = null` and no git subprocess runs. Invalid declared pattern → `InputValidationError` from `compilePathPattern` (deterministic conventions, FR-014).
  - `C`: when `input.stack_profile` is given, distinct `SENSITIVE_CATEGORIES` among `getBuiltInStackProfileRules(profile)` rules whose `target_patterns` match a declared path (lexicographic, deduplicated); empty when no profile is given (NO automatic stack detection — FR-015). Never reads `.changebudget/**` or lifecycle state. [US1, US4, US5; FR-006, FR-010, FR-011, FR-014, FR-015]
- [x] T006 [US1] Create `src/cli/commands/diagnose.ts` — `runDiagnose(repositoryRoot, args)`: parse via `parseDiagnoseArgs`, collect via `collectObservableSignals` (task resolution placeholder: `null` until US3), evaluate via `evaluateRecommendation`, return `DiagnosisResult`. Orchestration only — no rendering, no state writes, no contract/lifecycle interaction (FR-002). [US1, US2; FR-001, FR-002, FR-003, FR-014]
- [x] T007 [US1] Wire `diagnose` into `src/cli/index.ts`: add to `SUPPORTED_COMMANDS` and `printUsage` (`Commands: init, start, status, check, close, diagnose`); dispatch `case 'diagnose'` calling `runDiagnose(process.cwd(), args)`; add human printer per `contracts/human-output.md` emitting `Recommendation: <outcome>` (`manual review` with space, matching FR-001), `Source: <explicit|inferred>`, and `Reasons:` block with `- <signal>: <value>` lines in array order; set exit code `0` on ANY successful diagnosis including `manual review` (do not call `getDecisionExitCode`). JSON printer arrives in US6 (T019). [US1, US2; FR-001, FR-008, FR-010]
- [x] T008 [P] [US1] Create `tests/unit/diagnose-input.test.ts` — table-driven: flag surfaces and aliases (`--allow-path` ≡ `--allow-paths`), repeats accumulate, `--task` vs `--task-description`, `--json` forms, stack-profile acceptance for all four SPEC-005 profiles and rejection of invalid values (exit path via `InputValidationError`), rejection of budget flags and unknown flags, positional rejection, and no partial state (pure parser, no writes). [US1, US2, US4; FR-005, FR-014]
- [x] T009 [P] [US1] Create `tests/unit/diagnose-collect.test.ts` — `P` distinct counting; `N` via temp git fixtures (files under the prefix counted, files outside not; working tree never mutated — read-only proof at unit level); `N = null` when `P === 0` with no git subprocess; `C` classification for each builtin profile shows the correct `SENSITIVE_CATEGORIES` and excludes `runtime`; `C` empty when no profile (FR-015); lexicographic category ordering. [US1, US4; FR-006, FR-010, FR-015]

**Checkpoint**: At this point, User Story 1 is fully functional and testable independently.

---

## Phase 4: User Story 2 - Explainable recommendation when evidence is incomplete (Priority: P1)

**Goal**: Bare runs, prose-only runs, and high-risk/undecidable evidence produce `manual review` with reasons naming the missing evidence — never a fabricated default.

**Independent Test**: `node dist/src/cli/index.js diagnose` (no args) and `... diagnose --task "Refactor module"` both print `Recommendation: manual review` with `declared_paths: 0` and exit `0`.

### Implementation for User Story 2

- [x] T010 [US2] Extend `tests/unit/diagnose-advisor.test.ts` with the manual-review matrix (≥10 rows seeding SC-004): no declared paths (bare), no declared paths + task without annotation, prose-only input with no structural signals, `C` containing `migrations`, `C` containing `release_artifacts`, and undecidable-but-non-empty scope that still resolves per table — asserting `manual review` in 100% of the insufficient/high-uncertainty rows and NEVER a guessed default (FR-009, SC-004). [US2; FR-009; SC-004]
- [x] T011 [US2] Create `tests/integration/diagnose-command.spec.ts` (mirrors `tests/integration/spec-kit-task-bridge.spec.ts` style: real disposable temp git fixtures + compiled CLI `node dist/src/cli/index.js diagnose ...`) covering the US2 and shared-structure path: bare run → `manual review` + `declared_paths: 0` + exit 0; prose-only run → `manual review`; a structural run with declared paths → `Recommendation`/`Source`/`Reasons` per `contracts/human-output.md`; each run leaves `git status --short` unchanged (SC-003 seeds). This file is the shared integration home extended by US3 (T014), US4 (T015), US5 (T017), and US6 (T020). [US2, US4; FR-002, FR-009, FR-011, FR-013; SC-003, SC-004]

**Checkpoint**: At this point, User Stories 1 AND 2 both work independently.

---

## Phase 5: User Story 3 - Diagnose from an existing Spec-Kit task (Priority: P2)

**Goal**: `changebudget diagnose T031` reuses the SPEC-006 resolver; a valid explicit `[budget:...]` annotation is the recommendation (explicit configured intent wins, FR-007); resolution failures reuse SPEC-006 behavior.

**Independent Test**: With `specs/007-example-feature/tasks.md` containing `- [ ] T031 [budget:tiny] Implement task bridge`, `diagnose T031` prints `Recommendation: tiny` / `Source: explicit` with `task_id`+`task_budget_default` reasons; `diagnose T999` fails with the deterministic not-found error and exit 2.

### Implementation for User Story 3

- [x] T012 [P] [US3] Extend `src/cli/parsers/diagnose-input.ts`: accept AT MOST one optional positional `TASK_ID` satisfying `isTaskIdInput` (`^[Tt][0-9]{3,}$`), canonicalized via `canonicalizeTaskId` (reuse from `src/models/spec-kit-task.ts` — do NOT write a new parser or grammar) and stored as `task_id`; any other positional keeps the deterministic argument error; `--task` prose is stored separately and never derived from the task title. Grammar per `contracts/diagnose-command.md`. [US3; FR-004, FR-005, FR-014]
- [x] T013 [US3] Extend `src/cli/commands/diagnose.ts`: when `parsed.task_id` is present, call `resolveSpecKitTask(repositoryRoot, parsed.task_id)` UNMODIFIED (same canonicalization and unknown/ambiguous/not-resolvable behavior, read-only; never reads `.specify/feature.json` — FR-004). Map resolution to signals: `task_budget_default` only when `budget_default` equals `tiny`/`normal`/`free` (invalid value → treated as absent, never recommended, never an error — FR-007); feed `task_id` reason through the signals used by `evaluateRecommendation`. Resolution failures propagate as `InputValidationError`/`IOStateError` unchanged (exit 2/4 via existing mapping), with no recommendation and no state writes. [US3; FR-004, FR-007, FR-014]
- [x] T014 [US3] Extend `tests/unit/diagnose-input.test.ts` (positional acceptance/rejection, lower-case canonicalization) and `tests/integration/diagnose-command.spec.ts` (table-driven): `diagnose T031` with `[budget:tiny]` → `tiny`/`explicit` with `task_id`+`task_budget_default` reasons; conflicting larger declared scope does NOT override the annotation (AS2); invalid annotation (`[budget:custom]`) treated as absent and never recommended; unknown `T999` and ambiguous `T031` (two features) → deterministic SPEC-006 errors, exit 2, no recommendation, state byte-identical; annotation-driven outcomes join the SC-001 scenario pool. [US3; FR-004, FR-007, FR-014; SC-001]

**Checkpoint**: At this point, User Stories 1, 2, AND 3 work independently.

---

## Phase 6: User Story 4 - Diagnose without Spec-Kit and without a stack profile (Priority: P2)

**Goal**: Repositories with no `specs/` and no stack profile still get deterministic recommendations from structural evidence — or honest `manual review` — with repeated human runs byte-identical.

**Independent Test**: In a repo with no `specs/` and no profile, `diagnose --allow-path "src/ui/**"` gives a deterministic recommendation; `diagnose` bare gives `manual review`; both runs are byte-identical on repetition and leave the repo untouched.

### Implementation for User Story 4

- [x] T015 [US4] Extend `tests/integration/diagnose-command.spec.ts`: no-Spec-Kit fixture (no `specs/`) with declared paths → deterministic table outcome from structural evidence alone (FR-013); no-profile runs → `C` absent, structural-only decision (no automatic detection — FR-015); run-twice byte-identity for the human surface (FR-010, SC-002 seeds); `git status --short` and (when present) `tasks.md` bytes unchanged (FR-002, SC-003 seeds). [US4, US5; FR-002, FR-010, FR-013, FR-015; SC-002, SC-003, SC-005]
- [x] T016 [US4] Extend `tests/unit/diagnose-collect.test.ts` for the no-stack/no-Spec-Kit boundaries: `P=0` short-circuits the git subprocess entirely; missing profile → `C` empty; no matching stack-rule patterns under a declared path → `C` empty even with a profile; a declared path matching rules of excluded `runtime`-category only → still `C` empty (research decision 3). [US4, US5; FR-006, FR-015, FR-011]

**Checkpoint**: At this point, User Stories 1, 2, 3, AND 4 work independently.

---

## Phase 7: User Story 5 - Diagnose never mutates or blocks lifecycle state (Priority: P2)

**Goal**: With an active Change Contract and uncommitted working-tree changes, `diagnose` completes normally, ignores diff/lifecycle evidence, and leaves everything byte-identical. The OpenCode guard is untouched.

**Independent Test**: With an active contract and both matching and non-matching uncommitted changes, run `diagnose --allow-path "src/ui/**"` twice → identical output, exit 0, `git status --short` + `.changebudget/**` + `tasks.md` bytes unchanged (FR-011, SC-003).

### Implementation for User Story 5

- [x] T017 [US5] Extend `tests/integration/diagnose-command.spec.ts`: fixture with an ACTIVE contract (via `init`+`start`) and uncommitted working-tree changes that both match and do NOT match declared paths; run `diagnose` with declared paths twice → identical output and exit 0 (never blocks, FR-011); assert `N` came from the Git index (diff ignored as evidence — FR-011); `git status --short`, `.changebudget/**` contents, and `tasks.md` bytes byte-identical before/after (FR-002, SC-003); no contract created/widened/closed by any run. [US5; FR-002, FR-011; SC-003]
- [x] T018 [P] [US5] Extend `tests/unit/opencode-runtime-projection.test.ts`: regression proof that `diagnose` output/result types never feed `RuntimeProjectionInput` — assert the guard projection remains byte-identical for the existing decision cases and that no new `RuntimeProjectionInput` construction path references `DiagnosisResult`. [FR-013, SC-005]

**Checkpoint**: All user stories complete and independently verified.

---

## Phase 8: User Story 6 - Read machine-readable recommendations (Priority: P3)

**Goal**: `changebudget diagnose --json` emits a well-ordered structured result identical in meaning and ordering to the human output, byte-stable across runs.

**Independent Test**: `diagnose --allow-path "src/ui/**"` and its `--json` variant report the same recommendation and the same ordered reasons; two `--json` runs are byte-identical.

### Implementation for User Story 6

- [x] T019 [P] [US6] Extend `src/cli/index.ts` with `printDiagnoseResultJson` per `contracts/json-output.md`: fixed key order `{ recommendation, source, reasons, inputs }`; `reasons` as `{ signal, value }` pairs in the same order as the human output; `manual_review` as the literal JSON string (underscore form); `inputs` fixed key order `{ task_id, task_description, allow_paths, deny_paths, stack_profile }` (echo; `null` when absent); NO timestamps or random elements (FR-012). Dispatch on the parsed `--json` flag; unchanged exit-0 semantics. [US6; FR-012]
- [x] T020 [US6] Extend `tests/integration/diagnose-command.spec.ts` (and assert at unit level where useful): `--json` exact structure/key order and `manual_review` literal; human/JSON equivalence of recommendation and ordered reasons for the same run (FR-012); repeated `--json` runs byte-identical (FR-010, SC-002); `inputs` echo correct for task and no-task runs. [US6; FR-012; SC-002]

**Checkpoint**: At this point, User Stories 1..6 all work independently.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Acceptance metrics, the full regression gate, and quickstart validation affecting all stories

- [x] T021 Create `tests/acceptance/spec007-diagnose-metrics.test.ts` in the SPEC-005/006 metrics style, implementing SC-001..SC-006 and writing `specs/007-diagnose-budget-advisor/acceptance-metrics.md`, using ONLY disposable dummy repositories (never personal/work repos or clones of existing projects):
  - SC-001: ≥30 controlled scenarios across declared paths, stack profiles, and task annotations → predicted table outcome in 100%;
  - SC-002: ≥20 repeated runs (incl. `--json`) → byte-identical;
  - SC-003: ≥20 runs → `git status --short`, `.changebudget/**`, and `tasks.md` byte-identical before/after;
  - SC-004: ≥10 insufficient/high-uncertainty scenarios → `manual review` in 100%;
  - SC-005: existing SPEC-001..006 suites run green + `diagnose` works with neither Spec-Kit nor stack profile;
  - SC-006: ≥90% agreement with a simple reference classification on identical signals in controlled dummy-repo scenarios. [SC-001..SC-006]
- [x] T022 Run the validation gate: `npm run build`, full `npm test`, and execute every `specs/007-diagnose-budget-advisor/quickstart.md` scenario (structural recommendation, manual review, annotation precedence, stack-sensitive manual review, no-Spec-Kit/no-stack, byte-stability/zero mutation, active-contract independence) in disposable fixtures; confirm no new runtime dependencies were introduced, outputs are deterministic (FR-010), and none of the SPEC-001..006 behaviors regressed (FR-013, SC-005). [FR-013; SC-005; quickstart]

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: N/A — already satisfied by the existing repository.
- **Foundational (Phase 2)**: No dependencies — can start immediately (T001 → T002 → T003). **BLOCKS all user stories**.
- **User Stories (Phase 3+)**: All depend on Foundational completion.
  - US1 (Phase 3): can start immediately after Phase 2 — the MVP.
  - US2 (Phase 4): depends on US1 (integration file T011 needs the full pipeline from US1).
  - US3 (Phase 5): depends on US1 (parser/command files exist) + Phase 2 (advisor annotation precedence via T002).
  - US4 (Phase 6): depends on US1 and US2 (extends T011 integration home).
  - US5 (Phase 7): depends on US1-4 being functional (exercises the whole pipeline against lifecycle state).
  - US6 (Phase 8): depends on US1 (dispatch in `src/cli/index.ts`) — JSON printer only.
- **Polish (Phase 9)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Foundational (Phase 2) only — no dependency on other stories.
- **User Story 2 (P1)**: US1 — integration proof of the manual-review/insufficient-evidence path requires the CLI pipeline.
- **User Story 3 (P2)**: US1 + Phase 2 — task resolution is additive over the US1 command/parser; independent of US2/U4-6.
- **User Story 4 (P2)**: US1 + US2 — extends the same integration file.
- **User Story 5 (P2)**: US1-US4 — lifecyle/read-only independence harness.
- **User Story 6 (P3)**: US1 — printer-only addition; independent of US3-5.

### Within Each User Story

- Implementation before consolidated table-driven tests; each story is complete before the next priorities.
- T004/T005, T008/T009, and T012/T018/T019 are marked [P] — different files / independent slices.

### Parallel Opportunities

- **Phase 2**: T001 → T002 must be sequenced (T002 imports `src/models/diagnose.ts` types); T003 after both.
- **Phase 3**: T004 and T005 can run in parallel (different files); T006 after T004+T005; T007 after T006; T008/T009 after T004/T005.
- **Phase 5**: T012 is independent (parser file); T013 after T012; T014 after T013 (integration home exists).
- **Phase 8**: T019 is independent (printer); T020 after T019.
- **Phase 9**: T021 then T022 sequential (gate after metrics); both after all user stories.

---

## Parallel Example: First Block (Phase 2)

```bash
# Sequenced block to complete first (same turn is fine — small edits):
Task: "T001 Create src/models/diagnose.ts"
Task: "T002 Create src/core/diagnose/advisor.ts (depends on T001 types)"
Task: "T003 Create tests/unit/diagnose-advisor.test.ts (after T001+T002)"
```

```bash
# Phase 3 parallel slice after Phase 2:
Task: "T004 Create src/cli/parsers/diagnose-input.ts"
Task: "T005 Create src/core/diagnose/collect.ts"
```

```bash
# Phase 3 test slice after T004/T005:
Task: "T008 Create tests/unit/diagnose-input.test.ts"
Task: "T009 Create tests/unit/diagnose-collect.test.ts"
```

---

## Implementation Strategy

### Recommended First Block

1. **T001 + T002 + T003 together** (one turn): the model file and the pure advisor are small and form one compile boundary; table-driven tests verify the whole committed decision table before any CLI work. Run `npm run build` + `node --test dist/tests/unit/diagnose-advisor.test.js` to confirm green.
2. Continue with US1 (T004 → T005 → T006 → T007 → T008 → T009).

### MVP First (User Story 1 Only)

1. Complete Phase 2: Foundational (T001-T003)
2. Complete Phase 3: User Story 1 (T004-T009)
3. **STOP and VALIDATE**: `npm run build`, run the US1 unit tests; verify `diagnose --allow-path "src/ui/**"` prints `Recommendation`/`Source`/`Reasons` deterministically. MVP delivered: structural preset recommendation for the `tiny`/`normal`/`free` path (manual review and task/stack/JSON arrive in later stories).

### Incremental Delivery

1. Foundational complete → advisor domain ready.
2. Add US1 (structural recommendation) → MVP → validate independently.
3. Add US2 (manual-review/uncertainty) → US3 (Spec-Kit task + annotation precedence) → US4 (no-Spec-Kit/no-stack) → US5 (lifecycle/read-only independence) → US6 (JSON) — each independently then together.
4. Add Polish (acceptance metrics + full gate + quickstart) once every story is functional.
5. Each story adds value without breaking previous stories; advisory `diagnose` stays read-only throughout.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps task to the primary user story; FRs from other stories are called out in the description where a task serves multiple requirements.
- Each user story is independently completable and testable; tests are consolidated/table-driven and never duplicated across equivalent permutations.
- Commit after each task or logical group (the `git` extension's `/speckit.git.commit` is available).
- Stop at any checkpoint to validate the story independently.
- Avoid vague tasks, same-file conflicts, cross-story dependencies that break independence.
- Out of scope (do NOT implement in this feature): LLM/AI interpretation, automatic stack detection, contract creation/widening/auto-`start`, `tasks.md` writes or completion marking, `/speckit.*` or OpenCode invocation, repository-history/ML learning, AST analysis, network/telemetry, new preset outcome values beyond `tiny`/`normal`/`free`/`manual_review`, SPEC-008 dogfooding/hardening, and any change to the resolver, stack-policy, patterns, or existing CLI command modules.