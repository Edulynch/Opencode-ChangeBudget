# Research: SPEC-008 Reliability Decisions

**Branch**: `008-dogfood-reliability` | **Date**: 2026-08-18 | **Spec**: [spec.md](spec.md)

Research notes for the tricky platform/recovery/Git decisions in SPEC-008. Findings are empirically validated on this repository's environment (Git for Windows, Node.js). All recoveries/fixtures use disposable temporary repositories only.

## R-1 — Atomic state-write safety on Windows (F-B01)

**Decision**: Keep temp-file + `rename` atomic replacement. Remove the destructive delete-then-rename fallback entirely. On `EEXIST`/`EPERM`, retry `rename` up to a small bounded number of times with a short backoff; if it still fails, throw `IOStateError` while preserving the previous good file (the temp is cleaned up as today).

**Rationale**: Node's `fs.rename` on Windows uses `MoveFileEx` with `MOVEFILE_REPLACE_EXISTING`, so replacing an existing file already succeeds in the normal case. `EEXIST`/`EPERM` arise only when the destination is transiently locked (editor, antivirus, concurrent process). Retrying a bounded number of times clears transient locks without any window where the known-good file is deleted. `rename` stays atomic on both success paths and on failure (destination never touched).

**Failure/recovery sequence** (to be covered by tests):

1. Write temp file fully; optionally flush (`writeFile` complete).
2. `rename(temp, dest)`.
3. On `EEXIST`/`EPERM`: back off ~50–150 ms and retry, up to 3 attempts total.
4. If retries exhausted: unlink the temp file and throw `IOStateError` (documented exit class). The previous destination remains byte-identical.
5. No delete-then-replace path exists anywhere in the write routine.

**Windows behavior**: locked/held files now fail cleanly and appear as a transient, user-recoverable error rather than as latent data loss. No `fsync`, no directory sync, no transactional framework — A-07 remains an accepted limitation (any corruption that survives surfaces as a deterministic error, never silence).

**Alternatives considered**:
- Keep the delete fallback — rejected: non-atomic window can lose valid state (the committed BLOCKER).
- Write to a backup copy and swap symlinks — rejected: over-engineered, no concrete need.
- `fsync`/directory-sync durability — rejected: A-07, no proven power-loss scenario worth the platform complexity.

**Seam for tests**: `writeJsonFileAtomic` (or the small rename helper it uses) gains an optional injectable `rename` function parameter (defaults to `fs.rename`) and an exported retry/backoff hook so tests can deterministically simulate transient `EPERM` and assert the retry succeeds and the original file is preserved on exhausted retries. Public API otherwise unchanged.

## R-2 — Missing-file vs corrupt-file classification (F-M04)

**Decision**: Detect `ENOENT` by the actual errno identifier on the original `Error` (`(error as NodeJS.ErrnoException).code === 'ENOENT'`), not by string-matching rendered error text.

**Rationale**: The current code (`src/core/state/state.ts`) JSON-stringifies the error context and regexes `/ENOENT/`. Node's errno is stable and typed; relying on it removes localization/format fragility.

**Alternatives considered**: keep string matching (rejected: fragile), or catch-and-rethrow all as corruption (rejected: misclassifies a genuinely missing optional file as corruption breaking "uninitialized repo" semantics for `status`).

## R-3 — Lifecycle recovery without a recovery subsystem (F-M01/F-M02/F-M03)

**Decision**: No journal, no WAL, no lock manager, no background reconciliation. Two minimal, deterministic boundary fixes in the existing command/state code:

- **Start orphan cleanup**: `start` verifies no unreferenced `status:'active'` contract file exists under `.changebudget/contracts/` before writing the new contract; if one exists while `state.json` has no `active_contract_id`, it is deterministically removed as an orphan from a previously failed `start`. Such a file is, by construction, never referenced by any valid state, so removing it is safe.
- **Close incoherence detection**: when any command resolves the active contract and the contract file's `status !== 'active'` while `state.json` says `active`, emit a deterministic actionable `StateCorruptionError` (documented exit class) telling the user to re-run `changebudget close` to reconcile. Re-running `close` self-heals: it re-closes and writes `state.json` to `closed`.
- **Classification consistency**: `status`, `status --budget`, and `check` all hard-fail with the same corruption error/exit for a missing or corrupt active contract instead of diverging (`status` currently throws while `check`/`status --budget` soft-degrade).

**Rationale**: These are detection-and-actionable-error fixes at existing boundaries, not a subsystem. They preserve the persisted formats (no migration), fail deterministically, and never auto-repair silently (human authority / no auto-widening).

**Alternatives considered**: background auto-repair job (rejected, obeys "no recovery subsystem"); requiring manual hand-edits (rejected, not actionable); migrating to a transactional store (rejected, violates minimal dependencies and format stability).

## R-4 — Canonical Git input and change-record parsing (F-M05/F-M06/F-M07)

**Decision**: Make the engine's Git probe output NUL-delimited (`-z`) the single canonical input source, and parse records strictly (no silent drops).

Confirmed formats (verified on this machine with disposable repos):

- `git diff <base> -z --numstat [--find-renames] --`
  - Ordinary record: `<add><TAB><del><TAB><path><NUL>` (path literal bytes, NUL-terminated).
  - Detected rename record: `<add><TAB><del><TAB><NUL><old><NUL><new><NUL>` (note the extra NUL after the second tab; two NUL-terminated paths follow).
  - Binary file: columns are `-` instead of numbers.
- `git diff <base> -z --name-status [--find-renames] --`
  - Ordinary: `<status><NUL><path><NUL>` (e.g., `M`, `A`, `D`).
  - Rename/copy: `<statusWithScore><NUL><old><NUL><new><NUL>` (e.g., `R100<NUL>lib/old.txt<NUL>lib/new.txt<NUL>`).
- `git ls-files --others --exclude-standard -z` for untracked paths.
- `git diff -z --numstat --no-index -- <empty-sentinel> <path>` for untracked binary detection (see R-5).

**Canonical input source**: `git diff <base>` (staged + unstaged vs base) is the authoritative record source for the working-set totals. `git diff --cached <base>` is used only to mark which paths are staged (`staged = true`), NEVER to add line counts.

**Deduplication identity**: the normalized repository-relative path (backslashes folded to `/`, `./` stripped — existing `normalizePath`). A path present in both the staged and full sets has one record: the full-set values for lines, `staged: true`.

**Changed-line totals (F-M05)**: a file that is both staged and further modified reports its full diff against base exactly once — the worktree (`git diff <base>`) values — never the sum of staged + worktree records.

**Rename representation (F-M07)**: the change model keeps `sourcePath`/`destinationPath` (old/new) plus `type`, and classifies rename vs add/delete deterministically. Dir-rename notation and literal ` => ` in names no longer matter because `-z` disables git's C-style quoting and ` => ` splicing. Consumers inspected: the merged `BudgetChangeItem` list drives `renamedFileCount` (count of `type === 'renamed'` items in `rules.ts`), kept unchanged; the existing synthetic deleted-alias for rename sources is preserved where the item-list shape requires it (resolved during implementation against `check.ts`/`status.ts` consumers).

**Strict failure behavior (F-M06)**: any `-z` record that does not match the documented shape (bad number field, truncated record, unexpected token) raises a deterministic `GitOutputError` (new, typed, documented) containing the offending record excerpt. Silent dropping of records is eliminated: a drop is only possible via a deterministic error.

**Alternatives considered**:
- Keep tab/line parsing and add C-quote unescaping — rejected: `-z` is simpler, already supported, and removes quoting, `=>` splicing, newline-in-name splitting in one move.
- Run probes in one snapshot (single `git diff --numstat` without name-status) — rejected: name-status is still needed for status letters/renames; `Promise.all` non-snapshot window remains documented (A-03).

## R-5 — Untracked-binary detection on Windows (F-M08)

**Decision**: Replace the `/dev/null` operand with a disposable zero-byte file in the OS temporary directory, run with `-z`, and decide solely from the numstat columns (`-` = binary). Accept exit codes `{0, 1}` regardless of stderr content; treat any other exit as a real failure.

**Rationale**: Verified on this machine: Git for Windows accepts `/dev/null`, but native Windows Git would not, and C-quoted `old => new` tokens appear in non-`-z` output. With `-z`, binary detection is `-\t-\t\0path...` — literal and unambiguous. Current code (verified) rejects nonzero-exit + non-empty stderr, which Windows CRLF/locale warnings can trigger, silently disabling detection. Deciding purely on exit ∈ `{0,1}` removes that.

**Alternatives considered**: `git hash-object` (writes), `NUL` device (Windows-only), keeping `/dev/null` (breaks native Windows git).

## R-6 — Locale-independent byte-stable ordering (F-M09)

**Decision**: Replace `String.prototype.localeCompare` ordering in `src/core/check/diff.ts`, `src/core/check/rules.ts`, and `src/core/spec-kit/tasks.ts` with a single shared code-unit comparator (`a < b ? -1 : a > b ? 1 : 0` — UTF-16 code-unit order, deterministic across engines, locales, and Node builds).

**Rationale**: `localeCompare` order depends on the ICU locale and Node build, which breaks the committed byte-stable/deterministic claims for non-ASCII paths. Code-unit order is a stable total order for all inputs.

**Alternatives considered**: per-call `localeCompare('en')` (still ICU-variant) — rejected.

## R-7 — OpenCode plugin failure isolation (F-M10/F-M11)

**Decision**: Wrap the whole evaluation body (state read + contract read + `runCheck`) in the existing error handler so any failure yields the same documented degraded decision already used for check failures (`HUMAN_REVIEW`-based projection: pending mutation becomes a blocked/unresolved decision; read-only operations pass) — and never throws out of the hook. Missing state keeps its existing passive-`allow` behavior.

**Rationale**: Verified that `readLifecycleState` currently sits outside the try/catch in `opencode-plugin/src/evaluator.ts`, so malformed state can throw out of `permission.ask`. Routing evaluation errors to the existing degraded path preserves failure isolation and deterministic projection without expanding to new mechanisms.

**Bound memory (F-M11)**: place a documented ceiling on retained per-session context entries (tool + command), evicting oldest entries beyond the ceiling (FIFO). Single bounded map, no cache framework.

**Alternatives considered**: aggressive passive-allow on all errors (rejected: could silently allow a mutation a user expects blocked); unbounded retention (rejected: verified growth).

## R-8 — Stack-policy internal-crash guard (F-M12)

**Decision**: `getBuiltInStackProfileRules` returns a deterministic `InputValidationError` ("no built-in rules for profile …") when the profile has no builtin rule set, instead of raising an uncaught `TypeError`. No semantics, IDs, reason codes, ordering, or override behavior change.

**Rationale**: Verified that indexing `BUILTIN_RULES[profileId]` without a guard can crash on a profile without builtins. All existing behavior is preserved. Maven `pom.xml` version-only REVIEW noise remains ACCEPTED_LIMITATION A-05 (path-only rules, no content inspection) and is explicitly not fixed.

## R-9 — Test strategy notes

- Failure injection for F-B01 uses the exported injectable rename seam (R-1); no OS-level lock flakiness.
- Git edge tests use disposable temporary repositories (empty repo, detached HEAD, missing/invalid base, spaces-in-path).
- All fixtures disposable; no existing personal/work repositories are touched; self-hosting dogfooding stays a manual, user-opt-in gate.
- Ordering tests assert byte-stability by comparing output infrastructure across two artificial locale fixtures is unnecessary: code-unit comparator is locale-free by construction; tests assert exact ordering for non-ASCII paths.

## Decisions not requiring changes (verified)

- Read-only guarantees for `status`/`check`/`diagnose` and the plugin are already enforced; no production change needed (SC-002 reverified in acceptance).
- Spec-Kit bridge resolution, ambiguity handling, budget marker precedence, and read-only guarantees are already proven by SPEC-006 tests; no change.
- Diagnose advisor first-match table, byte-stable output, manual review under insufficient evidence, and zero mutation are already proven by SPEC-007 tests; no change.
- Liquibase/Flyway rules are present and tested (SPEC-005/check-rules tests); no change.