# Implementation Plan: Spec-Kit Task Bridge

**Branch**: `006-spec-kit-task-bridge` | **Date**: 2026-08-17 | **Spec**: `specs/006-spec-kit-task-bridge/spec.md`

**Input**: Feature specification from `/specs/006-spec-kit-task-bridge/spec.md`

## Summary

SPEC-006 adds a read-only bridge between Spec-Kit `tasks.md` files and the existing Change Contract lifecycle (`start → status → check → close`), so a contract can be opened directly from a `Txxx` task ID without extra commands or ceremony.

Scope:

- `start` accepts one optional positional argument matching the task ID grammar `^[Tt][0-9]{3,}$`, canonicalized to uppercase, resolved deterministically against `specs/<feature>/tasks.md` (read-only, lexicographic order).
- Unknown IDs fail with a stable "not found" error; IDs found in more than one source fail with a deterministic ambiguity error listing every source path; no guessing, `.specify/feature.json` is never read.
- Resolved task metadata (`task_id`, `task_title`, `task_source_feature`, `task_source_path`) is persisted as flat nullable fields on the existing contract; no schema migration required.
- Budget fast path: `--tiny`/`--normal`/`--free` are exact aliases of `--preset` (mutually exclusive with it) and an explicit `[budget:<preset>]` task-line annotation provides a deterministic default that an explicit CLI budget flag always overrides.
- Task context survives the lifecycle and is exposed as `Task:`/`Source:` lines in `status`/`close` and as an optional structured `task` object in `check --json` and `status --budget --json`, omitted entirely when absent so no-Spec-Kit output stays byte-identical.
- Repositories without Spec-Kit and task-free `start` calls behave exactly as SPEC-001..005.

The fast path `changebudget start T031 --tiny → implement → check → close` is achieved with the existing lifecycle and no new Spec-Kit commands or ceremony.

## Technical Context

**Language/Version**: TypeScript 5.9.x, Node.js 22 (ESM), strict mode. No new runtime dependencies.

**Storage**: existing repository-local `.changebudget/contracts/<id>.json` files via `src/core/state/state.ts` (stable-key JSON, atomic writes). Contract `schema_version` stays `1.0.0`; task fields are additive.

**Primary Dependencies**: Node builtins only (`node:fs/promises` for readdir/readFile, `node:path`) reused via existing `src/core/state/state.ts` file helpers (`readJsonFile`, `writeJsonFileAtomic`, `pathExists`, `ensureDirectory`). No new packages.

**Testing**: Node built-in test runner (`node --test`), existing `tests/unit`, `tests/integration`, `tests/acceptance` layout; `npm run build && npm test` gate.

**Target Platform**: Local CLI on developer machines (primary: Windows, secondary: macOS/Linux). No server/cloud surface.

**Project Type**: Local CLI (`changebudget`) with an OpenCode guard plugin consuming check policy results.

**Performance Goals**: Non-interactive commands complete well under the existing 3000 ms local threshold; task resolution is a small `readdir` + `readFile` scan only.

**Constraints**: Pure local, read-only toward all Spec-Kit state; deterministic byte-stable output; backward compatible with SPEC-001..005; no new commands; no LLM interpretation; never modifies `tasks.md`, completion markers, or git state; never invokes Spec-Kit commands; never reads `.specify/feature.json`.

**Scale/Scope**: Single-repo, personal-workflow CLI. At most dozens of `specs/<feature>` directories per repo; resolution is bounded and local.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Verdict |
|---|---|---|
| I. Local-first and deterministic | Pure local `readdir`/`readFile`; lexicographic ordering; exact-match resolution; error messages and orderings byte-stable per spec FR-017 | PASS |
| II. Minimal architecture | One new core module (`src/core/spec-kit/tasks.ts`) + one model file; extends existing contract/CLI modules; no new subsystem, services, or dependencies | PASS |
| III. Scope is a hard boundary | Only FR-001..FR-017 implemented; all spec non-goals (tasks.md writes, completion inference, `/speckit.*` invocation, LLM, stack detection, SPEC-007) are excluded | PASS |
| IV. Small changes require small workflows | `plan → implement → converge`; targeted validation after each phase; no full-spec ceremony | PASS |
| V. Targeted validation | Unit tests per module, focused integration fixtures, acceptance metrics; no full-suite reruns after every edit | PASS |
| VII. Enforcement over suggestion | Task resolution only treats unknown/ambiguous/malformed inputs as hard errors; existing PASS/REPAIR/HUMAN_REVIEW decision model untouched | PASS |
| VIII. Human authority | No auto-expansion of budgets/paths; budget defaults require explicit `[budget:...]` token or CLI flag | PASS |
| X. Fast execution | No git subprocesses in the resolution path (filesystem scan only); non-interactive | PASS |
| XI. Personal workflow first | Extends the existing Spec-Kit/OpenCode integration for personal, local use only | PASS |
| XVII. Anti-overengineering | Task metadata is flat nullable contract fields; single-purpose pure parser; no generic "task framework" abstraction | PASS |

Re-check after Phase 1: confirmation in `research.md` and `data-model.md` that the design stays additive and persists zero new global state.

## Project Structure

### Documentation (this feature)

```text
specs/006-spec-kit-task-bridge/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── task-id-grammar.md
│   ├── start-command.md
│   ├── human-output.md
│   └── json-output.md
├── checklists/requirements.md
├── acceptance-metrics.md
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# New files
src/models/spec-kit-task.ts          # SpecKitTaskResolution, TaskOutputObject, ID grammar helpers
src/core/spec-kit/tasks.ts           # Task-line parsing, source discovery, deterministic resolution

# Modified files (extend existing structure, no new layers)
src/models/change-contract.ts        # + task_id, task_title, task_source_feature, task_source_path
src/cli/parsers/contract-input.ts    # + positional task ID, --tiny/--normal/--free, mutual exclusivity
src/core/validation/contract-validator.ts  # + task field validation, description fill rule inputs
src/cli/commands/start.ts            # + resolution-before-persistence orchestration
src/cli/commands/check.ts            # + task pass-through into evaluation input/result
src/core/check/rules.ts              # + task on CheckEvaluationInput -> BudgetCheckResult
src/models/check-result.ts           # + BudgetCheckResult.task (nullable)
src/cli/commands/status.ts           # + last-closed task context propagation
src/cli/commands/close.ts            # + closed contract (task) exposed in result
src/cli/index.ts                     # + Task:/Source: lines, close output, JSON task object

# Tests
tests/unit/spec-kit-tasks.test.ts                 # parsing/discovery/resolution
tests/unit/start-command.test.ts                  # (extended) task start scenarios
tests/unit/contract-validation.test.ts            # (extended) task field validation
tests/unit/status-check-close.test.ts             # (extended) output/JSON/close
tests/unit/opencode-runtime-projection.test.ts    # (extended) guard unchanged by task fields
tests/integration/spec-kit-task-bridge.spec.ts    # end-to-end lifecycle + read-only + compat
tests/acceptance/spec006-task-bridge-metrics.test.ts  # SC-001..SC-006 metrics
```

**Structure Decision**: Keep the existing single-`src/` TypeScript layout (`models/`, `core/`, `cli/`). Task-domain code is a leaf module under `core/spec-kit/` so it has no circular dependencies: it depends only on `models/spec-kit-task.ts`, error types from `models/errors.ts`, and Node builtins. All other task behavior is expressed by extending existing modules in place (contract model, input parser, validator, start/check/status/close, output printers). No new directory layers, no new commands, no new packages.

## Complexity Tracking

No constitution violations; the complexity rationale table is not applicable. The single new leaf module `src/core/spec-kit/tasks.ts` is required to keep one compile-boundary scope around read-only task IO and parsing (per principles II and XVII); everything else is an in-place extension of existing modules.

## Technical Decisions

1. **Module placement**: New leaf module `src/core/spec-kit/tasks.ts` (discovery + parsing + resolution, read-only, no knowledge of contracts) and `src/models/spec-kit-task.ts` (task types). All other changes extend existing modules in place. There is no new CLI command.

2. **Responsibility boundaries**:
   - `src/cli/parsers/contract-input.ts`: pure argument parsing — positional task ID grammar + canonicalization, `--tiny/--normal/--free` aliases, `--preset` shorthand mutual exclusion, `--task` text capture. No filesystem access.
   - `src/core/spec-kit/tasks.ts`: `parseTaskLine` (pure line parser), `discoverTaskSources` (filesystem scan), `resolveSpecKitTask` (exact/unknown/ambiguity orchestration). Read-only; owns all task ID errors.
   - `src/cli/commands/start.ts`: orchestration only — resolve, apply budget precedence, fill `task_description` default, attach task metadata to the contract, then the unchanged persistence flow.
   - `src/models/change-contract.ts` + `src/core/validation/contract-validator.ts`: persistence/validation of additive task fields.
   - `src/core/check/rules.ts`, `src/cli/commands/check.ts`, `src/models/check-result.ts`: `task` pass-through from evaluated contract into `BudgetCheckResult`.
   - `src/cli/index.ts`, `src/cli/commands/status.ts`, `src/cli/commands/close.ts`: human `Task:`/`Source:` lines, JSON `task` object, close task mention.

3. **Contract representation**: Flat nullable top-level fields `task_id`, `task_title`, `task_source_feature`, `task_source_path` on `ChangeContract` (FR-005), matching the existing flat JSON style (`stack_profile` precedent). Not a nested object; `task` as a nested object appears only in machine-readable output where the spec defines it.

4. **Persisted-contract compatibility**: `readContract`/`parseContractPayloadForValidation` access fields by name; legacy contracts without task fields already parse (undefined fields are tolerated/ignored), and new contracts' extra keys are ignored by the same parser path. `schema_version` remains `1.0.0` — additive nullable fields require no version bump and no migration.

5. **Task ID recognition**: Single grammar `^[Tt][0-9]{3,}$` applied to the positional argument and to task-line ID tokens; canonicalization is `id.toUpperCase()` (e.g. `t031` → `T031`). Non-matching positionals keep the existing deterministic `Unexpected positional argument` error (edge cases `T031x`, `T31`, file names).

6. **Title/annotation extraction without Markdown parsing**: Line-based only. Requires `- <checkbox>` where checkbox ∈ `[ ]`, `[x]`, `[X]`; next whitespace token must match the ID grammar; subsequent `[token]` groups are treated as markers (including `[budget:<preset>]`); remaining plain text, trimmed, is the title. No heading/code-fence/emphasis parsing.

7. **Safe discovery**: `readdir('specs/', { withFileTypes: true })`; candidates are real non-symlink directories; feature names sorted with `localeCompare`; per-directory existence check for `tasks.md` via `pathExists`. Paths are repository-relative, forward-slash normalized (`.replace(/\\/g, '/')`), consistent with existing diff output. Unreadable `tasks.md` → deterministic `IOStateError` naming the path (never a silent "not found").

8. **Ambiguity**: Aggregation of exact matches across all sources; matches from more than one distinct `tasks.md` path, or duplicate occurrences within one file, both fail with an ambiguity error listing every distinct source path in sorted order. Zero matches → `not found` error naming the scanned source list. Both are `InputValidationError` (deterministic, exit code 2) and never guess.

9. **Budget precedence**: Annotation is extracted always but validated only when it is the effective source. Resolution order: explicit CLI budget flag (`--preset`/`--tiny`/`--normal`/`--free`) → `[budget:<preset>]` annotation → `null`. If the CLI flag is present the annotation is ignored entirely (even if invalid); if the annotation is the effective source and invalid, `start` fails deterministically before persistence.

10. **Failure-before-persistence**: In `runStart`, task resolution, budget determination, and `task_description` filling complete before the existing validation and before any `writeContract`/`writeLifecycleState`. Failed resolution leaves `.changebudget/` byte-identical (asserted in tests).

11. **JSON backward compatibility**: `task` key in `check --json` / `status --budget --json` payloads is present only when the evaluated contract carries task metadata; it is omitted entirely otherwise, keeping no-Spec-Kit payloads byte-identical to the SPEC-001..005 baseline. `BudgetCheckResult.task` is nullable; null is never serialized as `task`.

12. **OpenCode guard**: `opencode-plugin/` sources are not modified. The guard consumes policy decisions, paths, and sensitivity flags only; additive task fields never enter projection inputs (verified by an extended projection regression test, FR-007).

## Execution Plan

Phases are ordered by dependency; each phase ends with its unit tests green before the next begins.

### Phase 1 — Task model and parser (foundation)

- Add `src/models/spec-kit-task.ts`: `SpecKitTaskResolution` (`task_id`, `task_title`, `source_feature`, `source_path`, optional `budget_default`), `TaskOutputObject` (`id`, `title`, `source_feature`, `source_path`), `TASK_ID_PATTERN`, `canonicalizeTaskId`, `isTaskIdInput`.
- Add `src/core/spec-kit/tasks.ts`:
  - `parseTaskLine(line)` → discriminated result: task entry (`task_id`, `title`, `budget_default`), invalid-annotation entry, or `null` for non-task lines. Empty title → non-resolvable entry.
  - `discoverTaskSources(repositoryRoot)` → sorted `{ feature, relativePath }[]` (directories under `specs/`, each containing `tasks.md`).
  - `resolveSpecKitTask(repositoryRoot, taskId)` → single `SpecKitTaskResolution`, or deterministic `InputValidationError` (not found / ambiguous / invalid annotation / empty-title-only), or `IOStateError` (unreadable file).
- Extend `ChangeContract`/`ParsedContractInput`/`ValidatedContractInput` with the four nullable task fields; `createDraftContract` writes them from input.
- Tests: `tests/unit/spec-kit-tasks.test.ts`, `tests/unit/contract-validation.test.ts` (task field validation).

### Phase 2 — CLI argument parsing

- Extend `src/cli/parsers/contract-input.ts`:
  - Accept at most one positional argument; if present it must match the ID grammar (else existing `Unexpected positional argument` error); canonicalize via `canonicalizeTaskId`; record as `task_id` (new parse field). `--task` continues to set `task_description`.
  - Add `--tiny`/`--normal`/`--free` as exact aliases for `--preset tiny|normal|free`; combining any shorthand with `--preset` is a deterministic input error (FR-011, edge case).
- Tests: extend `tests/unit/start-command.test.ts` for grammar acceptance/rejection and shorthand exclusivity.

### Phase 3 — Start orchestration and budget default

- Extend `runStart` in `src/cli/commands/start.ts`:
  - When `task_id` present: `resolveSpecKitTask` → on failure, no state is read for task purposes and nothing persists.
  - Budget default: explicit CLI flag wins; else annotation `budget_default`; else keep `preset` as parsed.
  - `task_description` defaults to resolved `task_title` when `--task` absent (FR-006); explicit `--task` still wins, `task_title` stored separately.
  - Attach the four task fields to the contract before the unchanged `writeContract`/`transitionToActive`/`writeLifecycleState` flow.
- Tests: extend `tests/unit/start-command.test.ts` for unknown IDs, ambiguous IDs, invalid annotation, empty-title-only, precedence (annotation vs CLI), `--task` override, no-partial-state byte-identity.

### Phase 4 — Check, status, close exposure

- `src/models/check-result.ts` + `src/core/check/rules.ts`: add nullable `task` to `BudgetCheckResult`; add `task` to `CheckEvaluationInput`; `evaluateBudgetCheck` copies it through. Failure-result builders set `task: null`.
- `src/cli/commands/check.ts`: derive `TaskOutputObject` from the parsed contract payload (active or draft) and supply it to the evaluation input.
- `src/cli/commands/status.ts`: propagate `task` via `budgetResult` for JSON; human lines read from `activeContract`/`lastClosedContract` (both `ChangeContract`).
- `src/cli/commands/close.ts`: `CloseResult` carries the closed contract so the printer can emit task context.
- `src/cli/index.ts`:
  - `status` human: for a contract with `task_id`, print `Task: <task_id>` and `Source: <task_source_path>`; without metadata, keep the existing `Task: <task_description>` line untouched.
  - `check --json`/`status --budget --json`: include `task` object only when present; omit otherwise (byte-identical baseline).
  - `close`: after `Contract closed.`, when the closed contract has task metadata print `Task: <task_id>` and `Source: <task_source_path>`.
- Tests: extend `tests/unit/status-check-close.test.ts`; add `tests/integration/spec-kit-task-bridge.spec.ts` for the full lifecycle, JSON presence/omission, and byte-stability.

### Phase 5 — Read-only, backward compatibility, acceptance metrics

- Read-only assertions: `git status --short` and raw `tasks.md` bytes identical before/after `start` on task-tied repos (SC-005, SC-006, FR-013).
- No-Spec-Kit baseline: full `init → start → status → check → close` runs on a fixture without `specs/` and with plain `--task` text; outputs and persisted contracts byte-identical to the SPEC-001..005 baseline (FR-016, SC-004). Extend `tests/integration/opencode-plugin-runtime-hook.spec.ts` and `tests/unit/opencode-runtime-projection.test.ts` to assert the guard is unchanged by task fields (FR-007).
- Add `tests/acceptance/spec006-task-bridge-metrics.test.ts` implementing SC-001..SC-006 with the Spec-005 metrics style (counts, generated `acceptance-metrics.md`).
- Run `npm run build` then full `npm test`; gate on all green.

## Testing Strategy

Proportional and focused (principle V); each concern from the spec maps to specific tests:

- **Exact task parsing**: `parseTaskLine` unit tests for valid entries, `[x]`/`[X]` markers, marker token stripping, empty titles, malformed/non-task lines.
- **Deterministic discovery/resolution**: `discoverTaskSources`/`resolveSpecKitTask` unit tests with controlled fixture trees (lexicographic order, nested/non-directory entries, symlinks excluded).
- **Unknown task IDs**: start with `T999` fails deterministically, error names scanned sources, exit code 2.
- **Duplicate/ambiguous IDs**: same ID in two features and duplicate in one file → ambiguity error listing all paths, no guess.
- **Malformed task lines**: broken checkbox, no ID token, empty title, invalid annotation — each fails or resolves deterministically per rules above.
- **Lifecycle persistence**: contract file contains the four task fields after start; survive `status`/`check`/`close` (SC-001, FR-014).
- **Status/check/close exposure**: human `Task:`/`Source:` lines and close output match stored metadata (FR-008, FR-010).
- **JSON output**: `check --json` and `status --budget --json` include the `task` object only when present; omitted for task-free contracts (FR-009).
- **Explicit budget precedence**: annotation vs `--normal` override; shorthand alias behavior; mutual exclusion with `--preset` (FR-011, FR-012).
- **No-Spec-Kit backward compatibility**: baseline fixtures produce byte-identical output/persisted contracts (FR-016, SC-004).
- **Read-only behavior**: git working tree and `tasks.md` bytes unchanged after task-based starts (FR-013, SC-005/SC-006).
- **No partial state on failure**: failed start leaves `.changebudget/` byte-identical (FR-015).

## Risks and Compatibility

- **Schema migration**: none. All new contract fields are nullable and additive; `schema_version` stays `1.0.0`; legacy contracts remain valid and unchanged; unknown-field-tolerant readers remain compatible.
- **Baseline byte-stability**: every output change is conditional on task metadata presence; the JSON `task` key is omitted when absent, so no-Spec-Kit payloads, human output, and exit codes are byte-identical to SPEC-001..005.
- **Error taxonomy**: unknown/ambiguous/grammar/invalid-annotation → `InputValidationError` (exit 2); unreadable `tasks.md` → `IOStateError` (exit 4); existing lifecycle conflicts unchanged. All messages byte-stable per repository state (FR-017).
- **Read-only guarantee**: resolution uses `readFile`/`readdir` only; no writes, no completion marking, no git mutation, no `/speckit.*` invocation; enforced by integration assertions.
- **Windows paths**: repository-relative paths normalized to forward slashes for output and contract fields, matching existing conventions.
- **Behavioral safety**: task resolution runs before any contract validation/persistence in `start`, so a failing task start can never leave partial state.