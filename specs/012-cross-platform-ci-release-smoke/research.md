# Research: Cross-Platform CI and Release Smoke

## Decision: Use two thin official-action workflows

**Decision**: Add `.github/workflows/ci.yml` for pull requests and `master` pushes, and `.github/workflows/release-smoke.yml` for `v*` tag pushes. Both use Windows/Linux matrices, read-only contents permissions, explicit timeouts, and no write-capable action.

**Rationale**: Separating normal regression validation from actual immutable-tag installation keeps network behavior and release semantics clear. Workflow YAML should orchestrate triggers, runners, toolchain, isolation, concurrency, and invocation; shared assertions belong in Node code.

**Verified official actions**: `actions/checkout@v7` and `actions/setup-node@v7` are the current official major versions verified during implementation. Future workflow work should re-check exact majors before editing workflows.

**Alternatives considered**:
- One workflow with conditional jobs: rejected because normal CI and private tag smoke have different network, checkout, caching, authentication, and concurrency semantics.
- Third-party setup or shell actions: rejected because official actions are sufficient.

## Decision: Use `npm ci` as the authoritative dependency installation

**Decision**: Normal CI runs `npm ci` from the repository root after setup-node selects Node 24.18.0 and npm 11.16.0. The root `package-lock.json` is the only dependency lockfile; the plugin has no separate dependency installation contract.

**Rationale**: `npm ci` uses the committed lockfile without rewriting package metadata or lock state. The existing test/build scripts already compile both the root CLI and plugin.

**Alternatives considered**:
- `npm install`: rejected because it may modify the lockfile and is less deterministic.
- A second install under `opencode-plugin`: rejected because no plugin lockfile or dependency contract exists.

## Decision: Add explicit CI-safe release-gate mode

**Decision**: Extend `scripts/validate-release.mjs` with `--ci-safe`. It skips only local and remote expected-tag availability rejection. It continues package/package-lock consistency, tool compatibility, contract consistency, build, runtime presence, tracking, ignored-state, freshness, package contents, forbidden-content, and clean-tree checks.

**Rationale**: The current package version can already have a published tag during ordinary CI. A named semantic mode prevents YAML from composing unrelated low-level skip flags and prevents the mode from becoming a general release-safety bypass.

**Alternatives considered**:
- Synthetic version/tag: rejected because it mutates or fabricates release metadata and does not validate the repository's real candidate.
- Existing `--skip-tag-check` directly in YAML: rejected because its name is ambiguous and makes future weakening easier.

## Decision: Keep the smoke contract independent from production helpers

**Decision**: The repository-local smoke harness independently defines and asserts the HTTPS package spec, strict `vMAJOR.MINOR.PATCH` tag format, and exact npm argv. Contract tests separately compare those values with `buildPackageSpec()`, `buildNpmArgs()`, local acceptance expectations, release-gate checks, and current SPEC-011 documentation.

**Rationale**: Reusing production helpers as the only smoke source could make a shared transport or flag regression appear consistent everywhere. Independent assertions provide a separate failure boundary while comparison tests prevent silent drift.

## Decision: Checkout is orchestration-only for tagged smoke

**Decision**: The tag workflow checks out the exact triggering tag with persisted checkout credentials disabled, only to access the versioned smoke harness and contract documentation. The harness installs the actual remote HTTPS tag from the private repository and executes only the installed absolute CLI from the disposable prefix. Checkout remains orchestration input, not the package-under-test.

**Rationale**: The harness must be versioned with the release while the installation under test must remain the public GitHub path. This explicitly prevents checkout binaries, local packs, and local fixtures from satisfying the smoke.

## Decision: Centralize lifecycle and assertions in a Node built-in harness

**Decision**: Add `scripts/smoke-tagged-install.mjs` using Node built-ins and explicit CLI arguments. It owns tag parsing, independent contract construction, disposable prefix/cache/config/project lifecycle, remote installation, package-root and CLI discovery, installed runtime checks, preservation checks, prefix comparison, and cleanup. YAML owns platform-specific environment preparation and invokes the harness.

**Rationale**: Existing `tests/utils/disposable-npm.ts` and `tests/acceptance/tagged-install.test.ts` establish the required behavior, but test-only TypeScript utilities cannot be invoked directly by the tag workflow. A small dependency-free script avoids duplicated fragile YAML while preserving the local fixture test as network-free coverage.

## Decision: Use explicit platform isolation

**Decision**: Ubuntu smoke creates temporary `HOME`, isolated npm userconfig/cache/prefix, disables system/global Git config, disables Git prompting, and removes inherited personal SSH/GitHub credential paths and Git config environment overrides while preserving the process-scoped auth variables. It does not install or authenticate `gh`, create keys, or configure SSH. Windows uses a disposable prefix/cache/userconfig, a project path containing spaces, absolute `changebudget.cmd` execution, and the same workflow-token-only process-scoped auth model.

**Rationale**: Environment isolation must prove independence from developer credentials while allowing the minimum ephemeral repository credential required by a private GitHub repository. Prefix discovery before and after installation proves the real global npm prefix was not changed.

## Decision: Use process-scoped Git runtime authentication

**Decision**: The repository remains private. Tagged smoke uses only the GitHub Actions-provided `GITHUB_TOKEN` with `contents: read`. The harness derives a Basic authorization header and passes it to the spawned npm process through Git's process-scoped configuration environment: `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`, and `GIT_CONFIG_VALUE_0=Authorization: Basic ...`. The canonical package spec and npm argv remain credential-free.

**Rationale**: Git documents these zero-indexed environment pairs as runtime configuration that overrides config files, and `http.extraHeader` supplies the HTTPS header. The environment is inherited by npm and its Git children, disappears when the child exits, and does not require a credential helper, persistent file, tokenized URL, npmrc entry, or global Git mutation. It is the smallest secure boundary for both Windows and Ubuntu. Unit tests must verify Node -> npm -> Git environment propagation with a local fake process chain; the real tag smoke is the end-to-end private-repository proof.

**Security rules**: Never write the raw or encoded token to a URL, argument, file, npmrc, Git config, log, error, or returned diagnostic. Expose `GITHUB_TOKEN` only on the workflow harness invocation step. If platform testing shows that npm or Git does not inherit the environment on Windows, stop and reassess a temporary Git-native mechanism rather than changing the canonical package contract.

**Alternatives considered**:
- Tokenized HTTPS URL: rejected because it leaks into process arguments, npm diagnostics, or package-spec assertions.
- `credential.helper store` or temporary credential file: rejected because it creates persistent secret material and cleanup risk.
- `git config --global`/local config mutation: rejected because it changes host configuration and expands cleanup scope.
- SSH or `gh`: rejected by scope and because they are unnecessary for HTTPS read-only access.

## Decision: Use fresh tagged-smoke caches and optional normal-CI npm cache

**Decision**: Normal CI may use `setup-node` npm caching keyed by the root lockfile; cache hits are never required for correctness. Tagged smoke uses a fresh disposable npm cache for every job.

**Rationale**: Normal CI benefits from deterministic lockfile-keyed dependency caching. Fresh tagged-smoke caches reduce the chance that a prior cache masks public Git installation behavior.

## Decision: Use asymmetric concurrency and fixed timeouts

**Decision**: Normal CI uses a concurrency group based on workflow and pull-request number or branch ref with `cancel-in-progress: true`. Tagged smoke uses a group containing the immutable tag ref with `cancel-in-progress: false`, allowing each tag validation to finish independently. Set normal matrix jobs to 20 minutes and tagged-smoke jobs to 15 minutes.

**Rationale**: Superseded PR/push work is wasteful, while cancelling an immutable release validation could leave release status unknown. The limits are comfortably above the current install/build/test durations without permitting hung jobs indefinitely.

## Decision: Keep diagnostics minimal

**Decision**: Use command output and explicit failure messages as the initial diagnostics. Do not upload temporary smoke directories or workflow artifacts, because they can contain project data and cleanup failures must remain visible. Never print complete environment variables.

**Rationale**: The existing project favors local, readable failures and no sensitive state. Artifact upload adds complexity without a demonstrated diagnostic gap.

## Decision: Require a future real tag for final SPEC-012 acceptance

**Decision**: Implementation can merge after normal CI is green, but SPEC-012 remains final-acceptance-pending until a real immutable public `v*` tag triggers and passes both Windows and Ubuntu smoke jobs. Existing manual v1.1.3 evidence does not count for the new workflow.

**Rationale**: The feature exists to validate the actual workflow path, so a local or historical result cannot prove that the new tag-triggered automation works. A future “public tag” means a real tag pushed to this private GitHub repository, not a public repository.
