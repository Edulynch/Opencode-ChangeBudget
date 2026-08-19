# Implementation Plan: SPEC-008 Dogfood, Reliability & Personal v1.0

**Branch**: `008-dogfood-reliability` | **Date**: 2026-08-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-dogfood-reliability/spec.md`

## Summary

SPEC-008 hardens the converged SPEC-001..007 feature set into a trustworthy personal v1.0. Scope is FIXED to the committed findings: **1 BLOCKER (F-B01)**, **13 MUST_FIX (F-M01..F-M13)**, and **10 ACCEPTED_LIMITATION (A-01..A-10)**. No new hardening scope is discovered; every fix is the smallest targeted correction at the existing module/function boundary that closes the proven reliability gap (see [research.md](research.md) for the empirical validation of the tricky platform/Git/recovery decisions).

Delivery is four implementation phases plus one acceptance phase: **state integrity & atomic writes → Git budget-engine reliability → plugin & stack-policy reliability → coverage hardening → v1.0 reliability acceptance gate** (SC-001..SC-008). Zero new runtime dependencies; no new architecture; persisted formats unchanged.

## Technical Context

- **Language/Version**: TypeScript 5.9, Node.js 20+ (existing).
- **Primary Dependencies**: none beyond existing — Node standard library, Git CLI. Zero new runtime dependencies (FR-021).
- **Storage**: local `.changebudget/**` JSON files (state, contracts, history-declared-but-unused, stack-policy-overrides). Persisted formats DO NOT change.
- **Testing**: Node built-in test runner (`node --test`); unit + integration + acceptance suites; disposable Git repositories only.
- **Target Platform**: Windows and Node.js (already claimed). Git for Windows validated for research findings.
- **Project Type**: local CLI + optional OpenCode plugin.
- **Performance Goals**: no optimization work; only a regression guard — existing per-file untracked-binary subprocess behavior and probe counts remain unchanged (A-10).
- **Constraints**: local-first, deterministic, no silent destruction, human authority, zero telemetry, no fsync baseline, <proportional complexity>, no recovery subsystem, no new deps.
- **Scale/Scope**: finite hardening scope — 14 fixes, 10 accepted limitations, 1 acceptance gate.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — passed.*

| Principle | Verification |
|---|---|
| I. Local-first & deterministic | All fixes are local, deterministic; ordering becomes locale-free (F-M09). PASS |
| II. Minimal architecture | Modifications are in-place at existing boundaries; no new subsystem/framework. PASS |
| III. Scope is a hard boundary | Only the 14 committed findings; no speculative hardening; no feature expansion. PASS |
| IV. Small changes, small workflows | Phases grouped 3–6 tasks; full suite reserved for the final v1.0 gate. PASS |
| V. Targeted validation first | Finding-driven regression tests per phase; no full-suite churn after every edit. PASS |
| VI. Git is the source of change truth | Canonical `-z` probes still derive everything from Git; no parallel state abstraction. PASS |
| VII. Enforcement over suggestion | Error/recovery fixes preserve PASS/REPAIR/HUMAN_REVIEW semantics; no auto-repair. PASS |
| VIII. Human authority | Recovery is detection + actionable error (`re-run close`), never silent auto-widening or auto-revert. PASS |
| IX. Explainable decisions | New errors carry path/context; no opaque degradation. PASS |
| X. Fast execution | No new scans, no new git probes, no new deps. PASS |
| XI. Personal workflow first | Only OpenCode/Git/Node/Windows — no new integrations. PASS |
| XII. Tooling discipline | Zero new runtime dependencies. PASS |
| XIII. Dogfooding | Manual, user-opt-in self-host gate; never automated against other repos. PASS |
| XIV. Quality over complexity | Small targeted fixes, typed errors, testable seams. PASS |
| XV. Specification discipline | Findings register is the sole scope source; contradictions stop work. PASS |
| XVI. Roadmap governance | SPEC-008 is the approved final milestone; nothing beyond it. PASS |
| XVII. Anti-overengineering | A-01..A-10 stay accepted; no recovery engine, cache framework, or Git abstraction added. PASS |

No violations require complexity justification (Complexity Tracking stays empty).

## Findings & Fixes Mapping

Each item records: root cause, current boundary, smallest production change, focused regression test, compatibility impact, dependencies, parallel-capability, non-goals.

### F-B01 — Atomic state-write safety (BLOCKER)

- **Root cause**: `writeJsonFileAtomic` retries `rename` after `rm(dest, force)` on `EEXIST`/`EPERM`, creating a window where the previous good file is gone before replacement succeeds.
- **Current boundary**: `src/core/state/state.ts` → `writeJsonFileAtomic` (lines ~211-240), used by `writeLifecycleState`/`writeContract`.
- **Smallest change**: remove the delete-and-rename fallback; on `EEXIST`/`EPERM`, retry `rename` with short backoff (3 attempts, ~50–150 ms); on exhaustion, cleanup temp and throw `IOStateError` preserving the previous file. Optional injectable rename/backoff seam for deterministic tests (research R-1).
- **Regression test**: `tests/unit/state-helpers.test.ts` — table-driven: first-try success; transient-EPERM-then-success (retry); persistent-EPERM → `IOStateError`, previous bytes intact, temp cleaned, no delete called.
- **Compatibility impact**: none to CLI surface; error remains `IOStateError` (exit class unchanged). Only the internal replace strategy changes.
- **Dependencies**: none. **Parallel**: yes (independent of all other findings).
- **Non-goals**: no `fsync`, no directory sync, no transactional framework, no destination-swap strategy, no generic state-layer rewrite.

### F-M01 — Lifecycle partial-state recovery (MUST_FIX)

- **Root cause**: `start` writes the contract before `state.json`; `close` marks the contract closed before updating `state.json`. A mid-command failure leaves an orphaned active contract (start) or closed-contract/still-active-state (close).
- **Current boundary**: `src/cli/commands/start.ts` (write order ~168-171), `src/cli/commands/close.ts` (~99-105), `src/core/state/contracts.ts` (`closeContractInPlace`).
- **Smallest change** (research R-3): (a) `start` deterministically removes an unreferenced `status:'active'` orphan contract before writing the new one; (b) when reading the active contract, a contract whose `status !== 'active'` while state says `active` raises an actionable `StateCorruptionError` ("re-run `changebudget close` to reconcile"); re-running `close` self-heals. No auto-repair, no journal.
- **Regression test**: `tests/integration/lifecycle-init-start-status-check.spec.ts` — orphanned-start fixture (contract written, state rolled back), assert next `start` proceeds; close-mismatch fixture, assert error message + re-run `close` reconciles to `closed` with correct state, and `status` no longer reports it active.
- **Compatibility impact**: new deterministic error for an incoherent state that previously surfaced inconsistently (or was presented as active). Persisted format unchanged.
- **Dependencies**: none on other findings (F-B01 reduces, but does not gate, this fix). **Parallel**: yes with F-B01 (same batch).
- **Non-goals**: no recovery subsystem, no journal/WAL, no state migration, no contract backup/revert, no auto-close on read.

### F-M02 — Same corruption, same exit (MUST_FIX)

- **Root cause**: unknown/corrupt active contract hard-fails `status` (environment exit) but soft-degrades `check` and `status --budget` (review exit).
- **Current boundary**: `src/cli/commands/status.ts` (active-contract read ~234-256), `src/cli/commands/check.ts` (soft-fail ~492-535).
- **Smallest change**: for a missing/corrupt **active** contract, all three commands raise the same deterministic corruption error (documented exit class). Non-contract "no active to evaluate" cases (no state, no draft) keep their existing decision paths.
- **Regression test**: `tests/unit/status-check-close.test.ts` / `tests/unit/check-*.test.ts` — same corrupt active-contract fixture run via `status`, `status --budget`, `check`; assert identical actionable message + identical exit code.
- **Compatibility impact**: scripts that previously observed `check` exit-2 for corrupt active state now observe the corruption exit — an intentional correction (FR-005).
- **Dependencies**: none. **Parallel**: yes (independent of other findings; may land in the same phase).
- **Non-goals**: no exit-code renumbering; no message wording redesign; no change to legit no-contract decision paths; no JSON error envelope.

### F-M03 — No silent corruption swallow (MUST_FIX)

- **Root cause**: `getLastClosedContract` swallows ALL read errors and returns `null` (`src/cli/commands/status.ts`).
- **Current boundary**: `src/cli/commands/status.ts`.
- **Smallest change**: propagate read/corruption errors consistently with active-contract handling (deterministic corruption error, documented exit).
- **Regression test**: `tests/unit/status-check-close.test.ts` — corrupt/missing `last_closed_contract_id` target: assert the corruption is surfaced (not silently null).
- **Compatibility impact**: `status` now errors on corrupt last-closed-contract state instead of hiding it — intentional correction (FR-007).
- **Dependencies**: none. **Parallel**: yes.
- **Non-goals**: no warning-only path (consistency requires error), no changed format.

### F-M04 — Exact missing-file detection (MUST_FIX)

- **Root cause**: `readJsonFileOptional` matches `/ENOENT/` against a stringified error.
- **Current boundary**: `src/core/state/state.ts` (`readJsonFileOptional`).
- **Smallest change**: detect via `(error as NodeJS.ErrnoException).code === 'ENOENT'` on the underlying OS error (research R-2).
- **Regression test**: `tests/unit/state-validation.test.ts` — missing optional file → `null` (not corruption); present-but-invalid file → `StateCorruptionError`.
- **Compatibility impact**: none (same classification today, by construction).
- **Dependencies**: none. **Parallel**: yes.
- **Non-goals**: no new IO helper layer; no tolerance for other errno codes.

### F-M05 — Staged+unstaged double counting (MUST_FIX)

- **Root cause**: the changed-record merge sums staged and worktree numstat for the same path; a staged-then-modified file is counted twice (enshrined in a test).
- **Current boundary**: `src/core/check/diff.ts` (merge/normalize of changed items).
- **Smallest change** (research R-4): make `git diff <base> -z` the canonical totals source; `git diff --cached` contributes only `staged: true` membership; totals = a single diff vs base (counted once).
- **Regression test**: update `tests/unit/diff.test.ts` partial-staging case to assert the corrected total (1 diff vs base), plus table cases: staged-only, worktree-only, staged+worktree, staged+worktree+rename.
- **Compatibility impact**: changed-line totals for partially staged files change (were inflated) — the documented FR-008 correction; other outputs unchanged.
- **Dependencies**: F-M06/F-M07 (same parser boundary). **Parallel**: no — must land with F-M06/F-M07.
- **Non-goals**: no new git probes; no changed staged-detection semantics; no separate staged/unstaged total reporting redesign unless already provided by `status --budget` display.

### F-M06 — No silent record drops (MUST_FIX)

- **Root cause**: name-status/numstat line parsers silently skip malformed records and never unescape git-quoted paths.
- **Current boundary**: `src/core/check/diff.ts` (name-status/numstat parsing) + `src/core/git/repo.ts` probe calls.
- **Smallest change** (research R-4): switch change probes to `-z` (canonical NUL-delimited literal paths) and to strict record parsing; any record not matching the documented `-z` shape raises a new deterministic `GitOutputError` with the offending excerpt. No record can be silently dropped.
- **Regression test**: `tests/unit/diff.test.ts` table — newline/tab filename, unusual unicode, malformed truncated record (assert deterministic `GitOutputError`), binary columns, non-renames.
- **Compatibility impact**: malformed Git output now errors deterministically instead of undercounting — intentional correction (FR-009). Normal repositories see no change.
- **Dependencies**: F-M07 (rename records) and F-M05 (union semantics) share this boundary; F-M09 (ordering) touches the same module output. **Parallel**: no for F-M05/F-M07; yes with F-M08/F-M09 (separate boundaries within the module may still be batched).
- **Non-goals**: no `git status`-based redesign; no wrapping Git entirely; no fuzzy tolerance of malformed records.

### F-M07 — Rename parsing correctness (MUST_FIX)

- **Root cause**: `numstat` splitting on literal ` => ` mis-handles filenames containing ` => ` and directory renames; quoted paths not unescaped.
- **Current boundary**: `src/core/check/diff.ts` (rename record handling + synthetic alias).
- **Smallest change** (research R-4): `-z` yields literal rename records (`<status>[<score>]<NUL><old><NUL><new><NUL>`; numstat rename `n<TAB>m<TAB><NUL><old><NUL><new><NUL>`); the change model keeps `old`/`new` (sourcePath/path) and classifies rename vs add/delete deterministically. Confirm consumers of the synthetic deleted-alias (`renamedFileCount`) and adjust the model count to a single change per rename where semantically correct.
- **Regression test**: `tests/unit/diff.test.ts` table — file rename, directory rename (`{src => dst}/file` via plain rename), filename containing literal ` => `, rename-with-modification; assert exact old/new paths and single-change classification.
- **Compatibility impact**: rename classification fixes phantom paths/mis-splits; reported per-rename counting corrected per the spec (FR-010). `renamedFileCount` keeps counting `type === 'renamed'` items (existing `rules.ts` semantics and `check`/`status` output unchanged). The synthetic deleted-alias record for rename sources is preserved only where callers depend on that item list shape; consumers were inspected (`BudgetChangeItem` + `renamedFileCount`), and the merged item list keeps `sourcePath`/`destinationPath`.
- **Dependencies**: F-M06 (record shape), F-M05 (union of records). **Parallel**: no with F-M05/F-M06.
- **Non-goals**: no rename-detection tuning (`--find-renames` threshold unchanged); no rename/copy policy changes; no new item kinds.

### F-M08 — Windows untracked-binary detection (MUST_FIX)

- **Root cause**: untracked-binary probe rejects nonzero-exit + non-empty stderr (Windows CRLF/locale noise) and uses `/dev/null`.
- **Current boundary**: `src/core/check/diff.ts` (`detectUntrackedBinary`, `runGitWithAllowedExit`/probe calls).
- **Smallest change** (research R-5): probe with a disposable zero-byte sentinel in the OS temp dir + `-z`; decide binary from numstat columns; accept exits `{0,1}` regardless of stderr; other exits are real failures.
- **Regression test**: `tests/unit/diff.test.ts` — untracked binary with NUL bytes and non-UTF8 content → classified binary; untracked text → counted; stderr-noise simulation must not disable detection.
- **Compatibility impact**: restores claimed Windows behavior; no output-format change.
- **Dependencies**: none hard (uses the same `-z` machinery as F-M06/F-M07). **Parallel**: yes, but batched with the diff-parser block.
- **Non-goals**: no single-invocation rewrite; no `NUL`-device special-casing; per-untracked-file probe cost retained (A-10).

### F-M09 — Locale-free byte-stable ordering (MUST_FIX)

- **Root cause**: `localeCompare` ordering varies with ICU locale/Node build.
- **Current boundary**: `src/core/check/diff.ts`, `src/core/check/rules.ts`, `src/core/spec-kit/tasks.ts` sort comparators.
- **Smallest change** (research R-6): a shared code-unit comparator (`a<b?-1:a>b?1:0`) used consistently; one tiny helper module (three consumers).
- **Regression test**: ordering assertions for non-ASCII paths in `diff.test.ts`, `check-rules.test.ts` (violation ordering), and `spec-kit-tasks.test.ts` (feature scan ordering); assert exact expected order (locale-free by construction).
- **Compatibility impact**: sort order for non-ASCII input becomes byte-stable (was locale-dependent) — intentional deterministic-output correction (FR-012). ASCII order unchanged.
- **Dependencies**: none. **Parallel**: yes (distinct, small edits; may land in the Git phase).
- **Non-goals**: no new ordering abstraction beyond the single comparator; no locale config surface.

### F-M10 — Plugin failure isolation (MUST_FIX)

- **Root cause**: `readLifecycleState` sits outside the evaluation try/catch in the plugin; malformed state throws out of `permission.ask`.
- **Current boundary**: `opencode-plugin/src/evaluator.ts` (evaluation body), hook wrappers in `opencode-plugin/src/index.ts`.
- **Smallest change** (research R-7): route every evaluation error (state read, contract read, `runCheck`, target resolution) to the existing documented degraded decision (`HUMAN_REVIEW`-projected: unresolved/block for mutations; read-only passes). Missing state keeps passive-`allow`. Never throws out of a hook.
- **Regression test**: extend `tests/integration/opencode-plugin-runtime-hook.spec.ts` — malformed `state.json`, contract-missing-while-active, unresolvable target; assert hook completes with the documented decision and never throws.
- **Compatibility impact**: malformed-state path previously crashed the hook; now a deterministic decision (FR-015). Core CLI unaffected.
- **Dependencies**: none. **Parallel**: yes (with F-M11, same phase).
- **Non-goals**: no other-agent support; no new permissions surface; no change to deterministic projection rules; no CLI coupling to plugin success.

### F-M11 — Bounded plugin context memory (MUST_FIX)

- **Root cause**: per-session tool/command context maps grow without bound across a long-lived session.
- **Current boundary**: `opencode-plugin/src/index.ts` context maps.
- **Smallest change** (research R-7): a documented per-session ceiling with oldest-entry (FIFO) eviction for retained tool/command contexts; consumed entries still released.
- **Regression test**: simulate many asks; assert retained entry count stays at/below the ceiling.
- **Compatibility impact**: none to decisions; memory bounded (FR-016).
- **Dependencies**: none. **Parallel**: yes.
- **Non-goals**: no cache framework, no timeout-based GC, no persistence of context.

### F-M12 — Stack-policy guard (MUST_FIX)

- **Root cause**: `getBuiltInStackProfileRules` indexes builtins without a fallback → uncaught internal error for a profile without builtins.
- **Current boundary**: `src/core/check/stack-policy.ts`.
- **Smallest change** (research R-8): return a deterministic `InputValidationError` ("no built-in rules for profile …") for unknown/empty builtin sets. No semantic changes.
- **Regression test**: `tests/unit/stack-policy.test.ts` (new, includes F-M13 coverage) — unknown profile id raises the deterministic error, exit documented, no uncaught `TypeError`.
- **Compatibility impact**: none for valid profiles; deterministic error for the previously-crashing case.
- **Dependencies**: none. **Parallel**: yes.
- **Non-goals**: no new profiles (A-05 Maven `pom.xml` REVIEW noise stays accepted); no rule ID/reason-code/ordering/override change; no stack autodetection.

### F-M13 — Missing direct coverage (MUST_FIX, test-only)

- **Root cause**: no direct tests exist for `src/core/git/repo.ts` (empty repo, detached HEAD, invalid/missing base, spaces-in-path), stack-policy override parsing / malformed file shapes, and CRLF `tasks.md` fixtures.
- **Current boundary**: coverage of `repo.ts`, `stack-policy.ts`, and `tasks.ts`.
- **Smallest change**: add table-driven tests (disposable repositories): `tests/unit/git-repo.test.ts` (new), `tests/unit/stack-policy.test.ts` (new), CRLF fixtures in `tests/unit/spec-kit-tasks.test.ts`. No production code changes.
- **Regression test**: as above; include the F-M12 guard case.
- **Compatibility impact**: none (tests only).
- **Dependencies**: none; ordered after production phases so behavior is tested as shipped.
- **Non-goals**: no re-testing of SPEC-002/005/006 behaviors already strongly covered; no duplicate lifecycle coverage.

### Acceptance — v1.0 reliability gate (SC-001..SC-008)

- **Current boundary**: `tests/acceptance/spec007-diagnose-metrics.test.ts` pattern (disposable repos, helper-style CLI invocation, snapshot/byte-stability helpers).
- **Smallest change**: new `tests/acceptance/spec008-reliability-metrics.test.ts` covering only cross-feature reliability boundaries (SC-001..SC-008) + `quickstart.md` scenario validation + acceptance-metrics records; manual (user-opt-in) dogfood gate documented. Reuses existing helpers where possible.
- **Regression test**: the acceptance suite itself plus the unchanged full suite (SC-007, 245/245 baseline preserved after additions).
- **Compatibility impact**: none; adds evidence.
- **Dependencies**: all production phases.
- **Non-goals**: no re-testing of every SPEC-001..007 unit independently; no automation touching real user repositories.

## Implementation Phases

### Phase 1 — State integrity & atomic writes (~5 tasks)

Tasks: F-B01, F-M01, F-M02, F-M03, F-M04 (+ their focused regression tests).

Order within phase: F-B01 and F-M04 first (state-write layer), then F-M01 (start/close reconciliation), then F-M02/F-M03 (status/check classification). All five are independently parallel-safe; the ordering keeps each edit reviewable alone.

### Phase 2 — Git budget-engine reliability (~4 tasks)

Tasks: F-M06 + F-M07 + F-M05 (canonical `-z` parser + union semantics + rename records — one coherent block), F-M08 (Windows untracked-binary), F-M09 (locale-free ordering, with the tiny shared comparator).

Dependency note: F-M05/F-M06/F-M07 are coupled at the parser boundary and must be implemented/tested as one block. F-M08 and F-M09 are separable but batched for coherence.

### Phase 3 — Plugin & stack-policy reliability (~3 tasks)

Tasks: F-M10 (evaluation crash boundary), F-M11 (bounded context maps), F-M12 (stack-policy guard). All parallel-safe; each with focused tests.

### Phase 4 — Coverage hardening (~2 tasks)

Tasks: F-M13 git-repo edge tests (empty repo, detached HEAD, invalid/missing base, spaces-in-path — disposable repos), F-M13 stack-policy + CRLF direct coverage. Test-only.

### Phase 5 — v1.0 reliability acceptance gate (~2 tasks)

Tasks: SPEC-008 acceptance suite (SC-001..SC-008) with recorded evidence + `quickstart.md` validation guide; manual (user-opt-in) self-host dogfood gate documentation.

### Dependency order (findings)

```
F-B01 ────────────────┐
F-M04 ────────────────┤ (no cross-deps)
F-M02 ────────────────┼──── Phase 1 (parallel-safe, staged)
F-M03 ────────────────┤
F-M01 ────────────────┘
F-M06 ─┐
F-M07 ─┼─ one coherent diff-parser block
F-M05 ─┘                      │
F-M08 ── uses the same -z machinery (no hard dep) ─ Phase 2
F-M09 ── independent small edit
F-M10 ─┐
F-M11 ─┼─ Phase 3 (parallel)
F-M12 ─┘
F-M13 ── test-only, after production phases ─ Phase 4
Acceptance (SC-001..SC-008) ── after all fix phases ─ Phase 5
```

### Recommended first implementation block

**Phase 1, task order F-B01 → F-M04 → F-M01 → F-M02/F-M03.** Start with F-B01 (the sole BLOCKER) and F-M04 in the state-write layer; they have no dependencies and unblock the lifecycle fixes.

## Architecture Changes

- One new tiny module: shared code-unit comparator (`src/core/ordering.ts` or equivalent) — three consumers (diff.ts, rules.ts, tasks.ts).
- `diff.ts` change-record parsing replaced in place with canonical `-z` parsing (no new abstraction layer; existing functions/records preserved in shape where consumers rely on them).
- New typed error: `GitOutputError` (malformed Git output) — added to the existing error/exit classification; no renumbering of existing codes.
- Test-only seams: optional injectable rename/backoff in the state write path; export already-private helpers where needed by the new unit tests.
- Plugin: no new files beyond bounded-context bookkeeping inside existing maps; degraded-decision reuse.

**No new**: runtime dependencies (FR-021), recovery subsystem, state framework, Git abstraction, cache/plugin framework, telemetry, history.

## Accepted Limitations Preserved

A-01..A-10 remain documented non-implementation entries. Explicit notes:

- **A-02 is narrowed, not promoted**: the canonical `-z` parser (required to close F-M06/F-M07) also makes newline/tab filenames split correctly. The remaining non-UTF-8 byte-fidelity gap stays an accepted limitation. Callout: this is a required consequence of closing MUST_FIX findings, not new scope.
- All other A-* entries are unaffected: A-01 (exit-code collision - no renumbering), A-03 (snapshot window), A-04 (porcelain stat-cache refresh), A-05 (Maven `pom.xml` version-only REVIEW noise - explicitly NOT fixed in SPEC-008), A-06 (plugin keyword heuristics), A-07 (no fsync), A-08 (no history feature), A-09 (draft reason-code namespace), A-10 (per-untracked-file probe cost).

## Testing Strategy

- Finding-driven: exactly one focused regression test or one table-driven group per finding; no duplication of existing SPEC-001..007 coverage.
- Disposable dummy Git repositories only; never existing personal/work repositories.
- Injection for F-B01 via the exported rename seam (deterministic, not OS-lock-dependent).
- Validation per phase runs only that phase's targeted tests + typecheck/build where appropriate (Constitution V); the full suite is reserved for the final v1.0 gate.
- Acceptance phase measures SC-001..SC-008 with recorded evidence.

## Project Structure

### Documentation (this feature)

```text
specs/008-dogfood-reliability/
├── spec.md                # Specification (committed)
├── checklists/requirements.md
├── plan.md                # This file
├── research.md            # Phase 0 output
├── data-model.md          # Persisted formats + internal change-record model
├── quickstart.md          # Controlled v1.0 reliability scenarios
└── contracts/
    └── reliability-guarantees.md   # Stable externally observable contracts
```

### Source Code touched (existing modules, in place)

```text
src/core/state/state.ts                 # F-B01, F-M04
src/cli/commands/start.ts               # F-M01
src/cli/commands/close.ts               # F-M01
src/cli/commands/status.ts              # F-M01, F-M02, F-M03
src/cli/commands/check.ts               # F-M02
src/core/check/diff.ts                  # F-M05, F-M06, F-M07, F-M08, F-M09
src/core/check/rules.ts                 # F-M09
src/core/check/stack-policy.ts          # F-M12
src/core/spec-kit/tasks.ts              # F-M09
src/models/errors.ts                    # add GitOutputError (typed, classified)
src/core/ordering.ts (new, 1 helper)    # F-M09
opencode-plugin/src/evaluator.ts        # F-M10
opencode-plugin/src/index.ts            # F-M11
tests/unit/state-helpers.test.ts        # F-B01
tests/unit/state-validation.test.ts     # F-M04
tests/unit/status-check-close.test.ts   # F-M02, F-M03
tests/unit/diff.test.ts                 # F-M05, F-M06, F-M07, F-M08, F-M09
tests/unit/check-rules.test.ts          # F-M09
tests/unit/git-repo.test.ts (new)       # F-M13
tests/unit/stack-policy.test.ts (new)   # F-M12, F-M13
tests/unit/spec-kit-tasks.test.ts       # F-M09, F-M13 (CRLF fixtures)
tests/integration/lifecycle-init-start-status-check.spec.ts  # F-M01
tests/integration/opencode-plugin-runtime-hook.spec.ts        # F-M10, F-M11
tests/acceptance/spec008-reliability-metrics.test.ts (new)    # SC-001..SC-008
```

**Structure Decision**: in-place modification of existing modules; no new feature tree. Documentation artifacts follow the project's existing spec layout.

## Complexity Tracking

No constitution violations — table intentionally empty (all gates PASS).

## Non-Goals (implementation)

Reiterated from spec.md: no new hardening scope; no A-* promotion (A-05 Maven `pom.xml` noise explicitly NOT fixed); no refactor/architecture modernization; no dependency cleanup; no style churn; no performance work; no new runtime dependencies; no recovery/journal subsystem; no cache framework; no other coding-agent support; no history feature; no real-project automation; no redesign of error wording beyond the committed classification fixes; no exit-code renumbering.

## Final Self-Check

- F-B01 mapped exactly once (Phase 1). ✔
- F-M01..F-M11 mapped exactly once (Phases 1–3). ✔
- F-M12 mapped exactly once (Phase 3). ✔
- F-M13 mapped exactly once (Phase 4, test-only). ✔
- A-01..A-10 generate zero implementation work (A-02 narrowing is a required consequence, called out). ✔
- No speculative findings added; no feature expansion. ✔
- No accepted limitation accidentally promoted (A-05 explicitly excluded). ✔
- No unnecessary architecture (one comparator helper; no new subsystems/deps). ✔
- Executable in large coherent blocks (5 phases; Phase 2's parser block is one coherent change). ✔