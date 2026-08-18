---

description: "Task list for SPEC-008 reliability hardening"

---

# Tasks: SPEC-008 Dogfood, Reliability & Personal v1.0

**Input**: Design documents from `specs/008-dogfood-reliability/` (plan.md, spec.md, research.md, data-model.md, contracts/reliability-guarantees.md, quickstart.md)

**Prerequisites**: plan.md (required), spec.md, research.md, data-model.md, contracts/, quickstart.md

**Organization**: SPEC-008 is finding-oriented hardening. Tasks are grouped into 4 large implementation blocks (state integrity → Git reliability → OpenCode + stack-policy reliability → v1.0 acceptance). Each task carries its primary finding ID (`[F-XX]`). Production fix + focused regression coverage are grouped within a task; tests may prove multiple findings, but each finding has exactly ONE primary ownership task.

**Format**: `- [ ] [TaskID] [P] [F-XX] Description with file path`

- **[P]**: genuinely parallel-safe (different files, no dependency on sibling in-progress tasks)
- **[F-XX]**: primary finding owned by the task (F-B01, F-M01..F-M13)

---

## Phase 1: State Integrity & Atomic Writes

**Purpose**: Close the BLOCKER (destructive state-write fallback) and the lifecycle/error-classification MUST_FIX findings. Dependency order per plan: atomic-write safety → corruption classification → lifecycle/orphan handling. No recovery subsystem is introduced.

- [x] T001 [F-B01] Make `writeJsonFileAtomic` in `src/core/state/state.ts` non-destructive: remove the delete-then-rename fallback (EEXIST/EPERM path must never `rm` the destination); on `EEXIST`/`EPERM` retry `rename` up to 3 attempts with a short (~50–150 ms) backoff; on exhaustion unlink the temp file and throw `IOStateError` leaving the previous file byte-identical. Add an optional injectable rename/backoff seam (test-only) per research R-1. Windows behavior explicitly preserved (research R-1). FR-001, FR-004, SC-001. Non-goals: no fsync, no transactional framework, no state-layer rewrite.
- [x] T002 [P] [F-B01] Add table-driven regression coverage in `tests/unit/state-helpers.test.ts`: first-try success; transient EPERM → succeeds on retry (previous file intact); persistent EPERM → `IOStateError`, previous bytes byte-identical, temp cleaned up, and no delete-before-rename ever observed. FR-001, SC-001. (Depends on the seam from T001; otherwise [P]-safe.)
- [x] T003 [F-M04] Replace string-matched `/ENOENT/` detection with exact errno detection (`(error as NodeJS.ErrnoException).code === 'ENOENT'`) in `readJsonFileOptional` in `src/core/state/state.ts`; add cases to `tests/unit/state-validation.test.ts` proving missing-optional-file → `null` (uninitialized) vs present-but-invalid file → `StateCorruptionError`. FR-006, SC-003. Non-goals: no new IO helper layer.
- [x] T004 [F-M01] Add deterministic lifecycle reconciliation at existing boundaries: in `src/cli/commands/start.ts`, remove any unreferenced `status:'active'` orphan contract before writing a new contract (failed-start recovery); in the active-contract read path (`src/core/state/contracts.ts` / consuming commands), when `state.active_contract_id` references a contract with `status !== 'active'`, raise an actionable `StateCorruptionError` instructing re-run of `changebudget close` (which self-heals), and never present a closed contract as active. Persisted format unchanged; no auto-repair. FR-002, FR-003, SC-001. Non-goals: no journal/WAL, no migration, no auto-close.
- [x] T005 [P] [F-M01] Add lifecycle recovery fixtures in `tests/integration/lifecycle-init-start-status-check.spec.ts` using disposable repos: orphaned-start scenario (contract file present, state rolled back) → next `start` proceeds cleanly with no leftover orphan; close-mismatch scenario (contract `closed`, state `active`) → deterministic actionable error then re-run `close` reconciles to `closed` with correct `last_closed_contract_id`; failed transition leaves previously-valid state byte-intact. FR-002, FR-003, SC-001.
- [x] T006 [F-M02] Unify corruption classification: for a missing/corrupt **active** contract, `status`, `status --budget`, and `check` (`src/cli/commands/status.ts`, `src/cli/commands/check.ts`) MUST emit the same deterministic actionable corruption error and exit class; keep the existing no-contract/no-draft decision paths unchanged. Add regression cases to `tests/unit/status-check-close.test.ts` and the check suite. FR-004, FR-005, SC-003. Non-goals: no exit-code renumbering, no JSON error envelope, no message wording redesign.
- [x] T007 [P] [F-M03] Stop silently swallowing read errors for the last-closed contract: `getLastClosedContract` in `src/cli/commands/status.ts` MUST surface a missing/corrupt `last_closed_contract_id` target consistently with active-contract handling (deterministic corruption error). Add regression cases to `tests/unit/status-check-close.test.ts`. FR-007, SC-003.

**Checkpoint**: State writes are non-destructive, corruption is classified deterministically and consistently, and failed lifecycle operations leave valid state intact and recoverable.

---

## Phase 2: Git Budget-Engine Reliability

**Purpose**: Close the Git reliability findings with the single coherent `-z` parsing boundary defined in plan/research R-4/R-5. No Git engine rewrite.

- [x] T008 [F-M06] Implement the canonical NUL-delimited parsing boundary in `src/core/check/diff.ts`: switch name-status, numstat, and `ls-files --others` probes to `-z` (literal, NUL-terminated paths); parse strictly against the verified formats (ordinary `<add><TAB><del><TAB><path><NUL>`; numstat rename `n<TAB>m<TAB><NUL><old><NUL><new><NUL>`; name-status `<status><NUL><path><NUL>`; rename `<statusWithScore><NUL><old><NUL><new><NUL>`); any record not matching the documented shape raises a new typed `GitOutputError` (add to `src/models/errors.ts`, classified corruption/environment, with the offending excerpt) — NO silent record drops. FR-009, SC-003. Non-goals: no `git status`-based redesign, no fuzzy tolerance, no engine rewrite.
- [x] T009 [F-M07] Make rename handling deterministic in the `-z` parser in `src/core/check/diff.ts`: rename records carry `sourcePath`/`destinationPath` with `type 'renamed'`; directory renames and filenames literally containing ` => ` must not produce phantom paths or mis-splits; preserve `renamedFileCount` semantics (`rules.ts` counts `type === 'renamed'`) and the merged item-list shape consumers rely on (`check.ts`/`status.ts`). Regression table in `tests/unit/diff.test.ts`: file rename, directory rename, ` => ` literal, rename-with-modification, binary columns, truncated malformed record → `GitOutputError`. FR-010, SC-003. Non-goals: no rename-threshold tuning (`--find-renames` unchanged), no new item kinds.
- [x] T010 [F-M05] Fix staged+unstaged double counting at the merge boundary in `src/core/check/diff.ts`: totals MUST come from the canonical worktree (`git diff <base>`) records (counted once vs base); the staged (`git diff --cached`) records contribute only the `staged: true` membership flag — never summed line counts. Update the partial-staging expectation in `tests/unit/diff.test.ts` to the corrected totals and add table cases (staged-only, worktree-only, staged+worktree, staged+worktree+rename). FR-008, SC-003. Non-goals: no new git probes, no staged/unstaged totals redesign.
- [x] T011 [P] [F-M08] Make untracked-binary detection reliable on Windows in `src/core/check/diff.ts`: probe via `git diff -z --numstat --no-index` against a disposable zero-byte sentinel in the OS temp directory (no `/dev/null`); decide binary solely from numstat columns (`-` = binary); accept exits `{0,1}` regardless of stderr content (CRLF/locale noise must not disable detection); other exits are real failures. Regression cases in `tests/unit/diff.test.ts`: binary with NUL/non-UTF-8 bytes → classified binary, tab text → counted, stderr-noise simulation does not disable. FR-011, SC-003. Non-goals: no single-invocation rewrite, per-untracked-file probe cost retained (A-10).
- [x] T012 [F-M09] Introduce a single code-unit byte-stable comparator (small helper, e.g. `src/core/ordering.ts`) and apply it to all ordering currently using `localeCompare`: `src/core/check/diff.ts` (changed-file order), `src/core/check/rules.ts` (violation order), `src/core/spec-kit/tasks.ts` (feature scan order). Add non-ASCII ordering assertions to `tests/unit/diff.test.ts`, `tests/unit/check-rules.test.ts`, `tests/unit/spec-kit-tasks.test.ts`. FR-012, SC-003. Non-goals: no locale config surface, no new ordering abstraction beyond the single comparator.

**Checkpoint**: Correct budget totals, no silent record loss, deterministic rename representation, Windows-safe binary detection, and locale-independent byte-stable output.

---

## Phase 3: OpenCode + Stack-Policy Reliability

**Purpose**: Close the plugin failure-isolation/memory findings and the stack-policy internal-crash + missing-coverage findings. Deterministic projection is preserved; no other agents; no plugin architecture redesign; stack-policy semantics unchanged.

- [ ] T013 [F-M10] Isolate the plugin evaluation crash boundary in `opencode-plugin/src/evaluator.ts`: wrap the whole evaluation (state read + contract read + `runCheck` + target resolution) so any error resolves to a documented deterministic decision — missing state keeps passive `allow`; all other evaluation errors route to the existing `HUMAN_REVIEW`-projected degraded decision — and never throws out of the hook. Extend `tests/integration/opencode-plugin-runtime-hook.spec.ts` with malformed `state.json`, contract-missing-while-active, and unresolvable-target cases asserting deterministic completion (no thrown exception). FR-015, SC-003. Non-goals: no other-agent support, no permission-surface changes, no projection-rule changes.
- [ ] T014 [P] [F-M11] Bound plugin context bookkeeping in `opencode-plugin/src/index.ts`: retain per-session tool/command context under a documented ceiling with oldest-entry FIFO eviction (consumed entries still released). Add a bounded-growth regression (many simulated asks → retained entries stay at/below the ceiling) to `tests/integration/opencode-plugin-runtime-hook.spec.ts`. FR-016, SC-003. Non-goals: no cache framework, no persistence, no timeout-based GC.
- [ ] T015 [F-M12] Convert the stack-policy internal crash to classified behavior in `src/core/check/stack-policy.ts`: `getBuiltInStackProfileRules` for a profile without built-in rules MUST raise a deterministic `InputValidationError` ("no built-in rules for profile …") instead of an uncaught `TypeError`; add the guard case to `tests/unit/stack-policy.test.ts` (new file; base override/parsing cases land in T017). FR-017, SC-003. Non-goals: no new profiles, no rule/ID/reason-code/ordering/override change, Maven `pom.xml` version-only REVIEW noise stays ACCEPTED A-05.
- [ ] T016 [P] [F-M13] Add direct Git-layer edge coverage (test-only): create `tests/unit/git-repo.test.ts` proving deterministic results for empty repository (no HEAD), detached HEAD with valid base, missing/invalid base revision, and repository path containing spaces, using disposable temporary repos; add CRLF `tasks.md` fixtures to `tests/unit/spec-kit-tasks.test.ts`. FR-013, FR-019, SC-003. Non-goals: no re-testing of SPEC-002/006 behaviors already strongly covered.
- [ ] T017 [P] [F-M13] Add direct stack-policy coverage (test-only): extend `tests/unit/stack-policy.test.ts` with table-driven cases for `resolveStackPolicy`, builtin rule determinism (including Spring Boot Liquibase/Flyway paths), repository overrides, malformed override JSON (deterministic actionable error, documented exit), and unknown/duplicate rule IDs. FR-018, FR-019, SC-003. Non-goals: no semantic changes; keeps A-05 accepted.

**Checkpoint**: Plugin never throws out of a hook and stays memory-bounded; stack-policy misconfigurations produce deterministic classified errors with direct coverage proving it.

---

## Phase 4: Personal v1.0 Acceptance

**Purpose**: Run the v1.0 reliability gate (SC-001..SC-008) over cross-feature boundaries using only disposable dummy repositories. No personal/work repositories are inspected, cloned, or modified.

- [ ] T018 [F-M13] Create the SPEC-008 acceptance suite `tests/acceptance/spec008-reliability-metrics.test.ts` (reusing the SPEC-007 metrics-suite helper pattern; disposable repos only) proving SC-001..SC-008 with recorded evidence written to `specs/008-dogfood-reliability/acceptance-metrics.md`: (SC-001) zero state corruption across the controlled failure matrix (via the state-write seam and lifecycle fixtures); (SC-002) zero working-tree mutation from `status`/`check`/`diagnose` repeated runs; (SC-003) byte-identical outputs/errors across repeated and corrupt-state runs; (SC-004) ≥20 end-to-end lifecycle cycles; (SC-005) full lifecycle/diagnose with the OpenCode plugin absent; (SC-006) same with no `specs/` structure present; (SC-007) diagnose→start→check and Spec-Kit task start→check cross-feature flows + existing SPEC-001..007 suites green; (SC-008) BLOCKER=0, MUST_FIX=0, accepted limitations A-01..A-10 documented (mention-only, no implementation). FR-014, FR-019, FR-020. Non-goals (VERBATIM): no re-testing of every SPEC-001..007 unit independently; no access to real user repositories.
- [ ] T019 Execute the final v1.0 gate: run `npm run build`, `npm run typecheck`, full `npm test` (all SPEC-001..007 suites + SPEC-008 additions green), and the SPEC-008 `quickstart.md` gate scenarios; confirm SC-001..SC-008 evidence recorded, BLOCKER count 0, MUST_FIX count 0, zero new runtime dependencies (FR-021), and record any convoy/LOW residue in the acceptance-metrics notes. FR-020, FR-021, SC-007, SC-008. (Full-suite gate appears ONLY here, per constitution V.)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 → Phase 2**: none (independent blocks), but **Phase 4 depends on Phase 1, 2, and 3 completing** (acceptance tests the hardened boundaries).
- **Within Phase 1**: T001 first (removes the destructive fallback + adds the seam); T003 (same file `state.ts`) after T001; T002 after T001; T004/T005 after T002/T003 (reconciliation reads the corrected state layer); T006/T007 independent of T001..T005 (different commands; [P]-saf constituent order kept for reviewability).
- **Within Phase 2**: T008 → T009 → T010 are the coupled `-z` parser block and MUST run in order (same module `diff.ts`, shared record model). T011 and T012 also touch `diff.ts`; run after T008 to avoid merge friction. T011 is otherwise independent ([P]-safe with T012/Phase 3).
- **Within Phase 3**: T013 → T014 (both plugin, but different files `evaluator.ts`/`index.ts` — [P]-safe); T015/T016/T017 [P]-safe with each other and with Phase 1/2.
- **Phase 4**: T018 after Phases 1–3; T019 (final gate) last.

### Finding → Task Mapping (primary ownership = exactly once)

| Finding | Task | Validation boundary |
|---|---|---|
| F-B01 | T001 (impl) + T002 (tests) | tests/unit/state-helpers.test.ts |
| F-M01 | T004 (impl) + T005 (tests) | performance/integration lifecycle spec |
| F-M02 | T006 | tests/unit/status-check-close.test.ts |
| F-M03 | T007 | tests/unit/status-check-close.test.ts |
| F-M04 | T003 | tests/unit/state-validation.test.ts |
| F-M05 | T010 | tests/unit/diff.test.ts |
| F-M06 | T008 | tests/unit/diff.test.ts (table) |
| F-M07 | T009 | tests/unit/diff.test.ts (rename table) |
| F-M08 | T011 | tests/unit/diff.test.ts |
| F-M09 | T012 | tests/unit/{diff,check-rules,spec-kit-tasks}.test.ts |
| F-M10 | T013 | tests/integration/opencode-plugin-runtime-hook.spec.ts |
| F-M11 | T014 | tests/integration/opencode-plugin-runtime-hook.spec.ts |
| F-M12 | T015 | tests/unit/stack-policy.test.ts (guard) |
| F-M13 | T016, T017, T018 | tests/unit/git-repo.test.ts, stack-policy.test.ts, acceptance suite |

A-01..A-10: ZERO implementation tasks. Mentioned only in T018/T019 limitation verification.

### Parallel Opportunities

- T002, T005, T007, T011, T014, T016, T017 are [P]-safe once their direct dependency lands (T001/T004/T006/T008/T013 fuzzy respectively). Phase 1, Phase 2, and Phase 3 blocks are independent and can interleave if staffed in parallel.

## Implementation Strategy

### Large coherent blocks (3 production + 1 acceptance)

1. **Block A (Phase 1)**: T001→T003→T004→T006→T007 with T002/T005 parallelized after their deps. ~5–7 tasks in flight.
2. **Block B (Phase 2)**: T008→T009→T010 (one coherent parser) then T011, T012. ~4–5 tasks.
3. **Block C (Phase 3)**: T013, T014, T015, T016, T017. ~5 tasks.
4. **Block D (Phase 4)**: T018 then T019 (the ONLY full-suite/gate task).

### Validation cadence (Constitution V)

`npm run build && npm run typecheck` after each block; targeted tests (`node --test <that block's files>`) after each task group. Full `npm test` runs only in the final gate (T019).

## Notes

- Use disposable temporary Git repositories and the existing test helpers/fixtures everywhere; never existing personal/work repositories (constitution XIII).
- Each task is a meaningful implementation/test boundary — do not split into single-line microtasks.
- Commit after each task or logical group; verify per-task acceptance before advancing.
- Stop at any checkpoint to validate the block independently.
- Do NOT implement any A-01..A-10 item, and do NOT add speculative findings, product features, new dependencies, or SPEC-009/future scope.