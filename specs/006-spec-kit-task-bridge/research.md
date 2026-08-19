# Research: SPEC-006 — Spec-Kit Task Bridge

Phase 0 output. Sources: direct inspection of the SPEC-006 spec (including its own Clarifications), the current ChangeBudget source tree (`src/`), repo constitution, and prior SPEC-005 implementation. No external libraries or services were used; all unknowns were resolvable from the codebase.

## Decision 1: Where task discovery/resolution lives

- **Decision**: A leaf module `src/core/spec-kit/tasks.ts` plus `src/models/spec-kit-task.ts`; everything else extends existing modules in place.
- **Rationale**: The spec requires no new subsystem (goal 5). `start` already owns contract creation and validation; `check`/`status`/`close` already read contracts and render output. Only task IO/parsing is genuinely new and belongs in a single compile-boundary leaf that depends on `models/`, `models/errors.js`, and Node builtins only. Type definitions follow the repo convention of living in `src/models/` (cf. `change-contract.ts`, `check-result.ts`); behavior code lives in `src/core/` (cf. `core/check/stack-policy.ts`).
- **Alternatives considered**: a new `src/core/speckit/` sub-tree with discovery/parse/resolve split into separate files (over-fragmented for one consumer each, principle XVII); a new `changebudget task` command (explicitly rejected by spec fast-path goal and FR-016); hosting types inside the core module (deviates from the `models/` convention).

## Decision 2: Contract representation of task metadata

- **Decision**: Flat nullable top-level fields `task_id`, `task_title`, `task_source_feature`, `task_source_path` on `ChangeContract`.
- **Rationale**: The spec's Key Entities define exactly this surface (FR-005). The existing contract is flat (e.g. `stack_profile`, `disabled_stack_rules` added in SPEC-005 without a version bump), and `readContract`/`parseContractPayloadForValidation` tolerate unknown or missing fields, so old contracts parse unchanged and new fields are ignored by existing readers. Flat fields make persistence and diffing trivial.
- **Alternatives considered**: a nested `task: { id, ... }` object on the contract (adds a new shape and asymmetry with the rest of the flat schema; nested object is reserved for machine output where the spec names it); a separate sidecar store (violates VI "no parallel state abstraction"; spec explicitly wants contract-persisted lifecycle, FR-014).

## Decision 3: Task-line parsing strategy

- **Decision**: Line-based parsing only, no Markdown parsing. Grammar: `- <checkbox> <TaskId> [markers]* <title>` with checkbox ∈ `{[ ]`, `[x]`, `[X]}`; ID from `^[Tt][0-9]{3,}$`; bracket groups after the ID are markers (incl. `[budget:<preset>]`); title is the remaining plain text.
- **Rationale**: The spec assumption pins the task-line convention; the task-listing grammar is trivial and fully expression-free of headings/code spans/emphasis. Forbidding a Markdown parser keeps zero dependencies and deterministic behavior (binaries have no Markdown dep today; principle XVII). FR-002/FR-003 require exact, deterministic ID recognition, which a tokenizer gives directly.
- **Alternatives considered**: a Markdown AST parser (new dependency, overkill, risk to determinism); regex-only full-line matching (fragile for marker ordering); treating any line containing `T\d{3,}` as a task (too loose, breaks "not resolvable" edge cases).

## Decision 4: Error taxonomy for resolution failures

- **Decision**: Unknown ID, ambiguity, invalid `[budget:<preset>]` annotation, and resolvable-but-empty-title all raise `InputValidationError` (deterministic, exit 2 via `getExitCode`). An unreadable `tasks.md` raises `IOStateError` (exit 4). Existing `start` lifecycle conflicts are untouched.
- **Rationale**: `start` already surfaces user-input problems as `InputValidationError`; resolution failures are user-input problems (bad/missing/duplicate IDs) which must map to the same stable exit code and message format. File-system read failures are environment failures consistent with how `state.ts` raises `IOStateError`. Byte-stable messages follow the existing `formatError` convention (`name: message (context)`).
- **Alternatives considered**: a dedicated `TaskResolutionError` (new error type with no extra value; `getExitCode` switch would need growth); reusing `StateConflictError` (wrong semantics).

## Decision 5: JSON `task` object presence

- **Decision**: `BudgetCheckResult.task` is nullable; `check --json` and `status --budget --json` include the `task` key only when non-null, and omit it otherwise.
- **Rationale**: FR-009 says "MUST omit it when absent", and SC-004/FR-016 require no-Spec-Kit output byte-identical to baseline. The existing printers already branch on stack summaries with `?? null`; for `task` the spec explicitly demands omission, so the payload is assembled conditionally to guarantee the byte-identical baseline.
- **Alternatives considered**: always emitting `task: null` (simpler printer but not byte-identical to baseline; fails FR-016/SC-004); always emitting it only for task-tied contracts while leaving `null` elsewhere (same problem).

## Decision 6: Budget default precedence and validation timing

- **Decision**: CLI flag (`--preset` or `--tiny/--normal/--free`) > `[budget:<preset>]` annotation > `null`. The annotation is validated only when it is the effective source; if the CLI flag is present the annotation is ignored entirely, even if invalid.
- **Rationale**: Spec Clarification and FR-012 pin "CLI always wins, annotation ignored, not an error"; the invalid-annotation failure applies when the annotation would set the preset. Validating only the effective value keeps precedence deterministic without blocking fast-path users who override a bad inline default.
- **Alternatives considered**: always validating the annotation even when overridden (contradicts the "ignored, not an error" clarification); letting the annotation win (contradicts explicit CLI-precedence requirement).

## Decision 7: Failure-before-persistence ordering in `start`

- **Decision**: `runStart` performs task resolution, budget determination, and `task_description` filling before the existing contract validation and before any `writeContract`/`writeLifecycleState`.
- **Rationale**: FR-015 and edge cases require no partial state. The current `runStart` already orders validation ahead of persistence (`assertStackPolicyConfigurationIsValid`, `validateRevision`, then writes); inserting resolution between parsing and validation preserves that property for task failures. The contract's `task_description` is mandatory (validator), so the description default must be resolved prior to `assertInputIsValid`.
- **Alternatives considered**: resolving after validation with a "task w/o description" special case (breaks validator contract and adds branching); writing the contract first and clearing on failure (invalidates FR-015).

## Decision 8: Discovery safety and path normalization

- **Decision**: `readdir('specs/', { withFileTypes: true })` with candidates restricted to non-symlink directories; feature names sorted `localeCompare`; `tasks.md` presence via `pathExists`; repository-relative paths normalized to forward slashes (`replace(/\\/g, '/')`).
- **Rationale**: The repo already treats `specs/<feature>/tasks.md` as the only layout (assumption in spec). Restricting to real directories excludes stray files and avoids following symlinks out of the tree (determinism + read-only safety, FR-002/FR-013). Lexicographic order + file order gives byte-stable resolution (FR-017). Forward-slash normalization matches existing output conventions and cross-platform behavior.
- **Alternatives considered**: recursive glob for `**/tasks.md` (wider scope than the spec allows); trusting `DirEntry.isDirectory()` without a symlink check (can escape the repo); native `path.sep` output (breaks byte-stable expected strings on Windows).

## Decision 9: Ambiguity semantics

- **Decision**: Exact matches are aggregated across all sources; more than one distinct matching `tasks.md` path, or duplicate occurrences within one file, both raise the deterministic ambiguity error listing every distinct source path in sorted order. Zero matches raise the deterministic not-found error naming the scanned source list.
- **Rationale**: FR-004 forbids guessing and mandates listing every source path; `.specify/feature.json` is never consulted (spec Clarification). Treating same-file duplicates as ambiguous preserves the "never guess" guarantee and avoids hidden ordering bias.
- **Alternatives considered**: first-match-wins (silent wrong association — rejected by US2); using `.specify/feature.json` as a tiebreaker (explicitly prohibited).

## Decision 10: Testing approach

- **Decision**: Node built-in test runner; unit tests for parser/resolver per Concern, extended existing unit suites for start/validation/status/check/close, a new integration fixture suite, and a SPEC-005-style acceptance metrics suite for SC-001..SC-006.
- **Rationale**: Mirrors SPEC-005 (metrics with generated `acceptance-metrics.md`, integration via real git fixtures and the compiled CLI). Covers every user-mandated test concern including read-only (`git status --short` + file bytes), no-partial-state (`git status` of `.changebudget/`), and backward-compat (byte-compare against baseline). No new runner, matching principle XVII and existing scripts (`npm run build`, `npm test`).
- **Alternatives considered**: jest/vitest (new dev dependency, breaks zero-dependency choice); expanding only integration tests (loses focused unit coverage for parsing/discovery edge cases).