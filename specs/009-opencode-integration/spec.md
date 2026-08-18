# Feature Specification: OpenCode Project Integration (SPEC-009)

**Feature Branch**: `009-opencode-integration`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "Automate the already-proven ChangeBudget → OpenCode project-local integration. The integration consists of exactly three managed resources. ChangeBudget MUST NOT modify AGENTS.md. The integration must remain generic to OpenCode."

## Problem Statement

ChangeBudget Personal v1.0 ships an optional OpenCode Runtime Guard plugin (SPEC-004) and a deterministic CLI. A controlled prototype proved that a project-local integration — a plugin wrapper, a generic instruction file, and an `opencode.json` instruction entry — works correctly: the Runtime Guard loads, produces ALLOW/ASK/DENY decisions, `.changebudget/**` stays protected, Spec-Kit is optional, and existing OpenCode configuration coexists without conflict.

That integration is currently assembled by hand. Users must manually create the wrapper file with the correct absolute `file://` path to the compiled Runtime Guard, manually write the instruction file, and manually edit `opencode.json` without breaking existing entries. This is error-prone, not repeatable, and has no ownership protection.

SPEC-009 automates the proven prototype into a single idempotent CLI command: `changebudget integrate opencode`. It does not redesign ChangeBudget, the Runtime Guard, or OpenCode. It installs, updates, and removes exactly three managed resources with deterministic ownership markers, conflict detection, dry-run support, and a Git baseline warning.

### Evidence basis

This specification is grounded in the successful controlled prototype executed against a disposable dummy repository. The prototype verified:

- Project-local OpenCode plugin loading via a `file://` wrapper works
- Generic instructions coexist with existing `opencode.json` instructions
- `AGENTS.md` remains untouched
- OpenCode continues functioning normally with the integration present
- Runtime Guard produces ALLOW / ASK / DENY correctly through the wrapper
- `.changebudget/**` remains protected (DENY via OCG-CHANGEBUDGET-PROTECT)
- Spec-Kit is optional — integration works with and without `specs/`
- No global OpenCode or OMO configuration is required
- The wrapper's `file://` URL with absolute path is a supported local-first design

These are treated as established evidence, not questions to rediscover.

## User Scenarios & Testing

Stories are prioritized by impact on daily personal workflow reliability.

### User Story 1 - One-command integration setup (Priority: P1)

As a developer using OpenCode, I want to run a single ChangeBudget command that installs the OpenCode integration into my project, so that the Runtime Guard and workflow instructions are configured correctly without manual file editing.

**Why this priority**: Manual integration is error-prone and the primary friction point. Automating it is the core value of SPEC-009.

**Independent Test**: Fully testable with a disposable Git repository: run the command, verify the three managed resources exist with correct content and ownership markers, verify `opencode.json` is valid, verify `AGENTS.md` is unchanged.

**Acceptance Scenarios**:

1. **Given** a disposable Git repository with no existing OpenCode configuration, **When** `changebudget integrate opencode` runs, **Then** `.opencode/plugins/changebudget.js`, `.opencode/instructions/changebudget.md`, and `opencode.json` (with the instruction entry) are created with valid content and ChangeBudget ownership markers.
2. **Given** a disposable Git repository with an existing `opencode.json` containing unrelated fields and instructions, **When** `changebudget integrate opencode` runs, **Then** all existing fields and instructions are preserved, the ChangeBudget instruction is appended without duplication, and `AGENTS.md` is byte-identical.
3. **Given** a disposable Git repository where the compiled Runtime Guard does not exist (ChangeBudget not built), **When** `changebudget integrate opencode` runs, **Then** an actionable error is emitted telling the user to build ChangeBudget, and no files are written.

### User Story 2 - Idempotent re-runs and stale-path repair (Priority: P1)

As a developer, I want to re-run the integration command safely at any time, so that repeated execution produces no duplicate entries, no lost configuration, and repairs a stale wrapper path if ChangeBudget moved.

**Why this priority**: Idempotency is essential for trust. A command that corrupts configuration on re-run is worse than manual setup.

**Independent Test**: Testable with a disposable repo: run integration twice, verify zero content changes on the second run. Then simulate a path change and verify the wrapper is updated.

**Acceptance Scenarios**:

1. **Given** an already-integrated disposable repository, **When** `changebudget integrate opencode` runs again, **Then** no files change content, no duplicate instruction entry is created, and the command reports "already current / up-to-date".
2. **Given** an integrated disposable repository where the ChangeBudget installation moved to a different path, **When** `changebudget integrate opencode` runs, **Then** only the managed wrapper is updated with the new `file://` path; the instruction file and `opencode.json` are unchanged if their content is still current.

### User Story 3 - Dry-run preview (Priority: P2)

As a developer, I want to preview what the integration command would do without writing anything, so that I can verify the planned actions before modifying my project.

**Why this priority**: Dry-run builds confidence before touching project configuration, especially in projects with complex existing OpenCode setups.

**Independent Test**: Testable with a disposable repo: run with `--dry-run`, verify zero file mutations, verify the reported planned actions match the actual state.

**Acceptance Scenarios**:

1. **Given** a disposable repository with no existing integration, **When** `changebudget integrate opencode --dry-run` runs, **Then** the command reports CREATE for all three resources, modifies no files, creates no `.changebudget` state, and changes no Git state.
2. **Given** an already-integrated disposable repository, **When** `changebudget integrate opencode --dry-run` runs, **Then** the command reports UNCHANGED for all three resources and modifies nothing.
3. **Given** a disposable repository where a user-owned file exists at `.opencode/plugins/changebudget.js` without a ChangeBudget ownership marker, **When** `changebudget integrate opencode --dry-run` runs, **Then** the command reports CONFLICT for the plugin wrapper and modifies nothing.

### User Story 4 - Safe removal (Priority: P2)

As a developer, I want to cleanly uninstall the ChangeBudget integration from my project, so that only ChangeBudget-owned resources are removed and all my other OpenCode configuration is preserved.

**Why this priority**: Reversibility is essential for trust. Users need to know they can cleanly remove the integration without collateral damage.

**Independent Test**: Testable with a disposable repo: integrate, then remove, verify only ChangeBudget-owned files are deleted, `opencode.json` and `AGENTS.md` survive with their original content.

**Acceptance Scenarios**:

1. **Given** an integrated disposable repository, **When** `changebudget integrate opencode --remove` runs, **Then** `.opencode/plugins/changebudget.js` and `.opencode/instructions/changebudget.md` are removed (only if ownership markers match), the ChangeBudget instruction entry is removed from `opencode.json`, all other instructions and fields are preserved, and `AGENTS.md` is byte-identical.
2. **Given** a disposable repository where a user-owned file exists at `.opencode/instructions/changebudget.md` without a ChangeBudget marker, **When** `changebudget integrate opencode --remove` runs, **Then** removal is refused for that file, an actionable conflict is reported, and no destructive action is taken.

### User Story 5 - Ownership conflict protection (Priority: P1)

As a developer, I want ChangeBudget to detect when a file at a managed path is not ChangeBudget-owned and refuse to overwrite it, so that my existing files are never silently destroyed.

**Why this priority**: Silent overwrites of user-owned content are a data-loss risk. This is a safety-critical guarantee.

**Independent Test**: Testable with a disposable repo: place a user-owned file at each managed path without the ownership marker, run integration, verify CONFLICT is reported and no file is overwritten.

**Acceptance Scenarios**:

1. **Given** a disposable repository where `.opencode/plugins/changebudget.js` exists without a ChangeBudget ownership marker, **When** `changebudget integrate opencode` runs, **Then** the command reports a CONFLICT for the plugin wrapper, does not overwrite the file, and exits with a clear actionable error.
2. **Given** a disposable repository where `.opencode/instructions/changebudget.md` exists without a ChangeBudget ownership marker, **When** `changebudget integrate opencode` runs, **Then** the command reports a CONFLICT for the instruction file, does not overwrite it, and exits with a clear actionable error.

### User Story 6 - Git baseline awareness (Priority: P2)

As a developer, I want ChangeBudget to warn me that integration files should be committed to the Git baseline before starting an implementation contract, so that the integration files themselves do not trigger scope violations.

**Why this priority**: The prototype identified this as a real integration friction. Untracked integration files violate the contract's allowed paths and produce REPAIR. The warning prevents this confusion.

**Independent Test**: Testable with a disposable repo: run integration in a Git repo without committing the files, verify the warning appears. Commit the files, re-run, verify the warning does not appear.

**Acceptance Scenarios**:

1. **Given** a disposable Git repository where integration files were just installed and are untracked, **When** the integration command completes, **Then** a clear warning is emitted stating that integration files should be committed/baselined before starting a ChangeBudget contract.
2. **Given** a disposable Git repository where integration files are already committed to the baseline, **When** the integration command completes (re-run, already current), **Then** no baseline warning is emitted.

### User Story 7 - Integration status reporting (Priority: P3)

As a developer, I want the integration command to report the status of each managed resource after execution, so that I can verify the integration is ready or identify what needs attention.

**Why this priority**: Status visibility helps users diagnose issues without inspecting files manually. It is secondary to the core install/remove functionality.

**Independent Test**: Testable with a disposable repo: run integration, verify the status output covers all five status dimensions (plugin, instructions, opencode.json, Runtime Guard target, overall readiness).

**Acceptance Scenarios**:

1. **Given** a freshly integrated disposable repository, **When** the integration command completes, **Then** the output reports: plugin wrapper installed/current, instructions installed/current, opencode.json registration present, Runtime Guard target exists, integration READY.
2. **Given** a disposable repository where the compiled Runtime Guard was removed after integration, **When** the integration command runs, **Then** the output reports Runtime Guard target missing and integration NEEDS ATTENTION.

### Edge Cases

- **Missing `opencode.json`**: The command creates a minimal valid config with only the ChangeBudget instruction entry and schema reference.
- **Malformed `opencode.json`**: The command fails with an actionable parse error and does not modify the file.
- **Missing `.opencode/` directory**: The command creates the necessary subdirectories (`plugins/`, `instructions/`).
- **`opencode.json` with no `instructions` field**: The command creates the `instructions` array with the ChangeBudget entry.
- **`opencode.json` with `instructions` as a non-array**: The command fails with an actionable type error and does not modify the file.
- **ChangeBudget CLI not resolvable from PATH**: Integration status may warn that `changebudget` is not globally available; this does not block the Runtime Guard from loading via the wrapper.
- **Windows path with drive letter and backslashes**: The `file://` URL must be generated using Node URL APIs to ensure platform-correct encoding.
- **`.opencode/` directory contains unrelated plugins or instructions**: Removal must not delete the directory if unrelated content remains.
- **Integration files already committed to Git baseline**: The baseline warning must not appear.
- **Integration run outside a Git repository**: The Git baseline check is skipped; the rest of the integration proceeds normally.
- **Existing `instructions` entry with a different relative path to the same file** (e.g., `./.opencode/instructions/changebudget.md`): The command treats the exact string `.opencode/instructions/changebudget.md` as the canonical entry; variant spellings are not deduplicated (to avoid semantic ambiguity), but the canonical entry is appended if the exact string is absent.

## Requirements

### Integration Resource Ownership Model

ChangeBudget owns exactly three managed resources in the target project:

| Resource | Path | Ownership Marker | Content Authority |
|---|---|---|---|
| Plugin wrapper | `.opencode/plugins/changebudget.js` | Deterministic comment marker | ChangeBudget (generated, not user-editable) |
| Instruction file | `.opencode/instructions/changebudget.md` | Deterministic comment/header marker | ChangeBudget (generated, not user-editable) |
| Config registration | `opencode.json` → `instructions[]` | Exact string `.opencode/instructions/changebudget.md` | ChangeBudget appends/removes only this entry |

ChangeBudget MUST NOT modify:
- `AGENTS.md`
- Any file in `.opencode/` other than the two managed resources
- Any `opencode.json` field other than the `instructions` array
- Any global OpenCode or OMO configuration

### Install/Update/Remove State Model

**Install** (`changebudget integrate opencode`):
1. Validate the compiled Runtime Guard exists at the expected path; if missing, fail with an actionable "build ChangeBudget" error.
2. Detect existing files at managed paths; classify each as ABSENT, OWNED (marker matches), or CONFLICT (file exists, marker absent/mismatched).
3. If any CONFLICT is detected, report all conflicts and exit without writing.
4. Write the plugin wrapper (CREATE if ABSENT, UPDATE if OWNED and content changed, UNCHANGED if OWNED and content current).
5. Write the instruction file (CREATE / UPDATE / UNCHANGED).
6. Update `opencode.json` (CREATE file if absent, APPEND instruction entry if absent, UNCHANGED if already present).
7. Inspect Git status of managed files; emit baseline warning if any are untracked or modified.
8. Report integration status.

**Dry-run** (`changebudget integrate opencode --dry-run`):
- Perform steps 1–3 and 7 (detection/validation only).
- Report planned actions (CREATE / UPDATE / UNCHANGED / CONFLICT) for each resource.
- Write nothing. Create no `.changebudget` state. Change no Git state.

**Remove** (`changebudget integrate opencode --remove`):
1. Detect existing files at managed paths; classify each as ABSENT, OWNED, or CONFLICT.
2. If any CONFLICT is detected, report all conflicts and refuse destructive removal.
3. Remove the plugin wrapper (only if OWNED).
4. Remove the instruction file (only if OWNED).
5. Remove the exact ChangeBudget instruction entry from `opencode.json` (only the exact string match).
6. Optionally remove now-empty ChangeBudget-created child directories (`plugins/`, `instructions/`) only when safe and clearly owned.
7. Never delete `opencode.json`, `AGENTS.md`, or `.opencode/` if unrelated content exists.
8. Report removal status.

### Functional Requirements

**Primary command**

- **FR-001**: The CLI MUST provide a `changebudget integrate opencode` command whose sole responsibility is installing/updating the ChangeBudget OpenCode integration. It MUST NOT create a Change Contract, run diagnose, start implementation, commit, stage, push, modify global OpenCode config, modify OMO config, or modify `AGENTS.md`.

**Managed plugin wrapper**

- **FR-002**: The command MUST generate `.opencode/plugins/changebudget.js` as a wrapper that re-exports the default export from the compiled Runtime Guard via a `file://` URL pointing to the actual local ChangeBudget installation's `opencode-plugin/dist/opencode-plugin/src/index.js`. The wrapper MUST NOT copy or vendor the plugin implementation.
- **FR-003**: The `file://` URL MUST be generated using platform-safe Node URL APIs (not manual slash replacement) and MUST work correctly on Windows (including drive letters and backslashes).
- **FR-004**: The wrapper MUST include a deterministic ChangeBudget ownership marker (e.g., a comment line) that distinguishes ChangeBudget-managed content from user-owned content.
- **FR-005**: The command MUST detect an existing ChangeBudget-managed wrapper (marker matches) and update it if the expected Runtime Guard path changed. It MUST NOT overwrite an unrelated user-owned file at the same path (marker absent/mismatched); it MUST fail with a clear CONFLICT error.
- **FR-006**: The command MUST verify the compiled Runtime Guard entrypoint exists before writing the wrapper. If build output is missing, it MUST return an actionable error telling the user to run `npm run build` in the ChangeBudget repository. It MUST NOT build ChangeBudget automatically.

**Managed instructions**

- **FR-007**: The command MUST generate `.opencode/instructions/changebudget.md` with generic OpenCode agent instructions containing at minimum: ChangeBudget is the scope authority; check for an active contract before modifying files; use `changebudget diagnose Txxx` for Spec-Kit tasks without an explicit budget; start a contract before implementation; never widen automatically; perform targeted validation after implementation; run `changebudget check` after implementation; REPAIR means fix within the existing contract; PASS does not automatically complete a Spec-Kit task; close only after validation succeeds; never manually modify `.changebudget/**`.
- **FR-008**: The instruction file MUST be generic OpenCode wording only. It MUST NOT contain Sisyphus-, Prometheus-, Atlas-, Oracle-, or OMO-agent-specific text or prompts.
- **FR-009**: The instruction file MUST include a ChangeBudget ownership/version marker. The command MUST detect an existing ChangeBudget-managed file and update it if the managed template changed. It MUST NOT overwrite an unrelated user-owned file at the same path; it MUST fail with a clear CONFLICT error.

**OpenCode configuration**

- **FR-010**: If `opencode.json` exists, the command MUST parse it safely, preserve every unrelated field, preserve every existing `instructions` entry, and append `.opencode/instructions/changebudget.md` only if the exact string is absent. It MUST NEVER duplicate the entry or remove existing entries.
- **FR-011**: If `opencode.json` does not exist, the command MUST create the smallest valid project-local config containing the ChangeBudget instruction path and schema reference appropriate to existing OpenCode conventions.
- **FR-012**: If `opencode.json` exists but is malformed (invalid JSON), the command MUST fail with an actionable parse error and MUST NOT modify the file.
- **FR-013**: If `opencode.json` exists but `instructions` is not an array, the command MUST fail with an actionable type error and MUST NOT modify the file.
- **FR-014**: ChangeBudget-written JSON MUST use deterministic formatting (consistent indentation, key ordering, trailing newline) so repeated runs produce byte-identical output when no semantic change occurs.
- **FR-015**: The command MUST NOT modify global OpenCode configuration.

**Idempotency**

- **FR-016**: `changebudget integrate opencode` MUST be idempotent: repeated execution with an already-current integration MUST produce no content changes, create no duplicate instructions, preserve unrelated configuration, and return a clear already-current/up-to-date result.
- **FR-017**: If the ChangeBudget installation path changes, re-running the command MUST update only the managed wrapper. If the managed instruction template changes between ChangeBudget versions, re-running MUST update only the managed instruction file.

**Dry-run**

- **FR-018**: The command MUST support `--dry-run`, which performs all validation and detection but writes nothing. It MUST report planned actions (CREATE / UPDATE / UNCHANGED / CONFLICT) for the plugin wrapper, instruction file, and `opencode.json` registration. It MUST NOT modify project files, stage, commit, create `.changebudget` state, or change Git state.

**Removal**

- **FR-019**: The command MUST support `--remove`, which removes only ChangeBudget-owned resources: the plugin wrapper (only if ownership marker matches), the instruction file (only if ownership marker matches), and the exact ChangeBudget instruction entry from `opencode.json`. It MUST preserve all other instructions and configuration. It MUST NEVER delete `AGENTS.md`, `opencode.json`, or `.opencode/` if unrelated content exists.
- **FR-020**: On ownership conflict during removal, the command MUST refuse destructive removal and report an actionable conflict.

**Integration status**

- **FR-021**: After execution, the command MUST report: plugin wrapper status (installed/current/stale/conflict/absent), instruction file status (installed/current/stale/conflict/absent), `opencode.json` registration status (present/missing), Runtime Guard target status (exists/missing), and overall integration readiness (READY / NEEDS ATTENTION). This status is scoped to the integration feature; the command MUST NOT be a general-purpose `changebudget doctor`.

**Git baseline warning**

- **FR-022**: After installation or update, the command MUST inspect whether managed integration files are untracked or modified relative to Git. If any are, it MUST emit a clear warning that integration setup should be committed/baselined before starting a ChangeBudget contract. The warning MUST NOT appear when all managed files are committed to the baseline. The command MUST NOT automatically `git add`, `git commit`, amend, or push. No flag for automatic commits in this version.

**CLI availability**

- **FR-023**: The command MAY warn that `changebudget` is not resolvable from PATH and provide an actionable message. This is not a blocker for Runtime Guard loading. The command MUST NOT automatically run `npm link`.

**Safety and atomicity**

- **FR-024**: The command MUST validate all ownership conflicts before any writes. If a known conflict exists, it MUST NOT start writes. If writing multiple files cannot be transactionally atomic, the command MUST use a deterministic write ordering and, on an unexpected write failure, report exactly which resources changed and which did not. No generalized transaction subsystem is introduced.

**Backward compatibility**

- **FR-025**: SPEC-009 MUST NOT alter the behavior of `init`, `diagnose`, `start`, `status`, `check`, `close`, OpenCode Runtime Guard policy semantics, stack policies, or the Spec-Kit Task Bridge. Projects that never run `integrate opencode` MUST behave exactly as before. The CLI MUST remain usable without OpenCode.

**Testing**

- **FR-026**: All automated integration tests MUST use newly-created disposable dummy Git repositories. Tests MUST NOT inspect, clone, or copy personal/work application repositories, or modify global OpenCode/OMO configuration. Test coverage MUST be table-driven and include at minimum the 18-case matrix defined in Acceptance Scenarios.

**Dependencies**

- **FR-027**: SPEC-009 MUST introduce zero new runtime dependencies. The integration command uses only Node standard library and existing ChangeBudget code.

### Key Entities

- **IntegrationState**: the per-project state of the three managed resources (ABSENT / OWNED-CURRENT / OWNED-STALE / CONFLICT for wrapper and instructions; PRESENT / MISSING for opencode.json registration; EXISTS / MISSING for Runtime Guard target).
- **OwnershipMarker**: a deterministic string embedded in generated files that identifies content as ChangeBudget-managed, enabling safe detection, update, and removal without overwriting user-owned content.
- **ManagedWrapper**: the generated `.opencode/plugins/changebudget.js` file that re-exports the compiled Runtime Guard via `file://` URL.
- **ManagedInstructions**: the generated `.opencode/instructions/changebudget.md` file containing generic OpenCode agent workflow instructions.

## Success Criteria

### Measurable Outcomes

- **SC-001 — Idempotent repeated integration**: Running `changebudget integrate opencode` twice in succession on a disposable repository produces zero content changes on the second run (byte-identical files and `opencode.json`).
- **SC-002 — Zero unrelated opencode.json field loss**: Across all integration scenarios (install, update, remove), no `opencode.json` field other than the `instructions` array is modified, and no existing instruction entry is lost.
- **SC-003 — Zero AGENTS.md mutation**: Across all integration scenarios (install, update, remove, conflict), `AGENTS.md` remains byte-identical before and after.
- **SC-004 — Safe ownership conflict handling**: When a user-owned file (no ChangeBudget marker) exists at a managed path, the command reports CONFLICT, writes nothing, and exits with an actionable error.
- **SC-005 — Correct stale-wrapper repair**: When the ChangeBudget installation path changes, re-running the command updates only the wrapper with the new `file://` path; the instruction file and `opencode.json` are unchanged if their content is current.
- **SC-006 — Zero mutations in dry-run**: `--dry-run` modifies no project files, creates no `.changebudget` state, and changes no Git state.
- **SC-007 — Safe uninstall preserving user configuration**: `--remove` deletes only ChangeBudget-owned resources, preserves all other instructions and configuration, and refuses destructive removal on ownership conflict.
- **SC-008 — Windows-safe Runtime Guard file URL**: The generated `file://` URL correctly loads the Runtime Guard on Windows (drive letter, backslash normalization via Node URL APIs).
- **SC-009 — Existing OpenCode instructions preserved**: After integration, all pre-existing `instructions` entries in `opencode.json` remain present and unchanged.
- **SC-010 — Integration does not alter ChangeBudget policy behavior**: The Runtime Guard's ALLOW/ASK/DENY decisions, `.changebudget/**` protection, and contract enforcement semantics are identical before and after integration.
- **SC-011 — Disposable E2E OpenCode integration readiness**: A disposable repository with the integration installed supports the full ChangeBudget workflow (diagnose → start → edit → check → close) and the Runtime Guard produces correct ALLOW/ASK/DENY decisions through the wrapper.

## Assumptions

- **Prototype evidence is authoritative**: The controlled prototype proved the integration architecture works; SPEC-009 automates it without redesigning the architecture.
- **Local installation**: The wrapper uses an absolute `file://` URL to the local ChangeBudget installation. This is a supported local-first design, not a blocker. No npm publishing, package registry lookup, remote download, or self-update mechanism is introduced.
- **ChangeBudget must be built**: The compiled Runtime Guard must exist before integration. The command does not build automatically; it fails with actionable instructions.
- **Generic OpenCode only**: Instructions are generic OpenCode wording. No OMO-agent-specific (Sisyphus, Prometheus, Atlas, Oracle) configuration is included.
- **Spec-Kit is optional**: The integration works with and without a `specs/` directory. The Spec-Kit Task Bridge behavior is unchanged.
- **Existing CLI commands unchanged**: `init`, `diagnose`, `start`, `status`, `check`, `close` behavior is preserved. Projects that never run `integrate opencode` behave exactly as before.
- **Disposable repositories only for testing**: All automated tests use newly-created disposable dummy Git repositories. No personal/work application repository is inspected, cloned, or modified.
- **No automatic Git operations**: The command never `git add`, `git commit`, amends, or pushes. A baseline warning guides the user to commit integration files manually.

## Compatibility Impact

- **CLI surface**: A new `integrate opencode` subcommand is added. No existing command, flag, preset, output schema, reason code, or exit code is changed.
- **Runtime Guard**: The compiled plugin is loaded via a wrapper; the plugin's policy semantics, hook behavior, and decision projection are unchanged.
- **OpenCode configuration**: Only the project-local `opencode.json` is modified (append/remove one instruction entry). Global OpenCode configuration is never touched.
- **Spec-Kit Task Bridge**: Unchanged. Integration works with and without Spec-Kit.
- **Stack policies**: Unchanged.
- **Backward compatibility**: Projects that never run `integrate opencode` behave exactly as before. The CLI remains usable without OpenCode.
- **No new runtime dependencies**: FR-027.

## Non-Goals

The following are explicitly out of scope for SPEC-009:

- `AGENTS.md` modification
- OMO-specific configuration (Sisyphus, Prometheus, Atlas, Oracle, or any other OMO agent)
- Global OpenCode plugin installation
- Global OpenCode instructions
- Automatic Git commits, staging, or pushes
- npm publishing or package registry lookup
- `npm link` automation
- New OpenCode Runtime Guard rules or policy behavior
- New stack policies
- New ChangeBudget policy behavior
- Automatic contract creation
- General-purpose `changebudget doctor` subsystem
- Other coding-agent integrations (beyond OpenCode)
- Cloud/network services
- Plugin copying or vendoring mechanism
- Remote download or self-update mechanism
- Generalized transaction subsystem for multi-file writes

## Acceptance Scenarios (v1.0 gate)

The gate runs all SC-* criteria. Representative executable gate scenarios (disposable repositories, table-driven):

1. **Given** a clean disposable repository without `opencode.json`, **When** `changebudget integrate opencode` runs, **Then** all three managed resources are created with correct content and ownership markers, `opencode.json` is valid, and the integration is READY (SC-001, SC-008, SC-011).
2. **Given** a disposable repository with an existing `opencode.json` containing unrelated fields and instructions, **When** integration runs, **Then** all existing fields and instructions are preserved, the ChangeBudget instruction is appended without duplication, and `AGENTS.md` is byte-identical (SC-002, SC-003, SC-009).
3. **Given** an already-integrated disposable repository, **When** integration runs again, **Then** no files change and the command reports "already current" (SC-001).
4. **Given** an integrated disposable repository where the wrapper path is stale, **When** integration runs, **Then** only the wrapper is updated (SC-005).
5. **Given** a disposable repository with user-owned files at managed paths (no markers), **When** integration runs, **Then** CONFLICT is reported, nothing is overwritten (SC-004).
6. **Given** any disposable repository, **When** `--dry-run` runs, **Then** zero files are modified and planned actions are reported (SC-006).
7. **Given** an integrated disposable repository, **When** `--remove` runs, **Then** only ChangeBudget-owned resources are removed, all other configuration is preserved, and `AGENTS.md` is byte-identical (SC-007).
8. **Given** a disposable repository with user-owned files at managed paths, **When** `--remove` runs, **Then** removal is refused and conflict is reported (SC-004, SC-007).
9. **Given** a disposable repository with untracked integration files, **When** integration completes, **Then** a Git baseline warning is emitted (FR-022).
10. **Given** a disposable repository with integration files committed to baseline, **When** integration re-runs, **Then** no baseline warning is emitted (FR-022).
11. **Given** a disposable repository on Windows, **When** integration runs, **Then** the generated `file://` URL correctly loads the Runtime Guard (SC-008).
12. **Given** a disposable repository where ChangeBudget build output is missing, **When** integration runs, **Then** an actionable "build ChangeBudget" error is emitted and no files are written (FR-006).
13. **Given** a disposable repository with no `specs/` directory, **When** integration runs and the full workflow is exercised, **Then** everything works without Spec-Kit (SC-011).
14. **Given** a disposable repository with `specs/001-dummy/tasks.md` containing a `Txxx` task, **When** integration runs and `diagnose T001` / `start T001` are exercised, **Then** the Spec-Kit Task Bridge works as before (SC-010).
15. **Given** a disposable repository, **When** `AGENTS.md` is present before integration, **Then** `AGENTS.md` is byte-identical after install, update, dry-run, and remove (SC-003).
16. **Given** a disposable repository with a malformed `opencode.json`, **When** integration runs, **Then** an actionable parse error is emitted and the file is not modified (FR-012).
17. **Given** a disposable repository with `instructions` as a non-array in `opencode.json`, **When** integration runs, **Then** an actionable type error is emitted and the file is not modified (FR-013).
18. **Given** a disposable repository with existing unrelated `.opencode/plugins/` content, **When** `--remove` runs, **Then** the `.opencode/` directory is not deleted if unrelated content remains (FR-019).

## Definition of Done

SPEC-009 is complete when:

- All FR-001..FR-027 are implemented and verified by the corresponding tests.
- SC-001..SC-011 all pass with recorded evidence.
- The 18-case test matrix passes using disposable dummy repositories only.
- No existing CLI command, policy behavior, or output schema is altered.
- No new runtime dependencies are added.
- `AGENTS.md` is never modified by any integration operation.
- The CLI remains usable without OpenCode.
