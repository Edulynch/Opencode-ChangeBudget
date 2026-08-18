# Data Model: SPEC-007 — Diagnose & Budget Advisor

## Purpose

This document defines the Diagnose & Budget Advisor domain objects. SPEC-007 is strictly advisory and read-only: no data is persisted anywhere (`.changebudget/**` is never touched), and no existing lifecycle, budget, path-policy, stack-policy, task-bridge, reporting, exit-code, or OpenCode guard behavior changes (FR-002, FR-013).

## Entity: DiagnoseInput (derived, in-memory)

Explicit, deterministic inputs to one `diagnose` call. Produced by the argument parser (`src/cli/parsers/diagnose-input.ts`) and consumed by signal collection and the command orchestrator.

| Field | Type | Required | Source |
|---|---|---|---|
| `task_id` | string (`T` + digits) \| null | yes | optional positional argument, canonicalized via SPEC-006 grammar |
| `task_description` | string \| null | no | `--task` / `--task-description` prose; never semantically interpreted |
| `allow_paths` | string[] | yes | repeated `--allow-path`/`--allow-paths`, glob patterns |
| `deny_paths` | string[] | yes | repeated `--deny-path`/`--deny-paths`, glob patterns |
| `stack_profile` | string \| null | no | `--stack-profile`, validated against SPEC-005 profiles; `null` means none (never auto-detected, FR-015) |
| `json` | boolean | yes | `--json` output mode |

Rules:

- At most one positional argument, matching `^[Tt][0-9]{3,}$`; any other positional or unknown/budget flag → deterministic `InputValidationError` before any work (FR-005, FR-014).
- `stack_profile` must be one of the SPEC-005 profile identifiers (`android`, `flutter`, `spring-boot`, `node-ts`); otherwise deterministic `InputValidationError` (FR-014).
- `allow_paths`/`deny_paths` are declared scope only; they never mutate path-policy state.

## Entity: ObservableSignals (derived, in-memory)

Locally observed evidence, produced by `collectObservableSignals` (`src/core/diagnose/collect.ts`). All reads are read-only: Spec-Kit task resolution via the SPEC-006 resolver, and one `git ls-files` subprocess when declared paths exist.

| Signal | Type | Required | Notes |
|---|---|---|---|
| `declared_path_count` (P) | number | yes | count of distinct declared path prefixes (allow + deny) |
| `tracked_file_count` (N) | number \| null | yes | tracked files under declared prefixes via read-only Git index lookup; `null` when `P = 0` (no lookup performed) |
| `sensitive_categories` (C) | string[] | yes | distinct SPEC-005 sensitive categories (dependencies, migrations, configuration, public_api, release_artifacts) triggered by declared paths under an explicitly supplied profile; empty unless `--stack-profile` given (FR-015) |
| `task_budget_default` | `tiny` \| `normal` \| `free` \| null | yes | valid `[budget:...]` annotation on the resolved task, or `null` when none/invalid |

Determinism rules:

- `P` counts distinct prefixes; ordering of the input list is preserved for echo but the count is order-independent.
- `N` is the count of tracked files in the Git index matching the compiled declared patterns — **not** a diff count, and never a working-tree signal (FR-011).
- `C` is sorted lexicographically and deduplicated.
- `task_budget_default` is present **only** for a valid annotation value (`tiny`/`normal`/`free`); an invalid value is treated as absent (FR-007, edge case).

## Entity: RecommendationReason (result projection)

A single, stable reason pair. Human and JSON renderers emit them in array order, which is identical across both surfaces (FR-012).

| Field | Type | Notes |
|---|---|---|
| `signal` | string | one of: `declared_paths`, `tracked_files`, `task_id`, `task_budget_default`, `sensitive_category` |
| `value` | string \| number | concrete observed/derived value |

Ordering (fixed, per FR-010):

1. Structural: `declared_paths` (P), then `tracked_files` (N, when present).
2. Task metadata: `task_id` (when the task resolved), then `task_budget_default` (only when a valid annotation exists).
3. Sensitive categories: one `sensitive_category` reason per category, lexicographically sorted.

## Entity: DiagnosisResult (result projection)

The single output of `diagnose`.

| Field | Type | Notes |
|---|---|---|
| `recommendation` | `tiny` \| `normal` \| `free` \| `manual_review` | exactly one of these four outcomes (FR-001) |
| `source` | `explicit` \| `inferred` | `explicit` when a valid task annotation decided (rule 1); otherwise `inferred` (FR-007) |
| `reasons` | `RecommendationReason[]` | ordered per FR-010, byte-stable |
| `inputs` | `DiagnoseInput` | deterministic echo of the explicit inputs used (FR-012) |

`Recommendation` is a projection, never a persisted entity and never a preset: the `tiny`/`normal`/`free` strings reuse the existing preset identifiers from `change-contract.ts`, while `manual_review` is a distinct advisory outcome that is **never** accepted by `start`'s preset parser (FR-001, plan decision 4).

## Decision table (deterministic first-match)

Implemented verbatim as a pure function `evaluateRecommendation(signals)` in `src/core/diagnose/advisor.ts`. Signals `A`/`P`/`N`/`C` correspond to `task_budget_default`/`declared_path_count`/`tracked_file_count`/`sensitive_categories`.

1. If `A` is present → `A` (`source: explicit`; conflicting scope signals never override, FR-007).
2. Else if `P = 0` → `manual review`, reason `declared_paths: 0` (never a guessed default, FR-009).
3. Else if `C` contains `migrations` or `release_artifacts` → `manual review`, reason naming the category.
4. Else if `N ≤ 5` and `P ≤ 2` and `C` empty → `tiny`.
5. Else if `N ≤ 50` and `P ≤ 3` → `normal` (includes sensitive categories other than migrations/release_artifacts).
6. Else → `free`.
7. Fallback (unreachable) → `manual review`.

Thresholds are declared as constants in `src/models/diagnose.ts`. When `N` is `null` (rule 2 already handled `P = 0`), rules 4/5 evaluate with `N` as unavailable only after rule 2 ensures `P > 0`; the pure function treats missing `N` as `0` inside the guarded branch that already guarantees collection occurred.

## Determinism rules

- No timestamps, no randomness, no locale-dependent formatting, no network access.
- Reasons ordered per FR-010; repeated runs against the same repo and inputs are byte-identical (FR-010, SC-002).
- Errors reuse existing deterministic conventions: unknown/ambiguous task ID from the SPEC-006 resolver; `InputValidationError` for bad flags/positionals (exit 2); Git/environment failures map to the existing environment exit (4).
- Read-only guarantee: `diagnose` reads only Spec-Kit task files (via the SPEC-006 resolver) and a `git ls-files` subprocess; it never reads or writes `.changebudget/**`, never reads `.specify/feature.json`, never mutates `tasks.md`, git state, or the working tree (FR-002, FR-004, FR-011).

## Output projection rules

| Surface | Block | Notes |
|---|---|---|
| Human | `Recommendation`, `Source`, `Reasons` | see [human-output.md](contracts/human-output.md) |
| Human | `manual review` printed as `manual review` (space) | literal per FR-001 |
| JSON | `recommendation`, `source`, `reasons`, `inputs` | see [json-output.md](contracts/json-output.md); `manual_review` literal underscore form |
| Exit codes | 0 on any successful diagnosis (incl. `manual review`) | see [diagnose-command.md](contracts/diagnose-command.md) |
| OpenCode guard projection | unchanged; `diagnose` never emits policy decisions | FR-013 |