# Feature Specification: Cross-Platform CI and Release Smoke

**Feature Branch**: `012-cross-platform-ci-release-smoke`
**Created**: 2026-08-22
**Status**: Draft
**Input**: User description: "Create SPEC-012: Cross-Platform CI & Release Smoke for deterministic Windows/Linux CI and immutable-tag installation smoke."

## Problem Statement

Local and unit acceptance cannot fully detect platform differences in Git-based npm installation. SPEC-011 incidents showed that Windows and Linux can resolve the same Git package reference differently, and that a release can appear valid locally while its real immutable tag fails for users. The repository is private, so tagged smoke must validate the actual GitHub tag with only ephemeral workflow-scoped read access while remaining independent of developer credentials.

## Clarifications

### Session 2026-08-22

- Q: In normal pull-request and `master` push CI, should release-gate validation run against the repository's real package version while explicitly skipping only the existing-tag availability check? → A: Use an explicit CI-safe gate mode against the real package version; skip only existing-tag availability checks and do not synthesize a release version.
- Q: Should the tagged-install smoke harness independently construct and assert the canonical HTTPS package spec and npm argument order, while separate contract tests compare those values with `buildPackageSpec()` and `buildNpmArgs()`? → A: Keep independent exact contract assertions in the smoke boundary and compare them against production helpers in separate tests.
- Q: Should the tagged-smoke workflow check out the tagged repository only to obtain the shared smoke harness and contract documentation, while requiring every installation and CLI assertion to use the actual remote GitHub tag? → A: Check out the exact tag for harness and documentation access only; install from the remote HTTPS tag and execute only the installed CLI from the disposable prefix.
- Q: Should SPEC-012 remain pending final acceptance until both Windows and Ubuntu tagged-smoke jobs pass against at least one actual immutable tag event in the private repository, even after the workflow implementation is merged? → A: Require one actual immutable tag event to pass both Windows and Ubuntu smoke jobs; “public tag” means a real repository tag pushed to GitHub, not a public repository, and no tag should be created solely to satisfy SPEC-012.
- Q: Given that `Edulynch/Opencode-ChangeBudget` remains private, may tagged smoke use the ephemeral workflow-provided read-only `GITHUB_TOKEN` only at a separate Git authentication boundary while keeping the package spec and npm argv credential-free? → A: Yes; use only `GITHUB_TOKEN` with `contents: read` through process-scoped `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` `http.extraHeader` configuration, never embed it in the package spec or npm arguments, and keep PAT, custom secrets, SSH, and `gh` out of scope.

## User Scenarios & Testing

### User Story 1 - Validate Every Change on Windows and Linux (Priority: P1)

As a maintainer, I want pull requests and pushes to `master` validated on Windows and Ubuntu with the supported toolchain so that cross-platform packaging, runtime, and regression failures are detected before release work begins.

**Why this priority**: This is the earliest and broadest prevention point for regressions and protects every change, not only release tags.

**Independent Test**: Submit a change or push to `master` and confirm both required platform jobs complete dependency installation, typecheck, build, full tests, package validation, release-gate validation, and runtime tracking checks successfully.

**Acceptance Scenarios**:

1. **Given** a pull request or push to `master`, **when** the validation run starts, **then** it executes on exactly `windows-latest` and `ubuntu-latest` with Node 24.18.0 and npm 11.16.0 explicitly selected.
2. **Given** either platform job, **when** validation completes, **then** dependency installation, typecheck, build, `npm test`, package dry-run, release-gate checks, and tracked-runtime checks all pass or the job fails.
3. **Given** a normal CI run, **when** it finishes, **then** it has not created or changed tags, pushed, published a release, modified repository files, used `gh` authentication, or required SSH credentials.
4. **Given** newer superseding commits for the same pull request or branch, **when** CI is already running, **then** obsolete runs are cancelled without weakening the required validation of the newest run.

---

### User Story 2 - Validate the Actual Immutable Release Tag (Priority: P1)

As a release maintainer, I want a separate Windows and Ubuntu smoke run to install the exact tag that GitHub published so that release defects are detected from the same remote HTTPS path users will use.

**Why this priority**: A successful checkout, local fixture, or package archive does not prove that the immutable remote Git tag installs correctly from this private repository.

**Independent Test**: Push an immutable `v*` tag and confirm the tag-triggered run derives that tag from the event ref, authenticates Git over HTTPS using only the workflow-provided read-only token, installs it in disposable environments, and passes all installed CLI and integration checks on both platforms.

**Acceptance Scenarios**:

1. **Given** a push of an immutable tag matching `v*`, **when** the smoke workflow starts, **then** it runs on Windows and Ubuntu and derives the package tag from the GitHub event ref rather than a hard-coded version.
2. **Given** the smoke workflow on either platform, **when** it installs the package, **then** it uses the canonical scripts-disabled HTTPS Git package spec and the exact required npm argument order.
3. **Given** a successful installation, **when** the installed CLI is exercised from a disposable project and prefix, **then** package metadata, the CLI runtime, Runtime Guard, version, help, `init`, integration, wrapper, and project-preservation checks pass.
4. **Given** a tag whose installed package version differs from the tag without its leading `v`, **when** smoke validation compares them, **then** the platform job fails.
5. **Given** a smoke failure, **when** the workflow ends, **then** it does not move, delete, recreate, or repair the tag and does not publish a GitHub Release.

---

### User Story 3 - Prove Private Installation Independence and Contract Consistency (Priority: P1)

As a maintainer, I want the release smoke and repository checks to prove that private-repository installation is independent of developer credentials and consistent with self-update, local acceptance, release-gate expectations, and documentation.

**Why this priority**: The v1.1.2 Linux incident was caused by transport resolution, not by the application runtime, so private installation must use only ephemeral workflow access and must not depend on personal credentials.

**Independent Test**: Run the Ubuntu smoke with isolated home, Git, GitHub CLI, SSH, Git, and npm configuration, expose only the workflow-provided read-only token to the temporary Git authentication boundary, then inspect contract assertions across all supported surfaces.

**Acceptance Scenarios**:

1. **Given** a clean Ubuntu smoke environment, **when** the private tag is installed, **then** temporary HOME, absent SSH and GitHub CLI configuration, isolated Git configuration, non-interactive Git prompting, isolated npm user configuration, and temporary read-only `GITHUB_TOKEN` Git authentication are active; the install must not depend on personal credentials.
2. **Given** a Windows smoke environment, **when** the private tag is installed, **then** disposable prefix/cache and isolated npm configuration are used, paths containing spaces are supported, the installed `changebudget.cmd` is executed rather than any checkout binary, and access uses only the workflow-provided read-only token.
3. **Given** any supported contract surface, **when** its package spec and npm arguments are checked, **then** HTTPS transport, immutable tag syntax, and `install`, `-g`, `--ignore-scripts`, `--allow-git=all`, `--install-links=true`, package-spec ordering are identical.
4. **Given** the smoke project initially contains unrelated `opencode.json` fields and `AGENTS.md`, **when** integration runs, **then** those unrelated fields and the file bytes remain unchanged while the expected ChangeBudget instruction entry is added.

---

### Edge Cases

- A runner's preinstalled npm version differs from the supported version; validation must explicitly select npm 11.16.0 before dependency installation.
- The current package version tag already exists during normal CI; release-gate validation must support read-only CI mode without attempting to create or alter tags.
- Build output is stale, missing, ignored, untracked, or contains forbidden test/duplicate plugin output; the relevant job must fail with an actionable result.
- The tag ref is malformed, lacks a `v` prefix, or does not map to a strict package version; tagged smoke must fail before installation or version acceptance.
- GitHub is unavailable, the repository is inaccessible, or network installation fails; the smoke job must fail rather than substitute a checkout, package archive, or local fixture.
- The installed wrapper is absent or points outside the installed Runtime Guard package; the smoke job must fail.
- A test or cleanup operation mutates the real global npm prefix, leaves disposable resources behind, or changes protected project content; the job must fail.
- A required Windows or Ubuntu matrix job fails; the workflow must fail and must not hide the failure with continue-on-error.
- macOS is not part of this feature; existing POSIX-compatible automated coverage may remain, but no physical macOS CI result is required or claimed.

## Requirements

### Functional Requirements

- **FR-001**: The project MUST run normal validation on pull requests and pushes to `master`.
- **FR-002**: Normal validation MUST cover `windows-latest` and `ubuntu-latest` as required matrix platforms and MUST NOT add macOS.
- **FR-003**: Each normal-validation platform MUST explicitly use Node 24.18.0 and npm 11.16.0, not the runner defaults.
- **FR-004**: Each normal-validation platform MUST install dependencies and run typecheck, build, the full test suite, package dry-run validation, CI-safe release-gate validation against the repository's real package version, runtime zero-drift validation, and required/forbidden artifact tracking validation.
- **FR-005**: Normal validation MUST treat any required platform or validation failure as a workflow failure and MUST NOT use continue-on-error for required checks.
- **FR-006**: Normal validation MUST use least-privilege repository permissions, with read-only contents access unless a documented requirement proves stronger access is necessary.
- **FR-007**: Normal validation MUST NOT create, move, delete, or push tags; publish releases; mutate repository content; modify package versions; require `gh` authentication; or require SSH credentials.
- **FR-008**: Normal validation MUST NOT use the runner's real global npm installation for project or ChangeBudget state.
- **FR-009**: Normal pull-request and push validation MUST cancel superseded runs for the same change without suppressing the newest run's required matrix jobs.
- **FR-010**: A separate release-smoke validation MUST run on pushes of tags matching `v*` and MUST use the same Windows/Linux platform matrix.
- **FR-011**: Release smoke MUST derive the tested tag from the GitHub tag event ref and MUST compare the installed package version to that tag without its leading `v`.
- **FR-012**: Release smoke MUST install the actual remote tag from the private GitHub repository using the canonical HTTPS Git package spec, scripts-disabled flags, Git allowance, install-links flag, and exact argument order; repository authentication MUST be prepared separately from package-spec construction using only process-scoped Git runtime configuration derived from `GITHUB_TOKEN`.
- **FR-013**: Release smoke MAY check out the exact event tag for harness and contract-document access, but MUST NOT use that checkout, a checkout package archive, or a local Git fixture as the remote tag installation source; installation and CLI assertions MUST use the remote HTTPS tag and disposable prefix.
- **FR-014**: Release smoke MUST use disposable npm prefix, npm cache, user configuration, and test project resources and MUST clean them after validation.
- **FR-015**: Release smoke MUST execute the installed CLI from the disposable prefix and MUST verify installed `package.json`, `dist/src/cli/index.js`, Runtime Guard entrypoint, `--version`, `--help`, `init`, and `integrate opencode`.
- **FR-016**: Release smoke MUST verify that `AGENTS.md` remains byte-identical, unrelated `opencode.json` fields remain preserved, the expected ChangeBudget instruction entry is added, the wrapper exists, and the wrapper references the installed Runtime Guard.
- **FR-017**: Release smoke MUST verify that the real global npm prefix remains unchanged and that disposable resources are removed; cleanup or isolation failures MUST fail the job.
- **FR-018**: Ubuntu release smoke MUST use temporary HOME, no developer SSH or GitHub CLI configuration, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, isolated npm user configuration, and no inherited personal/global Git credentials; it MAY expose only the workflow-provided read-only `GITHUB_TOKEN` through process-scoped Git HTTPS authentication and MUST not install or authenticate `gh` or configure SSH.
- **FR-019**: Windows release smoke MUST use disposable prefix/cache and isolated npm user configuration where supported, execute the installed `changebudget.cmd`, preserve the real global prefix, and support paths containing spaces.
- **FR-020**: Required shared smoke behavior MUST be centralized in a maintainable repository-local validation boundary where practical, with platform-specific logic limited to genuine executable/path/configuration differences.
- **FR-021**: Contract checks MUST independently assert the exact canonical transport and npm argument order in the smoke boundary, then separately compare those values with production `buildPackageSpec()` and `buildNpmArgs()` plus public documentation, local tagged-install acceptance, and release-gate expectations.
- **FR-022**: Release smoke MUST never create, move, delete, force-update, or repair tags; change package metadata; create another version; push; or publish a GitHub Release.
- **FR-023**: GitHub Release publication MUST remain a manual maintainer action after normal CI, release preparation, gate validation, immutable tag creation, and successful Windows/Linux tagged smoke.
- **FR-024**: Workflows MUST use explicit timeouts, official actions where actions are needed, no unnecessary third-party actions, and no cache behavior whose correctness determines test outcome.
- **FR-025**: Workflows and shared validation MUST NOT print tokens, credentials, package specs containing credentials, or sensitive environment variables, and MUST NOT enable shell tracing that could expose temporary authentication configuration.

### Non-Functional Requirements

- **NFR-001**: Validation MUST be deterministic for a given source revision, immutable tag, platform, and pinned toolchain, apart from explicitly reported external network failures.
- **NFR-002**: CI MUST remain network-free after dependency installation; only the tagged smoke may access the private GitHub repository for the actual immutable-tag install.
- **NFR-003**: The workflow design MUST make required platform coverage and failure status visible without hidden skips or best-effort behavior.
- **NFR-004**: The canonical installation contract MUST have one authoritative construction boundary and independent exact-value assertions to prevent future transport or flag drift.
- **NFR-005**: The feature MUST add no runtime service, PAT, custom repository secret, personal token, SSH key, publishing automation, rollback automation, or unrelated release infrastructure; the ephemeral workflow-provided `GITHUB_TOKEN` with `contents: read` is the only permitted tagged-smoke credential.
- **NFR-006**: The validation MUST preserve the repository's existing local-first behavior and must not make GitHub Actions a runtime dependency.

### Key Entities

- **CI Validation Run**: A pull-request or `master` push validation with source revision, trigger, platform, pinned toolchain, required checks, and outcome.
- **Release Smoke Run**: A tag-triggered private-repository installation validation with immutable tag, resolved package version, platform, isolated environment, smoke assertions, cleanup result, and outcome.
- **Canonical Install Contract**: The shared HTTPS package specification, immutable tag format, and ordered npm arguments used by documentation, self-update, local acceptance, release gate, and release smoke.
- **Disposable Smoke Environment**: Temporary npm prefix/cache/configuration and test project whose paths, preserved content, and cleanup state are validated.

## Platform Matrix

| Validation | Windows | Ubuntu/Linux | macOS |
|---|---:|---:|---:|
| Pull-request/push CI | Required | Required | Out of scope |
| Immutable-tag public install smoke | Required | Required | Out of scope |
| Node.js | 24.18.0 | 24.18.0 | Not applicable |
| npm | 11.16.0 | 11.16.0 | Not applicable |
| Credential-isolation proof | Windows developer-credential isolation | Developer-credential isolation plus workflow-token-only repository access | Not applicable |

## Release Lifecycle

1. Pull-request or `master` push CI passes on Windows and Ubuntu.
2. A maintainer prepares the release commit and confirms the release gate passes.
3. A maintainer creates the immutable release tag.
4. The tag-triggered smoke installs that actual remote tag on Windows and Ubuntu using only ephemeral read-only workflow access.
5. Both tagged smoke jobs pass, including installed version, Runtime Guard, integration, preservation, isolation, and cleanup checks.
6. The maintainer manually publishes the GitHub Release as Latest.

A tagged smoke failure identifies a defective immutable release. The workflow must report the failure and must not mutate the tag or attempt an automatic repair; a new patch release is required.

## Scope

### In Scope

- Windows/Linux pull-request and `master` push CI validation.
- Immutable `v*` tag private-repository installation smoke on Windows/Linux.
- Shared cross-platform smoke validation boundary where needed to prevent duplicated contract logic.
- CI-specific regression and contract-consistency checks.
- CI, release-smoke, and maintainer release-lifecycle documentation.
- Explicit credential, permission, isolation, cleanup, and failure behavior.

### Out of Scope

- macOS runners or physical macOS release smoke.
- npm 12 support.
- npmjs publication, automatic semantic versioning, automatic tag creation, tag repair, rollback, or automatic GitHub Release publication.
- Docker release systems, signing, notarization, coverage services, Dependabot, branch-protection configuration, telemetry, or custom repository secrets.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every pull request and every push to `master` produces required Windows and Ubuntu results using Node 24.18.0 and npm 11.16.0, with no required platform hidden or skipped.
- **SC-002**: For 100% of normal CI platform runs, dependency installation, typecheck, build, 526-test-equivalent full regression coverage, package validation, release-gate validation, runtime zero-drift, and artifact tracking checks are executed and their failures fail the job.
- **SC-003**: For 100% of immutable `v*` tags, release smoke attempts the actual remote HTTPS tag installation on both Windows and Ubuntu without substituting a local artifact or fixture, using only process-scoped ephemeral workflow-provided read-only GitHub access; SPEC-012 final acceptance additionally requires at least one actual immutable tag event in this private repository to complete both required smoke jobs successfully.
- **SC-004**: Both tagged smoke platforms verify that installed version equals the tag version, the CLI and Runtime Guard execute, `init` and integration pass, project preservation passes, wrapper linkage passes, and disposable resources are cleaned.
- **SC-005**: 100% of Ubuntu tagged smoke runs pass with no personal SSH keys, no GitHub CLI configuration, no inherited personal/global Git credentials, temporary HOME, isolated Git configuration, non-interactive Git prompting, isolated npm user configuration, and only the workflow-provided read-only `GITHUB_TOKEN` available to the temporary Git authentication boundary.
- **SC-006**: Contract-consistency checks detect any mismatch in HTTPS transport, immutable tag syntax, or ordered npm flags across production self-update, public documentation, local acceptance, release smoke, and release-gate expectations before the change is accepted.
- **SC-007**: 100% of required workflow runs demonstrate no tag mutation, push, release publication, package-version mutation, credential disclosure, or real-global-npm mutation.
- **SC-008**: The intended release lifecycle remains manual at the publication step, with GitHub Release creation occurring only after both Windows and Ubuntu tag-smoke jobs pass.

## Assumptions

- `Edulynch/Opencode-ChangeBudget` remains private for now; tagged smoke uses only an ephemeral workflow-provided `GITHUB_TOKEN` with `contents: read` at a separate Git authentication boundary.
- The canonical package spec and npm argv never contain credentials. If the repository becomes public later, authentication can be removed from release-smoke without changing the canonical HTTPS package spec, npm argv, or smoke assertions.
- `master` remains the main development branch for normal CI triggers.
- Node 24.18.0 and npm 11.16.0 remain available for the supported SPEC-012 validation contract.
- Normal CI uses an explicit release-gate mode that skips only existing local/remote tag-availability checks while retaining all package, version, runtime, tracking, package-content, and zero-drift checks.
- Existing production helpers remain the updater implementation source, while the smoke boundary retains independent exact-value assertions and separate comparison tests prevent a shared implementation from hiding contract regressions.
- The repository tag is immutable before the tag-smoke workflow runs; workflow success does not establish tag mutability or authorize release publication.
- Network access is permitted only where needed for dependency installation and the actual remote tag smoke installation; normal test assertions remain local and deterministic.

SPEC-012 may be merged after its normal CI implementation is validated, but final acceptance remains pending until a future immutable `v*` tag event in this private repository passes both required tagged-smoke jobs. “Public tag” means a real repository tag pushed to GitHub, not a public repository. Existing manual v1.1.3 evidence does not satisfy this criterion, and no tag is created solely to satisfy it.
