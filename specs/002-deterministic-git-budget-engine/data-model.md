# Data Model: SPEC-002

## Purpose

This document defines the data entities used for deterministic budget checks and the required derived outputs for `changebudget check`.

## Entity: Change Contract (existing)

Stored as `.changebudget/contracts/<contract-id>.json` and used unchanged from SPEC-001.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `base_revision` | string | yes | git revision reference that resolves to a commit | used as comparison anchor for all metrics |
| `allow_paths` | array<string> | no | each entry is a validated glob-like path pattern | empty list means allow-all base behavior |
| `deny_paths` | array<string> | no | each entry is a validated glob-like path pattern | denies override allow list |
| `max_files` | number / null | no | non-negative integer or null | file budget limit |
| `max_changed_lines` | number / null | no | non-negative integer or null | line budget limit |

No schema change is required in SPEC-002.

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

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `limitName` | string | yes | `max_files` or `max_changed_lines` | identifies evaluated budget control |
| `expected` | number | yes | null when limit is not defined | contract-defined maximum |
| `observed` | number | yes | computed metric | integer for this spec |
| `status` | string | yes | `pass`, `fail`, or `skip` | skip means contract value is null |

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
| `status` | string | yes | `PASS` or `FAIL` | final check result |
| `asOf` | string | yes | ISO-8601 UTC timestamp | when check ran |

## Validation and Evaluation Rules

- `changed_file_count` is computed after canonicalization and deduplication, not after filtering path policy violations.
- `changed_lines_count` aggregates only measurable text line contributions. Binary paths count as file-level changes and non-text line contribution fallback is deterministic.
- `pathRuleResults` is computed after canonical set is built and after path normalization. Deny rules always win over allow rules.
- `allow_paths` non-empty means every changed path must match at least one allow pattern unless deny matches.
- `status` is `PASS` only when all evaluated rules have passing status.

## Relationship to Existing State Entities

- SPEC-002 reads active contract from existing lifecycle state (`state.active_contract_id`) or draft JSON.
- No new fields are added to lifecycle state or contracts for this feature.
- `check` still uses the same deterministic read-only path as SPEC-001 for state and contract IO.
