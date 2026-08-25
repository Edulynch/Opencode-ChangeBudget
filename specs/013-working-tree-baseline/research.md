# Research: Working Tree Baseline

## Decision: Use a hybrid baseline

Use Git-native identities and modes wherever the current or future comparison can recover them. Store private immutable content snapshots only for dirty tracked and untracked file values that Git cannot later recover. Every entry carries a descriptor and contributes to an evidence integrity digest.

This is smaller than copying every repository object, but safer than storing only paths, timestamps, or status flags. A path present at start is never ignored by name. The comparator must prove that the effective current state is unchanged before excluding it.

## Decision: Preserve current check anchors

`collectChangedItems` and `evaluateBudgetCheck` remain compatibility anchors. Baseline comparison produces an equivalent post-start `BudgetChangeItem[]`, including current file, line, binary, rename, and staging fields. Existing rule evaluation then runs without a second policy engine. Legacy contracts call the current base-revision collection path.

## Decision: Treat Git state as evidence, not timestamps

Git object identity, mode, type, index/worktree participation, and recoverable content are authoritative. Modification times may be observed for operational purposes but never decide equality, exclusion, or safety. No timestamp fallback exists.

## Decision: Persist evidence before activation

The lifecycle is validate, capture, persist evidence, persist contract, activate pointer. Evidence and contract writes use existing atomic persistence boundaries. Failure cleanup removes incomplete evidence and contract where possible. The active pointer is not written until both are complete. After activation, missing, corrupt, tampered, or unavailable evidence produces `HUMAN_REVIEW`, never PASS.

The contract carries an explicit `comparison_mode` and, at activation, the exact HEAD commit identity. At check, exact HEAD equality allows normal B-to-C evaluation. Any inequality produces `BASELINE_HEAD_MOVED` and HUMAN_REVIEW, never PASS, without rewriting baseline or history. A return to the captured commit resumes only after integrity validation. Only an older contract schema lacking that discriminator and lacking a baseline reference is recognized as legacy. Missing evidence on a baseline-enabled contract is an invalid baseline state, never a legacy fallback.

Activation uses a lifecycle token and pointer-last compare-and-swap behavior. A competing activation or stale token is rejected. Crash recovery accepts only an old pointer or a fully verifiable new pointer. No partial pointer can be treated as active.

## Decision: Keep object and path semantics explicit

NUL-delimited Git output is parsed strictly. Malformed records are errors, not omissions. Paths are slash-normalized and sorted by stable code-unit order. Repository and platform identity rules apply without global lowercasing. Case-only renames are meaningful when the platform and repository can distinguish them. Ambiguity resolves deterministically or fails safely.

The baseline treats a symlink as the symlink object and its value, not its target. A tracked submodule is a gitlink and its recorded commit, not a recursive nested worktree. Unsupported nested dirty submodule work is disclosed as `HUMAN_REVIEW`.

## Decision: Make staging transitions budget-silent

Staging or unstaging byte-identical content does not create a post-start file or line change and produces no normal-output noise. If content, creation, deletion, rename, mode, type, symlink value, or gitlink state also changes, that semantic delta remains in the effective change list. An explicit diagnostic may report only an aggregate transition count.

## Decision: Use an observe-before/capture/observe-after protocol

Each required value is observed before reading, captured into private `.changebudget/**` evidence, and observed again. Identity, mode, type, size, and content or digest evidence must agree. Integrity validation also requires canonical repository paths, unique entry identity, contract and evidence association, complete entries and payloads, and supported schema and entry types. A bounded retry handles a transient change; exhaustion is an explicit unsafe failure with no active contract. Timestamps are never used as authority. `.git/**`, the index, refs, commits, stash, and nested worktrees remain read-only.

## Decision: Preserve evaluator accuracy

The comparator is checked against an independent B-to-C fixture oracle. Every changed-after-start entry must be emitted once, every unchanged pre-existing entry must be excluded, and unknown state must fail safely. The projected list retains the existing `BudgetChangeItem[]` shape and goes through the existing evaluator, so accuracy includes both detection and unchanged policy evaluation.

New public JSON is limited to the camelCase fields `comparisonMode`, `baselineState`, `decision`, `reasonCodes`, `excludedUnchangedCount`, `detectedDeltaCount`, and optional `stagingTransitionCount`. `baselineState` is exactly `captured`, `legacy`, `unavailable`, `invalid`, or `incompatible`; detailed causes exist only in `reasonCodes`. Internal and persisted schemas may retain existing conventions, with no public aliases.

## Decision: Measure storage without inventing a limit

The many-untracked fixture records entry count, evidence bytes, capture time, persistence time, and comparison time on Windows and Ubuntu. These measurements describe observed cost and do not become a fixed threshold. Complete evidence and safe failure take precedence over arbitrary size limits.

## Alternatives rejected

* Full working-tree copy: rejected as unnecessary storage and a second repository representation when Git can recover most identities and content.
* Path-only baseline: rejected because it would hide later edits to pre-existing files and weaken all enforcement rules.
* Timestamp baseline: rejected because timestamps are not authoritative and vary across platforms.
* Automatic reconstruction for old contracts: rejected by the specification and unsafe after the original start boundary is gone.
* Rewriting Git state to create a comparison ref or index: rejected because capture must not mutate files, index content, refs, or commits.

## Testing research

The acceptance matrix defines 56 scenarios, including five HEAD binding cases and twelve integrity cases. Focused tests should first lock parsing, ordering, descriptors, integrity, effective staged/worktree state, binary zero-line behavior, renames, special objects, and cleanup. Lifecycle tests should then cover restart, close retention, mode reporting, legacy behavior, and failure-safe activation. Full typecheck, build, test suite, and Windows/Ubuntu coverage are future implementation validation, not evidence available from this planning task.
