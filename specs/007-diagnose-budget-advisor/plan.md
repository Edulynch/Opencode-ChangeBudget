# Implementation Plan: Diagnose & Budget Advisor

**Branch**: `007-diagnose-budget-advisor` | **Date**: 2026-08-18 | **Spec**: `specs/007-diagnose-budget-advisor/spec.md`

**Input**: Feature specification from `/specs/007-diagnose-budget-advisor/spec.md`

## Summary

SPEC-007 adds a new advisory, read-only CLI command, `changebudget diagnose`, that recommends one of `tiny`, `normal`, `free`, or `manual review` BEFORE implementation, so the developer can pick the right preset for `start` instead of guessing or adjusting after the fact.

Scope:

- New command `diagnose` with the smallest deterministic surface: optional positional task ID (reuses the SPEC-006 resolver), `--task`/`--task-description` (prose, never semantically interpreted), `--allow-path`/`--allow-paths` and `--deny-path`/`--deny-paths` (declared scope), `--stack-profile` (SPEC-005 profiles), and `--json`. No budget flags and no new presets.
- Observable signals are strictly local and read-only: declared path prefixes (`P`), tracked-file count under declared prefixes (`N`, via read-only Git), distinct SPEC-005 sensitive categories triggered under an explicit stack profile (`C`), plus resolved Spec-Kit task metadata.
- A single, committed, first-match decision table produces exactly one recommendation (`tiny` / `normal` / `free` / `manual review`). Explicit task `[budget:...]` annotations win over inferred advice (FR-007). Insufficient or high-risk evidence → `manual review`, never a guessed default (FR-009).
- Reasons are ordered deterministically (structural → task metadata → sensitive categories) and repeated runs are byte-identical (FR-010).
- Strictly advisory and read-only: no contract creation/widening/closing, no `.changebudget/**` writes, no `tasks.md` mutation, no Git mutation, no OpenCode/Spec-Kit invocation, no network. Active contracts and working-tree changes are ignored (FR-011).
- Backward compatible: SPEC-001..006 commands, the OpenCode guard, stack enforcement, and Spec-Kit bridge behavior are unchanged; repos without Spec-Kit or without a stack profile remain fully diagnosable where evidence exists.

## Technical Context

**Language/Version**: TypeScript 5.9.x, Node.js 22 (ESM), strict mode. No new runtime dependencies.

**Storage**: none. `diagnose` never reads or writes `.changebudget/**` state and never persists anything.

**Primary Dependencies**: Node builtins only (`node:fs/promises`, `node:path`) and the existing repo helpers: `runGit` (`src/core/git/repo.ts`) for the read-only tracked-file lookup, `getBuiltInStackProfileRules` + `compilePathPatterns`/`matchPathPattern` (`src/core/check/stack-policy.ts`, `src/core/check/patterns.ts`) for stack-policy evidence, and the SPEC-006 resolver (`src/core/spec-kit/tasks.ts`) for task resolution. No new packages.

**Testing**: Node built-in test runner (`node --test`), existing `tests/unit`, `tests/integration`, `tests/acceptance` layout; `npm run build && npm test` gate.

**Target Platform**: Local CLI on developer machines (primary: Windows, secondary: macOS/Linux). No server/cloud surface.

**Project Type**: Local CLI (`changebudget`) with an OpenCode guard plugin consuming check policy results.

**Performance Goals**: `diagnose` completes well under the existing local non-interactive threshold; the only Git subprocess is one read-only tracked-file listing (and only when declared paths exist).

**Constraints**: Pure local, read-only toward repo/state/task/Spec-Kit; deterministic byte-stable output; advisory only (never enforces); backward compatible with SPEC-001..006; no LLM/semantic analysis; no automatic stack detection; never reads the active contract or `.changebudget/**`; never mutates `tasks.md`, git state, or working tree.

**Scale/Scope**: Single-repo, personal-workflow CLI. Recommendation reasons are bounded (≤ handful of declared paths, ≤ handful of sensitive categories).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Verdict |
|---|---|---|
| I. Local-first and deterministic | All signals from local Git/files/task files; committed first-match decision table; byte-stable output per FR-003/FR-010 | PASS |
| II. Minimal architecture | One new leaf module (`src/core/diagnose/`) + one model file + one command file + parsers/render helpers; no new subsystem/services/deps | PASS |
| III. Scope is a hard boundary | Only FR-001..FR-015 implemented; spec non-goals (LLM, auto-start, widening, autodetect, history ML, SPEC-008) excluded | PASS |
| IV. Small changes require small workflows | `plan → implement → converge`; targeted validation after each phase | PASS |
| V. Targeted validation | Unit tests per module, focused integration fixtures, acceptance metrics; no full-suite reruns after every edit | PASS |
| VII. Enforcement over suggestion | `diagnose` is explicitly advisory; it never produces PASS/REPAIR/HUMAN_REVIEW and never feeds `check`; enforcement model untouched | PASS |
| VIII. Human authority | Recommendation is never auto-applied; developer chooses at `start`; explicit `[budget:...]`/flags always win | PASS |
| IX. Explainable decisions | Every recommendation emits ordered reasons naming concrete signals; no opaque scoring | PASS |
| X. Fast execution | Single read-only `git ls-files` only when declared paths exist; no interactive prompts | PASS |
| XI. Personal workflow first | Extends the existing local Git/OpenCode/Spec-Kit personal workflow only | PASS |
| XIV. Quality over complexity | Small pure decision function with table-driven tests; zero implicit mutation | PASS |
| XVII. Anti-overengineering | No "recommendation subsystem"; one leaf evaluator + additive CLI/model changes | PASS |

Re-check after Phase 1: confirm in `research.md`/`data-model.md` that the design reads zero `.changebudget/**` state and never persists.

**Re-check result (post-Phase 1, 2026-08-18): PASS.** `research.md` (decisions 2, 7, 8) and `data-model.md` (Determinism rules) confirm `diagnose` reads only Spec-Kit task files (via the SPEC-006 resolver) and a single read-only `git ls-files` subprocess, never reads `.changebudget/**` or `.specify/feature.json`, and persists nothing. All rows above remain valid.

## Project Structure

### Documentation (this feature)

```text
specs/007-diagnose-budget-advisor/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── diagnose-command.md
│   ├── human-output.md
│   └── json-output.md
├── checklists/requirements.md
├── acceptance-metrics.md     # Phase 5 output (/speckit tasks)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# New files
src/models/diagnose.ts               # DiagnoseInput, ObservableSignals, RecommendationReason, DiagnosisResult
src/core/diagnose/advisor.ts         # Pure observable-signal collection + first-match recommendation evaluator
src/core/diagnose/collect.ts         # Read-only signal collection (tracked-file count, stack-category set)
src/cli/parsers/diagnose-input.ts    # Pure argument parser for `diagnose`
src/cli/commands/diagnose.ts         # Orchestration: parse → resolve task → collect → evaluate → render

# Modified files (extend existing structure, no new layers)
src/cli/index.ts                     # + `diagnose` in SUPPORTED_COMMANDS; dispatch + human/JSON printing

# Tests
tests/unit/diagnose-advisor.test.ts              # decision table outcomes + precedence + reason ordering
tests/unit/diagnose-collect.test.ts              # signal collection (N via Git, C via stack rules)
tests/unit/diagnose-input.test.ts                # parser acceptance/rejection
tests/unit/opencode-runtime-projection.test.ts   # (extended) guard unchanged by diagnose
tests/integration/diagnose-command.spec.ts       # end-to-end read-only + byte-stability + no-Spec-Kit/no-stack
tests/acceptance/spec007-diagnose-metrics.test.ts # SC-001..SC-006 metrics (disposable dummy repos)
```

**Structure Decision**: Keep the existing single-`src/` TypeScript layout (`models/`, `core/`, `cli/`). The advisor core is one leaf module `src/core/diagnose/advisor.ts` plus a small `collect.ts` for read-only signal gathering, mirroring `src/core/spec-kit/` and `src/core/check/`. CLI surface is a tiny parser under `src/cli/parsers/` and one command under `src/cli/commands/`, wired through `src/cli/index.ts` like the existing commands. No new directory layers, no packages, no state layer.

## Complexity Tracking

No constitution violations; the complexity rationale table is not applicable. The two new leaf modules under `src/core/diagnose/` are required to keep one compile-boundary around read-only signal IO and one around pure evaluation (principles II and XVII); everything else extends existing modules in place.

## Technical Decisions

1. **Module placement**: New leaf module `src/core/diagnose/advisor.ts` (pure evaluation + reason construction, no IO) plus `src/core/diagnose/collect.ts` (read-only signal collection) and `src/models/diagnose.ts` (types). CLI wiring follows the existing command pattern: a parser, a command, and dispatch/printing in `src/cli/index.ts`.

2. **Responsibility boundaries**:
   - `src/cli/parsers/diagnose-input.ts`: pure argument parsing — optional positional task ID (grammar + canonicalization via the SPEC-006 helpers), `--task`/`--task-description` prose capture, repeated `--allow-path`/`--deny-path`, `--stack-profile` (validated against SPEC-005 profiles), `--json`. Rejects unknown flags, budget flags (`--preset`/`--tiny`/etc.), and unexpected positionals with the existing deterministic `InputValidationError` conventions. No filesystem access.
   - `src/core/spec-kit/tasks.ts` (reused, unmodified): task resolution (`resolveSpecKitTask`) including canonicalization and unknown/ambiguous failure behavior. `diagnose` never reads `.specify/feature.json`.
   - `src/core/diagnose/collect.ts`: read-only observable-signal collection. `N` = count of tracked files under declared prefixes via one `git ls-files` subprocess (only when declared paths exist); `C` = distinct SPEC-005 sensitive categories triggered by declared paths under an explicitly given profile via `getBuiltInStackProfileRules` + `matchPathPattern`; `P` = distinct declared prefixes. Never reads `.changebudget/**` or lifecycle state.
   - `src/core/diagnose/advisor.ts`: pure first-match decision-table evaluation over `ObservableSignals` → `DiagnosisResult` (outcome + ordered reasons), including explicit task-annotation precedence. No IO, no policy objects.
   - `src/cli/commands/diagnose.ts`: orchestration only — parse, resolve task (if ID), collect signals, evaluate, and return a typed result. No rendering.
   - `src/cli/index.ts`: dispatch + human printer + JSON printer (mirrors `check`/`status` printing), exit-code mapping.

3. **Minimal model surface**: `DiagnoseInput` (task_id, task_description, allow_paths, deny_paths, stack_profile, json). `ObservableSignals` (P, N, C, task budget annotation). `RecommendationReason` (stable `{ signal, value }` pairs). `DiagnosisResult` (recommendation outcome, ordered reasons, input echo, source `explicit` vs `inferred`). No persisted entity; no new lifecycle state.

4. **Recommendation representation without new presets**: `tiny`, `normal`, `free` reuse the existing preset identifiers from `change-contract.ts` (result type is `'tiny' | 'normal' | 'free' | 'manual_review'`). `manual_review` is a distinct outcome string, never a preset value elsewhere in the system; it is not accepted by `start`'s preset parser because `diagnose` never calls `start`.

5. **Explicit `[budget:...]` as configured recommendation source**: The resolved task's valid annotation is treated as an explicit/configured source (`source: 'explicit'`), NOT inferred evidence. Rule 1 of the decision table short-circuits to it; conflicting inferred scope signals do not override it (FR-007). An invalid annotation value is treated as absent (`source: 'inferred'` path proceeds) and is never recommended (edge case).

6. **Decision table as deterministic first-match logic**: The committed rule list in `spec.md` is implemented verbatim as an ordered pure function: (1) valid annotation → annotation; (2) `P = 0` → `manual_review`; (3) `C` contains `migrations`/`release_artifacts` → `manual_review`; (4) `N ≤ 5 && P ≤ 2 && C` empty → `tiny`; (5) `N ≤ 50 && P ≤ 3` → `normal`; (6) else `free`; (7) unreachable fallback `manual_review`. Each rule returns the outcome plus the specific reasons that fired, guaranteeing explainability with no hidden thresholds beyond the committed table.

7. **Reason ordering & byte-stability**: Fixed order — structural (`declared_paths`, `tracked_files`) → task metadata (`task_id`, `task_budget_default`) → sensitive categories lexicographically sorted. Reasons live on the result; human and JSON renderers emit them in array order. No timestamps, no randomness, no locale-dependent formatting; repeated runs byte-identical (FR-010).

8. **Read-only structural guarantee**: `diagnose` reaches only (a) `node:fs/promises` `readdir`/`readFile` inside the SPEC-006 resolver (read-only), and (b) one `git ls-files` subprocess. It never imports/writes lifecycle state, never calls `write*` helpers, never touches `.changebudget/**`, never stages/commits, and never invokes `/speckit.*` or network. Integration assertions verify `git status --short` and raw `tasks.md` bytes are identical before/after (SC-003, FR-002).

9. **Working-tree and active-contract behavior**: Per the committed spec, existing working-tree changes and any active contract are ignored as evidence (FR-011). `N` is the count of tracked files in the Git index under the declared prefixes — not a diff count — so diagnosis reflects declared scope, never the diff/history. `diagnose` neither reads nor blocks on lifecycle state.

10. **Exit codes**: `0` on any successful diagnosis, including `manual review` (it is a valid advisory outcome, not an error). Input-problem errors reuse `InputValidationError` → `2`; Git/environment errors reuse the existing mapping → `4`. No decision exit codes (PASS/REPAIR/HUMAN_REVIEW) are produced; `diagnose` never feeds the enforcement path.

11. **JSON contract**: `diagnose --json` emits `{ recommendation, source, reasons, inputs }` with fixed key order; reasons ordered as in human output; `manual_review` is the literal JSON string; no timestamps; omitted keys only where the contract says so.

12. **OpenCode guard**: `opencode-plugin/` sources are not modified. `diagnose` produces advisory results that never enter `RuntimeProjectionInput`; an extended projection regression test asserts the guard is unchanged by the new command.

## Execution Plan

Phases are ordered by dependency; each phase ends with its unit tests green before the next begins.

### Phase 1 — Models and advisor core (foundation)

- Add `src/models/diagnose.ts`: `DiagnoseInput`, `ObservableSignals`, `RecommendationReason`, `DiagnosisOutcome` (`'tiny' | 'normal' | 'free' | 'manual_review'`), `DiagnosisResult`, and the decision-table constants.
- Add `src/core/diagnose/advisor.ts` (pure): `evaluateRecommendation(signals)` implementing the committed first-match rules verbatim; returns outcome + ordered reasons.
- Tests: `tests/unit/diagnose-advisor.test.ts` covering every outcome, first-match precedence, annotation precedence, invalid-annotation-is-absent, and reason ordering.

### Phase 2 — Read-only signal collection

- Add `src/core/diagnose/collect.ts`: `collectObservableSignals(repositoryRoot, input, taskResolution)`:
  - `P`: distinct declared prefixes (allow + deny), stable order.
  - `N`: read-only `git ls-files` listing filtered by `matchPathPattern` against compiled declared patterns; only when `P > 0`. No `.changebudget/**` or lifecycle reads.
  - `C`: when `--stack-profile` given, distinct SPEC-005 categories from `getBuiltInStackProfileRules(profile)` that match any declared path pattern (lexicographic).
- Tests: `tests/unit/diagnose-collect.test.ts` with temp git repos for `N`, plus pure tests for `C` classification.

### Phase 3 — CLI parsing and command

- Add `src/cli/parsers/diagnose-input.ts`: positional task ID grammar/canonicalization, `--task`, repeated `--allow-path`/`--deny-path`, `--stack-profile` (validated), `--json`; deterministic rejection of budget flags, unknown flags, and bad positionals (existing error conventions).
- Add `src/cli/commands/diagnose.ts`: orchestration — parse, `resolveSpecKitTask` when ID present (reuse; failures propagate unmodified), collect signals, evaluate, return `DiagnosisResult`.
- Wire `diagnose` into `src/cli/index.ts`: `SUPPORTED_COMMANDS`, dispatch, human printer, JSON printer, exit-code mapping. No `check`/`status`/`close` behavior touched.
- Tests: `tests/unit/diagnose-input.test.ts` (accept/reject), extension of `tests/unit/opencode-runtime-projection.test.ts` (guard unchanged, FR-013).

### Phase 4 — Integration: byte-stability, read-only, no-Spec-Kit/no-stack, human/JSON equivalence

- Add `tests/integration/diagnose-command.spec.ts`: end-to-end `node dist/.../index.js diagnose ...` in disposable temp git repos.
  - `manual review` on bare/prose-only runs; `tiny`/`normal`/`free`/`manual review` per table on fixture repos with declared paths and optional profiles.
  - Annotation precedence: `Txxx [budget:tiny]` wins even with conflicting scope signals; invalid annotation treated as absent.
  - Byte-stability: run twice → identical bytes (human and `--json`).
  - Read-only: `git status --short`, `.changebudget/**` (when present), and `tasks.md` bytes unchanged.
  - Active-contract and working-tree independence: run with an active contract and uncommitted changes → unchanged output and no mutation.
  - No-Spec-Kit and no-stack repos still get deterministic results; `manual review` when evidence is insufficient.
  - Human/JSON equivalence of recommendation and reasons.

### Phase 5 — Acceptance metrics and full gate

- Add `tests/acceptance/spec007-diagnose-metrics.test.ts` implementing SC-001..SC-006 with the SPEC-005/006 metrics style (counts; generated `acceptance-metrics.md`):
  - SC-001: ≥30 table scenarios → expected outcome in 100% of cases.
  - SC-002: ≥20 repeated runs (incl. `--json`) → byte-identical.
  - SC-003: ≥20 runs → `git status --short`, `.changebudget/**`, `tasks.md` byte-identical before/after.
  - SC-004: ≥10 insufficient/high-uncertainty runs → `manual review` in 100%.
  - SC-005: existing SPEC-001..006 suites still pass; diagnose works with neither Spec-Kit nor stack profile.
  - SC-006: recommendation matches a reference classification on identical signals in ≥90% of controlled dummy-repo scenarios.
- Run `npm run build` then full `npm test`; gate on all green.

## Testing Strategy

Proportional and focused (principle V); each spec concern maps to specific tests:

- **Decision table outcomes**: `tiny`, `normal`, `free`, `manual review` each exercised, table-driven over the committed rule thresholds (FR-008, SC-001).
- **First-match precedence**: ordered rules tested in rule order; overlapping conditions resolve to the earlier rule (FR-008).
- **Explicit annotation precedence**: valid `[budget:...]` wins over conflicting inferred signals; invalid value treated as absent (FR-007).
- **Reason ordering**: fixed structural → task → sensitive-category order asserted (FR-010).
- **Repeated-run stability**: same repository/input run twice → byte-identical human and JSON (FR-010, SC-002).
- **Spec-Kit task input**: `diagnose T031` reuses the SPEC-006 resolver; unknown/ambiguous task IDs fail with the existing deterministic errors (FR-004).
- **No-Spec-Kit / no-stack scenarios**: repos without `specs/` and without a profile still produce deterministic results or `manual review` (FR-013).
- **Stack-policy evidence reuse**: declared paths under an explicit profile surface distinct sensitive categories; no duplicate policy definitions (FR-006; reuse via `getBuiltInStackProfileRules`).
- **Insufficient evidence / manual review**: bare runs and prose-only runs → `manual review`, never a guessed default (FR-009, SC-004).
- **Active-contract non-mutation / working-tree behavior**: runs with an active contract and uncommitted changes leave state and output unchanged (FR-011, SC-003).
- **Zero mutation**: `git status --short`, `.changebudget/**`, and `tasks.md` byte-identical before/after (FR-002, SC-003).
- **Human/JSON equivalence**: identical recommendation and ordered reasons in both surfaces (FR-012).
- **SPEC-001..006 compatibility**: existing suites pass unchanged; guard projection extended to prove `diagnose` never feeds `RuntimeProjectionInput` (FR-013, SC-005).

## Risks and Compatibility

- **No new state/schema**: `diagnose` persists nothing; `.changebudget/**`, contract files, and `schema_version` are untouched. No migration risk.
- **Baseline byte-stability**: all existing outputs are untouched; `diagnose` adds a new command only. `npm test` regression gate covers SPEC-001..006 byte-identity.
- **Git subprocess scope**: the only Git call is read-only `git ls-files`, made only when declared paths exist; failure surfaces as the existing `GitEnvironmentError` → exit 4.
- **Stack-policy coupling**: evidence reuses builtin profile rules only (repository override files are enforcement-scoped and not read by `diagnose`), avoiding a second policy-resolution path and preserving determinism.
- **Advisory-only guarantee**: `diagnose` cannot create/widen contracts or feed `check`; the enforcement model (`check`) is untouched. Development/CI can never mistake `diagnose` output for an authorization.
- **Windows paths**: declared prefixes are used only for pattern matching and counts; no path strings enter output except the declared input echo (normalized consistently with existing conventions).