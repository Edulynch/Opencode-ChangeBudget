# Feature Specification: Diagnose & Budget Advisor

**Feature Branch**: `007-diagnose-budget-advisor`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "Implement SPEC-007 — Diagnose & Budget Advisor: a read-only deterministic `changebudget diagnose` workflow that helps the developer choose an appropriate ChangeBudget preset BEFORE implementation."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Diagnose the right preset before starting a contract *(Priority: P1)*

As a developer, I want to ask `changebudget diagnose` which preset fits my task BEFORE implementing, so I can start the contract with a budget that matches the real scope instead of guessing or repeatedly adjusting after the fact.

**Why this priority**: This is the core value of SPEC-007: turning an upcoming change into a concrete preset recommendation without any implementation work and without any mutation of the repository.

**Independent Test**: In a disposable dummy repository, run `changebudget diagnose --allow-path "src/ui/**" --allow-path "tests/ui/**"` and verify a deterministic preset recommendation (`tiny`, `normal`, `free`, or manual review) is printed with the signals that produced it.

**Acceptance Scenarios**:

1. **Given** a dummy repository and a `diagnose` invocation with two declared paths and an explicit stack profile, **When** the command runs, **Then** it prints exactly one recommendation plus a list of deterministic reasons, and the recommendation follows the SPEC-007 decision table.
2. **Given** the same repository and arguments, **When** `diagnose` runs twice, **Then** both outputs are byte-identical (same recommendation, same reasons, same order).
3. **Given** any `diagnose` invocation in a dummy repository, **When** the command completes, **Then** `git status --short`, `.changebudget/**` contents, and any `tasks.md` files are byte-identical before and after.

---

### User Story 2 - Get an explainable recommendation when evidence is incomplete *(Priority: P1)*

As a developer, I want `diagnose` to recommend manual review instead of fabricating a preset when it cannot deterministically justify a choice.

**Why this priority**: Faking precision on weak evidence would silently push developers toward the wrong budget; SPEC-007 must be honest about uncertainty.

**Independent Test**: In a dummy repository, run `changebudget diagnose` with no declared paths, no stack profile, and no Spec-Kit task, and verify the result is `manual review` with reasons naming the missing evidence.

**Acceptance Scenarios**:

1. **Given** a `diagnose` run with no declared paths, no stack profile, and no task metadata, **When** the command runs, **Then** the recommendation is `manual review`, not a guessed default preset.
2. **Given** a `diagnose` run whose declared paths are only discoverable through semantic source-code understanding, **When** the command runs, **Then** it does not perform semantics and instead reports `manual review` if deterministic signals are insufficient.

---

### User Story 3 - Diagnose from an existing Spec-Kit task *(Priority: P2)*

As a developer working with Spec-Kit, I want `changebudget diagnose T031` to reuse the SPEC-006 task resolver and my explicit `[budget:...]` metadata, so the recommendation honors configured intent without re-typing context.

**Why this priority**: SPEC-006 already resolves `Txxx` deterministically; SPEC-007 reuses it rather than inventing a second resolver, and explicit configured budgets must dominate inferred advice.

**Independent Test**: In a dummy repository with `specs/.../tasks.md` containing `- [ ] T031 [budget:tiny] Implement task bridge`, run `changebudget diagnose T031` and verify the recommendation is `tiny` (the explicit annotation), then run it with additional conflicting scope signals and verify the annotation still wins.

**Acceptance Scenarios**:

1. **Given** a resolved task with an explicit `[budget:tiny]` annotation and no other explicit budget input, **When** `diagnose T031` runs, **Then** the recommendation is `tiny` and the annotation is listed as a reason.
2. **Given** the same task but fresh declared paths that would normally imply `normal`, **When** `diagnose T031 --allow-path …` runs, **Then** the explicit annotation still wins and the recommendation stays `tiny`.
3. **Given** a `diagnose` invocation with an unknown or ambiguous task ID, **When** the command runs, **Then** it fails with the deterministic SPEC-006 resolution error and makes no recommendation.

---

### User Story 4 - Diagnose without Spec-Kit and without a stack profile *(Priority: P2)*

As a maintainer, I want `diagnose` to remain useful and safe in ordinary repositories that have no Spec-Kit structure and no explicit stack profile, as long as sufficient deterministic evidence exists.

**Why this priority**: SPEC-007 must be strictly additive; repositories that never use Spec-Kit or stack profiles must keep working and still get honest recommendations.

**Independent Test**: In a dummy repository with no `specs/` directory and no `.changebudget` state, run `diagnose` with declared paths and verify a deterministic recommendation; then run it bare and verify `manual review`.

**Acceptance Scenarios**:

1. **Given** no Spec-Kit structure and no stack profile but declared path signals, **When** `diagnose` runs, **Then** it produces a deterministic recommendation from path/structure evidence alone, or `manual review` if evidence is insufficient.
2. **Given** no Spec-Kit structure, no stack profile, and no task, **When** `diagnose` runs with only a task description, **Then** it does not infer scope from prose and reports `manual review` unless deterministic signals exist.

---

### User Story 5 - Diagnose never mutates or blocks lifecycle state *(Priority: P2)*

As a developer, I want `diagnose` to be purely observational: even when a Change Contract is active, `diagnose` must not create, widen, change, or close anything, and must not block on lifecycle state.

**Why this priority**: The adviser must never become an accidental enforcement gate; it only informs the developer before they choose.

**Independent Test**: In a dummy repository with an active contract and uncommitted working-tree changes, run `diagnose` twice and verify both runs succeed, produce identical output, and leave the active contract, working tree, and `.changebudget` state untouched.

**Acceptance Scenarios**:

1. **Given** an active Change Contract, **When** `diagnose` runs, **Then** it reports normally (advisory only), does not read or depend on the active contract for its recommendation signals, and does not modify the contract.
2. **Given** uncommitted working-tree changes that match or do not match declared paths, **When** `diagnose` runs, **Then** working-tree diff state is ignored as evidence (never used as size/history signal) and nothing is staged or committed.

---

### User Story 6 - Read machine-readable recommendations *(Priority: P3)*

As a developer or CI-friendly script, I want `diagnose --json` to emit a well-ordered structured result identical in meaning to the human output.

**Why this priority**: Scriptability mirrors the existing `--json` conventions (check, status) and keeps the recommendation auditable.

**Independent Test**: In a dummy repository, run `diagnose …` and `diagnose … --json` and verify the JSON recommendation, reasons, and their order match the human text.

**Acceptance Scenarios**:

1. **Given** a `diagnose --json` run, **When** the command completes, **Then** the JSON contains the same recommendation and same ordered reasons as the human output.
2. **Given** repeated `diagnose --json` runs on the same state, **When** they complete, **Then** output is byte-identical (no timestamps, no random ordering).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a `diagnose` CLI command that is advisory and read-only, and MUST recommend exactly one of: `tiny`, `normal`, `free`, or `manual review`. No new presets are introduced.
- **FR-002**: `diagnose` MUST NOT create, activate, widen, modify, or close any Change Contract; MUST NOT touch `.changebudget/**` state; MUST NOT stage or commit files; MUST NOT invoke OpenCode, Spec-Kit, or any network service.
- **FR-003**: All inputs and rules MUST be deterministic and explicitly defined; the recommendation MUST be a pure function of repository-local observable state plus the explicitly supplied arguments. Semantic source-code understanding is forbidden.
- **FR-004**: `diagnose` MUST accept an optional positional argument matching the SPEC-006 task ID grammar (`^[Tt][0-9]{3,}$`); when present, task resolution MUST reuse the SPEC-006 task-resolution capability, be read-only, reuse the same canonicalization and unknown/ambiguous failure behavior, and never read or trust `.specify/feature.json`.
- **FR-005**: `diagnose` MUST accept at least these explicit flags, all deterministic: `--task`/`--task-description` (prose, stored as input context only, never semantically interpreted), `--allow-path`/`--allow-paths` and `--deny-path`/`--deny-paths` (declared scope), `--stack-profile` (one of the SPEC-005 profile identifiers), and `--json`.
- **FR-006**: The observable signal set MUST be limited to: declared path prefixes (P), the count of tracked repository files under the declared prefixes (N, computed read-only from Git), distinct SPEC-005 sensitive categories triggered by declared paths when a stack profile is explicitly given (C), and resolved task metadata from SPEC-006.
- **FR-007**: When the resolved task carries a valid `[budget:tiny|normal|free]` annotation, that annotation MUST be the recommendation (explicit configured intent wins over inferred advice). An invalid annotation value MUST be ignored (treated as absent), never reported as the recommendation.
- **FR-008**: The recommendation decision table MUST be evaluated in fixed order (see Edge Cases), producing: `tiny`, `normal`, `free`, or `manual review`, and every recommendation MUST be accompanied by reasons naming the concrete signals that produced it.
- **FR-009**: When evidence is insufficient (no declared paths and no deterministic structural signal), `diagnose` MUST return `manual review` rather than a default preset, and MUST state why (e.g., "no declared paths"). It MUST NOT default to `normal` on incomplete evidence.
- **FR-010**: Tasks/signal reasons MUST be ordered deterministically: structural signals (declared path count, tracked file count), then task metadata, then sensitive categories in lexicographic order. Repeated runs against the same repository and inputs MUST be byte-identical.
- **FR-011**: `diagnose` MUST be completely independent of the active contract lifecycle: it MUST NOT fail, block, or change behavior because a contract is active or because working-tree changes exist; diff state is ignored as evidence.
- **FR-012**: `diagnose --json` MUST emit a structured object containing the recommendation (as `tiny` | `normal` | `free` | `manual_review`), an ordered reasons array with signal name and value, and the explicit inputs used; its meaning and ordering MUST equal the human output.
- **FR-013**: Backward compatibility: SPEC-001..006 commands (`init`, `start`, `status`, `check`, `close`), the OpenCode runtime guard, stack-policy enforcement, and Spec-Kit Task Bridge behavior MUST be unchanged by the addition of `diagnose`; repositories without Spec-Kit or without a stack profile MUST remain fully diagnosable where deterministic evidence exists.
- **FR-014**: Invalid task resolution, invalid flag values, and malformed arguments MUST produce the same deterministic error conventions as the existing CLI and MUST NOT leave partial state. A stack profile, when supplied, MUST be validated against the SPEC-005 profiles.
- **FR-015**: `diagnose` MUST NOT perform automatic stack detection: if the developer does not supply `--stack-profile`, no profile is assumed, and only structural signals (P, N) are used unless task annotation already decides.

### Recommendation model & precedence (deterministic decision table)

Signals used by the model:

- `A`: a valid `<[budget:tiny|normal|free]>` annotation on the resolved task (explicit configured intent).
- `P`: number of distinct declared path prefixes (`--allow-path` / `--deny-path`).
- `N`: number of tracked repository files under the declared prefixes, computed read-only from Git.
- `C`: set of SPEC-005 sensitive categories (dependencies, migrations, configuration, public_api, release_artifacts) triggered by declared paths under an explicitly supplied stack profile; empty unless a profile is given.

The recommendation is the outcome of the FIRST matching rule, evaluated strictly in this order:

1. If `A` is present → recommend `A` (explicit configured intent wins; conflicting scope signals do not override it).
2. Else if `P = 0` → `manual review` (no declared scope; never guess a default).
3. Else if `C` contains `migrations` or `release_artifacts` → `manual review` (protected/high-risk surface; a fixed preset cannot be deterministically justified).
4. Else if `N ≤ 5` and `P ≤ 2` and `C` is empty → `tiny`.
5. Else if `N ≤ 50` and `P ≤ 3` → `normal` (includes sensitive categories other than migrations/release_artifacts, e.g. dependencies or configuration, per the "explainable why" example).
6. Else → `free` (scope clearly exceeds a focused change).
7. Fallback (unreachable given rule 2..6 completeness) → `manual review`.

Uncertainty rule: if no rule deterministically justifies a preset (rules 2 and 3 and 7), the result MUST be `manual review`; the model never downgrades to a guessed preset.

### Key Entities

- **DiagnoseInput**: Explicit, deterministic inputs to a `diagnose` call: optional task ID (canonical `Txxx`), optional task description prose, declared path prefixes (allow + deny), optional stack profile, output mode (human/JSON).
- **ObservableSignals**: Locally observed evidence:
  - `declared_path_count` (P): number of distinct declared path prefixes.
  - `tracked_file_count` (N): number of tracked files under declared prefixes (read-only Git lookup).
  - `sensitive_categories` (C): set of SPEC-005 categories (dependencies, migrations, configuration, public_api, release_artifacts) triggered by declared paths under an explicitly given profile.
  - `task_budget_default`: resolved task `[budget:...]` annotation when valid.
- **Recommendation**: The single output of `diagnose`: one of `tiny`, `normal`, `free`, `manual review`, plus ordered `reasons` that map each decision back to specific signals.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In at least **30** controlled dummy-repository scenarios spanning declared paths, stack profiles, and task annotations, `diagnose` produces the preset predicted by the SPEC-007 decision table in **100%** of cases (deterministic recommendations).
- **SC-002**: In at least **20** repeated runs against identical repository/input state (including `--json`), the output is byte-identical (deterministic, stable ordering, no timestamps).
- **SC-003**: In at least **20** `diagnose` runs, `git status --short`, `.changebudget/**`, and any `tasks.md` are byte-identical before and after (zero repository/state mutation).
- **SC-004**: In at least **10** scenarios with insufficient or high-uncertainty evidence (no declared paths, undecidable signals), `diagnose` returns `manual review` in **100%** of cases and never a fabricated default.
- **SC-005**: After adding `diagnose`, all existing SPEC-001..006 flows (lifecycle, budget, stack policy, OpenCode guard, Spec-Kit task bridge, JSON output) pass their existing suites unchanged (compatibility), and `diagnose` works on dummy repositories with neither Spec-Kit nor stack profile.
- **SC-006**: In controlled dummy-project scenarios, the recommendation (when not `manual review`) matches a simple reference classification on the same signals in **≥ 90%** of cases, demonstrating usefulness of the advisor without turning it into an enforcement gate.

## Assumptions

- The system targets the roadmap v0.5 deterministic advisor only; LLM/AI scope suggestions remain a reserved future extension.
- `diagnose` runs before implementation; historical or working-tree diff data is intentionally not used as an evidence signal, so the recommendation cannot be mistaken for a `check` result.
- Repositories are normal local Git checkouts; tracked-file counts come from Git's index (`git ls-files`-style read-only inspection) scoped to declared prefixes.
- The recommendation is advisory only; the developer retains final authority and can always override it via explicit `start` flags, which `diagnose` never touches.
- SPEC-004 decisions: `diagnose` is independent of active-contract state and of the OpenCode runtime guard; it neither reads the active contract nor depends on the guard for signals.

## Edge Cases

- What if `diagnose` is called with no arguments at all? → `manual review` (no deterministic evidence), with reasons stating no declared paths / no task.
- What if only a task description (prose) is provided and no other signals? → `manual review`; prose is never semantically interpreted, and no bundle of missing evidence is invented.
- What if a task ID is provided but unknown or ambiguous? → Deterministic failure using SPEC-006 resolution semantics; no recommendation.
- What if a task carries `[budget:...]` but the value is invalid? → The annotation is ignored as evidence (treated as absent) and the decision table runs on structural signals; the invalid value is never recommended.
- What if a task carries a valid `[budget:...]` and also a conflicting stack/path signal? → Explicit configured intent wins (FR-007); the annotation is the recommendation.
- What if declared paths are provided but no stack profile is given? → Only structural signals (P, N) are used; no profile is assumed (no automatic stack detection).
- What if declared paths match sensitive categories under an explicitly supplied stack profile? → Those categories enter C and are listed as reasons; if the category set is undecidable for a fixed preset, higher-uncertainty rules push toward `normal` or `manual review` per the decision table, never toward guessed precision.
- What if a Change Contract is already active when `diagnose` runs? → `diagnose` completes normally without reading or altering the contract; the recommendation is advisory.
- What if the working tree has uncommitted changes? → Ignored as evidence; nothing is staged or committed; the diff is never the basis of any signal.
- What if the repository has no `specs/` directory or no `.changebudget` state? → `diagnose` still runs; only the absence of evidence is reported, not an error, except for strictly required input validation.
- What if `--json` is requested? → Structured recommendation + ordered reasons equal to human output; deterministic ordering; no timestamps or random elements.
- How is output ordering guaranteed? → Fixed order: structural signals (P then N), then task metadata (ID, title, explicit annotation), then sensitive categories in lexicographic order; repeated runs are byte-identical.

## Explicit Non-Goals

- LLM/OpenAI/Anthropic-based semantic task interpretation or AI-generated budgets.
- Automatic contract creation, widening, execution of `start`, or auto-application of a recommended preset.
- Modifying Spec-Kit `tasks.md`, marking tasks complete, or invoking `/speckit.*`.
- Automatic stack detection; stack profile is only consumed when explicitly provided by the user.
- History-based ML, repository telemetry, cloud services, remote APIs, or analytics.
- AST/semantic multi-language code analysis.
- New presets beyond `tiny`, `normal`, `free`, and the existing `custom` semantics.
- Generalized advisor plugins or support for other specification frameworks.
- SPEC-008 hardening/dogfooding work.
- Turning `diagnose` into an enforcement or `check`-like gate; all results remain advisory.

## Compatibility Impact

- **SPEC-001..005 compatibility**: `diagnose` is a new command with no shared mutating path; existing lifecycle, budget, path-policy, stack-policy, reporting, and exit-code behavior is unchanged.
- **SPEC-006 compatibility**: task resolution reuse is read-only and fully deterministic; no `tasks.md` writes, closes, or Spec-Kit invocation.
- **OpenCode guard compatibility**: the runtime guard is untouched; `diagnose` does not emit or override policy decisions.
- **Storage compatibility**: no schema or state changes (`.changebudget` stays untouched).
- **CLI compatibility**: all existing commands and flags remain valid; `diagnose` adds only new, self-contained flags.