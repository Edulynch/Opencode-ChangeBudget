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

1. **Given** an active contract with provenance-qualified hard ceilings `max_files=5` and `max_changed_lines=80`, **When** `check` finds all counts within those limits and no path violations or failed evaluation preconditions, **Then** decision is `PASS`, all summary fields are within limits, and command exits with the PASS code.
2. **Given** a single changed file outside `allow_paths` and no failed evaluation precondition, **When** `check` runs, **Then** violation includes a stable reason code, decision is `REPAIR`, and command exits with the REPAIR code.
3. **Given** a deny-path violation and an exceeded provenance-qualified hard numeric ceiling in the same result, with no failed evaluation precondition, **When** `check` runs, **Then** both are reported and decision remains `REPAIR`.
4. **Given** a verified soft planner/agent estimate is exceeded but no other rule or evaluation precondition fails, **When** `check` runs, **Then** the drift remains an auditable advisory, is not a violation, and does not alone prevent `PASS`.
5. **Given** valid repository, contract, and base prerequisites and a legacy non-null numeric value with unknown or ambiguous provenance whose hard-versus-soft classification is necessary for safe evaluation, **When** `check` runs, **Then** it does not infer a hard-cap violation or return `PASS`; it returns `HUMAN_REVIEW` with an explicit reason and recovery guidance.
6. **Given** valid repository, contract, and base prerequisites and a known path/capability violation that coexists with such an unresolved numeric evaluation precondition, **When** `check` runs, **Then** it reports every known violation and preserves deny/protected boundaries, while `HUMAN_REVIEW` takes precedence over `REPAIR` as the final decision.

---

### User Story 2 - Integrate with scripts and CI by parsing structured output (Priority: P1)

As an automation author, I need `changebudget check --json` to return stable machine fields so scripts can branch without parsing human output.

**Why this priority**: This is the bridge from manual feedback to reliable CI enforcement.

**Independent Test**: A script reads `--json` output and maps `PASS` to success, `REPAIR` to actionable block, and `HUMAN_REVIEW` to manual escalation.

**Acceptance Scenarios**:

1. **Given** a normal pass, **When** the script runs, **Then** it reads `decision: PASS` and exit code `0`.
2. **Given** a path violation or an exceeded provenance-qualified hard numeric ceiling, **When** the script runs, **Then** it reads `decision: REPAIR`, `reason_codes` contain at least one stable rule code, and exit code matches REPAIR code.
3. **Given** repository, contract, and base prerequisites are valid but a material legacy numeric value has unknown or ambiguous provenance, **When** the check can safely produce a completed decision, **Then** it returns `HUMAN_REVIEW`, an explicit review reason/recovery, and the HUMAN_REVIEW exit code.
4. **Given** an unresolved base revision or non-git context, **When** `check` runs, **Then** the existing hard Git/command error and exit behavior is returned before decision-result creation; it does not report `HUMAN_REVIEW`.

---

### User Story 3 - Keep human output concise and explainable for review (Priority: P1)

A developer needs to understand exactly what failed and why without opening internal logs or parsing JSON first.

**Why this priority**: Human visibility is required even when automation is present.

**Independent Test**: Run `check` with one `deny_paths` violation and one exceeded provenance-qualified hard `max_changed_lines` ceiling and verify text output lists both with path, expectation, and observed values in deterministic order.

**Acceptance Scenarios**:

1. **Given** a protected path is changed and a provenance-qualified hard line ceiling is exceeded, with no failed evaluation precondition, **When** `check` runs, **Then** text output shows both reasons with clear rule labels.
2. **Given** there are no violations and no failed evaluation precondition, **When** `check` runs, **Then** output explicitly shows no violations and still includes decision context.

### User Story 4 - Expose live budget usage in `status` without changing lifecycle behavior (Priority: P2)

As a team member checking context quickly, I want `changebudget status` to show current budget consumption so I can decide next steps before editing.

**Why this priority**: It shortens feedback loops and avoids extra `check` calls in routine commanding.

**Independent Test**: With an active contract and working-tree changes, run `changebudget status --budget`, then verify usage fields align with `check` results.

**Acceptance Scenarios**:

1. **Given** active contract and working-tree modifications, **When** `status --budget` runs, **Then** it shows computed `changed_files`, `changed_lines`, binary/new/deleted/renamed counts and last known decision.
2. **Given** no active contract, **When** `status --budget` runs, **Then** it reports the reason, no mutation occurs, and the command returns deterministic non-success when appropriate.

### Edge Cases

- How are decisions resolved when path violations and provenance-qualified hard budget violations both exist in the same check?
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
  - no provenance-qualified hard numeric limit violations exist (`max_files`, `max_changed_lines`); soft estimate overruns are not policy limit violations,
  - no path policy violations exist (`allow_paths`, `deny_paths`),
  - and no deterministic evaluation precondition failed, including an unresolved numeric classification when that classification is necessary for the evaluation or an authority-dependent operation.

- **FR-003**: `REPAIR` decision is produced when at least one concrete rule violation exists in deterministic evaluation and no failed safe-evaluation precondition requires `HUMAN_REVIEW`. Concrete violations include existing path/capability violations and an exceeded provenance-qualified hard numeric ceiling. A soft estimate overrun alone is not a concrete violation and MUST NOT produce `REPAIR`.

- **FR-004**: `HUMAN_REVIEW` is a completed check decision, not a replacement for fatal command prerequisites. Produce it for unknown/ambiguous numeric provenance only when repository, contract, and base prerequisites are valid, evaluation has enough context to safely produce the result, and the numeric classification is material. A truly completed partial evaluation may also use `HUMAN_REVIEW` only where an existing supported result path can safely produce it. Unresolved base revision, non-git context, invalid/broken contract or contract source, malformed input/path pattern, and other hard argument/environment/repository/state failures retain their existing CLI error behavior under SPEC-002 and FR-014; they do not become `HUMAN_REVIEW` results. For a completed unresolved-provenance result, do not guess a hard-cap violation or silently treat the value as soft. Give an explicit reason and recovery guidance to obtain fresh valid human authorization or verify trusted policy provenance through a supported workflow; do not forge retroactive evidence or silently broaden authority. Under the existing status vocabulary, this is non-PASS (`status: FAIL`) without fabricating a concrete violation. If known concrete violations coexist, report them all and preserve deny/protected boundaries, but `HUMAN_REVIEW` takes precedence as the final decision. This is a check outcome, not an `ASK` substitute: Guardian MUST BLOCK an operation that relies on unresolved authority.

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

  Use the existing taxonomy where a code accurately identifies the outcome. This amendment does not define a new code for unresolved numeric provenance; do not mislabel it with an unrelated existing code. Its stable reason-code/representation mapping is a planning item, while the HUMAN_REVIEW outcome and explicit reason/recovery guidance are normative.

- **FR-007**: Existing deterministic rule names and counts from SPEC-002 remain unchanged (`max_files`, `max_changed_lines`, `allow_paths`, `deny_paths`, and core file/line counters), and existing deterministic path and metric computation is reused. Only a provenance-qualified hard `max_files`/`max_changed_lines` value is enforceable as a numeric ceiling; a soft planner/agent/preset/advisor estimate overrun is a separately auditable advisory, not a violation or `REPAIR`/`HUMAN_REVIEW` by itself. Unknown/ambiguous origin is `UNRESOLVED` when classification is necessary and follows FR-004. Preserve the legacy value without schema migration; the existing contract shape has no numeric-origin field, and a number, `max_*` name, preset selection/label, task budget/default, CLI invocation, free-text reason, storage, or historical result does not prove issuer or boundary intent. Verifiable direct human input must establish both the exact numeric boundary and intent as a ceiling; trusted policy provenance must establish that exact boundary. A verifiable recommendation without hard adoption is soft. Do not add a field/schema, reason code, or final taxonomy in this requirement.

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

- **FR-014**: Existing hard error classes for check argument validation, environment failures, and repository/state errors MUST continue to surface through deterministic error text and use documented non-check exit behavior outside the decision mapping. This includes an unresolved base revision and non-git context under SPEC-002's CLI contract; neither produces a completed `HUMAN_REVIEW` decision or uses its exit-code mapping.

The normative distinctions in FR-004 and FR-014 supersede any stale historical SPEC-003 plan/task wording that mapped unreachable-base or non-git hard errors to `HUMAN_REVIEW`; those historical artifacts are not amended here.

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
- **SC-002**: In all scenarios with no concrete violations and no failed evaluation precondition, exit code is `0` and `decision` is `PASS`.
- **SC-003**: In at least 10 deterministic policy violation scenarios (including numeric-limit cases only when a provenance-qualified hard ceiling is exceeded), exit code is `1` and output includes both rule context and reason codes.
- **SC-004**: In at least 8 supported scenarios where check can safely produce a completed decision but an evaluation precondition remains unresolved (including material unknown numeric provenance), decision is `HUMAN_REVIEW`, exit code is `2`, and the review reason is explicit. Fatal argument/environment/repository/state errors remain outside this decision mapping under FR-014.
- **SC-005**: Repeated execution of the same check scenario without repo changes yields byte-identical `--json` `decision`, `reason_codes`, and ordered `violations`.
- **SC-006**: `status --budget` (human and JSON) displays live usage counters within 1 second for small-to-medium local repositories and does not alter lifecycle state.
- **SC-007**: Soft estimate overruns remain deterministic, auditable advisory observations, not violations or authority restrictions; exceeding one alone does not change a violation-free result from `PASS`.
- **SC-008**: In every case where unknown/ambiguous numeric provenance is necessary for safe evaluation, `check` does not return `PASS` or fabricate a hard-cap violation; it returns `HUMAN_REVIEW`, preserves any known concrete violations, and gives explicit recovery guidance.
- **SC-009**: A contract with no numeric values to classify remains valid; missing historical provenance alone does not invalidate it or require a schema migration.

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
- **Numeric-provenance compatibility**: Existing contract documents remain readable and structurally valid without schema migration. Provenance classification uses verifiable evidence and the SPEC-002 legacy rule; unknown/ambiguous provenance is not silently treated as a human grant or soft estimate. No final field, store, or new reason code is defined by SPEC-003.
- **Behavioral compatibility**: Existing structural validation, contract parsing, and non-mutating `check` execution from SPEC-002 are preserved.
- **CLI compatibility**: Existing `check` positional and `--draft` flags remain valid; `--json` and `--budget` additions are additive and backward-compatible.
- **Reporting compatibility**: Human text output remains concise and readable while adding explicit decision and reason sections.

The HUMAN_REVIEW decision reports a failed or incomplete check evaluation; it is not itself permission to proceed or an authorization request. Under Guardian's separate runtime policy, an operation that relies on unresolved authority is blocked, not allowed through an `ASK` in place of valid provenance. A concrete violation remains reportable even when a failed safe-evaluation precondition takes decision precedence.
