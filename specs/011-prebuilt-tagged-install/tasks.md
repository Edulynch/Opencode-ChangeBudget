---

description: "Implementation tasks for SPEC-011 prebuilt tagged installation reliability"
---

# Tasks: Prebuilt Tagged Installation Reliability (SPEC-011)

**Input**: Design documents from `/specs/011-prebuilt-tagged-install/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`, and `contracts/`

**Tests**: Required by SPEC-011. Use `node:test` and disposable local fixtures only; do not use GitHub/network or the real global npm prefix in automated tests.

**Implementation rule**: Every task starts unchecked. Do not create `v1.1.2`, move/recreate `v1.1.0` or the v1.1.1 incident tag, bump release versions, push tags, add CI, or add npmjs/custom-installer work in these implementation tasks.

## Phase 1: Setup - Repository Artifact Tracking Foundation

**Goal**: Make only the required release runtime paths intentionally trackable without broadly unignoring generated output.

- [X] T001 Update `.gitignore` to remove the broad `dist/` rule and ignore only `dist/tests/**`, `opencode-plugin/dist/src/**`, and existing transient artifacts while leaving `dist/src/**` and `opencode-plugin/dist/opencode-plugin/**` trackable.
- [X] T002 [P] Add artifact tracking tests in `tests/unit/release-artifacts.test.ts` proving ordinary `git add` eligibility for required runtime paths, continued ignore behavior for `dist/tests/**` and `opencode-plugin/dist/src/**`, and rejection of temporary/development output.
- [X] T003 Verify the clean build output and tracked-path allowlist in `tests/unit/release-artifacts.test.ts` without changing `tsconfig.json` or `opencode-plugin/tsconfig.json`; document any observed output layout mismatch as a failing test rather than broadening the allowlist.
- [X] T004 [P] Update `tests/integration/package-contents.test.ts` to assert required root/runtime files and maps are package-eligible while `dist/tests/**`, duplicate plugin output, source TypeScript, tests, specs, and node_modules remain excluded.

**Checkpoint**: Required runtime directories are intentionally trackable, forbidden generated output remains ignored, and no `git add -f` step is needed.

---

## Phase 2: Foundational - Package and Install Contract

**Goal**: Remove installation-time build dependence while preserving developer commands and the direct CLI entrypoint.

- [X] T005 Remove `prepare` from `package.json` while preserving `build`, `typecheck`, `test`, `start`, `bin`, and the direct `dist/src/cli/index.js` executable entrypoint.
- [X] T006 [P] Update `tests/unit/spec010-infrastructure.test.ts` and `tests/integration/package-contents.test.ts` to verify the package has no required prepare lifecycle, retains developer scripts, and contains the prebuilt CLI and Runtime Guard under the narrowed files whitelist.
- [X] T007 [P] Update `specs/011-prebuilt-tagged-install/quickstart.md` and `specs/011-prebuilt-tagged-install/contracts/installation.md` with the canonical `npm install -g --ignore-scripts --allow-git=all --install-links=true github:Edulynch/Opencode-ChangeBudget#vX.Y.Z` command, npm `>=11.9 <12`, Node 20+, and npm 12 outside-scope wording.
- [X] T008 Verify `package-lock.json` remains consistent with `package.json` and add the package metadata/version assertion to `tests/unit/release-artifacts.test.ts` without changing the release version.

**Checkpoint**: A tagged package can run from tracked artifacts with `--ignore-scripts`, while `npm run build`, `npm run typecheck`, and `npm test` remain available.

---

## Phase 3: User Story 1 - Install a Working Tagged CLI (Priority: P1) 🎯 MVP

**Goal**: Replace the lifecycle-oriented T037 proof with a local, prebuilt, scripts-disabled tagged installation.

**Independent Test**: Build the current source, create a matching local tagged fixture containing tracked runtime artifacts, install it into a disposable prefix with `--ignore-scripts --allow-git=all --install-links=true`, and execute the installed CLI and Runtime Guard integration from a path containing spaces.

### Tests and fixture implementation

- [X] T009 [US1] Update `tests/utils/git-fixture.ts` source-root mode to require prebuilt runtime files, preserve the copied package version, create the exact `v<package.json.version>` tag, and commit required artifacts with ordinary `git add` rather than `git add -f`.
- [X] T010 [US1] Remove the prepare sentinel mutation from `tests/utils/git-fixture.ts`; ensure source-root fixtures remove installation-only devDependencies without adding a lifecycle build or requiring TypeScript during npm install.
- [X] T011 [US1] Update `tests/acceptance/tagged-install.test.ts` to install the fixture with `--ignore-scripts --allow-git=all --install-links=true`, assert dynamic tag/package-version consistency, and remove all prepare-marker assertions.
- [X] T012 [US1] Extend `tests/acceptance/tagged-install.test.ts` to verify installed `--version`, `--help`, CLI execution, Runtime Guard presence, `init`, `integrate opencode`, paths containing spaces, preserved `AGENTS.md`/unrelated `opencode.json` fields, disposable prefix cleanup, and unchanged real global npm prefix.
- [X] T013 [P] [US1] Update `tests/unit/spec010-infrastructure.test.ts` to preserve T035 no-sourceRoot `v1.0.0` behavior while adding tag/package-version validation coverage for source-root fixtures.

**Checkpoint**: T037 proves a true prebuilt tagged installation, runs network-free, executes the installed binary, and never depends on `prepare`, TypeScript, or devDependencies.

---

## Phase 4: User Story 2 - Update from a Prebuilt Compatible Tag (Priority: P1)

**Goal**: Make self-update use the exact public scripts-disabled installation strategy without changing discovery, SemVer, exit, or project-isolation behavior.

**Independent Test**: Unit-test exact POSIX and Windows subprocess invocations and run existing update orchestration regressions to prove same-major updates still work while major-only updates remain informational exit 0.

- [X] T014 [US2] Change `src/core/update/npm.ts` `buildNpmArgs()` to return `install`, `-g`, `--ignore-scripts`, `--allow-git=all`, `--install-links=true`, and the validated GitHub tag package spec in that exact order.
- [X] T015 [P] [US2] Update `tests/unit/core/update/npm.test.ts` to assert the exact POSIX argv, direct `npm` command, and `shell: false` behavior with scripts disabled and Git allowance enabled.
- [X] T016 [P] [US2] Update `tests/unit/core/update/npm.test.ts` to assert the exact Windows `ComSpec`/`cmd.exe` invocation, `/C` strategy, validated package/tag boundary, space-safe behavior, and `shell: false` process option.
- [X] T017 [US2] Extend `tests/unit/core/update/npm.test.ts` and existing update tests to prove non-zero exits, spawn failures, interruptions, and output mapping remain unchanged after the argv change.
- [X] T018 [US2] Run/update `tests/unit/core/update/update.test.ts` and `tests/unit/core/update/edge-cases.test.ts` to verify same-major selection, exact stable-tag integrity checks, major-only informational exit 0, no automatic integration, no project mutation, and no updater discovery/SemVer redesign.

**Checkpoint**: Self-update and public installation have identical relevant npm flags and package-spec behavior on POSIX and Windows.

---

## Phase 5: User Story 3 - Release a Self-Contained Stable Tag (Priority: P1)

**Goal**: Add the smallest repository-local, dependency-free manual release gate that proves a stable tag is complete, fresh, trackable, packageable, and immutable.

**Independent Test**: Run the gate against valid and invalid temporary Git fixtures; valid candidates pass only after clean regeneration, while missing, stale, untracked, ignored, forbidden, version-mismatched, dirty, and existing-tag candidates fail without changing tags.

- [X] T019 [US3] Create `scripts/validate-release.mjs` with strict `package.json` and `package-lock.json` version checks, expected `v<version>` derivation, Node/npm compatibility messaging, and read-only command failure handling.
- [X] T020 [US3] Add local and remote existing-tag checks to `scripts/validate-release.mjs` using read-only Git queries; refuse any existing tag including `v1.1.0` and never create, delete, move, force-update, or push a tag.
- [X] T021 [US3] Add required artifact presence, tracked-state, and not-ignored checks to `scripts/validate-release.mjs` for `dist/src/**`, `dist/src/cli/index.js`, `opencode-plugin/dist/opencode-plugin/**`, and the Runtime Guard entrypoint.
- [X] T022 [US3] Add forbidden-content and package-content checks to `scripts/validate-release.mjs` using `npm pack --dry-run --json --ignore-scripts`; reject tests, specs, TypeScript source, node_modules, temporary files, `dist/tests/**`, and duplicate plugin output.
- [X] T023 [US3] Add clean-build stale detection to `scripts/validate-release.mjs`: run the existing build, require `git diff --exit-code -- dist/src opencode-plugin/dist/opencode-plugin` or equivalent required-path diff, and require the final release working tree to be clean.
- [X] T024 [P] [US3] Add negative and positive gate tests in `tests/unit/release-gate.test.ts` for invalid package version, package/package-lock mismatch, missing required file, stale runtime output, untracked runtime, ignored runtime, forbidden package content, dirty final tree, valid candidate, and existing local/remote tags.

**Checkpoint**: The release gate proves current source regenerates the committed runtime exactly and refuses every specified invalid release state without tag mutation.

---

## Phase 6: Polish - SPEC-009 and SPEC-010 Regression Acceptance

**Goal**: Confirm the hotfix changes only installation packaging/update invocation and preserves existing integration and safety behavior.

- [X] T025 [P] Update `tests/acceptance/tagged-install.test.ts` and `tests/integration/opencode-plugin-runtime-hook.spec.ts` to verify the installed Runtime Guard resolves from the packaged path and `integrate opencode` remains idempotent and functional.
- [X] T026 [P] Extend `tests/acceptance/tagged-install.test.ts` to verify no automatic integration occurs during install/update and that unrelated project fields plus `AGENTS.md` remain byte-identical.
- [X] T027 [P] Run/update SPEC-010 update regression coverage in `tests/unit/core/update/update.test.ts`, `tests/unit/core/update/edge-cases.test.ts`, and `tests/integration/cli/spec009-compat.test.ts` for major-only exit 0, same-major behavior, tag/package integrity, and zero project mutation.
- [X] T028 Verify automated tests use disposable prefixes/caches and no network in `tests/utils/disposable-npm.ts`, `tests/acceptance/tagged-install.test.ts`, and all new release-gate tests; assert the real global npm prefix is unchanged.

**Checkpoint**: SPEC-009 integration and SPEC-010 update semantics pass without new integration behavior, project mutation, or real global npm mutation.

---

## Phase 7: Polish - Release Documentation and Evidence

**Goal**: Make the manual release and smoke-test contract executable without creating or moving a tag during implementation.

- [X] T029 [P] Update `specs/011-prebuilt-tagged-install/quickstart.md` with the final canonical install command, scripts-disabled evidence, disposable-prefix setup, and expected installed CLI/Runtime Guard checks.
- [X] T030 [P] Update `specs/011-prebuilt-tagged-install/contracts/release-gate.md` and `specs/011-prebuilt-tagged-install/plan.md` with the manual sequence: version bump outside normal implementation, build, commit matching artifacts, gate, clean tree, read-only tag checks, annotated tag/push by maintainer, and public smoke test.
- [X] T031 [P] Update `specs/011-prebuilt-tagged-install/research.md` and `specs/011-prebuilt-tagged-install/contracts/installation.md` to preserve npm `>=11.9 <12`, npm 12 exclusion, Windows/Linux real validation, macOS POSIX coverage, `v1.1.0` and v1.1.1 incident immutability, and planned-but-not-created `v1.1.2` wording.
- [X] T032 Document the exact Windows and Ubuntu/WSL public GitHub smoke-test evidence requirement in `specs/011-prebuilt-tagged-install/quickstart.md` without adding network-dependent automated tests or a tag-creation task.

**Checkpoint**: Release maintainers have a reviewable, manual, no-CI procedure and the public command is consistent across installation, update, contracts, and evidence.

---

## Phase 8: Final Validation

**Goal**: Validate the complete SPEC-011 change set and restore unrelated generated metrics if the suite regenerates them.

- [X] T033 Run `npm run typecheck` and verify the result against `specs/011-prebuilt-tagged-install/quickstart.md` without changing production behavior.
- [X] T034 Run `npm run build`, verify `dist/src/**` and `opencode-plugin/dist/opencode-plugin/**` are regenerated, and confirm no unexpected generated output is introduced.
- [X] T035 Run `npm test` with no network and no real global npm mutation; restore only `specs/005-personal-stack-policies/acceptance-metrics.md`, `specs/006-spec-kit-task-bridge/acceptance-metrics.md`, `specs/007-diagnose-budget-advisor/acceptance-metrics.md`, `specs/008-dogfood-reliability/acceptance-metrics.md`, and `specs/009-opencode-integration/acceptance-metrics.md` if regenerated.
- [X] T036 Run `npm pack --dry-run --json --ignore-scripts` and `node scripts/validate-release.mjs`; confirm package contents, stale-artifact zero diff, version consistency, and read-only tag checks.
- [X] T037 Run `git diff --check` and inspect repository hygiene in `.gitignore`, `package.json`, `package-lock.json`, `specs/011-prebuilt-tagged-install/`, and `git status --short`; confirm no SPEC-001..010 or `.omo/` changes, version bump, tag creation, CI, npmjs, npm 12, or unrelated build-system work entered the change set.
- [ ] T038 Perform the required real Windows and Ubuntu/WSL public-tag smoke validations from `specs/011-prebuilt-tagged-install/quickstart.md` after a maintainer creates the future immutable release tag; record evidence without creating `v1.1.2` as part of normal implementation.

**Checkpoint**: SPEC-011 is ready for explicit manual release preparation; `v1.1.0` and the v1.1.1 incident tag remain immutable and no `v1.1.2` tag has been created by implementation tasks.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** has no dependency and establishes intentional artifact tracking.
- **Phase 2** depends on Phase 1 and establishes package/lifecycle prerequisites.
- **Phase 3 (US1)** depends on Phases 1-2 and is the MVP installation slice.
- **Phase 4 (US2)** depends on Phase 2 and may run in parallel with Phase 3 when files do not overlap; its regression checkpoint follows the adapter edits.
- **Phase 5 (US3)** depends on Phase 1 and Phase 2 and should follow the artifact/package layout decisions before gate implementation.
- **Phase 6** depends on Phases 3-5 because it validates their integrated behavior.
- **Phase 7** can run in parallel with implementation after the decisions are stable, but final wording must reflect the implemented command and gate.
- **Phase 8** depends on all implementation and documentation phases.

### Critical Path

`T001 -> T003 -> T005 -> T009 -> T011 -> T012 -> T014 -> T018 -> T019 -> T021 -> T023 -> T024 -> T027 -> T033 -> T034 -> T035 -> T036 -> T037`

### Parallel Opportunities

- `T002` and `T004` can run in parallel after the `.gitignore` decision in `T001`.
- `T006`, `T007`, and `T008` can run in parallel after `T005`.
- `T013` can run in parallel with `T011` after the fixture contract is understood.
- `T015` and `T016` can run in parallel after `T014`.
- `T020`, `T021`, and `T022` can run in parallel after the gate entrypoint in `T019` exists.
- `T025`, `T026`, and `T027` can run in parallel after the relevant implementation phases.
- `T029`, `T030`, `T031`, and `T032` can run in parallel during documentation polish.

### User Story Dependencies

- **US1** is the MVP and depends on artifact tracking plus package/install foundation.
- **US2** depends only on package/install foundation and preserves existing updater discovery/SemVer logic.
- **US3** depends on artifact/package decisions and validates the release boundary; it does not create a tag.

## Coverage Matrix

### Functional Requirements

| Requirements | Tasks |
|---|---|
| FR-001, FR-001a, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-008a | T005-T008, T011-T012, T029-T032 |
| FR-009, FR-010, FR-011, FR-012 | T001-T004, T009-T010, T021-T022 |
| FR-013, FR-014, FR-015, FR-016, FR-017, FR-018, FR-019 | T019-T024, T030-T032, T036-T038 |
| FR-020, FR-021, FR-022, FR-023, FR-024 | T014-T018, T027 |
| FR-025, FR-026, FR-027, FR-028 | T012, T025-T027, T035-T037 |
| FR-029, FR-030, FR-031, FR-032, FR-033, FR-034, FR-035 | T011-T012, T024-T032, T035-T038 |

**FR coverage**: 37/37 requirements mapped.

### Success Criteria

| Success Criteria | Verification tasks |
|---|---|
| SC-001 | T011-T012, T034-T038 |
| SC-002 | T012, T025-T028, T035 |
| SC-003 | T019-T024, T036 |
| SC-004 | T014-T018, T027 |
| SC-005 | T008, T009, T019-T021, T036-T037 |
| SC-006 | T017-T018, T027, T035 |
| SC-007 | T019-T023, T029-T032, T036-T038 |
| SC-008 | T007, T029-T032, T038 |

**SC coverage**: 8/8 success criteria mapped.

## Implementation Strategy

### MVP First

1. Complete Phases 1-2.
2. Complete Phase 3 (US1) and validate T037 independently.
3. Stop and confirm scripts-disabled tagged installation, Runtime Guard, path safety, and real-prefix isolation.

### Incremental Delivery

1. Add US2 adapter flags and regression tests without changing discovery.
2. Add US3 release gate and negative stale-artifact coverage.
3. Run SPEC-009/SPEC-010 regression acceptance and documentation checks.
4. Run final validation; only then hand off to manual release preparation.

## Notes

- All tasks are intentionally unchecked and use exact repository-relative file paths.
- `[P]` marks only tasks with independent file/verification scope and no incomplete dependency.
- No task creates, moves, force-updates, or pushes a tag.
- Public GitHub smoke testing is manual release evidence, not a normal automated test.
