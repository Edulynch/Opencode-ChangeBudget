# Feature Specification: Tagged Installation & Self-Update (SPEC-010)

**Feature Branch**: `010-tagged-install-self-update`

**Created**: 2026-08-19

**Status**: Complete

**Input**: User description: "Make ChangeBudget easy to install and update for non-technical users, with the primary installation source being stable GitHub tags/releases rather than the master branch or a published npm package."

## Problem Statement

ChangeBudget Personal v1.0 is a local-first, deterministic CLI tool. Currently, users must build from source via `npm link` or clone the repository and run `npm run build` manually. This creates friction for non-technical users who want a simple one-command installation and a straightforward way to keep ChangeBudget updated.

The intended user experience is:

1. **Install once** from a stable GitHub tag:
   `npm install -g github:Edulynch/Opencode-ChangeBudget#vX.Y.Z`

2. **Inside a project**:
   `changebudget init`
   `changebudget integrate opencode`

3. **Open OpenCode and use it normally** — the LLM follows the ChangeBudget workflow automatically through the existing SPEC-009 project instructions and Runtime Guard.

4. **Keep ChangeBudget updated** through:
   `changebudget update --check`
   `changebudget update`

This feature adds self-contained installation and self-update capabilities that work with stable GitHub tags, without requiring npmjs publication, custom installers, or background processes.

## User Scenarios & Testing

### User Story 1 — One-command global installation from a stable tag (Priority: P1)

As a non-technical user, I want to install ChangeBudget globally with a single npm command pointing to a stable GitHub tag, so that I get a working `changebudget` CLI immediately without cloning the repository or running build commands.

**Why this priority**: Manual build steps are the primary adoption barrier for non-technical users.

**Independent Test**: Testable in an isolated disposable environment: run the install command, verify the CLI executes and reports the correct version, verify the OpenCode Runtime Guard is available for SPEC-009 integration.

**Acceptance Scenarios**:

1. **Given** a clean isolated environment with Node.js 20+ and npm, **When** `npm install -g github:Edulynch/Opencode-ChangeBudget#v1.1.0` completes, **Then** the `changebudget` command is available on PATH, `changebudget --version` reports `1.1.0`, and `changebudget integrate opencode` can locate the Runtime Guard.
2. **Given** a Windows PowerShell environment, **When** the same install command runs, **Then** the CLI works identically (paths with spaces, backslashes handled correctly).
3. **Given** a macOS/Linux environment, **When** the same install command runs, **Then** the CLI works identically.

### User Story 2 — Read-only update check (Priority: P1)

As a ChangeBudget user, I want to check whether a compatible update is available without modifying my system or project, so that I can decide whether to update.

**Why this priority**: Read-only checks build trust and allow informed decisions.

**Independent Test**: Testable in an isolated environment: install a specific version, run `--check`, verify zero filesystem mutations in the target project, verify output reports current version, latest compatible version, and update availability.

**Acceptance Scenarios**:

1. **Given** a project with SPEC-009 integration using ChangeBudget v1.1.0, **When** `changebudget update --check` runs, **Then** it reports: current version, latest compatible same-major version (e.g., v1.2.0), whether an update is available, and exits with code 0. Zero target-project files are modified.
2. **Given** the latest compatible version is already installed, **When** `changebudget update --check` runs, **Then** it reports "already current" and exits with code 0.
3. **Given** only a newer major version exists (e.g., v2.0.0), **When** `changebudget update --check` runs, **Then** it reports the newer major, states that automatic update is not available, and shows the explicit installation command for the major upgrade.
4. **Given** the installed version cannot be determined reliably, **When** `changebudget update --check` runs, **Then** it reports the problem and does not attempt to discover updates.

### User Story 3 — Compatible self-update within the same major version (Priority: P1)

As a ChangeBudget user, I want to update to the latest compatible same-major version with a single command, so that I get fixes and improvements without manual reinstallation.

**Why this priority**: Automatic same-major updates are the core convenience feature.

**Independent Test**: Testable in an isolated environment: install v1.1.0, run `update`, verify v1.2.0 is installed, verify CLI works, verify SPEC-009 integration still functions, verify zero target-project mutations.

**Acceptance Scenarios**:

1. **Given** v1.1.0 is installed and v1.2.0 is the latest stable same-major tag, **When** `changebudget update` runs, **Then** v1.2.0 is installed, `changebudget --version` reports `1.2.0`, the Runtime Guard is available for integration, and the command exits with code 0.
2. **Given** the latest compatible same-major version is already installed, **When** `changebudget update` runs, **Then** it performs a no-op, reports "already current", and exits with code 0.
3. **Given** the update runs from inside a project with existing SPEC-009 integration, **When** `changebudget update` completes, **Then** the integration continues to work (Runtime Guard resolvable, instructions valid), and no project files are modified.

### User Story 4 — Major version upgrade requires explicit user action (Priority: P1)

As a ChangeBudget user, I want to be clearly informed when a new major version exists and shown the exact command to upgrade, so that I can choose when to adopt breaking changes.

**Why this priority**: Silent major upgrades would violate local-first deterministic principles and could break existing workflows.

**Independent Test**: Testable in an isolated environment: install v1.x, simulate v2.0.0 tag existence, run `update --check` and `update`, verify neither performs the major upgrade, verify the explicit install command is shown.

**Acceptance Scenarios**:

1. **Given** v1.2.0 is installed and v2.0.0 is the latest stable tag, **When** `changebudget update --check` runs, **Then** it reports: current v1.2.0, newer major v2.0.0 available, automatic update blocked, and shows: `npm install -g github:Edulynch/Opencode-ChangeBudget#v2.0.0`.
2. **Given** v1.2.0 is installed and v2.0.0 is the latest stable tag, **When** `changebudget update` runs, **Then** it performs no mutation, reports the same information as `--check`, and exits with a non-zero code indicating major upgrade required.

### User Story 5 — Safe failure handling (Priority: P1)

As a ChangeBudget user, I want network, GitHub, and npm failures to produce actionable errors without leaving my system in a broken state, so that I can retry or diagnose the issue.

**Why this priority**: Unreliable networks must not corrupt the installation.

**Independent Test**: Testable in an isolated environment with network failure simulation: run `update --check` and `update`, verify actionable errors, verify no partial mutations, verify existing installation remains intact.

**Acceptance Scenarios**:

1. **Given** GitHub is unreachable, **When** `changebudget update --check` runs, **Then** it reports a network error with actionable guidance and exits with non-zero code.
2. **Given** npm is unavailable or the update subprocess fails, **When** `changebudget update` runs, **Then** it reports the failure, performs no mutation to the global package, and exits with non-zero code.
3. **Given** an interrupted/failed package update, **When** the command is re-run, **Then** it either completes the update cleanly or reports the failure without leaving a partially installed state.

### User Story 6 — Non-technical Quick Start (Priority: P1)

As a new user, I want to follow a 4-step Quick Start that gets me to a working OpenCode + ChangeBudget setup without understanding internals.

**Why this priority**: This is the primary product goal for SPEC-010.

**Independent Test**: Testable in an isolated disposable environment: follow the exact Quick Start steps, verify OpenCode launches and the LLM follows ChangeBudget workflow.

**Acceptance Scenarios**:

1. **Given** a clean environment, **When** the user runs the four Quick Start commands in sequence, **Then** OpenCode launches and the integrated LLM follows ChangeBudget workflow automatically.

### Edge Cases

The following tag patterns must be handled correctly:

| Tag Pattern | Expected Behavior |
|---|---|
| `v1.2.0` | Valid stable tag — eligible for installation/update |
| `v1.10.0` | Valid stable tag — correctly parsed as 1.10.0 (not 1.1.0) |
| `v2.0.0` | Valid stable tag — major version, not auto-selected for v1.x |
| `v1.3.0-beta.1` | Prerelease — ignored entirely |
| `v1.3` | Malformed (missing patch) — ignored |
| `release-1.3.0` | Non-semver prefix — ignored |
| `latest` | Alias/branch — ignored |
| `v1.2.0-rc.1` | Prerelease — ignored |
| `v1.2` | Malformed — ignored |

Additional edge cases:

- **Multiple compatible versions**: Must select the highest patch/minor within the same major
- **Current version newer than available tags**: No-op, report already current
- **Tag exists but package version mismatches**: Tag is invalid for installation/update; skip and continue discovery
- **GitHub reachable but no valid stable tags**: Report no valid versions found
- **Update invoked from a project with SPEC-009 integration**: Integration must remain functional
- **Installation paths containing spaces**: Must work on Windows, macOS, Linux
- **Windows behavior**: Backslashes, drive letters, PATH resolution must work
- **npm executable unavailable**: Actionable error, no mutation
- **Failed/interrupted package update**: Safe recovery, no corruption
- **Test isolation**: Automated tests must never mutate the developer's real global npm environment

## Requirements

### Installation Requirements

- **FR-001**: The ChangeBudget package MUST be installable via `npm install -g github:Edulynch/Opencode-ChangeBudget#vX.Y.Z` where the tag is a stable semantic version matching exactly `vMAJOR.MINOR.PATCH`.
- **FR-002**: After successful installation, the `changebudget` CLI MUST be immediately available on PATH and executable without additional build steps.
- **FR-003**: After successful installation, the OpenCode Runtime Guard required by `changebudget integrate opencode` MUST be present and usable without additional user action.
- **FR-004**: Installation MUST NOT require publishing ChangeBudget to npmjs.
- **FR-005**: Installation MUST delegate all package management (download, extraction, binary placement, lifecycle scripts) to npm.
- **FR-006**: Installation MUST work on Windows PowerShell, macOS, and Linux.

### Version Management Requirements

- **FR-007**: The current installed version MUST be read from the installed package's `package.json` `version` field (not from Git, not from a separate namespace).
- **FR-008**: Available versions MUST be discovered from GitHub tags matching exactly the pattern `vMAJOR.MINOR.PATCH` (no prerelease, no malformed, no branch aliases).
- **FR-009**: A GitHub tag `vX.Y.Z` is valid for installation/update ONLY if the package version in that tag's `package.json` is exactly `X.Y.Z`. A mismatch makes the tagged version invalid.
- **FR-010**: Prerelease tags (e.g., `v1.3.0-beta.1`, `v1.2.0-rc.1`) MUST be ignored during version discovery.
- **FR-011**: Malformed tags (e.g., `v1.3`, `v1`, `release-1.3.0`, `latest`) MUST be ignored during version discovery.
- **FR-012**: Branch names and mutable references (`master`, `main`, `latest`) MUST never be selected automatically.

### CLI Commands

- **FR-013**: `changebudget --version` MUST print the installed version from `package.json` and exit with code 0.
- **FR-014**: `changebudget update --check` MUST be a read-only operation that reports:
  - Current installed version
  - Latest compatible stable version (same major)
  - Whether a compatible update is available
  - If a newer major exists, report it and show the explicit installation command
  - Exit code 0 on successful check; exit 4 if version cannot be determined or discovery fails
- **FR-015**: `changebudget update --check` MUST cause zero filesystem mutations in the target project (no `.changebudget/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, Spec-Kit artifacts, or any project files modified).
- **FR-016**: `changebudget update` MUST update the globally installed ChangeBudget to the latest compatible stable GitHub tag (same major version).
- **FR-017**: `changebudget update` MUST delegate the global package replacement to npm (no custom binary backup/restore, no rollback directories, no duplicate executable management).
- **FR-018**: `changebudget update` MUST NOT modify any target project files (`.changebudget/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, Spec-Kit artifacts, or any project files).
- **FR-019**: `changebudget update` MUST NOT automatically rerun `changebudget integrate opencode` in any user project.
- **FR-020**: If the installed version cannot be determined reliably, `changebudget update` MUST NOT attempt an installation and MUST report an actionable error.
- **FR-021**: If no compatible newer version exists (already on latest same-major), `changebudget update` MUST perform no mutation and report "already current".
- **FR-022**: If a newer major version exists, `changebudget update` MUST NOT perform the major upgrade automatically. It MUST report the newer major and show the explicit installation command for the user to run manually.
- **FR-023**: If tag/package version integrity validation fails for a candidate tag, that tag MUST be skipped and the next valid candidate evaluated.

### Update Exit Behavior

- **FR-024**: `update --check` succeeds + already current → exit 0, output reports "already current"
- **FR-025**: `update --check` succeeds + compatible update exists → exit 0, output reports update available with version
- **FR-026**: `update --check` succeeds + only newer major exists → exit 0, output reports newer major with explicit install command
- **FR-027**: `update` succeeds + compatible update applied → exit 0, output reports updated to version X.Y.Z
- **FR-028**: `update` succeeds + already current (no-op) → exit 0, output reports "already current"
- **FR-029**: Version cannot be determined → exit 4, output reports version detection failure
- **FR-030**: GitHub/tag discovery fails → exit 4, output reports discovery failure with actionable guidance
- **FR-031**: npm/update subprocess fails → exit 4, output reports failure with actionable guidance, existing installation unchanged

### Safety & Integrity

- **FR-032**: Self-update MUST never mutate `.changebudget/**`, `opencode.json`, `.opencode/**`, `AGENTS.md`, Spec-Kit artifacts (`specs/**`, `tasks.md`, `spec.md`, `plan.md`), or other project files.
- **FR-033**: Updating the globally installed ChangeBudget MUST NOT automatically run `changebudget integrate opencode` in user projects.
- **FR-034**: Existing SPEC-009 project integration MUST continue working after a compatible tagged update (Runtime Guard resolvable, instructions valid, `opencode.json` registration intact).
- **FR-035**: No telemetry, backend, account, daemon, service, scheduler, or background update checks.
- **FR-036**: No custom binary backup/rollback package manager.
- **FR-037**: No automatic major-version upgrade under any circumstance.
- **FR-038**: No installation from `master`, `main`, or any mutable branch.
- **FR-039**: No installation from untagged commits.
- **FR-040**: No prerelease update channel in SPEC-010.
- **FR-041**: No custom curl/bash or PowerShell installer in SPEC-010.
- **FR-042**: No CI/CD release automation or changelog generation in SPEC-010.
- **FR-043**: Windows, macOS, and Linux MUST be supported.

### Compatibility

- **Validated npm range**: npm >=8 <12. npm 12 Git dependency and lifecycle policy changes are outside the validated SPEC-010 range and require follow-up work.

- **FR-044**: SPEC-010 MUST preserve all existing ChangeBudget behavior from SPEC-001 through SPEC-009.
- **FR-045**: The `changebudget` CLI MUST remain usable without OpenCode.
- **FR-046**: Projects that never run `changebudget update` MUST behave exactly as before.
- **FR-047**: SPEC-010 MUST introduce zero new runtime dependencies unless clearly justified by the specification.

### Testing

- **FR-048**: All automated installation/update tests MUST use isolated disposable environments (temporary directories, mocked GitHub API, or npm registry mocks). Tests MUST NOT mutate the developer's real global npm installation.
- **FR-049**: Test coverage MUST include at minimum the edge cases listed in the Edge Cases section.

## Key Entities

- **InstalledVersion**: The semantic version string from the globally installed package's `package.json` `version` field.
- **AvailableTag**: A GitHub tag matching exactly `vMAJOR.MINOR.PATCH` with a corresponding matching package version.
- **CompatibleUpdate**: An available tag with the same major version as the installed version, and a higher minor or patch version.
- **NewerMajor**: An available tag with a higher major version than the installed version.
- **UpdateCheckResult**: Read-only output containing current version, latest compatible version (or null), newer major version (or null), and update availability boolean.
- **UpdateResult**: Outcome of the update operation: `UPDATED`, `ALREADY_CURRENT`, `MAJOR_AVAILABLE`, `VERSION_UNDETERMINED`, `DISCOVERY_FAILED`, `INSTALL_FAILED`.

## Success Criteria

### Measurable Outcomes

- **SC-001 — Tagged installation produces working CLI**: `npm install -g github:Edulynch/Opencode-ChangeBudget#vX.Y.Z` produces a `changebudget` command that executes and reports the correct version.
- **SC-002 — `--version` matches installed tag's package version**: `changebudget --version` output equals the `package.json` version of the installed tag.
- **SC-003 — Compatible version selection is deterministic**: Given the same set of available stable tags, the selected update target is always the highest minor/patch within the same major.
- **SC-004 — Prerelease/malformed tags never selected**: Tags matching `vX.Y.Z-*`, `vX.Y`, `release-*`, `latest`, or any non-semver pattern are never chosen as update targets.
- **SC-005 — Major upgrades never performed automatically**: `changebudget update` never installs a higher major version without explicit user action.
- **SC-006 — `update --check` causes zero target-project mutations**: No files in the current working directory (including `.changebudget/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, `specs/**`) are modified by `--check`.
- **SC-007 — `update` causes zero target-project mutations**: No files in the current working directory are modified by `update`.
- **SC-008 — SPEC-009 integration remains functional after compatible update**: After `changebudget update` to a compatible version, `changebudget integrate opencode` continues to work (Runtime Guard resolvable, instructions valid, `opencode.json` registration intact).
- **SC-009 — Failed update never triggers project integration changes**: If `changebudget update` fails (network, npm, subprocess), no project files are modified and existing integration remains untouched.
- **SC-010 — Isolated tests never mutate real global npm**: Automated tests use isolated environments and leave the developer's actual global npm installation unchanged.
- **SC-011 — GitHub tag / package version integrity enforced**: A tag `v1.2.3` whose `package.json` version is not `1.2.3` is rejected and never used for installation or update.
- **SC-012 — Quick Start completes successfully**: The four-command Quick Start sequence results in a working OpenCode session with ChangeBudget integration active.

## Assumptions

- **Stable tags are authoritative**: A GitHub release/tag is valid for ChangeBudget installation only when its semantic version corresponds to the package version shipped by that tag. This correspondence is a release invariant maintained by the project.
- **Local-first behavior preserved**: No cloud backend, account, telemetry, or LLM required for installation, update checks, or version resolution.
- **npm is the package manager**: Global installation and update delegation to npm is the supported mechanism. No custom installer, curl/bash, or PowerShell script is provided.
- **Runtime Guard is internal**: The OpenCode Runtime Guard is part of the ChangeBudget package and available after installation; no separate package or `node_modules` dependency is introduced.
- **SPEC-009 integration contract is stable**: The integration mechanism (`changebudget integrate opencode`) resolves the Runtime Guard from the installed ChangeBudget location. Compatible updates must preserve this resolution.
- **No automatic Git operations**: The update commands never `git add`, `git commit`, amend, or push.
- **Disposable test environments**: All automated tests use isolated temporary environments. The developer's real global npm installation is never touched by tests.

## Compatibility Impact

- **CLI surface**: New subcommands `--version`, `update --check`, `update` are added. No existing command, flag, output schema, reason code, or exit code is changed.
- **Runtime Guard**: The compiled Runtime Guard remains part of the ChangeBudget installation. SPEC-009 integration continues to resolve it correctly after tagged installation and compatible updates.
- **OpenCode configuration**: No modifications to project or global OpenCode configuration by update commands.
- **Spec-Kit Task Bridge**: Unchanged. Integration works with and without Spec-Kit.
- **Stack policies**: Unchanged.
- **Backward compatibility**: Projects that never run `changebudget update` behave exactly as before. The CLI remains usable without OpenCode.
- **No new runtime dependencies**: FR-047.

## Non-Goals

The following are explicitly out of scope for SPEC-010:

- npmjs publication
- Custom curl/bash installer
- Custom PowerShell installer
- CI/CD release automation
- Changelog generation
- Prerelease update channels
- Background update checks
- Daemons/services/schedulers
- Telemetry
- Automatic major upgrades
- Project reintegration during self-update
- Custom binary backup/rollback package manager
- Modification of `AGENTS.md` or Spec-Kit artifacts
- General-purpose `changebudget doctor` subsystem
- Other coding-agent integrations (beyond existing SPEC-009)

## Acceptance Scenarios (v1.0 gate)

The gate runs all SC-* criteria. Representative executable gate scenarios (isolated disposable environments, mocked GitHub API, npm registry mocks):

1. **Install from stable tag**: Clean environment, install v1.1.0 → CLI works, version correct, Runtime Guard available (SC-001, SC-002, SC-012).
2. **Install on Windows**: Clean Windows environment, install v1.1.0 → CLI works, paths with spaces handled (SC-001, SC-002).
3. **Check — already current**: Install v1.2.0 (latest same-major), run `update --check` → reports already current, exit 0, zero mutations (SC-006).
4. **Check — compatible update exists**: Install v1.1.0, v1.2.0 available → reports update available v1.2.0, exit 0, zero mutations (SC-004, SC-006).
5. **Check — newer major only**: Install v1.2.0, v2.0.0 available → reports newer major, shows explicit install command, no auto-update, exit 0 (SC-005, SC-006).
6. **Check — version undetermined**: Corrupted/no package.json → reports detection failure, no discovery attempted, exit 4 (SC-006).
7. **Check — GitHub unavailable**: Network failure → actionable error, exit 4, zero mutations (SC-006).
8. **Update — compatible success**: Install v1.1.0, v1.2.0 available → runs `update`, installs v1.2.0, version updated, exit 0, zero project mutations (SC-003, SC-007, SC-008).
9. **Update — already current**: Install v1.2.0 (latest), run `update` → no-op, reports already current, exit 0 (SC-007).
10. **Update — major blocked**: Install v1.2.0, v2.0.0 available → no mutation, reports major with explicit command, refuses automatic installation, exit 0 (SC-005, SC-007).
11. **Update — version undetermined**: Corrupted package → no install attempt, actionable error, exit 4 (SC-007).
12. **Update — npm failure**: npm subprocess fails → actionable error, existing installation unchanged, exit 4 (SC-007, SC-009).
13. **Integration preserved after update**: Install v1.1.0, integrate SPEC-009, update to v1.2.0 → integration still works (Runtime Guard resolvable, instructions valid) (SC-008).
14. **Prerelease ignored**: Tags v1.3.0-beta.1, v1.2.0-rc.1 present → never selected, v1.2.0 selected instead (SC-004).
15. **Malformed tags ignored**: Tags v1.3, release-1.3.0, latest present → never selected (SC-004).
16. **Tag/package mismatch rejected**: Tag v1.2.3 exists but package.json says 1.2.4 → tag skipped, next valid candidate used (SC-011).
17. **Test isolation**: All automated tests use temporary directories/mocks; developer's global npm untouched (SC-010).
18. **Quick Start acceptance**: T037 proves tagged installation; T031 covers the documented init/integrate sequence; SPEC-009 tests cover Runtime Guard behavior. A real OpenCode process is not an automated dependency (SC-012).

## Definition of Done

SPEC-010 is complete when:

- All FR-001..FR-049 are implemented and verified by corresponding tests.
- SC-001..SC-012 all pass with recorded evidence.
- The 18-case acceptance matrix passes using isolated disposable environments only.
- No existing CLI command, policy behavior, or output schema is altered.
- No new runtime dependencies are added (unless clearly justified).
- `update --check` and `update` cause zero target-project mutations in all scenarios.
- SPEC-009 integration remains fully functional after compatible updates.
- The Quick Start sequence works for a non-technical user in a clean environment.
- Windows real validation and Ubuntu/WSL real validation pass; macOS is covered by POSIX-compatible tests without requiring a physical-device run.

(End of file)
