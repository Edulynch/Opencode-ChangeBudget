# Implementation Plan: Cross-Platform CI and Release Smoke

**Branch**: `012-cross-platform-ci-release-smoke` | **Date**: 2026-08-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/012-cross-platform-ci-release-smoke/spec.md`

## Summary

SPEC-012 adds deterministic Windows/Linux validation without changing ChangeBudget runtime behavior. T001-T011 are already implemented and remote-ready; this replan preserves their normal CI and gate contract. T012+ adds a separate `v*` tag workflow that checks out the triggering tag only for a versioned, dependency-free smoke harness, then authenticates and installs the actual remote HTTPS tag from the private repository in isolated disposable environments. The release gate retains its explicit `--ci-safe` mode, which skips only existing-tag availability rejection.

The design keeps workflow YAML thin, preserves local fixture acceptance as network-free coverage, and adds independent credential-free package-contract assertions plus separate comparisons with production updater helpers. Private-repository authentication is a separate process-scoped Git environment boundary using only the ephemeral workflow `GITHUB_TOKEN`. SPEC-012 can merge after normal CI is green, but final acceptance remains pending until a future real immutable tag event passes both required smoke jobs.

## Technical Context

**Language/Version**: Node.js 24.18.0, npm 11.16.0, ECMAScript modules; existing TypeScript source targets ES2022.

**Primary Dependencies**: Existing TypeScript and Node built-ins; official `actions/checkout@v7` and `actions/setup-node@v7` only for workflows. No new runtime dependency.

**Storage**: No persistent storage. Git-tracked workflow, script, tests, generated runtime, package metadata, and documentation remain the sources of truth.

**Testing**: Existing Node test runner, focused unit/acceptance tests, `npm ci`, typecheck, build, `npm test`, `npm pack --dry-run --json --ignore-scripts`, release gate, process-scoped Git auth environment tests without network, and real private-repository tag smoke.

**Target Platform**: GitHub-hosted `windows-latest` and `ubuntu-latest`; no macOS runner. Local harness behavior must remain testable on the repository's supported POSIX/Windows process paths.

**Project Type**: Local-first TypeScript CLI with tracked prebuilt release runtime and manual immutable Git-tag publication.

**Performance Goals**: Normal matrix jobs complete within 20 minutes; tagged smoke jobs complete within 15 minutes. No cache hit is required for correctness.

**Constraints**: Read-only GitHub Actions permissions, no PAT/custom secrets/personal tokens/SSH keys/`gh`, no tag/release mutation, no automatic publication, private HTTPS installation using only ephemeral read-only `GITHUB_TOKEN` Git authentication, no tokenized URL or persistent credential file, no npm 12 support, fresh tagged-smoke cache, disposable npm/project resources, and no checkout CLI execution.

**Scale/Scope**: Two workflows, one dependency-free smoke harness, one explicit release-gate mode, focused contract/gate/harness tests, and only the documentation needed to connect SPEC-011 and SPEC-012 release behavior.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

* **PASS - Local-first and deterministic**: GitHub Actions validates the release boundary but is not a runtime dependency. Local tests remain network-free; the public network is used only by the explicitly separate tag smoke.
* **PASS - Minimal architecture**: Two thin official-action workflows and one Node built-in harness are the smallest design that avoids duplicated cross-platform shell logic and proves the remote tag.
* **PASS - Scope is a hard boundary**: No macOS, npm 12, npmjs, automatic release/tagging, Docker, signing, coverage service, or branch-protection work is included.
* **PASS - Small changes, small workflows**: YAML orchestrates; existing scripts, production helpers, package layout, and local acceptance patterns are reused.
* **PASS - Targeted validation**: Focused gate/contract/harness tests precede workflow validation; full CI remains the required platform checkpoint.
* **PASS - Git is the source of truth**: Runtime tracking, zero drift, clean state, exact tag ref, and immutable release semantics are validated through Git state.
* **PASS - Enforcement over suggestion**: Required matrix jobs fail on any validation, isolation, cleanup, package, or installed-runtime failure.
* **PASS - Human authority**: Tag creation, repair decisions, and GitHub Release publication remain manual maintainer actions.
* **PASS - Explainable decisions**: The gate and harness report expected contract, observed paths/versions, and affected check on failure.
* **PASS - Quality over complexity**: No service, PAT, custom secret, persistent credential store, dependency, cache correctness requirement, or artifact-upload subsystem is introduced; process-scoped Git environment is the smallest auth boundary.

## Phase 0: Research Decisions

Research is complete in [research.md](./research.md). Decisions resolved:

1. Use `npm ci` at the repository root as the deterministic dependency command.
2. Use official `actions/checkout@v7` and `actions/setup-node@v7`; verify majors again immediately before future workflow implementation.
3. Add named `--ci-safe` release-gate mode, not YAML composition of low-level skips.
4. Keep independent public-contract constants/assertions in the smoke boundary and compare separately with production helpers.
5. Checkout the exact tag for harness/docs only; install and execute the remote tag.
6. Use a fresh tagged-smoke cache, optional lockfile-keyed normal-CI npm cache, asymmetric concurrency, 20/15-minute timeouts, and command-output diagnostics only.

## Phase 1: Design

### Workflow architecture

#### Normal CI: `.github/workflows/ci.yml`

- Triggers: `pull_request` and `push.branches: [master]`.
- Top-level `permissions: contents: read`.
- Concurrency group: workflow plus pull-request number when available, otherwise branch/ref; `cancel-in-progress: true`.
- One job with matrix `os: [windows-latest, ubuntu-latest]`, `fail-fast: false`; no `continue-on-error`.
- Job timeout: 20 minutes.
- Checkout uses `actions/checkout@v7`; setup uses `actions/setup-node@v7` with Node `24.18.0`.
- Select/verify npm `11.16.0` explicitly before dependency installation. If the runner does not provide it, install only that npm version in the job environment; do not rely on runner default.
- Run root `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm pack --dry-run --json --ignore-scripts`, `npm run ci:release-gate` (or equivalent explicit `node ... --ci-safe`), and `git diff --check`.
- The gate performs build freshness, runtime presence/tracking/ignore checks, package contents, forbidden content, contract consistency, and clean-tree validation. Any redundant visible build is retained because the normal CI contract requires both build and gate checks.
- Use setup-node lockfile-keyed npm cache for normal CI; cache availability never changes pass/fail semantics.
- Do not install ChangeBudget globally, mutate tags, publish, authenticate `gh`, configure SSH, or upload artifacts. Normal CI does not need the tagged-smoke token boundary.

#### Tagged smoke: `.github/workflows/release-smoke.yml`

- Trigger: `push.tags: ["v*"]` only.
- Top-level `permissions: contents: read`.
- Concurrency group includes the immutable tag ref; `cancel-in-progress: false` so a later tag cannot cancel an earlier release result.
- One job with matrix `os: [windows-latest, ubuntu-latest]`, `fail-fast: false`; no `continue-on-error`.
- Job timeout: 15 minutes.
- Checkout uses `actions/checkout@v7`, the exact event ref, and `persist-credentials: false`; checkout is harness/docs input only. A static test must fail if persisted credentials are enabled.
- Setup uses `actions/setup-node@v7` with Node `24.18.0`; explicitly select/verify npm `11.16.0`.
- Invoke the harness with the event-derived tag, repository URL, and platform environment. Do not run `npm ci` or install the checkout package for smoke; the harness uses Node built-ins and the checkout only supplies versioned support code.
- The harness builds the remote credential-free package spec and exact npm args independently. The harness derives a temporary Basic authorization header from `GITHUB_TOKEN` and passes it as process-scoped `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`, and `GIT_CONFIG_VALUE_0=Authorization: Basic ...` only to the spawned npm process and its Git children. It installs the actual private HTTPS tag into a disposable prefix/cache/userconfig and executes only the installed absolute CLI. No token is written to a URL, argument, file, npmrc, log, or error.
- Use fresh disposable npm cache per job; do not use setup-node cache for private tag smoke.
- No tag/release mutation, package metadata changes, repair, push, PAT/custom secret/SSH/`gh`, or artifact upload. `GITHUB_TOKEN` is exposed only on the harness invocation step.

#### Private Git authentication boundary

- Select process-scoped Git runtime configuration as the smallest cross-platform mechanism. Git documents `GIT_CONFIG_COUNT` with zero-indexed `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` pairs as runtime configuration that overrides config files; `http.extraHeader` supplies the HTTPS authorization header.
- The harness accepts `GITHUB_TOKEN` from the workflow invocation environment, validates that private auth mode has a non-empty token, constructs `Basic ${base64("x-access-token:<token>")}`, and never returns the raw or encoded value in a user-visible object.
- Spawn the platform npm executable with an environment containing only the required Git variables. Verify the propagation chain Node smoke harness -> npm -> Git using a local fake npm/Git executable in unit tests; the real tag smoke verifies it end-to-end against GitHub.
- The environment disappears when the npm child exits. Do not use `credential.helper store`, tokenized URLs, `git config --global`, persistent credential files, npmrc credentials, SSH, or `gh`.
- If Windows Git or npm fails to inherit the variables in implementation testing, stop and re-evaluate the next-smallest temporary Git-native mechanism before changing the package contract.

### Shared smoke harness: `scripts/smoke-tagged-install.mjs`

The harness is a dependency-free ESM script with explicit arguments such as `--tag`, `--repository`, and optional paths supplied by the workflow. It exits zero only after every assertion and cleanup check passes.

Responsibilities:

1. Validate the event-derived tag against strict `vMAJOR.MINOR.PATCH` syntax and derive the expected installed version.
2. Independently construct `git+https://github.com/Edulynch/Opencode-ChangeBudget.git#${TAG}` and the exact ordered npm args.
3. Create disposable prefix, cache, userconfig, and a project path containing spaces; snapshot the real global npm prefix before install.
4. On Ubuntu, set temporary HOME, no `~/.ssh` or `~/.config/gh`, isolated npm userconfig, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, and remove inherited personal/global Git credential configuration. Preserve the process-scoped `GIT_CONFIG_COUNT` auth variables for npm/Git. Do not install or authenticate `gh` or SSH.
5. On Windows, set disposable prefix/cache/project/userconfig, support paths with spaces, preserve the real prefix snapshot, use an absolute installed `changebudget.cmd` path, and pass only the process-scoped auth variables to npm. Do not call `git config --global` or depend on personal `gh`/SSH state.
6. Run npm install with structured arguments where possible; keep Windows command-processor behavior isolated to the npm invocation boundary.
7. Discover the installed package root through `npm root --global` under the disposable environment and require it to be under the disposable prefix. Discover the CLI from the disposable global prefix, not PATH or checkout.
8. Verify installed `package.json`, `dist/src/cli/index.js`, Runtime Guard entrypoint, version equality, help, `init`, `integrate opencode`, wrapper existence/reference, AGENTS.md bytes, unrelated config fields, expected instruction entry, and project state.
9. Verify the real global npm prefix is unchanged after installation and integration.
10. Use `try/finally` cleanup for all temporary paths, preserve the original failure while reporting cleanup failure, and assert prefix/cache/userconfig/project absence after cleanup.

11. Sanitize all command descriptions, errors, stdout/stderr, and cleanup diagnostics so raw tokens, Basic headers, encoded secret material, and tokenized URLs cannot appear.

The harness must not import production package-spec/argv helpers as its only contract source. Separate tests compare its independent contract values with `buildPackageSpec()` and `buildNpmArgs()`. Auth environment construction is independently tested with `FAKE_SECRET_DO_NOT_PRINT`; the fake token must be absent from package spec, argv, command descriptions, errors, logs, and sanitized failure output, including its encoded form where practical.

### CI-safe release gate

Modify `scripts/validate-release.mjs`:

- Add `--ci-safe` to option parsing and validation options.
- Make `--ci-safe` skip only the `assertTagAvailable` call, including both local and remote availability rejection.
- Keep metadata/version, installation-contract, tool compatibility, runtime presence, tracking/ignore, fresh build, package contents, forbidden content, and clean-tree checks active.
- Reject or document incompatible combinations so `--ci-safe` cannot become an alias for general skipping.
- Preserve default normal release behavior: an existing local tag fails, and `--check-remote` continues to add remote availability checking.
- Add tests in `tests/unit/release-gate.test.ts` for current existing tag passing CI-safe mode, stale runtime failing CI-safe mode, package/version mismatch failing, forbidden contents failing, and normal mode rejecting an existing tag.

### Contract-consistency tests

Add focused tests, preferably `tests/unit/ci-contract.test.ts`, that independently define expected transport/tag/argv values and compare them with:

- `buildPackageSpec()` and `buildNpmArgs()`.
- Tagged smoke harness contract exports or a testable contract module.
- `tests/acceptance/tagged-install.test.ts` expected install string/args.
- `scripts/validate-release.mjs` and SPEC-011 release-gate contract expectations.
- Current SPEC-011 canonical command surfaces.

The scan must exclude historical SPEC-010 artifacts intentionally retained as incident evidence. It must reject current `github:` shorthand, SSH transport, mutable branch refs, and wrong flag order.

### Package scripts and test boundaries

Modify `package.json` only to add clear developer/CI entrypoints if useful:

- `ci:release-gate`: invokes `node scripts/validate-release.mjs --ci-safe`.
- `smoke:tagged`: invokes the shared harness with forwarded arguments.

Do not change the package version or production runtime entrypoint. Keep `tests/acceptance/tagged-install.test.ts` network-free and local-fixture based; refactor only reusable assertions that do not make the real tag harness depend on that fixture.

### Documentation impact

Update only the relevant documentation surfaces:

- `README.md`: concise Windows/Linux CI and private tagged-smoke/release sequence, supported toolchain, and manual GitHub Release publication.
- `specs/011-prebuilt-tagged-install/contracts/release-gate.md`: named CI-safe semantics and preserved normal gate behavior.
- `specs/011-prebuilt-tagged-install/quickstart.md`: distinguish local acceptance from remote tag smoke and link the release sequence.
- `specs/012-cross-platform-ci-release-smoke/quickstart.md`: implementation validation guide already defines the planned commands and acceptance sequence.
- `specs/012-cross-platform-ci-release-smoke/contracts/ci-validation.md` and `contracts/tagged-smoke.md`: normative workflow/harness boundaries.
- `specs/012-cross-platform-ci-release-smoke/acceptance-metrics.md`: add only when implementation and real-tag evidence exist; do not claim final acceptance before the future tag smoke passes.

Do not rewrite historical SPEC-010 incident records or broaden repository-wide shorthand scans to historical docs.

## Project Structure

### Documentation and design artifacts

```text
specs/012-cross-platform-ci-release-smoke/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── ci-validation.md
    └── tagged-smoke.md
```

The data model is validation-only and does not create runtime persistence. The contracts document workflow boundaries and private tagged-smoke behavior.

### Repository files expected to change during implementation

```text
.github/workflows/ci.yml                         # create
.github/workflows/release-smoke.yml              # create
scripts/smoke-tagged-install.mjs                 # create
scripts/validate-release.mjs                     # modify
package.json                                     # modify only for CI/smoke scripts
tests/unit/release-gate.test.ts                  # modify
tests/unit/ci-contract.test.ts                   # create
tests/acceptance/tagged-install.test.ts          # modify only for shared assertions if needed
README.md                                        # modify
specs/011-prebuilt-tagged-install/quickstart.md  # modify
specs/011-prebuilt-tagged-install/contracts/release-gate.md # modify
specs/012-cross-platform-ci-release-smoke/       # update implementation evidence later
```

Tracked generated runtime output should change only if a production source change unexpectedly requires it; SPEC-012 does not intentionally alter production behavior or package version.

## Implementation Sequence

1. Add and test the independent canonical smoke contract and tag/version parser.
2. Add `--ci-safe` release-gate mode and focused negative/positive tests.
3. Add harness lifecycle/discovery/cleanup and process-scoped Git auth propagation tests using disposable local resources; do not contact GitHub in automated tests.
4. Add contract-consistency tests across production helpers, local acceptance, gate, and current docs.
5. Add package script entrypoints if the finalized harness interface benefits from them.
6. Add normal CI workflow with pinned toolchain, `npm ci`, matrix checks, CI-safe gate, permissions, concurrency, cache, and timeout.
7. Add tagged-smoke workflow with exact-tag checkout boundary, fresh cache, derived tag, platform isolation, and harness invocation.
8. Update README and SPEC-011/SPEC-012 validation docs.
9. Run focused tests, typecheck, build, full local suite, package dry-run, CI-safe gate, and workflow/static contract checks.
10. After a maintainer creates a future immutable tag, run the real tag workflow and record Windows/Ubuntu results. Only then mark SPEC-012 final acceptance complete.

## Safe Parallel Implementation Groups

After steps 1-2 establish the contract and gate interfaces:

- **Group A**: normal CI workflow and tagged-smoke workflow; separate files, shared contract interface already fixed.
- **Group B**: harness lifecycle/auth propagation tests and contract-consistency tests; separate test files after harness exports are stable.
- **Group C**: README and SPEC-011/SPEC-012 documentation updates; no workflow or script ownership overlap.

Keep the following sequential:

- Independent smoke contract before harness and workflows.
- CI-safe release-gate semantics before normal workflow invocation.
- Harness interface and Node -> npm -> Git auth propagation tests before tagged workflow invocation.
- Workflow implementation before GitHub-hosted validation.
- Future real-tag smoke before final SPEC-012 acceptance evidence.

## Validation and Failure Behavior

- Any required Windows or Ubuntu job failure fails its workflow; no required job uses `continue-on-error`.
- A failed CI-safe gate still reports the original check; only existing-tag availability is exempted.
- A failed tag smoke leaves the immutable tag unchanged, prevents the manual release publication step, and requires a new patch release.
- Harness cleanup always runs, but cleanup failure also fails the job.
- No workflow prints complete environment state, credentials, tokens, or secret-bearing configuration.
- Normal CI may be implementation-complete while final feature acceptance remains pending for the future real-tag smoke.

## Constitution Re-check After Design

* **PASS - Determinism**: Lockfile installation, pinned toolchain, independent contract assertions, disposable resources, and explicit outcomes are deterministic.
* **PASS - Minimal architecture**: Two workflows, one built-in Node harness, one named gate mode, and focused tests are the minimum cross-platform surface.
* **PASS - Scope**: No prohibited platform, package registry, release automation, secret, service, or unrelated refactor is planned.
* **PASS - Human release authority**: Tag creation and GitHub Release publication remain outside automation.
* **PASS - Local-first runtime**: GitHub Actions validates but does not become required for CLI execution or core enforcement.
* **PASS - Explainability and quality**: Failures identify the contract/check and observed state; cleanup and isolation failures are explicit.

## Complexity Tracking

No constitution violations. A second workflow and a repository-local smoke harness are required because normal CI and actual immutable-tag installation have different trust and network boundaries. No additional service, runtime dependency, cache subsystem, artifact store, or release automation is introduced.
