# Feature Specification: Prebuilt Tagged Installation Reliability (SPEC-011)

**Feature Branch**: `011-prebuilt-tagged-install`

**Created**: 2026-08-21

**Status**: Draft

**Input**: User description: "Create SPEC-011 as a focused hotfix for ChangeBudget tagged installation reliability. Stable GitHub tags must contain prebuilt runtime artifacts so installation and self-update work with scripts disabled."

## Problem Statement

SPEC-010 made stable Git tags the public installation and self-update source. Release v1.1.0 demonstrated that a Git dependency can report a successful prepare build while the final globally installed package lacks the compiled CLI entrypoint. The resulting executable fails with `MODULE_NOT_FOUND`.

The source and build are valid, and `npm pack` produces a complete package. The unreliable boundary is therefore the user's direct global installation of a Git dependency whose runtime files exist only after an install-time lifecycle build. SPEC-011 makes the tagged commit itself executable by requiring the compiled runtime to be present in the immutable release commit and by disabling installation scripts in the documented flow.

## Scope

This hotfix changes only the tagged-package artifact and installation mechanism required to make SPEC-010 reliable. It includes release artifact tracking, deterministic release validation, the public installation command, self-update invocation, and acceptance evidence for scripts-disabled installation.

It does not change ChangeBudget policy behavior, project integration behavior, update selection rules, or the Runtime Guard contract except where required to resolve the packaged prebuilt path.

## User Scenarios & Testing

### User Story 1 - Install a working tagged CLI (Priority: P1)

As a ChangeBudget user, I want to install an immutable stable GitHub tag without running a build on my machine, so that the global `changebudget` command is executable immediately after npm completes.

**Why this priority**: A successful installation that produces a broken executable is a release-blocking defect and prevents all other ChangeBudget workflows.

**Independent Test**: In a disposable npm prefix, install a locally tagged or public stable source using the documented command with scripts disabled, then verify the installed CLI, version, help, Runtime Guard, `init`, and OpenCode integration.

**Acceptance Scenarios**:

1. **Given** a stable immutable tag, Node.js 20+, and npm `>=11.9 <12`, **when** a user runs `npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z`, **then** the installed `changebudget` executable runs without compiling source files and reports `X.Y.Z`.
2. **Given** the same installation on Windows with paths containing spaces, **when** the user runs `changebudget --help` and `changebudget integrate opencode`, **then** both commands succeed and the packaged Runtime Guard is resolved.
3. **Given** the same installation on Linux or macOS, **when** the user runs the CLI and integration commands, **then** they produce the same functional result without lifecycle scripts.

---

### User Story 2 - Update from a prebuilt compatible tag (Priority: P1)

As a ChangeBudget user, I want self-update to use the same scripts-disabled tagged installation strategy, so that an automatic compatible update cannot recreate the v1.1.0 packaging failure.

**Why this priority**: An update path that uses a different installation strategy would leave the same production defect reachable after the hotfix.

**Independent Test**: With a disposable global installation and deterministic tag metadata, run `changebudget update` for a newer same-major tag and verify npm receives the scripts-disabled Git-tag command, the new CLI works, and the target project is unchanged.

**Acceptance Scenarios**:

1. **Given** a validated newer same-major stable tag, **when** `changebudget update` runs, **then** it delegates installation using `--ignore-scripts --allow-git=all --install-links=true` and the explicit immutable tag, and the installed CLI reports the target version.
2. **Given** only a newer major stable tag, **when** `changebudget update` or `changebudget update --check` runs, **then** no installation occurs and the existing SPEC-010 manual-major behavior and exit codes are preserved.
3. **Given** an update from a project with existing SPEC-009 integration, **when** the update completes, **then** no project files are changed and the packaged Runtime Guard remains usable.

---

### User Story 3 - Release a self-contained stable tag (Priority: P1)

As a release maintainer, I want a deterministic pre-tag gate that verifies source, version, and compiled runtime agreement, so that no stable tag can be published with missing or mismatched runtime artifacts.

**Why this priority**: The release tag is the installation boundary; its contents must be independently reviewable and sufficient for execution.

**Independent Test**: Run the release gate against a release candidate, then inspect the resulting commit and tag. The gate must reject missing artifacts, stale artifacts, version/tag mismatch, or a tag that is already assigned.

**Acceptance Scenarios**:

1. **Given** a release candidate with a valid package version, **when** the build and release gate complete before tagging, **then** the same commit contains all required JavaScript runtime artifacts and `package.json` reports the tag's exact version.
2. **Given** missing, ignored, stale, or inconsistent runtime artifacts, **when** the release gate runs, **then** it fails before a release tag is created.
3. **Given** an existing stable tag such as `v1.1.0`, **when** a maintainer attempts to move or recreate it, **then** the release process refuses and leaves the existing tag unchanged.

### Edge Cases

- A tag is not exactly `vMAJOR.MINOR.PATCH`; it is rejected as a release and never selected for installation or update.
- `package.json` has a version different from the tag; the release gate and tag/package integrity validation reject it.
- `dist/src/cli/index.js` is present but a transitive runtime module is missing; the release gate rejects the candidate.
- The Runtime Guard entrypoint is missing from `opencode-plugin/dist/**`; the release gate rejects the candidate.
- Required `dist/**` files are ignored or untracked; the release gate rejects the candidate rather than relying on local files.
- `npm install` is invoked with `--ignore-scripts`; installation still produces an executable package.
- `--allow-git=all` or `--install-links=true` is absent or unsupported; npm failure is surfaced without fallback to scripts or a mutable branch.
- The package spec uses `github:` shorthand or resolves through SSH; the public contract rejects it in favor of HTTPS.
- npm is older than 11.9; it is outside the validated SPEC-011 installation contract because `--allow-git` is unavailable.
- npm is version 12 or newer; it is outside this hotfix until the final prebuilt installation flow is separately validated.
- GitHub is unreachable during update discovery; existing update failure and exit behavior are preserved.
- A release tag is immutable but its package contents are incomplete; installation fails validation rather than silently rebuilding.
- Windows paths, POSIX paths, and paths containing spaces must remain supported.
- Automated tests must never mutate the developer's real global npm prefix.

## Requirements

### Installation Requirements

- **FR-001**: The documented public installation command MUST be `npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z` with an explicit stable tag.
- **FR-001a**: For the planned v1.1.2 corrective release, the supported npm range MUST be `>=11.9 <12`; npm versions before 11.9 are outside the validated installation contract, and npm 12 is unverified and outside this corrective release.
- **FR-002**: Installation MUST accept only an exact stable tag matching `vMAJOR.MINOR.PATCH`; it MUST NOT use `master`, `main`, `latest`, an untagged commit, or a prerelease alias.
- **FR-003**: A successful scripts-disabled installation MUST make the `changebudget` executable immediately available without compiling TypeScript or running any lifecycle script on the user's machine.
- **FR-004**: Installation MUST work without npmjs publication, a custom installer, curl, PowerShell, shell scripts, or a custom package manager.
- **FR-005**: `--allow-git=all` MUST be passed as an invocation-scoped npm option in the public installation command and equivalent self-update command.
- **FR-005a**: `--install-links=true` MUST be passed as an invocation-scoped npm option in the public installation command and equivalent self-update command.
- **FR-005b**: The public package spec MUST use `git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z`; `github:` shorthand, SSH transport, GitHub CLI, SSH keys, and credential helpers MUST NOT be required.
- **FR-006**: Windows, Linux, and macOS POSIX-compatible installation and execution MUST remain supported, including paths containing spaces.
- **FR-007**: Development `npm run build` and `npm run typecheck` functionality MUST remain available; development build capability MUST NOT be removed merely because user installation no longer builds.
- **FR-008**: A `prepare` or other install-time build MUST NOT be required for a user to obtain a working CLI. Package lifecycle behavior MUST remain compatible with `--ignore-scripts`.
- **FR-008a**: The package executable entrypoint MUST point directly to the tracked prebuilt CLI entrypoint so npm does not need a lifecycle script to make the command runnable.

### Release Artifact Requirements

- **FR-009**: Every stable release commit MUST contain `package.json` and all runtime JavaScript required by the CLI under `dist/src/**`.
- **FR-010**: Every stable release commit MUST contain `dist/src/cli/index.js`.
- **FR-011**: Every stable release commit MUST contain `opencode-plugin/dist/opencode-plugin/src/index.js` and all required Runtime Guard JavaScript under `opencode-plugin/dist/**`.
- **FR-012**: Required compiled runtime artifacts MUST be tracked in Git as reviewable release content. The repository ignore configuration MUST NOT leave required release paths dependent on ignored or untracked local files.
- **FR-013**: The release process MUST build the runtime before creating a release tag.
- **FR-014**: The compiled runtime in the release commit MUST correspond to the source commit and package version being tagged.
- **FR-015**: A deterministic release validation gate MUST fail before tagging when required artifacts are missing, stale, untracked, ignored, or inconsistent with the source/version under release.
- **FR-016**: `package.json.version` MUST exactly match the stable tag without the leading `v`.
- **FR-017**: Stable release tags MUST be immutable. The release process MUST refuse to move, overwrite, or recreate an existing stable tag.
- **FR-018**: Release artifact preparation MUST be manual and deterministic unless later specification analysis proves automation strictly necessary; SPEC-011 MUST NOT add CI/CD release automation.
- **FR-019**: Versions `v1.1.0`, `v1.1.1`, and `v1.1.2` MUST remain immutable and MUST NOT be moved or rewritten. The intended corrective release is `v1.1.3`, but SPEC-011 generation MUST NOT create that tag.

### Self-Update Requirements

- **FR-020**: `changebudget update` MUST use the equivalent of `npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z` for every validated compatible target tag.
- **FR-021**: Self-update MUST preserve SPEC-010 same-major automatic update selection, exact stable tag filtering, tag/package version integrity validation, and major-update informational/manual behavior.
- **FR-022**: Self-update MUST preserve SPEC-010 exit codes, Windows/Linux/macOS subprocess strategies, actionable failure handling, and no-project-mutation behavior.
- **FR-023**: Self-update MUST NOT compile source, invoke a user-machine prepare/build lifecycle, install from a mutable reference, or automatically integrate OpenCode.
- **FR-024**: Update discovery MUST continue to skip prerelease, malformed, aliased, and tag/package-version-mismatched candidates.

### Runtime Guard and Compatibility Requirements

- **FR-025**: After scripts-disabled installation from a valid stable tag, `changebudget integrate opencode` MUST resolve the packaged Runtime Guard without a separate Runtime Guard installation.
- **FR-026**: The installed CLI MUST preserve `--version`, `--help`, `init`, and SPEC-009 integration behavior.
- **FR-027**: SPEC-001 through SPEC-010 behavior MUST remain unchanged except for the installation packaging and self-update invocation changes explicitly required by this specification.
- **FR-028**: No new runtime dependency, telemetry, background updater, automatic major update, or unrelated OpenCode integration behavior may be introduced.

### Acceptance and Release Evidence Requirements

- **FR-029**: The primary automated acceptance test MUST install a tagged source with `npm install -g --ignore-scripts --allow-git=all --install-links=true` and MUST NOT use a synthetic prepare sentinel as proof of installation.
- **FR-030**: The acceptance test MUST use a disposable global npm prefix and verify that the real global npm prefix is unchanged after cleanup.
- **FR-031**: The acceptance test MUST verify `changebudget --version`, `changebudget --help`, the packaged Runtime Guard, `changebudget init`, and `changebudget integrate opencode`.
- **FR-032**: The acceptance test MUST verify preservation of unrelated project fields, byte-identical `AGENTS.md`, paths containing spaces, and cleanup.
- **FR-033**: Before a release is considered valid, maintainers MUST manually run the exact documented public HTTPS command for the immutable tag with supported npm `>=11.9 <12` in an isolated npm prefix and record the result as release evidence. This smoke test need not run in the normal automated suite.
- **FR-034**: Windows and Linux MUST be validated with real executions before the hotfix release; macOS MUST retain POSIX-compatible coverage.
- **FR-035**: Automated installation and update tests MUST not access the network or mutate the developer's real global npm installation.

## Key Entities

- **ReleaseCommit**: The source commit containing the matching package version and tracked compiled runtime artifacts before a stable tag is created.
- **StableReleaseTag**: An immutable Git tag exactly matching `vMAJOR.MINOR.PATCH` and pointing to a validated ReleaseCommit.
- **PackagedRuntime**: The tracked JavaScript CLI and Runtime Guard files required for execution without user-machine compilation.
- **ReleaseValidationResult**: A deterministic pass/fail result covering artifact presence, tracking, source/build correspondence, package version, and tag immutability.
- **UpdateInstallInvocation**: The validated stable-tag npm installation request used by `changebudget update`, including scripts-disabled and Git-allowance options.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In Windows and Linux real executions using supported npm `>=11.9 <12`, 100% of tested valid stable tags install a working `changebudget` executable with scripts disabled and no user-machine compilation.
- **SC-002**: In the primary automated acceptance test, `changebudget --version`, `--help`, `init`, and `integrate opencode` all succeed from the installed tagged package, with 0 writes to the real global npm prefix.
- **SC-003**: Every release candidate rejected for a missing, untracked, stale, or inconsistent required artifact fails the release gate before tag creation.
- **SC-004**: For every validated compatible update scenario, the update invocation contains the same immutable-tag, scripts-disabled installation options as the public installation command, with 0 target-project mutations.
- **SC-005**: `package.json.version` and the stable tag version match exactly for 100% of release validation cases; `v1.1.0` remains unchanged.
- **SC-006**: SPEC-010 stable-tag filtering, same-major selection, integrity checks, exit codes, and manual-major behavior pass without regression.
- **SC-007**: Release maintainers can complete the deterministic build, validation, and tag-readiness procedure without CI/CD automation or undocumented local-file assumptions.
- **SC-008**: The release evidence explicitly validates npm `>=11.9 <12`; npm 12 is not claimed as supported until separately tested with the final prebuilt installation flow.

## Assumptions

- Stable release tags are created by maintainers after a clean, reviewable release commit; SPEC-011 does not create `v1.1.3`.
- Compiled runtime artifacts are intentionally tracked in release commits so a cloned or downloaded tag contains the executable runtime; development workflows may continue to regenerate them.
- For v1.1.3, Node.js 20+ remains required and npm `>=11.9 <12` is the supported SPEC-011 range because `--allow-git` is available beginning with npm 11.9.0. npm versions before 11.9 are outside the validated contract.
- npm 11.16.0 is the real Windows environment currently validated. npm 12 support is unverified and outside this corrective release until separately validated.
- GitHub remains the public source of stable tags and npm remains the package installer; no npmjs publication is required.
- Release validation may use local Git and filesystem inspection, while the public smoke test separately validates the actual GitHub tag.
- Existing SPEC-009 project files and Runtime Guard behavior are the compatibility baseline.

## Non-Goals

- Moving or rewriting `v1.1.0`.
- Creating the `v1.1.3` tag during specification, planning, implementation, or automated validation.
- Publishing ChangeBudget to npmjs.
- Adding CI/CD release automation unless a future analysis proves it strictly necessary.
- Adding curl, PowerShell, shell installers, custom package managers, telemetry, background updates, or automatic major updates.
- Changing ChangeBudget policy semantics, project mutation rules, or new OpenCode integration behavior.
