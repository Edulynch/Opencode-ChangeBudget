# Data Model: Working Tree Baseline

The following is a planning model for persisted evidence and comparison. It does not prescribe an exact JSON schema, snapshot serialization, hash algorithm, or Git command sequence.

## WorkingTreeBaseline

Represents the contract-start observable boundary.

| Field | Type | Meaning |
|---|---|---|
| `comparison_mode` | `baseline` or `legacy` | Explicit discriminator. `legacy` is recognized only for an older schema that lacks this field and has no baseline reference. |
| `contractId` | contract identifier | Contract that owns the evidence. |
| `baseRevision` | Git revision | Retained for compatibility and legacy behavior. |
| `entries` | ordered baseline entries | Start-state observations required for safe comparison. |
| `evidenceRef` | opaque local reference | Association to persisted evidence. |
| `integrity` | integrity descriptor | Digest and validation state for persisted evidence. |
| `activationToken` | opaque token | Captured lifecycle version used to reject stale or competing pointer activation. |
| `activationHead` | exact Git commit identity | HEAD captured at activation for baseline-enabled contracts. Check requires exact equality; legacy contracts have no binding. |

## BaselineEntry

Describes one repository path at start.

| Field | Type | Meaning |
|---|---|---|
| `path` | normalized repository path | Slash-normalized identity, ordered by code units. |
| `identity` | Git/platform identity | Native identity where recoverable; never global lowercase. |
| `objectType` | descriptor | Regular file, directory participation, symlink, gitlink, or other supported object. |
| `participation` | descriptor | Tracked, staged, unstaged, untracked, deleted, renamed, or current modeled state. |
| `mode` | repository mode | Relevant mode or type state. |
| `contentEvidence` | Git reference or private snapshot reference | Recoverable Git evidence or immutable private value snapshot under `.changebudget/**`. |
| `contentDescriptor` | metadata | Size, binary classification, and other comparison metadata needed for safe behavior. |
| `sourcePath` | optional path | Rename source when required by current modeling. |
| `destinationPath` | optional path | Rename destination when required by current modeling. |

Content snapshots are private evidence associated with the contract. They are not user files, are not permission lists, and are not exposed as policy exceptions. Symlink evidence is the link value. Gitlink evidence is the recorded commit. Nested submodule worktree content is not recursively included.

## Integrity validation matrix

Before comparison or PASS, a baseline-enabled artifact validates canonical repository paths, unique entry identities, contract and evidence association including `activationHead`, complete required entries and payloads, payload and integrity evidence, and supported schema and entry types. Missing, mismatched, duplicated, malformed, partial, unsupported, or ambiguous values remain nonlegacy and yield HUMAN_REVIEW, never PASS. A canonical path collision is resolved only when safe resolution is proven; otherwise it yields HUMAN_REVIEW.

### Stable diagnostic grouping

Public detailed diagnostics for baseline-enabled integrity and HEAD conditions MUST use the following compact categories. Existing internal or persisted reason values may remain where compatible, but they MUST map to one category here.

| Category | Condition |
|---|---|
| `BASELINE_REQUIRED_MISSING` | Missing baseline reference, artifact, required entry, or payload |
| `BASELINE_CORRUPT` | Malformed artifact or failed payload/integrity verification |
| `BASELINE_MISMATCH` | Contract/evidence association mismatch or identity collision |
| `BASELINE_UNSUPPORTED` | Unsupported schema or entry type |
| `BASELINE_PATH_AMBIGUITY` | Duplicate canonical path, invalid path identity, or unresolved path ambiguity |
| `BASELINE_HEAD_MOVED` | Current HEAD differs from the exact activation-captured HEAD |
| `BASELINE_UNSTABLE_CAPTURE` | Observe-before/capture/observe-after inconsistency or exhausted TOCTOU retry |
| `BASELINE_SUBMODULE_DIRTY` | Unsupported dirty nested submodule work outside gitlink semantics |

Each category maps to HUMAN_REVIEW and never PASS for a baseline-enabled condition.

## EvidenceIntegrity

Controls whether evidence can be trusted.

| State | Meaning | Safe result |
|---|---|---|
| `valid` | Complete evidence and digest verify | Compare normally. |
| `legacy` | No baseline reference on an older contract | Use base-revision semantics and disclose mode. |
| `missing` | Referenced evidence cannot be found | `HUMAN_REVIEW`, never PASS. |
| `corrupt` | Structure or content is malformed | `HUMAN_REVIEW`, never PASS. |
| `tampered` | Integrity digest does not verify | `HUMAN_REVIEW`, never PASS. |
| `unavailable` | Required evidence cannot be read safely | `HUMAN_REVIEW`, never PASS. |

## PostStartChangeSet

The comparison result before policy evaluation.

| Field | Type | Meaning |
|---|---|---|
| `items` | `BudgetChangeItem[]` | Equivalent effective post-start change list passed to existing rules. |
| `excludedUnchangedCount` | integer | Aggregate count of unchanged pre-existing entries. |
| `stagingTransitionCount` | integer | Optional diagnostic aggregate, absent from normal output. |
| `mode` | `baseline` or `legacy` | Internal comparison mode used. |
| `evidenceState` | integrity state | Evidence condition supporting the result. |
| `decision` | existing decision | `PASS`, `REPAIR`, or `HUMAN_REVIEW` according to existing rules and safe evidence handling. |
| `reasonCode` | stable identifier | Internal reason value; public JSON uses `reasonCodes`. |

`items` preserves current semantics: binary entries contribute zero changed lines, rename source and destination participation remains compatible, and byte-identical staging transitions are absent.

## Lifecycle artifacts

The contract references complete evidence. Evidence and snapshots are stored only under `.changebudget/**`; `.git/**` is never written by capture. The evidence is persisted before the contract is persisted. The state file's active contract pointer is written last using a concurrency check. Close changes contract lifecycle metadata but retains the evidence association for audit. A baseline-mode contract with invalid or missing evidence remains baseline mode and cannot become legacy or PASS.

## Canonical new public JSON

The public JSON shape uses only `comparisonMode`, `baselineState`, `decision`, `reasonCodes`, `excludedUnchangedCount`, `detectedDeltaCount`, and optional `stagingTransitionCount`. `baselineState` is exactly `captured`, `legacy`, `unavailable`, `invalid`, or `incompatible`. Detailed causes appear only in `reasonCodes`. No snake_case or alternate aliases are public; snake_case remains an internal or persisted schema convention only.
