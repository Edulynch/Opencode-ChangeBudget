# Contract: Working Tree Baseline

This contract defines the future public behavior of baseline-aware lifecycle commands. It does not invent new flags, policy categories, exit-code meanings, or exact storage serialization.

## Comparison modes

* **Baseline mode**: `comparison_mode=baseline` and complete contract-start evidence, including the exact HEAD commit captured at activation. Current HEAD must equal that identity for normal B-to-C comparison. Current state is compared with that boundary, and only post-start effective deltas are passed as an equivalent `BudgetChangeItem[]` to existing evaluation rules.
* **Legacy/no-baseline mode**: `comparison_mode` is absent because the contract uses an older schema, and no baseline reference exists. Current base-revision behavior remains authoritative, the mode is disclosed, and no baseline is reconstructed.
* **Unsafe baseline evidence**: A baseline-enabled contract has missing, malformed, corrupt, tampered, unavailable, or unsupported required evidence. It remains baseline mode, uses the existing `HUMAN_REVIEW` path, and PASS is prohibited.

## `start`

`start` validates the repository, input, base revision, policy configuration, and required repository context. It captures the contract-start working tree without changing user files, index content, refs, commits, or nested worktrees.

Capture uses Git-native identities and modes where recoverable. It stores private immutable snapshots and metadata only under `.changebudget/**`, only for dirty tracked and untracked values Git cannot later recover, with descriptors and an integrity digest. `.git/**`, the index, refs, commits, stash, and nested worktrees are read-only. Timestamps are not authority. Symlinks are captured as link objects and values, not targets. Gitlinks are captured as recorded commits, not nested dirt.

Activation binds the baseline-enabled contract to the exact observed HEAD commit identity. At check, any inequality yields `BASELINE_HEAD_MOVED` and HUMAN_REVIEW, never PASS, without rewriting baseline or history. If HEAD moves away and returns exactly to the captured identity, normal comparison resumes only after integrity validation. Legacy contracts have no HEAD binding.

The observable lifecycle is validate, observe-before/capture/observe-after, persist evidence, persist contract, activate pointer. A bounded consistency failure aborts start. Activation uses a lifecycle token and is pointer-last, so a competing activation or stale token is rejected. A failure removes incomplete evidence and contract where possible and never activates the pointer. Start does not stash, commit, reset, restore, widen scope, or mutate Git state.

## `status --budget`

For an active baseline contract, status reports baseline mode and evaluates the current state through the same policy result model used by check. It gives concise deterministic summaries for unchanged pre-existing exclusions, detected post-start deltas, and unsafe evidence. It does not emit normal-output noise for byte-identical staging transitions. Structured diagnostics may include an aggregate transition count.

For a legacy contract, status reports legacy/no-baseline mode and retains base-revision results. For missing or invalid evidence, status exposes `HUMAN_REVIEW` and an actionable reason rather than PASS.

## `check`

`check` reloads persisted evidence for each invocation. Baseline comparison excludes only entries proven unchanged from contract start. Any later edit to a pre-existing tracked or untracked entry is evaluated by all existing file, line, path, dependency, configuration, migration, public API, stack, deny, and budget rules.

Staging and unstaging of byte-identical content are budget-silent. Content deletion or creation, rename source or destination participation, mode or type changes, symlink value changes, and gitlink changes remain evaluated. Binary changes are file-level and contribute zero changed lines. Strict NUL parsing, stable ordering, slash-normalized paths, deny precedence, `.changebudget/**` exclusion, case-only rename handling, and safe ambiguity behavior remain in force.

The result retains existing PASS, REPAIR, and HUMAN_REVIEW meanings, output compatibility, and exit-code meanings. No baseline condition grants permission to modify denied or sensitive paths.

## `close`

`close` retains existing human-authority semantics and lifecycle behavior. Closing a baseline-aware contract does not discard its evidence association. The closed contract remains auditable. Close does not redefine validation authority, reconstruct evidence, or change policy results retroactively.

## Safety boundaries

The baseline is an audit boundary, not a permission list. It cannot whitelist a path merely because it existed at start. Unsupported policy-critical objects or platform ambiguity fail safely. Nested dirty submodule work outside gitlink semantics is disclosed as unsupported with deterministic `HUMAN_REVIEW`.

No command changes existing rule precedence, introduces timestamps as authority, mutates Git state, or changes legacy behavior. `tasks.md` is intentionally frozen during this correction pass and must be regenerated after the authoritative planning artifacts change. Production and test implementation remain out of scope for this pass.

## Structured output contract

New public JSON identifies only `comparisonMode`, `baselineState`, `decision`, `reasonCodes`, `excludedUnchangedCount`, `detectedDeltaCount`, and optional `stagingTransitionCount`, exclusively in camelCase. `baselineState` is exactly `captured`, `legacy`, `unavailable`, `invalid`, or `incompatible`; detailed causes exist only in `reasonCodes`, with no aliases. Snake_case names are internal or persisted schema conventions only and are not public output. Existing internal reason values may remain where compatible, but public detailed diagnostics for the conditions below MUST use the listed stable category.

| Stable diagnostic category | Corresponding condition |
|---|---|
| `BASELINE_REQUIRED_MISSING` | Missing baseline reference, artifact, required entry, or payload |
| `BASELINE_CORRUPT` | Malformed artifact or failed payload/integrity verification |
| `BASELINE_MISMATCH` | Contract/evidence association mismatch or identity collision |
| `BASELINE_UNSUPPORTED` | Unsupported schema or entry type |
| `BASELINE_PATH_AMBIGUITY` | Duplicate canonical path, invalid path identity, or unresolved path ambiguity |
| `BASELINE_HEAD_MOVED` | Current HEAD differs from the exact activation-captured HEAD |
| `BASELINE_UNSTABLE_CAPTURE` | Observe-before/capture/observe-after inconsistency or exhausted TOCTOU retry |
| `BASELINE_SUBMODULE_DIRTY` | Unsupported dirty nested submodule work outside gitlink semantics |

Each category maps to HUMAN_REVIEW and never PASS for a baseline-enabled condition. Normal output remains concise and byte-identical staging transitions remain silent.

## Integrity validation matrix

Before comparison or PASS, validate canonical repository paths, unique entry identity, contract/evidence/HEAD association, completion of entries and payloads, payload and integrity evidence, and supported schema and entry types. Every baseline-enabled failure remains nonlegacy and yields HUMAN_REVIEW, never PASS. A path collision is resolved deterministically only when proven safe; otherwise it yields HUMAN_REVIEW.

## B-to-C evaluator contract

The comparator compares baseline state B with current state C. Identical content and relevant object state are excluded. Content, deletion, creation, rename participation, mode, type, symlink value, and gitlink changes are emitted and evaluated. Binary changes contribute zero lines. Every emitted item is passed once to the existing evaluator, and unknown state fails safely rather than being excluded. Required fixture accuracy is 100 percent changed-after-start detection with zero false exclusions.
