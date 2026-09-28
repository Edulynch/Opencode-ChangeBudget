# Data Model: SPEC-002

## Purpose

This document defines the data entities used for deterministic budget checks and the required derived outputs for `changebudget check`.

## Entity: Change Contract (existing)

Stored as `.changebudget/contracts/<contract-id>.json` with the existing SPEC-001 storage shape. Existing contracts remain readable and structurally valid without migration; numeric authority classification at evaluation is qualified by FR-021 in `spec.md`.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `base_revision` | string | yes | git revision reference that resolves to a commit | used as comparison anchor for all metrics |
| `allow_paths` | array<string> | no | each entry is a validated glob-like path pattern | empty list means allow-all base behavior |
| `deny_paths` | array<string> | no | each entry is a validated glob-like path pattern | denies override allow list |
| `max_files` | number / null | no | non-negative integer or null | file budget limit |
| `max_changed_lines` | number / null | no | non-negative integer or null | line budget limit |

No schema change is required in SPEC-002, and the existing contract shape has no numeric-origin field. These stored numeric fields contain values, not proof of issuer or intent. Do not infer hard-ceiling authority from a number, `max_*` name, preset selection/label, task budget/default, CLI invocation, free-text reason, persistence, or historical check result. Verifiable exact human ceiling authority or trusted policy provenance is required for HARD; verifiable unadopted planner/preset/advisor recommendations are SOFT; unknown or ambiguous provenance is UNRESOLVED. The full deterministic legacy rule and recovery behavior are in `spec.md` FR-021. This is an evaluation qualification, not a new field, schema, or migration.

### Guardian provenance cross-reference (planning only; no schema change)

For a future runtime authority check, classify the evidence for an existing contract value as (a) a verified human authorization event for the exact ceiling/scope, (b) trusted exact policy provenance, (c) a verifiable but unadopted recommendation (SOFT only), or (d) absent/ambiguous (UNRESOLVED). A contract value, its `max_*` name, a task identifier, execution-envelope/permission metadata, or a historic check result is not issuer evidence. Preserve FR-021's legacy readability and check behavior; do not retrofit a grant or silently upgrade old numbers.

As a planning-level correlation only, a ChangeBudget-minted `ChangeContract.id` can identify one bounded unit of work, including a draft created before `START` is activated. `task_id` remains optional SpecKit correlation and is not the work authority or issuer. Each unrelated work item needs a separate contract identity. A verified grant must refer to ChangeBudget-owned evidence of the exact native human authorization event, repository binding, bounded work identity, authority version, exact scope/capabilities/ceilings, provenance, and lifecycle status; no such fields, evidence location, schema, or migration are established here. Existing contract snapshots/amendment values do not on their own authenticate who supplied the value. If available ChangeBudget-owned history cannot preserve and validate the necessary pre-start event and subsequent audit evidence, implementation design may consider the smallest local evidence journal associated with the draft/contract; that is not a selected file path or a new SPEC-002 entity. SPEC-004 product decisions are finalized for planning; physical identity and installed-host behavior remain implementation-validation dependencies, not task-generation gates. Its selected local model uses a user-owned registry outside the repository, a repo-local public reference, and a physical ChangeBudget anchor associated with Git common-dir. HARD binding fails closed if genuine physical identity is unavailable or unreliable, with no path/remote/copied-UUID fallback; routine non-HARD operations may continue. This local registry is not a cloud/global grant database.

## Entity: BudgetChangeItem

Represents one path-level changed artifact in deterministic evaluation.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `path` | string | yes | repository-relative path with `/` separators | primary changed location |
| `sourcePath` | string | no | repository-relative source path for renames | present for rename source event |
| `destinationPath` | string | no | repository-relative destination path for renames | present for rename destination event |
| `type` | string | yes | `added`, `modified`, `deleted`, `renamed` | normalized operation type |
| `addedLines` | number | yes | integer >= 0 | deterministic line additions when measurable |
| `removedLines` | number | yes | integer >= 0 | deterministic line removals when measurable |
| `isBinary` | boolean | yes | true when line content is not text-measured | deterministic for repeated runs |

## Entity: PathRuleResult

Represents deterministic path policy outcome per changed path.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `path` | string | yes | normalized repository-relative path | changed path being evaluated |
| `matchedAllow` | boolean | yes | true when path matches at least one allow pattern or allow list is empty | normalized result |
| `matchedDeny` | boolean | yes | true when path matches deny pattern | deny has precedence |
| `status` | string | yes | `allow` or `deny` | deterministic final policy classification |

## Entity: LimitResult

Represents deterministic numeric limit outcome.

`limitResults` describe enforced numeric ceilings only after they are classified HARD under `spec.md` FR-021. A soft estimate is not a passing/failing hard limit and must be recorded separately as advisory drift; the report/evidence representation is left to planning. An UNRESOLVED value is never marked as a hard-limit failure.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `limitName` | string | yes | `max_files` or `max_changed_lines` | identifies evaluated budget control |
| `expected` | number | yes | null when limit is not defined | stored numeric value; authoritative as a hard ceiling only when provenance-qualified |
| `observed` | number | yes | computed metric | integer for this spec |
| `status` | string | yes | `pass`, `fail`, or `skip` | `skip` means contract value is null; `fail` means an exceeded provenance-qualified hard ceiling, not an estimate overrun or unresolved value |

## Entity: BudgetViolation

Deterministic actionable reason for non-pass behavior.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `rule` | string | yes | e.g., `max_files`, `max_changed_lines`, `allow_paths`, `deny_paths` | identifies failing rule |
| `path` | string | no | optional affected path | path-aware failures when applicable |
| `message` | string | yes | human-readable deterministic reason | stable language template |
| `expected` | number / string | no | optional threshold metadata | included when relevant |
| `observed` | number / string | no | optional measured value | included when relevant |

## Entity: BudgetCheckResult

Output shape for one deterministic check run.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `contractSource` | string | yes | `active` or `draft` | indicates contract origin |
| `contractId` | string | no | present for active contract | for draft may be null |
| `baseRevision` | string | yes | normalized base ref used in evaluation | explicit in output |
| `changedFileCount` | number | yes | integer >= 0 | unique canonical path count |
| `changedLinesCount` | number | yes | integer >= 0 | additive `added + removed` from deterministic text metrics |
| `binaryChangeCount` | number | yes | integer >= 0 | count of non-text changes |
| `newFileCount` | number | yes | integer >= 0 | number of added/new paths in canonical set |
| `deletedFileCount` | number | yes | integer >= 0 | number of deleted paths in canonical set |
| `renamedFileCount` | number | yes | integer >= 0 | number of rename events |
| `pathRuleResults` | array<PathRuleResult> | yes | deterministic order by path | includes all changed paths |
| `limitResults` | array<LimitResult> | yes | deterministic order by limit name | |
| `violations` | array<BudgetViolation> | yes | deterministic order by rule, path, message | explicit outcomes list |
| `status` | string | yes | existing snapshot values `PASS` or `FAIL` | lower-level SPEC-002 result status; after hard command prerequisites pass, `FAIL` also represents a failed decision-level evaluation precondition, while SPEC-003 supplies the final decision/reason layer |
| `asOf` | string | yes | ISO-8601 UTC timestamp | when check ran |

## Validation and Evaluation Rules

- `changed_file_count` is computed after canonicalization and deduplication, not after filtering path policy violations.
- `changed_lines_count` aggregates only measurable text line contributions. Binary paths count as file-level changes and non-text line contribution fallback is deterministic.
- `pathRuleResults` is computed after canonical set is built and after path normalization. Deny rules always win over allow rules.
- `allow_paths` non-empty means every changed path must match at least one allow pattern unless deny matches.
- `status` is `PASS` only when all evaluated rules and required evaluation preconditions pass; after hard command prerequisites pass, `FAIL` is the existing non-PASS status for either concrete violations or a failed decision-level precondition and does not itself assert a concrete violation. Fatal CLI prerequisites prevent result creation instead.
- A non-null numeric value MUST be classified by the verifiable-evidence rule in `spec.md` FR-021. A soft estimate is an auditable advisory observation, not an enforced limit failure; its separate report/evidence representation is a planning item and no result field is defined here.
- An unresolved classification MUST NOT produce a hard-limit violation. After hard repository, contract, and base prerequisites pass, if classification is necessary to evaluate the result or an authority-dependent operation, use the existing `FAIL` status without fabricating a `BudgetViolation`; SPEC-003 supplies the `HUMAN_REVIEW` decision and its review reason/recovery. Fatal CLI prerequisites prevent result creation. The shape above remains a historical SPEC-002 snapshot and does not define a new field/schema or final reason code.
- If that precondition failure coexists with known path/capability violations, preserve and report every concrete violation (including deny/protected paths); SPEC-003 determines the final decision precedence. Check evaluation and classification are deterministic and do not use LLM judgment.

## Relationship to Existing State Entities

- SPEC-002 reads active contract from existing lifecycle state (`state.active_contract_id`) or draft JSON.
- No new fields are added to lifecycle state or contracts for this feature. A legacy numeric value with unresolved provenance does not make the contract unreadable or structurally invalid; it prevents `PASS` only when classification is necessary for safe evaluation, with explicit recovery guidance and no fabricated retroactive grant.
- `check` still uses the same deterministic read-only path as SPEC-001 for state and contract IO.
