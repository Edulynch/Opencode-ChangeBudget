# Feature Specification: Policy Results, Reports & Exit Codes

**Feature Branch**: `003-policy-results-exit-codes`

**Created**: 2026-08-16

**Status**: Draft

**Input**: User description: "Implement SPEC-003 — Policy Results, Reports & Exit Codes"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use `check` as a deterministic decision point (Priority: P1)

As a developer, after running `changebudget check` I need a clear single decision (`PASS`, `REPAIR`, `HUMAN_REVIEW`) so I know whether I can continue, must repair, or must pause for manual review.

**Why this priority**: This changes the output contract from status-only to action-oriented decisions for real-world workflows.

**Independent Test**: From a repo with an active contract, run `changebudget check` in three scenarios and verify decision, reason listing, and exit behavior.

**Acceptance Scenarios**:

1. **Given** an active contract with `max_files=5`, **When** `check` finds all files and lines within budget and no path violations, **Then** decision is `PASS`, all summary fields are within limits, and command exits with the PASS code.
2. **Given** a single changed file outside `allow_paths`, **When** `check` runs, **Then** violation includes a stable reason code, decision is `REPAIR`, and command exits with the REPAIR code.
3. **Given** deny path and limit violations in the same result, **When** `check` runs, **Then** both are reported and decision remains `REPAIR`.

---

### User Story 2 - Integrate with scripts and CI by parsing structured output (Priority: P1)

As an automation author, I need `changebudget check --json` to return stable machine fields so scripts can branch without parsing human output.

**Why this priority**: This is the bridge from manual feedback to reliable CI enforcement.

**Independent Test**: A script reads `--json` output and maps `PASS` to success, `REPAIR` to actionable block, and `HUMAN_REVIEW` to manual escalation.

**Acceptance Scenarios**:

1. **Given** a normal pass, **When** the script runs, **Then** it reads `decision: PASS` and exit code `0`.
2. **Given** a limit violation, **When** the script runs, **Then** it reads `decision: REPAIR`, `reason_codes` contain at least one stable rule code, and exit code matches REPAIR code.
3. **Given** unresolved `base_revision` or non-git context, **When** the command runs, **Then** decision is `HUMAN_REVIEW`, reason code is explicit, and exit code matches HUMAN_REVIEW code.

---

### User Story 3 - Keep human output concise and explainable for review (Priority: P1)

A developer needs to understand exactly what failed and why without opening internal logs or parsing JSON first.

**Why this priority**: Human visibility is required even when automation is present.

**Independent Test**: Run `check` with one `deny_paths` and one `max_changed_lines` violation and verify text output lists both with path, expectation, and observed values in deterministic order.

**Acceptance Scenarios**:

1. **Given** a protected path is changed and a line budget is exceeded, **When** `check` runs, **Then** text output shows both reasons with clear rule labels.
2. **Given** there are no violations, **When** `check` runs, **Then** output explicitly shows no violations and still includes decision context.

### User Story 4 - Expose live budget usage in `status` without changing lifecycle behavior (Priority: P2)

As a team member checking context quickly, I want `changebudget status` to show current budget consumption so I can decide next steps before editing.

**Why this priority**: It shortens feedback loops and avoids extra `check` calls in routine commanding.

**Independent Test**: With an active contract and working-tree changes, run `changebudget status --budget`, then verify usage fields align with `check` results.

**Acceptance Scenarios**:

1. **Given** active contract and working-tree modifications, **When** `status --budget` runs, **Then** it shows computed `changed_files`, `changed_lines`, binary/new/deleted/renamed counts and last known decision.
2. **Given** no active contract, **When** `status --budget` runs, **Then** it reports the reason, no mutation occurs, and the command returns deterministic non-success when appropriate.

### Edge Cases

- How are decisions resolved when path violations and budget violations both exist in the same check?
- How is a human-only failure represented versus a concrete policy violation?
- Are reason codes stable when contract source is `active` versus `draft`?
- What happens when `base_revision` is missing versus malformed versus unreachable?
- Are machine outputs deterministic in ordering when repeated with no repository changes?
- Can `--json` output be produced while contract validation fails?
- Does `status --budget` preserve existing lifecycle behavior and output shape?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The `check` command MUST produce a deterministic final decision from one of: `PASS`, `REPAIR`, `HUMAN_REVIEW`.

- **FR-002**: `PASS` decision is produced only when:
  - no policy limit violations exist (`max_files`, `max_changed_lines`),
  - no path policy violations exist (`allow_paths`, `deny_paths`),
  - and no deterministic evaluation precondition failed.

- **FR-003**: `REPAIR` decision is produced when at least one concrete rule violation exists in deterministic evaluation.

- **FR-004**: `HUMAN_REVIEW` decision is produced when deterministic evaluation completed partially or cannot safely complete due to missing prerequisites (for example unresolved base reference, broken contract/contract source, non-git context, or malformed path pattern data).

- **FR-005**: Every `REPAIR` or `HUMAN_REVIEW` outcome MUST include one or more machine-reason entries and at least one human-readable recommendation.

- **FR-006**: The result model and output MUST include reason codes for each item in a stable taxonomy:
  - `CBV-BASE-REVISION-UNKNOWN`
  - `CBV-LIMIT-FILES-EXCEEDED`
  - `CBV-LIMIT-LINES-EXCEEDED`
  - `CBV-PATH-DENIED`
  - `CBV-PATH-NOT-ALLOWED`
  - `CBV-INPUT-INVALID`
  - `CBV-ENV-NOT-READY`
  - `CBV-RULE-CONFIG-INVALID`

- **FR-007**: Existing deterministic rule names and counts from SPEC-002 remain unchanged (`max_files`, `max_changed_lines`, `allow_paths`, `deny_paths`, and core file/line counters), and existing path/limit evaluation behavior is reused.

- **FR-008**: The result output for every check run MUST be deterministic across repeated runs with identical repository state.

- **FR-009**: `check` output in human mode MUST include: decision, contract source/id, base revision, current counts, all path and limit results, all violations, and reason codes.

- **FR-010**: `changebudget check --json` MUST output machine-readable JSON with the same core fields as human output, plus:
  - `decision`,
  - ordered `violations` containing `rule`, `reason_code`, `message`, optional `path`, optional `expected`, optional `observed`, and severity category.

- **FR-011**: `changebudget status --budget` MUST emit the same decision schema when possible, reusing live `check` evaluation semantics, while retaining existing `status` contract context fields.

- **FR-012**: `status --budget --json` MUST output a compact machine-readable object with at least: lifecycle state, active contract id, usage counters, decision, reason codes, and as-of timestamp.

- **FR-013**: Exit code mapping for completed `check` runs MUST be deterministic and documented:
  - `PASS` => `0`,
  - `REPAIR` => `1`,
  - `HUMAN_REVIEW` => `2`.

- **FR-014**: Existing hard error classes for check argument validation, environment failures, and repository/state errors MUST continue to surface through deterministic error text and use documented non-check exit behavior outside the decision mapping.

- **FR-015**: Output ordering for both human text and machine JSON MUST be stable and sorted for reproducibility:
  - violations by `rule`, then `reason_code`, then `path`,
  - path results by file path, then allow/deny state,
  - limit results in fixed `max_files` then `max_changed_lines` order.

- **FR-016**: Report generation MUST remain non-destructive; no file mutation, staging changes, or lifecycle transitions occur as a result of `check` or `status --budget`.

### Key Entities

- **Policy Decision Result**: Enhanced decision record derived from budget evaluation.
  - `decision` (`PASS` | `REPAIR` | `HUMAN_REVIEW`)
  - `status` (`PASS` | `FAIL`)
  - `contractSource` (`active` | `draft`)
  - `contractId` (string or `null`)
  - `baseRevision` (string)
  - `changedFileCount` (integer)
  - `changedLinesCount` (integer)
  - `binaryChangeCount` (integer)
  - `newFileCount` (integer)
  - `deletedFileCount` (integer)
  - `renamedFileCount` (integer)
  - `limitResults` (list)
  - `pathRuleResults` (list)
  - `violations` (list)
  - `reasonCodes` (list of strings)
  - `asOf` (timestamp)

- **Decision Reason**: Structured reason element for machine parsing.
  - `rule` (`max_files`, `max_changed_lines`, `allow_paths`, `deny_paths`, `contract`, `environment`)
  - `reasonCode` (canonical stable string)
  - `message` (human-readable)
  - `path` (optional string)
  - `expected` (optional)
  - `observed` (optional)
  - `action` (`repair` or `review`)

- **Budget Report (status mode)**: Optional status extension payload.
  - `lifecycleState`
  - `activeContractId`
  - `decision`
  - `decisionReason`
  - `reasonCodes`
  - current counters and timestamps

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For at least 20 reproducible check scenarios, the `--json` schema contains all required fields and decision codes and can be parsed without schema drift.
- **SC-002**: In all violation-free scenarios, exit code is `0` and `decision` is `PASS`.
- **SC-003**: In at least 10 deterministic policy violation scenarios, exit code is `1` and output includes both rule context and reason codes.
- **SC-004**: In at least 8 environment/input-precondition scenarios, decision is `HUMAN_REVIEW`, exit code is `2`, and reason code is stable and explicit.
- **SC-005**: Repeated execution of the same check scenario without repo changes yields byte-identical `--json` `decision`, `reason_codes`, and ordered `violations`.
- **SC-006**: `status --budget` (human and JSON) displays live usage counters within 1 second for small-to-medium local repositories and does not alter lifecycle state.

## Assumptions

- Deterministic diff extraction and rule evaluation from SPEC-002 is authoritative and remains the single source of policy truth.
- Reason codes are used to improve machine interoperability and are not intended as user-facing replacements for readable messages.
- Decision mapping is additive and independent of lifecycle transitions (`init`, `start`, `close`).

## Explicit Non-Goals

- Auto-repair or auto-revert.
- Autonomous change recommendations based on ML/LLM during rule evaluation.
- Enforcement logic that bypasses SPEC-002 policy primitives.
- Web UI, dashboards, remote services, or telemetry integrations.
- Multi-repository cross-budget aggregation in this specification.

## Compatibility Impact

- **Model compatibility**: The existing `check` result fields (`status`, rule counters, violations, path/limit results) remain present and interpretable; only additional decision/reason-layer metadata is added.
- **Behavioral compatibility**: Existing structural validation, contract parsing, and non-mutating `check` execution from SPEC-002 are preserved.
- **CLI compatibility**: Existing `check` positional and `--draft` flags remain valid; `--json` and `--budget` additions are additive and backward-compatible.
- **Reporting compatibility**: Human text output remains concise and readable while adding explicit decision and reason sections.
