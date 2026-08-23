---

description: "Implementation tasks for SPEC-012 cross-platform CI and immutable-tag release smoke"

---

# Tasks: Cross-Platform CI and Release Smoke (SPEC-012)

**Input**: Design documents from `specs/012-cross-platform-ci-release-smoke/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `quickstart.md`, and `contracts/`

**Tests**: Required by SPEC-012. Keep normal automated tests network-free; real public GitHub installation is reserved for the tag-smoke workflow.

**Implementation rule**: Do not create, move, delete, or repair tags; bump versions; publish releases; add PATs/custom secrets/SSH keys; or add macOS/npm 12/third-party release infrastructure. The private-repository tagged smoke may use only the ephemeral workflow-provided `GITHUB_TOKEN` with `contents: read` at a temporary Git HTTPS authentication boundary. SPEC-012 final acceptance remains pending until a future immutable `v*` tag event in this private repository passes both required smoke platforms.

## Phase 1: Setup - Shared Contract Foundation

**Goal**: Establish the dependency-free smoke boundary and exact independent public-install contract before workflows or consumers use it.

- [X] T001 Create `scripts/smoke-tagged-install.mjs` with exported/testable independent constants and pure helpers for the HTTPS repository URL, strict `vMAJOR.MINOR.PATCH` tag validation, tag-to-version conversion, canonical package-spec construction, and exact npm argv ordering.
- [X] T002 [P] Add `smoke:tagged` and `ci:release-gate` developer entrypoints to `package.json` without changing the package version, production entrypoint, or existing build/typecheck/test scripts.

**Checkpoint**: The independent smoke contract and its invocation boundary exist; no workflow depends on production updater helpers as its only contract source.

---

## Phase 2: Foundational - Gate and Contract Tests

**Goal**: Add the blocking release-gate mode and contract-consistency coverage before CI and tagged-smoke workflows consume them.

- [X] T003 Extend `scripts/validate-release.mjs` with explicit `--ci-safe` option parsing that skips only local/remote expected-tag availability rejection while retaining every other release check.
- [X] T004 Add `--ci-safe` positive and negative coverage to `tests/unit/release-gate.test.ts`: an existing current tag passes CI-safe mode; normal mode still rejects it; stale runtime, package/version mismatch, forbidden package content, missing runtime, untracked runtime, and ignored runtime still fail.
- [X] T005 [P] Create `tests/unit/ci-contract.test.ts` with independent exact assertions for HTTPS transport, strict immutable tag syntax, npm argv order, absence of `github:` shorthand/SSH requirements, and equality between the independent smoke contract and production `buildPackageSpec()`/`buildNpmArgs()`.
- [X] T006 [P] Create `tests/unit/smoke-tagged-install.test.ts` covering pure smoke helpers for tag validation, tag-to-version conversion, canonical package spec, exact argv, platform package-root/CLI path resolution, and deterministic invalid-input failures.
- [X] T007 Add current-contract scan coverage in `tests/unit/ci-contract.test.ts` for SPEC-011 documentation, release-gate expectations, local tagged-install acceptance expectations, and production updater transport while excluding historical SPEC-010 incident artifacts.

**Checkpoint**: CI-safe gate behavior and independent contract drift detection are testable before workflow implementation; default release-tag safety remains unchanged.

---

## Phase 3: User Story 1 - Validate Every Change on Windows and Linux (Priority: P1) 🎯 MVP

**Goal**: Run deterministic pull-request and `master` push validation on required Windows/Linux runners using the real package version.

**Independent Test**: A matrix job on each required runner selects Node 24.18.0/npm 11.16.0, runs `npm ci`, typecheck, build, tests, package dry-run, CI-safe gate, and hygiene checks, and fails visibly on any required failure.

### Implementation

- [X] T008 [US1] Create `.github/workflows/ci.yml` with `pull_request` and `push` to `master` triggers, `windows-latest`/`ubuntu-latest` matrix, `permissions: contents: read`, official `actions/checkout@v7`, official `actions/setup-node@v7`, Node 24.18.0, npm 11.16.0, no `continue-on-error`, and a 20-minute job timeout.
- [X] T009 [US1] Add root `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm pack --dry-run --json --ignore-scripts`, `node scripts/validate-release.mjs --ci-safe`, runtime tracking/forbidden-output checks, and `git diff --check` steps to `.github/workflows/ci.yml` without mutating tags, releases, package versions, or the real global ChangeBudget installation.
- [X] T010 [US1] Add lockfile-keyed setup-node npm caching, explicit npm 11.16.0 selection/verification, and concurrency cancellation for superseded pull-request/branch runs to `.github/workflows/ci.yml`; ensure cache hits do not affect correctness.
- [X] T011 [US1] Add static workflow-contract assertions in `tests/unit/workflow-contract.test.ts` for CI triggers, exactly two required runners, pinned toolchain, read-only permissions, required commands, no write operations/secrets/third-party actions, 20-minute timeout, and cancellable non-tag concurrency.

**Checkpoint**: US1 is independently testable as normal Windows/Linux CI; both required matrix jobs fail the workflow on validation failure.

---

## Phase 4: User Story 2 - Validate the Actual Immutable Release Tag (Priority: P1)

**Goal**: Install and exercise the actual remote HTTPS tag from the private repository using only process-scoped ephemeral read-only workflow authentication in disposable Windows/Linux environments using the shared harness.

**Independent Test**: A `v*` tag event derives its tag from GitHub context, checks out only the exact tag for harness access, prepares process-scoped Git HTTPS authentication with only `GITHUB_TOKEN`, installs the remote HTTPS package using the credential-free canonical package spec, executes the installed CLI, and validates package/runtime/version/integration/preservation/cleanup behavior on both platforms.

### Shared Harness Implementation

- [X] T012 [US2] Implement disposable prefix, cache, userconfig, and space-containing project lifecycle in `scripts/smoke-tagged-install.mjs`, including real global npm prefix snapshot, deterministic CLI argument handling, and `try/finally` cleanup/error propagation.
- [X] T013 [US2] Implement actual private remote-tag npm installation and installed package/CLI discovery in `scripts/smoke-tagged-install.mjs` using the independently constructed credential-free package spec, process-scoped `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` HTTPS auth from `GITHUB_TOKEN`, disposable environment, `npm root --global`, and absolute platform CLI paths; reject checkout/local fixture/package-archive substitution.
- [X] T014 [US2] Implement installed package assertions in `scripts/smoke-tagged-install.mjs` for `package.json`, `dist/src/cli/index.js`, Runtime Guard, tag/version equality, `--version`, `--help`, `init`, and `integrate opencode`.
- [X] T015 [US2] Implement project-preservation, wrapper/Runtime Guard linkage, real-global-prefix equality, cleanup absence, and deterministic non-zero failure assertions in `scripts/smoke-tagged-install.mjs`.
- [X] T016 [US2] Extend `tests/unit/smoke-tagged-install.test.ts` with focused tests for process-scoped auth environment construction and Node -> npm -> Git propagation using a local fake process chain, raw/encoded token redaction, cleanup success, cleanup failure, assertion failure behavior, installed path resolution, and preservation comparison without GitHub/network installation.

### Tagged Workflow

- [X] T017 [US2] Create `.github/workflows/release-smoke.yml` with `push.tags: ["v*"]`, exact event-tag checkout using `actions/checkout@v7` with `persist-credentials: false`, `fail-fast: false`, `windows-latest`/`ubuntu-latest` matrix, `actions/setup-node@v7`, Node 24.18.0/npm 11.16.0, `permissions: contents: read`, and a 15-minute timeout; expose only the built-in `GITHUB_TOKEN` on the harness invocation step and use no PAT/custom secret/SSH/`gh`.
- [X] T018 [US2] Invoke the installed-tag harness from `.github/workflows/release-smoke.yml` using the event-derived tag and repository URL, fresh isolated cache, process-scoped Git runtime auth derived from `GITHUB_TOKEN`, credential-free package spec/argv, non-cancellable per-tag concurrency, and no checkout installation, tokenized URL, credential file, tag mutation, push, repair, or GitHub Release publication.
- [X] T019 [US2] Add tagged-workflow static assertions in `tests/unit/workflow-contract.test.ts` for `v*` trigger, exact-tag checkout boundary, `persist-credentials: false`, private remote HTTPS install source, Windows/Linux matrix with `fail-fast: false`, derived tag input, fresh-cache behavior, 15-minute timeout, non-cancellable tag concurrency, token exposure only at the harness step, and no release/tag write permissions.

**Checkpoint**: US2 is independently testable through the harness locally and through the real remote tag workflow when a future immutable tag exists.

---

## Phase 5: User Story 3 - Prove Credential Independence and Contract Consistency (Priority: P1)

**Goal**: Prove private-repository installation works without developer GitHub configuration, using only the ephemeral workflow token, and that all contract surfaces remain aligned without sharing one regression source.

### Isolation and Contract Implementation

- [X] T020 [US3] Add Ubuntu developer-credential isolation to `scripts/smoke-tagged-install.mjs`: temporary HOME, isolated npm userconfig, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, removed personal SSH/GitHub credential paths and config overrides, no inherited personal/global Git credentials, no `gh`/SSH setup, and preservation of only the process-scoped Git auth variables for the npm child.
- [X] T021 [US3] Add Windows isolation behavior to `scripts/smoke-tagged-install.mjs`: disposable prefix/cache/userconfig, paths containing spaces, absolute installed `changebudget.cmd` execution, no personal `gh`/SSH dependency, process-scoped workflow-token-only private repository access, and real global npm prefix before/after comparison.
- [X] T022 [P] [US3] Preserve network-free local tagged-install coverage in `tests/acceptance/tagged-install.test.ts` while refactoring only reusable assertions that do not replace the local fixture with public GitHub installation.
- [X] T023 [US3] Add production-helper equality and current-documentation consistency assertions to `tests/unit/ci-contract.test.ts`, proving `buildPackageSpec()`/`buildNpmArgs()` match the independent public contract without making the smoke harness depend on them.
- [X] T024 [US3] Add security/static assertions in `tests/unit/workflow-contract.test.ts` for `contents: read`, built-in `GITHUB_TOKEN` limited to the harness auth boundary, `persist-credentials: false`, absent PAT/custom secrets/SSH/`gh`/write permissions, no credential/package-spec/environment dumps or shell tracing, no tokenized URL/credential file/global Git mutation, no GitHub Release publication, and no tag mutation commands.

**Checkpoint**: US3 proves Linux developer-credential isolation with workflow-token access, Windows prefix isolation, contract consistency, and safe workflow behavior while retaining network-free automated acceptance.

---

## Phase 6: Polish - Documentation and Final Validation

**Goal**: Document the release lifecycle and validate the complete implementation without claiming final real-tag acceptance prematurely.

- [X] T025 [P] Update `README.md` with concise Windows/Linux CI, pinned toolchain, private tagged-smoke using ephemeral read-only workflow authentication, manual GitHub Release sequence, and developer-credential isolation expectations without rewriting unrelated sections.
- [X] T026 [P] Update `specs/011-prebuilt-tagged-install/contracts/release-gate.md` with named CI-safe semantics, retained normal tag rejection, and the SPEC-011-to-SPEC-012 release sequence.
- [X] T027 [P] Update `specs/011-prebuilt-tagged-install/quickstart.md` to distinguish local network-free acceptance from actual remote-tag smoke and link the Windows/Linux release workflow behavior.
- [X] T028 [P] Update `specs/012-cross-platform-ci-release-smoke/quickstart.md`, `contracts/ci-validation.md`, and `contracts/tagged-smoke.md` with final command names, file paths, failure semantics, and future real-tag acceptance boundary.
- [X] T029 Run focused tests covering `tests/unit/release-gate.test.ts`, `tests/unit/ci-contract.test.ts`, `tests/unit/smoke-tagged-install.test.ts`, and `tests/unit/workflow-contract.test.ts`; fix only SPEC-012 implementation defects in those owning files.
- [X] T030 Run `npm run typecheck`, `npm run build`, `npm test`, `npm pack --dry-run --json --ignore-scripts`, and `node scripts/validate-release.mjs --ci-safe`; confirm runtime zero drift and required/forbidden tracking.
- [X] T031 Review `.github/workflows/ci.yml`, `.github/workflows/release-smoke.yml`, `scripts/`, `tests/`, and `specs/012-cross-platform-ci-release-smoke/` with `git diff --check`, `git status --short`, and static searches confirming no macOS/npm 12/third-party action/PAT/custom secret/SSH/`gh`/tag/release mutation scope entered the change set and that only built-in read-only `GITHUB_TOKEN` auth is used.

**Checkpoint**: SPEC-012 implementation may be reported as `IMPLEMENTATION COMPLETE - REAL TAG SMOKE PENDING` only after T029-T031 pass; T032 remains intentionally pending.

---

## Phase 7: Final Acceptance - Future Immutable Tag Evidence

**Goal**: Close SPEC-012 only after the newly implemented tagged-smoke workflow validates a real future immutable tag event in this private repository.

- [X] T032 Run the implemented `.github/workflows/release-smoke.yml` for one future immutable `v*` tag event in this private repository created by a maintainer outside this task list; record both Windows and Ubuntu job PASS results, proof that only process-scoped ephemeral read-only `GITHUB_TOKEN` Git auth was used, no PAT/custom secret/SSH/`gh` was used, no credential persisted, installed version/tag equality, Runtime Guard/integration/preservation/developer-credential-isolation/cleanup evidence, and final SPEC-012 acceptance in `specs/012-cross-platform-ci-release-smoke/quickstart.md` or a dedicated evidence file. “Public tag” means a real repository tag pushed to GitHub, not a public repository. Do not create, move, repair, or publish the tag/release as part of this task.

**Checkpoint**: SPEC-012 becomes `COMPLETE` only after T032 records PASS for both required platform jobs. Existing manual v1.1.3 evidence does not satisfy T032.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** has no implementation dependency and establishes the independent smoke contract boundary.
- **Phase 2** depends on T001 and blocks workflow/harness consumers with CI-safe gate and contract tests.
- **Phase 3 (US1)** depends on T003-T005 and can proceed once the gate interface and contract expectations are stable.
- **Phase 4 (US2)** depends on T001 and T006; the workflow depends on T012-T015 harness behavior.
- **Phase 5 (US3)** depends on T012-T015 for isolation additions and T005 for independent contract assertions.
- **Phase 6** depends on all implementation phases and produces the implementation-complete checkpoint.
- **Phase 7** depends on merged workflows, a future maintainer-created immutable tag, and all Phase 6 validation.

### Critical Path

`T001 -> T003 -> T004 -> T005 -> T012 -> T013 -> T014 -> T015 -> T017 -> T018 -> T020 -> T021 -> T029 -> T030 -> T031 -> T032`

### Parallel Groups

- After T001: T002, T005, and T006 can proceed in separate files where their interfaces are respected.
- After T003: T004 and T005 can proceed in parallel because they own different test files.
- After T012-T015 establish the harness: T016 can proceed; T019 follows T017-T018 because its assertions require the completed tagged workflow.
- After T015: T017 and T022 can proceed in parallel; the workflow consumes the stable harness while local acceptance remains network-free.
- After the shared interfaces stabilize: T008/T009/T010 own `ci.yml`, T017/T018 own `release-smoke.yml`, and T025-T028 own separate documentation surfaces.
- During Phase 6: T025-T028 can proceed in parallel; T029-T031 remain sequential validation tasks.

### File Ownership

| File | Owning tasks | Notes |
|---|---|---|
| `scripts/validate-release.mjs` | T003 | Single sequential gate API owner. |
| `scripts/smoke-tagged-install.mjs` | T001, T012-T015, T020-T021 | Sequential shared harness ownership. |
| `.github/workflows/ci.yml` | T008-T010 | Sequential workflow construction; static checks are separate. |
| `.github/workflows/release-smoke.yml` | T017-T018 | Sequential workflow construction; static checks are separate. |
| `tests/unit/release-gate.test.ts` | T004 | Gate-specific tests only. |
| `tests/unit/ci-contract.test.ts` | T005, T007, T023 | Sequential additions to the same contract test file. |
| `tests/unit/smoke-tagged-install.test.ts` | T006, T016 | Sequential helper test additions. |
| `tests/unit/workflow-contract.test.ts` | T011, T019, T024 | Sequential static/security test additions. |
| `tests/acceptance/tagged-install.test.ts` | T022 | Preserve local network-free acceptance. |
| Documentation | T025-T028, T032 | Parallel only where files do not overlap; T032 owns final evidence closure. |

### User Story Dependencies

- **US1 (P1)**: Depends on the foundational gate and independent contract interfaces; it is the MVP and can be validated without a public tag.
- **US2 (P1)**: Depends on the smoke contract and harness; its real workflow execution requires a future immutable tag.
- **US3 (P1)**: Depends on the harness lifecycle and independent contract tests; it complements both US1 and US2 and remains network-free in automated tests.

## Implementation Strategy

### MVP First

1. Complete T001-T007 foundational contract and release-gate work.
2. Complete T008-T011 for normal Windows/Linux CI.
3. Run T029-T031 and report `SPEC-012 IMPLEMENTATION COMPLETE - REAL TAG SMOKE PENDING` if all local validation passes.

### Incremental Delivery

1. Add the independent contract and CI-safe gate.
2. Add and test the shared tagged-smoke harness.
3. Add normal CI and validate the MVP matrix.
4. Add the real-tag smoke workflow and isolation behavior.
5. Update documentation and run final local/static validation.
6. After a future immutable tag, complete T032 and close SPEC-012.

## Notes

- Every task uses the required `- [ ] T###` format and includes exact file paths.
- `[P]` appears only when file ownership and dependencies permit concurrent work.
- No task creates workflows/scripts during this task-generation step; the list describes future implementation only.
- No task creates a tag or publishes a release. T032 requires a maintainer-created future tag and may intentionally remain unchecked.
