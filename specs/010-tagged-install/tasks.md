# Implementation Tasks: SPEC-010 Tagged Installation & Self-Update

**Feature Branch**: `010-tagged-install-self-update`

**Generated from**: spec.md, plan.md, research.md, data-model.md

---

## Phase 1: Setup & Package Foundation

### Goal
Establish package.json changes for Git-based installation and validate package contents.

### Independent Test Criteria
- `npm pack --dry-run --json` produces expected file list
- Local `npm install -g git+file://` from tagged fixture works
- Installed CLI reports correct version and Runtime Guard is available

### Tasks

- [X] T001 Add `prepare` lifecycle script to `package.json` (`scripts.prepare = "tsc && tsc -p opencode-plugin/tsconfig.json"`)
- [X] T002 Add `files` whitelist to `package.json` (`"dist/src/**", "opencode-plugin/dist/**"`)
- [X] T003 Run `npm pack --dry-run --json` and verify output includes:
  - `package.json` at root
  - `dist/src/cli/index.js` (bin entry)
  - All transitive runtime modules under `dist/src/**`
  - `opencode-plugin/dist/opencode-plugin/src/index.js` (Runtime Guard)
  - Excludes: `dist/tests/**`, `tests/**`, `specs/**`, `src/**`
- [X] T004 Create local tagged Git fixture for acceptance testing (temporary repo with v1.0.0 tag)
- [X] T005 Test local tagged installation: `npm install -g git+file:///path/to/fixture#v1.0.0` in disposable prefix; verify `changebudget --help` works and Runtime Guard is present

---

## Phase 2: Foundational — Shared Package-Root & Version Support

### Goal
Create the shared package-root helper and version loading used by all update operations.

### Independent Test Criteria
- `getChangeBudgetRoot()` returns correct package root from any cwd
- `getInstalledVersion()` loads `package.json.version` without `process.cwd()`
- Tests pass with unrelated cwd, paths with spaces, no `.git`

### Tasks

- [X] T006 Create `src/core/package-root.ts` with:
  - `getChangeBudgetRoot(): string` — exactly 4 `dirname` operations from `dist/src/core/package-root.js` to package root
  - `getInstalledVersion(): string` — resolves `<root>/package.json`, parses `version` field
- [X] T007 [US1] Add unit tests for package-root/version resolution in `tests/unit/core/package-root.test.ts`:
  - Helper resolves correct root from module location
  - Version loading works when cwd is unrelated user project
  - Version loading works when cwd changes during execution
  - Version loading works with package path containing spaces
  - Version loading works when no `.git` directory exists
- [X] T008 [US1] Verify SPEC-009 `resolveChangeBudgetRoot()` can reuse this helper (document if compatible, else note minimal change)

---

## Phase 3: User Story 1 — One-Command Global Installation (P1)

### Goal
Verify tagged Git installation produces working CLI with Runtime Guard.

### Independent Test Criteria
- Clean install from stable tag (`npm install -g github:...#vX.Y.Z`) makes `changebudget` available on PATH
- `changebudget --version` reports correct version matching tag's package.json
- `changebudget integrate opencode` locates Runtime Guard at expected path
- Works on Windows, macOS, Linux

### Tasks

- [X] T009 [US1] Implement `--version` command in `src/cli/commands/version.ts`:
  - Calls `getInstalledVersion()` from shared helper
  - Prints version string, exits 0
- [X] T010 [US1] Wire `--version` in `src/cli/index.ts` command parser
- [X] T011 [US1] Add integration test for `--version` in `tests/integration/cli/version.test.ts`:
  - Runs in disposable npm prefix with local tagged fixture
  - Verifies correct version output
- [X] T012 [US1] Add cross-platform acceptance test for tagged installation:
  - Windows: run install in temp prefix with path containing spaces; verify CLI executes
  - macOS/Linux: same verification

---

## Phase 4: User Story 2 — Read-Only Update Check (P1)

### Goal
Implement `changebudget update --check` with deterministic version discovery and zero project mutations.

### Independent Test Criteria
- Reports current version, latest compatible same-major version, update availability
- Exits 0 on success; non-zero on version undetermined or discovery failure
- Zero target-project filesystem mutations (snapshot before/after proves byte-identical)
- Handles all edge cases: already current, newer major only, no valid tags, network failure

### Tasks

- [X] T013 [US2] Create `src/core/update/version.ts`:
  - `parseSemVer(version: string): SemVer` — strict `vMAJOR.MINOR.PATCH` parsing, numeric comparison
  - `compareSemVer(a, b): number` — major > minor > patch ordering (1.10.0 > 1.2.0)
  - `selectCompatibleUpdate(current, availableTags): AvailableTag | null` — same major, highest minor/patch
  - `detectNewerMajor(current, availableTags): AvailableTag | null` — higher major version
  - Reject prerelease/malformed: `v1.3.0-beta.1`, `v1.3`, `release-1.3.0`, `latest`
- [X] T014 [US2] Add unit tests for semantic version in `tests/unit/core/update/version.test.ts`:
  - Strict parsing rejects malformed/prerelease
  - Numeric comparison: v1.10.0 > v1.2.0
  - Compatible selection picks highest same-major
  - Newer-major detection works
  - Current newer than tags → no candidate
- [X] T015 [US2] Create `src/core/update/github.ts`:
  - `fetchAllTags(): Promise<GitTag[]>` — paginated `GET /repos/.../tags?per_page=100&page=N`
  - `validateTagIntegrity(tag): Promise<boolean>` — fetches `package.json` at tag ref via Contents API, validates `version === tag`
  - Uses Node built-in `fetch` (no new runtime dependencies)
  - Handles pagination, network timeouts, API errors
- [X] T016 [US2] Add unit tests for GitHub discovery in `tests/unit/core/update/github.test.ts`:
  - Pagination stops at empty page
  - Filtering rejects prerelease/malformed/branch aliases
  - Integrity validation rejects version-mismatched tags
  - Network/API failures return actionable errors
- [X] T017 [US2] Implement `changebudget update --check` command in `src/cli/commands/update.ts`:
  - Calls `getInstalledVersion()` → current version
  - Calls `fetchAllTags()` → available tags
  - Filters/validates/selects compatible update and newer major
  - Outputs: current, latest compatible, update available (Y/N), newer major + explicit install command if applicable
  - Exit codes: 0 OK, 4 ENVIRONMENT (version undetermined, discovery failure, network error)
  - Zero target-project mutations (no file I/O outside installed package)
- [X] T018 [US2] Add integration test for `update --check` in `tests/integration/cli/update-check.test.ts`:
  - Snapshot project tree before/after → byte-identical
  - Scenarios: already current, compatible update, newer major only, version undetermined, network failure (mocked)
  - Verifies zero project mutations
- [X] T019 [US2] Wire `update --check` in `src/cli/index.ts` command parser

---

## Phase 5: User Story 3 — Compatible Self-Update (P1)

### Goal
Implement `changebudget update` that delegates global package replacement to npm with explicit tag.

### Independent Test Criteria
- Installs latest compatible same-major version via `npm install -g github:...#vX.Y.Z`
- Reports updated version, exits 0
- No-op if already current (reports "already current", exits 0)
- Zero target-project mutations
- SPEC-009 integration still works after update

### Tasks

- [X] T020 [US3] Create `src/core/update/npm.ts`:
  - `runSelfUpdate(targetTag): Promise<UpdateResult>` — spawns npm with explicit tag spec
  - macOS/Linux: `spawn('npm', ['install', '-g', spec])`
  - Windows: `spawn(process.env.ComSpec || 'cmd.exe', ['/C', 'npm', 'install', '-g', spec])`
  - Only validated tag (`^v\d+\.\d+\.\d+$`) interpolated into spec
  - Classifies: npm unavailable, launch failure, non-zero exit, interruption
- [X] T021 [US3] Add unit tests for npm adapter in `tests/unit/core/update/npm.test.ts`:
  - Mocks spawn; verifies correct argv for each platform
  - Handles npm unavailable (ENOENT)
  - Handles non-zero exit code
  - Handles interruption
  - Windows path-with-spaces test
- [X] T022 [US3] Implement `changebudget update` command in `src/cli/commands/update.ts`:
  - Runs `--check` logic first to get current and target version
  - If already current → no-op, report, exit 0
  - If newer major only → report major with explicit install command, perform no npm call, exit 0
  - If compatible update → call `runSelfUpdate(targetTag)` → report result, exit 0 on success
  - Zero target-project mutations
- [X] T023 [US3] Add integration test for `update` in `tests/integration/cli/update.test.ts`:
  - Local tagged fixture: install v1.1.0, run update, verify v1.2.0 installed
  - Already current: no-op
  - Verify zero project mutations (snapshot before/after)
  - Verify SPEC-009 integration still works after update
- [X] T024 [US3] Add cross-platform test for Windows npm subprocess in disposable prefix with spaces in path

---

## Phase 6: User Story 4 — Major Version Upgrade Requires Explicit Action (P1)

### Goal
Ensure major upgrades are never automatic; user must run explicit command.

### Independent Test Criteria
- `update --check` with newer major reports it and shows explicit install command
- `update` with newer major performs no mutation, reports same info, and exits 0
- Zero target-project mutations

### Tasks

- [X] T025 [US4] Verify major upgrade logic in `update.ts`:
  - `selectCompatibleUpdate` returns null for higher major
  - `detectNewerMajor` returns newer major tag
  - `--check` outputs explicit command: `npm install -g github:Edulynch/Opencode-ChangeBudget#v2.0.0`
  - `update` performs no npm call, outputs same info, and exits 0
- [X] T026 [US4] Add integration test for major upgrade blocking:
  - Install v1.2.0, mock v2.0.0 tag existence
  - Run `--check` → reports major, shows command, exit 0
  - Run `update` → no mutation, same output, exit 0

---

## Phase 7: User Story 5 — Safe Failure Handling (P1)

### Goal
Actionable errors for network, GitHub, npm failures; no partial mutations.

### Independent Test Criteria
- Network failure → actionable error, exit 4
- npm unavailable/subprocess failure → actionable error, existing installation unchanged, exit 4
- Interrupted update → safe recovery on re-run
- Zero target-project mutations in all failure scenarios

### Tasks

- [X] T027 [US5] Add error handling in `github.ts`:
  - Network timeout (5s) → exit 4, "Network timeout during GitHub API request"
  - GitHub unreachable/non-200 → exit 4, "Cannot reach GitHub for tag discovery"
  - Invalid response format → exit 4, "Invalid GitHub API response"
- [X] T028 [US5] Add error handling in `npm.ts`:
  - npm not found on PATH → exit 4, "npm not found in PATH"
  - spawn ENOENT/launch failure → exit 4, actionable error
  - Non-zero exit code → exit 4, includes npm stderr
  - Interruption (signal) → exit 4, "Update process interrupted"
- [X] T029 [US5] Add integration tests for failure scenarios in `tests/integration/cli/failures.test.ts`:
  - Mock GitHub network failure → verify error output, exit code, no mutations
  - Mock npm failure → verify error output, exit code, no global mutation
  - Verify interrupted update recovery (mock partial then complete)

---

## Phase 8: User Story 6 — Non-Technical Quick Start (P1)

### Goal
Document and validate the 4-step Quick Start sequence.

### Independent Test Criteria
- Fresh environment: run 4 commands → working OpenCode + ChangeBudget integration
- No manual build steps required

### Tasks

- [X] T030 [US6] Create `quickstart.md` with 4-step sequence:
  1. `npm install -g github:Edulynch/Opencode-ChangeBudget#vX.Y.Z`
  2. `changebudget init`
  3. `changebudget integrate opencode`
  4. `opencode` (launches with integration active)
- [X] T031 [US6] Add acceptance test for Quick Start in `tests/acceptance/quickstart.test.ts`:
  - Runs full sequence in disposable environment
  - Verifies OpenCode launches with ChangeBudget integration

---

## Phase 9: Project Isolation & SPEC-009 Compatibility

### Goal
Prove update operations never touch project files; SPEC-009 integration preserved.

### Independent Test Criteria
- Snapshot tests prove zero project mutations for `--check` and `update`
- SPEC-009 Runtime Guard resolvable after compatible update
- No automatic `changebudget integrate opencode` call

### Tasks

- [X] T032 [US2/US3] Add project isolation snapshot test in `tests/integration/cli/isolation.test.ts`:
  - Create disposable project with `.changebudget/`, `.opencode/`, `opencode.json`, `AGENTS.md`, `specs/`
  - Run `update --check` → snapshot after → assert byte-identical
  - Run `update` → snapshot after → assert byte-identical
  - Verify no calls to SPEC-009 integration code
- [X] T033 [US3] Add SPEC-009 compatibility test in `tests/integration/cli/spec009-compat.test.ts`:
  - Install v1.1.0, run `changebudget integrate opencode`
  - Run `update` to v1.2.0
  - Verify Runtime Guard still resolvable at expected path
  - Verify `opencode.json` registration intact
  - Verify integration instructions still valid

---

## Phase 10: Isolated Installation Tests & Validation

### Goal
Validate all automated tests use isolated environments; verify package contents.

### Independent Test Criteria
- All tests use disposable npm prefixes (never real global npm)
- Local `git+file://` tagged-install acceptance test passes
- `npm pack --dry-run --json` validation passes
- Build, typecheck, full `npm test` pass
- No network required for normal test suite
- SPEC-005–009 acceptance-metrics.md unchanged (or restored)

### Tasks

- [X] T034 Create test utility `tests/utils/disposable-npm.ts`:
  - Creates temp directory + npm prefix
  - Sets `npm_config_prefix`, `PATH` for isolation
  - Cleanup on exit
- [X] T035 Create local tagged Git fixture utility in `tests/utils/git-fixture.ts`:
  - `init()` → bare repo with commit + tag
  - `getPackageSpec(tag)` → `git+file://...#vX.Y.Z`
  - Cleanup on exit
- [X] T036 [P] Add `npm pack --dry-run --json` validation test in `tests/integration/package-contents.test.ts`:
  - Runs after build
  - Asserts required files present, excluded files absent
- [X] T037 [P] Add tagged-install acceptance test in `tests/acceptance/tagged-install.test.ts`:
  - Uses disposable npm prefix + local git fixture
  - Installs from fixture, verifies CLI executes, version matches, Runtime Guard available
- [X] T038 Run full validation gate: `npm run build && npm run typecheck && npm test`
- [X] T039 Verify no SPEC-005–009 acceptance-metrics.md modified (or restored before final diff evaluation)

---

## Phase 11: Polish & Cross-Cutting

### Goal
Final integration, edge-case coverage, documentation.

### Independent Test Criteria
- All 18 acceptance scenarios from spec.md pass
- Windows real validation and Ubuntu/WSL real validation verified; macOS covered by POSIX-compatible tests
- Exit code conventions match existing ChangeBudget (0, 2, 4, 10)
- No new runtime dependencies introduced

### Tasks

- [X] T040 [P] Add CLI help text for `update` and `--version` in `src/cli/commands/update.ts`
- [X] T041 Verify exit code conventions throughout:
  - `--version` → 0
  - `update --check` success → 0
  - `update --check` version undetermined/discovery failure → 4
  - `update` success/no-op → 0
  - `update` major blocked safely without npm installation → 0
  - `update` version undetermined/npm failure → 4
  - Invalid CLI flags → 2
  - Unexpected internal → 10
- [X] T042 [P] Add edge-case tests in `tests/unit/core/update/edge-cases.test.ts`:
  - Multiple compatible versions → highest selected
  - Current newer than tags → no-op
  - Tag/package mismatch → tag skipped, next candidate used
  - No valid stable tags → "no valid versions found"
- [X] T043 [P] Cross-platform validation: Windows real run, Ubuntu/WSL real run, and POSIX-compatible macOS coverage
- [X] T044 Update `CHANGELOG.md` if project convention requires (no changelog convention/file exists; quick-start and acceptance evidence updated)

---

## Dependency Graph

```
Phase 1 (T001-T005) ──────────────────────────────────────┐
    │                                                     │
    ▼                                                     ▼
Phase 2 (T006-T008) ────────────────────────────────── Phase 3 (T009-T012)
    │                                                         │
    ├── Phase 4 (T013-T019) ◄────────────────────────────────┤
    │       │                                                │
    │       ▼                                                │
    ├── Phase 5 (T020-T024) ◄──────────────────────────────┤
    │       │                                                │
    │       ├── Phase 6 (T025-T026)                         │
    │       │                                                │
    │       ├── Phase 7 (T027-T029)                         │
    │       │                                                │
    │       ├── Phase 8 (T030-T031)                         │
    │       │                                                │
    │       ├── Phase 9 (T032-T033)                         │
    │       │                                                │
    │       ├── Phase 10 (T034-T039)                        │
    │       │                                                │
    │       └── Phase 11 (T040-T044)                        │
    │                                                        │
    └────────────────────────────────────────────────────────┘
```

### Critical Dependency Chain
`T001-T005` → `T006-T008` → `T009-T012` → `T013-T019` → `T020-T024` → `T025-T026` / `T027-T029` → `T030-T039` → `T040-T044`

### Parallelizable Groups
- T013 & T015 (semantic version & GitHub discovery — different files)
- T020 & T013 (npm adapter & semantic version — different files, after T008)
- T034 & T035 (test utilities — independent)
- T036 & T037 (package validation & acceptance test — independent after T034/T035)
- T040, T042, T044 (polish tasks — independent)

### Suggested First Implementation Block (MVP)
**Phase 1 + Phase 2 + Phase 3** (T001–T012)
- Establishes package foundation, shared helper, and `--version` command
- Enables end-to-end tagged installation verification
- ~12 tasks, independently testable

### Total Task Count: 44

---

## Validation Checklist

- [X] All tasks follow checklist format: `- [ ] T### [P?] [Story?] Description with file path`
- [X] Each user story (US1-US6) has dedicated phase with traceable tasks
- [X] Setup/Foundational phases have NO story label
- [X] User Story phases HAVE story label [US1]-[US6]
- [X] Polish phase has NO story label
- [X] [P] marker only on genuinely independent tasks
- [X] File paths are exact and actionable
- [X] Dependencies reflected in phase ordering
- [X] Tests alongside behavior they validate
- [X] Normal `npm test` requires NO network (mocks/disposable fixtures used)
- [X] No tasks introduce npm publishing, CI/CD, prerelease channels, background checks, telemetry, or unrelated refactors
