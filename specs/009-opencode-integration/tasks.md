---

description: "Task list for SPEC-009 OpenCode Project Integration"

---

# Tasks: SPEC-009 OpenCode Project Integration

**Input**: Design documents from `specs/009-opencode-integration/` (spec.md, plan.md, research.md, data-model.md, contracts/opencode-integration-contract.md, quickstart.md)

**Prerequisites**: spec.md (required), plan.md (required), research.md, data-model.md, contracts/, quickstart.md

**Organization**: SPEC-009 automates the proven ChangeBudget → OpenCode project-local integration. Tasks are grouped into 4 large coherent blocks (core model/preflight → install/update/remove → disposable-repo validation → acceptance/final gate). Each task carries its primary FR/SC IDs. Exactly 3 managed resources. Zero new runtime dependencies. No AGENTS.md, OMO, or global OpenCode modifications.

**Format**: `- [ ] [TaskID] [P?] [FR-XX] Description with file path`

- **[P]**: genuinely parallel-safe (different files, no dependency on sibling in-progress tasks)
- **[FR-XX]**: primary functional requirement(s) owned by the task

---

## Phase 1: Core Integration Model / Preflight

**Purpose**: Build all pure domain logic — types, path resolution, ownership detection, content generators, config merge, and pre-flight inspection — with no CLI surface. This is the foundation for Phase 2.

- [ ] T001 [FR-001,FR-004] Define integration types and managed-resource constants in `src/core/integration/opencode.ts`: `OwnershipState` (`MISSING`/`MANAGED_CURRENT`/`MANAGED_STALE`/`CONFLICT`), `ResourceAction` (`CREATE`/`UPDATE`/`UNCHANGED`/`REMOVE`/`CONFLICT`/`ABSENT`), `IntegrationResourceStatus`, `IntegrationResult`, `PreflightPlan`, `MANAGED_RESOURCES` (3 paths), `INSTRUCTION_ENTRY` string, ownership marker strings for `.js` and `.md` file types. FR-001, FR-004.
- [ ] T002 [FR-002,FR-003] Implement Runtime Guard compiled-path resolution in `src/core/integration/opencode.ts`: derive ChangeBudget root from `import.meta.url` via `fileURLToPath` → `dirname()` ×3, join to `opencode-plugin/dist/opencode-plugin/src/index.js`, validate existence via `access(F_OK)`, return `InputValidationError` with actionable "run npm run build" message if missing. Implement `pathToFileURL()` conversion for Windows-safe `file://` URL. FR-002, FR-003, SC-008.
- [ ] T003 [FR-004,FR-005,FR-009,FR-019,FR-020] Implement ownership-marker detection in `src/core/integration/opencode.ts`: read first line of a managed file, check for `ChangeBudget-managed` string → classify as `MANAGED_CURRENT` (content byte-identical to expected) or `MANAGED_STALE` (content differs). If marker absent → `CONFLICT`. If file absent → `MISSING`. FR-004, FR-005, FR-009, FR-019, FR-020, SC-004.
- [ ] T004 [FR-007,FR-008] Implement expected-content generators in `src/core/integration/opencode.ts`: `generateWrapperContent(fileUrl)` → 2-line wrapper with ownership marker + `export { default } from "<url>"` + trailing newline; `generateInstructionsContent()` → fixed markdown with ownership marker header + 11 behavioral instructions from spec FR-007, generic OpenCode wording only, no OMO-agent-specific text (no Sisyphus/Prometheus/Atlas/Oracle), byte-identical on every call. FR-007, FR-008, SC-009.
- [ ] T005 [FR-010,FR-011,FR-012,FR-013,FR-014] Implement `opencode.json` parse/merge/validate/serialize in `src/core/integration/opencode.ts`: `parseOpenCodeConfig(content)` → `JSON.parse` with `InputValidationError` on syntax error; `mergeInstructionEntry(config, entry)` → append only if exact string absent, create `instructions` array if field absent, `InputValidationError` if `instructions` is not an array; `serializeConfig(config)` → `JSON.stringify(obj, null, 2) + '\n'` deterministic formatting; `generateMinimalConfig()` → smallest valid config with `$schema` + `instructions` containing the entry. FR-010, FR-011, FR-012, FR-013, FR-014, SC-002, SC-009.
- [ ] T006 [FR-005,FR-006,FR-024] Implement pre-flight inspection in `src/core/integration/opencode.ts`: `inspectIntegration(projectRoot, runtimeGuardEntryPath)` → classify all 3 managed resources (wrapper, instructions, opencode.json), validate Runtime Guard target exists, collect all conflicts, return `PreflightPlan` with `readyToWrite = conflicts.length === 0 && runtimeGuardTargetExists && opencodeConfig.valid`. If any CONFLICT → zero writes allowed. FR-005, FR-006, FR-024, SC-004.
- [ ] T007 [FR-002,FR-003,FR-004,FR-007,FR-008,FR-010..FR-014] Create table-driven unit tests in `tests/unit/integration-opencode.test.ts` for Phase 1 pure functions: ownership detection (MISSING/MANAGED_CURRENT/MANAGED_STALE/CONFLICT), wrapper generation (byte-stability, same path → identical output), instructions generation (byte-stability, no OMO terms), `file://` URL generation (Windows drive-letter path, POSIX path, UNC path), config merge (existing fields preserved, entry appended without duplication, invalid JSON rejected, non-array instructions rejected, missing file → minimal config), pre-flight plan calculation (conflicts collected, readyToWrite correct). FR-002..FR-014, SC-001..SC-009.

**Checkpoint**: All pure domain logic is implemented and unit-tested. No CLI surface yet. No files are written to any project.

---

## Phase 2: Install / Update / Dry-Run / Remove + CLI

**Purpose**: Add the `changebudget integrate opencode` CLI command with install/update/dry-run/remove orchestration, Git baseline warning, and concise status output. Dry-run and real install MUST reuse the same pre-flight logic.

- [ ] T008 [FR-001,FR-021] Create CLI command `src/cli/commands/integrate.ts`: parse arguments (`opencode` target, `--dry-run`, `--remove`), call core orchestration, render concise human output (Integration: READY/NEEDS_ATTENTION, per-resource action, Runtime Guard status, baseline warning). Reject unknown targets with `InputValidationError`. FR-001, FR-021.
- [ ] T009 [FR-001,FR-002,FR-007,FR-010,FR-016,FR-017,FR-024] Implement install/update orchestration in `src/core/integration/opencode.ts`: run pre-flight → if any conflict, report and exit (zero writes) → else write in deterministic order (1: wrapper, 2: instructions, 3: opencode.json) using `ensureDirectory` + `writeFile` → on unexpected filesystem failure, report exactly which resources succeeded (`written`) and which remain pending, never claim READY on partial failure → return `IntegrationResult`. Idempotent re-run: MANAGED_CURRENT → UNCHANGED, zero writes. Stale wrapper: MANAGED_STALE → UPDATE with corrected `file://` path. FR-001, FR-002, FR-007, FR-010, FR-016, FR-017, FR-024, SC-001, SC-005.
- [ ] T010 [FR-018] Implement dry-run orchestration in `src/core/integration/opencode.ts`: reuse the exact same `inspectIntegration` pre-flight logic, classify each resource as CREATE/UPDATE/UNCHANGED/CONFLICT, report readiness (READY/NEEDS_ATTENTION), write nothing, create no `.changebudget` state, change no Git state. FR-018, SC-006.
- [ ] T011 [FR-019,FR-020] Implement remove orchestration in `src/core/integration/opencode.ts`: inspect ownership of wrapper and instructions → if any CONFLICT, refuse and report (zero deletes) → else delete managed files (only if ownership marker matches) → read `opencode.json`, remove exact `.opencode/instructions/changebudget.md` entry from `instructions[]`, reserialize preserving all other fields → optionally remove now-empty `.opencode/plugins/` and `.opencode/instructions/` directories only if empty and ChangeBudget-created → never delete `opencode.json`, `AGENTS.md`, or `.opencode/` with unrelated content → idempotent (ABSENT for all → exit 0). FR-019, FR-020, SC-007.
- [ ] T012 [FR-022] Implement Git baseline warning in `src/core/integration/opencode.ts`: after successful install/update, run `git status --porcelain -- .opencode/plugins/changebudget.js .opencode/instructions/changebudget.md opencode.json` in the target project → if any output (untracked/modified), emit warning text "Integration installed. Commit/baseline the OpenCode integration files before starting a ChangeBudget contract." → if not a Git repo, skip silently → never `git add`, `git commit`, amend, or push. FR-022.
- [ ] T013 [FR-001,FR-025] Integrate `integrate` command into CLI dispatch in `src/cli/index.ts`: add `'integrate'` to `SUPPORTED_COMMANDS`, add `case 'integrate':` to `executeCommand` (parse args, call `runIntegrate`, render output, set exit code), update `printUsage` to list `integrate`. Verify no existing command behavior is altered. FR-001, FR-025, SC-010.

**Checkpoint**: The `changebudget integrate opencode` command is fully functional with install, update, dry-run, and remove. No Git operations performed. No AGENTS.md touched. No global config modified.

---

## Phase 3: Disposable Project Integration / Runtime Smoke

**Purpose**: Prove the integration works end-to-end across the 18-case acceptance matrix using only newly-created disposable dummy Git repositories. No real/work repositories inspected. No global OpenCode/OMO configuration modified.

- [ ] T014 [FR-026,SC-001..SC-009] Create disposable-repo integration test matrix part 1 in `tests/integration/integration-opencode-disposable.spec.ts` (cases 1–9): clean project without `opencode.json` → all 3 resources CREATE; existing `opencode.json` with unrelated fields → fields preserved, entry appended; existing `instructions[]` → order preserved, no duplication; already-integrated project → UNCHANGED, zero writes (idempotency); stale wrapper path → UPDATE wrapper only; instruction template update → UPDATE instructions only; wrapper ownership conflict → CONFLICT, zero writes; instruction ownership conflict → CONFLICT, zero writes; dry-run → zero mutations, complete tree byte-identity. FR-026, SC-001..SC-009.
- [ ] T015 [FR-026,SC-001..SC-011] Create disposable-repo integration test matrix part 2 in `tests/integration/integration-opencode-disposable.spec.ts` (cases 10–18): safe removal → only owned files deleted, config preserved; removal conflict → refused, zero deletes; Git baseline warning → untracked files trigger warning, committed files suppress warning; Windows `file://` URL → drive-letter path generates valid URL that loads; missing compiled Runtime Guard → actionable error, zero writes; Spec-Kit present → integration works, `diagnose T001`/`start T001` exercise; Spec-Kit absent → integration works, full lifecycle exercised; AGENTS.md byte-identical before/after all operations; generated wrapper import/runtime smoke → `import()` wrapper, call `server()`, verify 3 hooks returned (`tool.execute.before`, `command.execute.before`, `permission.ask`). FR-026, SC-001..SC-011.
- [ ] T016 [P] [FR-001,FR-021,FR-025] Create unit tests for CLI parsing, output rendering, and exit codes in `tests/unit/integration-opencode.test.ts`: verify `integrate opencode` parses correctly, `--dry-run` flag detected, `--remove` flag detected, unknown target rejected with exit 2, missing Runtime Guard rejected with exit 2, conflict reported with exit 2, successful install exit 0, already-current exit 0. FR-001, FR-021, FR-025.

**Checkpoint**: All 18 acceptance cases pass in disposable repositories. Generated wrapper loads the compiled Runtime Guard. AGENTS.md never touched. No global config modified.

---

## Phase 4: Acceptance / Final Regression

**Purpose**: Prove all SC-001..SC-011 criteria with recorded evidence, then run the full project suite as the final gate. Full suite runs ONLY here.

- [ ] T017 [FR-026,SC-001..SC-011] Create SPEC-009 acceptance suite `tests/acceptance/spec009-integration-metrics.test.ts` (reusing the SPEC-007/008 metrics-suite pattern; disposable repos only) proving SC-001..SC-011 with recorded evidence written to `specs/009-opencode-integration/acceptance-metrics.md`: (SC-001) repeated integrate is idempotent; (SC-002) zero unrelated opencode.json field loss; (SC-003) AGENTS.md zero mutation across all operations; (SC-004) conflicts produce zero writes; (SC-005) stale wrapper repaired correctly; (SC-006) dry-run zero mutation; (SC-007) uninstall preserves user-owned config; (SC-008) Windows-safe file URL; (SC-009) existing OpenCode instructions preserved; (SC-010) ChangeBudget policy semantics unchanged (Runtime Guard ALLOW/ASK/DENY verified through wrapper); (SC-011) disposable E2E OpenCode integration readiness (full lifecycle with integration installed). FR-026, SC-001..SC-011.
- [ ] T018 [FR-025,FR-027,SC-010] Execute the final SPEC-009 gate: run `npm run build`, `npm run typecheck`, full `npm test` (all SPEC-001..008 suites + SPEC-009 additions green), and the SPEC-009 `quickstart.md` gate scenarios using disposable repositories; confirm SC-001..SC-011 evidence recorded, zero new runtime dependencies (FR-027), existing commands unchanged (FR-025), and record any residue in the acceptance-metrics notes. FR-025, FR-027, SC-010.

**Checkpoint**: SPEC-009 is complete. All SC criteria pass with evidence. Full suite green. No regressions.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 → Phase 2**: Phase 2 orchestration calls Phase 1 pre-flight and generators. Phase 1 MUST complete first.
- **Phase 2 → Phase 3**: Phase 3 tests exercise the Phase 2 CLI command. Phase 2 MUST complete first.
- **Phase 3 → Phase 4**: Phase 4 acceptance proves the full feature. Phase 3 MUST complete first.

### Within Phase 1

T001 first (types/constants), then T002–T006 (path resolution, ownership, generators, config merge, pre-flight — all in the same file `src/core/integration/opencode.ts`, so NOT parallel), then T007 (unit tests for all Phase 1 functions).

### Within Phase 2

T008 (CLI command) and T009–T012 (orchestration functions in core) are in different files but T008 calls T009–T012. Implement T009–T012 first, then T008, then T013 (index.ts dispatch). T009–T012 are in the same file, so NOT parallel.

### Within Phase 3

T014 and T015 are in the same test file (sequential parts of one matrix), so NOT parallel. T016 is in a different test file (`tests/unit/` vs `tests/integration/`) and is [P]-safe with T014/T015.

### Within Phase 4

T017 (acceptance suite) first, then T018 (final gate).

### Parallel Opportunities

- T016 is [P]-safe with T014/T015 (different test file, different concern).
- No other tasks are genuinely parallel-safe (shared files or caller/callee dependencies).

## Implementation Strategy

### Large coherent blocks (3 production + 1 acceptance)

1. **Block A (Phase 1)**: T001→T002→T003→T004→T005→T006→T007. Core domain logic + unit tests. ~7 tasks.
2. **Block B (Phase 2)**: T009→T010→T011→T012→T008→T013. Install/remove/dry-run orchestration + CLI. ~6 tasks.
3. **Block C (Phase 3)**: T014→T015 + T016 [P]. Disposable-repo integration matrix + CLI unit tests. ~4 tasks.
4. **Block D (Phase 4)**: T017→T018. Acceptance suite + final gate. ~2 tasks.

### Validation cadence

`npm run build && npm run typecheck` after each block; targeted tests (`node --test <that block's files>`) after each task group. Full `npm test` runs only in the final gate (T018).

### Recommended first block

**Block A (Phase 1)** — T001→T007. Start with T001 (types/constants) and T002 (path resolution), then T003–T006 (ownership, generators, config merge, pre-flight), then T007 (unit tests). This block has no CLI surface and no project file writes — it's pure domain logic that can be fully unit-tested in isolation.

## Notes

- Use disposable temporary Git repositories and the existing test helpers/fixtures everywhere; never existing personal/work repositories.
- Each task is a meaningful implementation/test boundary — do not split into single-line microtasks.
- Commit after each task or logical group; verify per-task acceptance before advancing.
- Stop at any checkpoint to validate the block independently.
- Do NOT implement any AGENTS.md, OMO-specific, global OpenCode, automatic commit, npm publishing, npm link, Runtime Guard policy, stack policy, auto-contract, doctor, other-agent, cloud, plugin vendoring, or manifest database work.
- Zero new runtime dependencies (FR-027). Node standard library only.
