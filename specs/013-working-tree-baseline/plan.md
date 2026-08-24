# Implementation Plan: Working Tree Baseline

**Branch**: `013-working-tree-baseline` | **Date**: 2026-08-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-working-tree-baseline/spec.md`

## Summary

SPEC-013 adds a persisted contract-start working-tree boundary. The smallest safe design is a hybrid baseline: use Git-native identities and recoverable modes wherever Git can later provide the required evidence, and retain private immutable content snapshots only for dirty tracked and untracked values that Git cannot later recover. Each baseline entry also carries a descriptor and integrity digest. Activation captures and retains the exact HEAD commit identity for baseline-enabled contracts. At check, exact equality permits normal B-to-C comparison; inequality yields `BASELINE_HEAD_MOVED` and HUMAN_REVIEW, never PASS, without rewriting baseline or history. No timestamp is an authority.

The comparison layer adapts the current observable state into an equivalent post-start `BudgetChangeItem[]`, then passes that list through the existing `evaluateBudgetCheck` rules unchanged. Legacy contracts without baseline evidence continue using the current base-revision behavior. The active pointer is written only after validation, capture, evidence persistence, and contract persistence succeed.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20+

**Primary Dependencies**: Existing Node built-ins, Git, current CLI and rule modules. No new runtime dependency.

**Storage**: Repository-local `.changebudget/contracts/<id>.json`, immutable baseline snapshots and metadata under `.changebudget/**`, and existing `.changebudget/state.json`. `.git/**` is read-only. Exact snapshot serialization and hash algorithm remain implementation choices.

**Testing**: Existing Node test runner, focused unit and contract tests, acceptance fixtures, typecheck, build, and full test suite. Future implementation validation covers Windows and Ubuntu.

**Target Platform**: Local Git repositories on Windows and Ubuntu, with equivalent observable decisions and path behavior.

**Project Type**: Local-first TypeScript CLI.

**Performance Goals**: Keep clean starts lightweight, avoid arbitrary size limits, and make repeated status/check evaluation deterministic without noisy per-entry output.

**Constraints**: Read-only capture with respect to user files and Git state; no timestamp authority, stash, reset, restore, commit, ref or index mutation; `.changebudget/**` remains outside user budgets; no new policy categories or changed exit-code meanings.

**Scale/Scope**: One baseline per contract, covering tracked, dirty, untracked, renamed, deleted, binary, symlink, and gitlink observations required to distinguish post-start work.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

* **PASS - Local-first and deterministic**: Evidence is local, Git-derived where possible, and compared with stable NUL parsing, slash normalization, and code-unit ordering.
* **PASS - Minimal architecture**: One baseline capture/comparison boundary, one evidence persistence boundary, and small model additions avoid a parallel policy engine or service.
* **PASS - Scope is a hard boundary**: Existing collection and evaluation contracts remain compatibility anchors. No new policy category, automatic widening, or legacy reconstruction is planned.
* **PASS - Small changes, small workflows**: Focused baseline tests precede typecheck, build, and the full suite.
* **PASS - Git is the source of truth**: Git-native identities and modes remain authoritative where recoverable; private snapshots only preserve values Git cannot recover later.
* **PASS - Enforcement over suggestion**: Unsafe evidence produces the existing `HUMAN_REVIEW` path and never a convenient PASS.
* **PASS - Human authority**: Start, check, status, and close do not alter user work or contract policy. Close remains a human lifecycle decision.
* **PASS - Explainable decisions**: Reports identify baseline or legacy mode, excluded unchanged entries, deltas, and unsafe evidence reasons.
* **PASS - Quality over complexity**: The hybrid avoids full copies of recoverable Git objects and avoids unsafe metadata-only baselines.

## Phase 0: Research Decisions

Research is complete in [research.md](./research.md). Decisions resolved:

1. Use a hybrid baseline rather than a full repository copy or path-only ignore list.
2. Preserve `collectChangedItems` and `evaluateBudgetCheck` as compatibility anchors by adapting baseline comparison to equivalent `BudgetChangeItem[]` output.
3. Use Git-native identities and modes when recoverable, private snapshots for dirty tracked and untracked values Git cannot recover, plus descriptors and an integrity digest.
4. Persist in the order validate, capture, persist evidence, persist contract, activate pointer. On failure, remove incomplete evidence and contract where possible and never activate the pointer.
5. Keep contracts lacking the new `comparison_mode` discriminator on base-revision semantics as recognized legacy/no-baseline contracts. A baseline-enabled contract with missing evidence remains unsafe baseline mode, never legacy and never PASS.

## Phase 1: Design

### Module boundaries

* `src/core/check/diff.ts` remains the public shape boundary for `BudgetChangeItem[]`. Add a baseline-aware collection path or adapter without changing the legacy path's meaning.
* A focused baseline module owns capture, entry descriptors, snapshot references, digest verification, and comparison of start state with current observable state.
* `src/models/change-contract.ts` gains only the contract reference needed to declare baseline mode and evidence identity. Existing policy fields and statuses remain unchanged.
* `src/core/state/state.ts` and the existing atomic JSON writer own evidence and contract file persistence. Evidence storage may be a contract-associated file or directory, but the plan does not prescribe exact serialization or hash algorithm.
* `src/cli/commands/start.ts` coordinates validation and lifecycle ordering. `check.ts` and `status.ts` select baseline or legacy mode and map invalid evidence to existing safe failure behavior.
* `src/core/check/rules.ts` continues to receive the same effective change-item shape and applies the same path, cardinality, line, binary, rename, stack, deny, and budget rules.

### Capture and comparison semantics

The baseline records path identity according to repository and platform semantics, not global lowercasing. Stable NUL-delimited parsing rejects malformed output. Paths are slash-normalized and ordered by code units. `.changebudget/**` is excluded recursively from user budget collection while Runtime Guard protection remains unchanged.

Git-native entries cover recoverable object identities, modes, types, index/worktree participation, renames, deletions, and gitlinks. A dirty tracked value or untracked value that Git cannot later recover is captured as a private immutable content snapshot. A symlink is captured as the symlink object and value, never its target. A gitlink is captured as its recorded commit, never nested worktree dirt. Binary content has deterministic file-level treatment and zero changed lines.

At check time, the comparator first validates canonical paths, unique entry identity, contract and evidence association, completion, payload and integrity, and supported schema and entry types. It excludes only unchanged pre-existing entries, detects any post-start delta, and emits an equivalent `BudgetChangeItem[]`. Byte-identical staging or unstaging transitions are budget-silent. A transition combined with a content, mode, type, symlink, gitlink, creation, deletion, or rename delta remains evaluated. Case ambiguity resolves deterministically only when proven safe, otherwise HUMAN_REVIEW. Every baseline-enabled integrity failure remains nonlegacy and never PASS. A return to the captured HEAD resumes only if integrity is valid. Legacy contracts have no HEAD binding.

New public JSON uses only `comparisonMode`, `baselineState`, `decision`, `reasonCodes`, `excludedUnchangedCount`, `detectedDeltaCount`, and optional `stagingTransitionCount`. `baselineState` is exactly `captured`, `legacy`, `unavailable`, `invalid`, or `incompatible`; detailed causes appear only in `reasonCodes`, with no aliases. Internal and persisted schemas may retain existing conventions.

### Lifecycle sequence

1. Validate repository, input, base revision, policy configuration, and supported context.
2. Capture all required baseline evidence without mutating files, index, refs, commits, or nested repositories.
3. Persist complete evidence atomically and verify its descriptor and integrity digest.
4. Persist the contract referencing the complete evidence, still not active.
5. Activate the lifecycle pointer only after both persisted artifacts are complete.

If any step fails, remove incomplete evidence and contract where possible. The pointer is never activated. After activation, missing, corrupt, unavailable, or tampered evidence yields `HUMAN_REVIEW` and never PASS. Close marks the contract closed while retaining its evidence association.

### Pointer-last activation, concurrency, and crash table

Activation uses a read-only repository observation and a compare-and-swap style lifecycle token for the active pointer. It never overwrites a pointer changed after validation.

| Event | Required outcome |
|---|---|
| Competing start detected before capture | Reject the start with `BASELINE_CONCURRENT_ACTIVATION`; preserve the existing active pointer |
| Pointer changed while evidence is being prepared | Reject activation as stale; do not replace the newer pointer |
| Crash before evidence persistence | No active contract; no valid-looking evidence required |
| Crash after evidence persistence, before contract persistence | No active pointer; remove incomplete evidence where possible |
| Crash after contract persistence, before pointer activation | No active pointer; contract remains inactive and incomplete artifacts are cleaned where possible |
| Crash during pointer activation | Atomic pointer write yields either the old pointer or the complete new pointer, never a partial pointer |
| Crash after pointer activation | Reload verifies contract and evidence; valid complete artifacts are active, invalid artifacts produce unsafe `HUMAN_REVIEW`, never PASS |

### TOCTOU capture protocol

For each required entry, observe identity, mode, type, size, and content or digest before capture. Read the value into private `.changebudget/**` evidence, then observe the same fields again. Accept only matching before and after observations. Retry a bounded number of times when the value changes during capture. If the bound is exhausted, the entry is unreadable or unsupported, or a required observation is omitted, abort start with no active contract. Timestamps may be logged for diagnostics but never decide equality or safety.

### Evaluator accuracy contract

The baseline comparator is measured against the B-to-C transition matrix in `spec.md`, using an independent fixture oracle. It must emit every changed-after-start entry exactly once, exclude every unchanged pre-existing entry, preserve deletion and rename cardinality, and pass the resulting `BudgetChangeItem[]` through the existing evaluator without a second policy engine. Any unknown comparison is an unsafe result, not an exclusion. The target is 100 percent changed-entry detection and zero false exclusions in the required fixtures.

### Storage fixture and measurement

The motivating fixture contains many pre-existing untracked files outside the allow list, plus tracked dirty, staged, binary, symlink, gitlink, and Unicode cases. The fixture records entry count, snapshot byte size, capture duration, persistence duration, and comparison duration on both supported platforms. Results are reported as observations, not fixed thresholds. No arbitrary size limit or timestamp authority may replace complete evidence.

### Implementation sequence

1. Define baseline descriptors, mode metadata, evidence reference, integrity state, and compatibility parsing rules.
2. Implement stable path and NUL observation handling, including binary, rename, symlink, gitlink, case ambiguity, and `.changebudget/**` behavior.
3. Implement read-only capture with Git-native recovery first and private snapshots only for unrecoverable dirty tracked and untracked values.
4. Implement atomic evidence persistence, digest verification, cleanup of incomplete artifacts, and activation ordering.
5. Adapt baseline comparison to produce equivalent post-start `BudgetChangeItem[]`; leave `evaluateBudgetCheck` policy logic unchanged.
6. Integrate baseline mode into `runStart`, `runCheck`, `runStatus`, and `runClose`, preserving legacy/no-baseline behavior.
7. Add focused tests for capture, comparison, persistence failure, integrity failure, and all 56 acceptance scenarios.
8. Run future implementation validation in order: focused tests, typecheck, build, full test suite, then Windows and Ubuntu coverage.

### Acceptance matrix strategy

The implementation must map one independently testable fixture to each of the 56 scenarios in `spec.md`, including five exact HEAD binding cases and twelve integrity cases. Start with focused unit tests for parsing, descriptors, digest verification, snapshot selection, effective staged/worktree comparison, path identity, and failure cleanup. Follow with lifecycle integration tests for restart, close retention, status reporting, legacy mode, and no pointer activation. Finish with the complete matrix on Windows and Ubuntu, including clean, dirty, untracked, binary, large, Unicode, spaces, renames, symlinks, gitlinks, case-only renames, ambiguous paths, HEAD movement, and invalid evidence.

No tests, build, or suite are run as part of this planning artifact. This is a plan, not implementation validation.

## Project Structure

### Documentation and design artifacts

```text
specs/013-working-tree-baseline/
|-- plan.md
|-- research.md
|-- data-model.md
|-- quickstart.md
|-- contracts/
|   `-- working-tree-baseline.md
`-- tasks.md                 # Existing execution artifact; frozen during this correction pass and regenerated after authoritative artifacts change
```

### Repository files expected to change during implementation

```text
src/core/check/diff.ts              # Preserve collector shape; add baseline adapter boundary
src/core/check/rules.ts             # Preserve evaluateBudgetCheck input and rule semantics
src/core/baseline/                  # Capture, evidence, integrity, and comparison modules
src/core/state/state.ts             # Reuse atomic persistence boundary as needed
src/core/state/contracts.ts         # Associate evidence and retain it on close
src/cli/commands/start.ts           # Validate, capture, persist, then activate
src/cli/commands/check.ts           # Select baseline or legacy collection path
src/cli/commands/status.ts          # Report mode and safe evidence state
src/cli/commands/close.ts           # Retain evidence through close
src/models/change-contract.ts       # Add baseline reference and compatibility parsing
tests/unit/                         # Focused baseline and persistence tests
tests/integration/                  # Lifecycle and restart coverage
tests/acceptance/                   # 56-scenario matrix coverage
```

**Structure Decision**: Keep the existing CLI, check, model, and state modules. Add a small baseline boundary under `src/core/baseline/` rather than introducing a database, service, or broad storage abstraction. Exact file names and serialization remain implementation decisions within these boundaries.

## Validation and Failure Behavior

* Focused tests must prove byte-identical staging transitions are silent and that real content or semantic changes remain visible.
* Strict NUL parsing errors, unsupported policy-critical objects, unreadable required values, case ambiguity, and missing or invalid evidence fail explicitly and cannot return PASS.
* A start persistence failure leaves no active pointer and no valid-looking partial evidence or contract where cleanup is possible.
* Existing decisions `PASS`, `REPAIR`, and `HUMAN_REVIEW`, existing exit codes, existing rule precedence, and legacy base-revision behavior remain unchanged.
* Future implementation validation runs focused tests first, then typecheck, build, full suite, and Windows/Ubuntu coverage. This plan does not run them.

## Constitution Re-check After Design

* **PASS - Determinism and Git truth**: The comparator uses stable identity, NUL parsing, ordering, and Git-native state, with no timestamp authority.
* **PASS - Minimal architecture**: The hybrid stores only unrecoverable values and reuses current collection and rule contracts.
* **PASS - Scope and compatibility**: No policy category, exit code, legacy migration, or user-state mutation is introduced.
* **PASS - Safety and human authority**: Incomplete or invalid evidence cannot activate or produce PASS; close remains a human decision.
* **PASS - Explainability and quality**: Mode, excluded entries, deltas, and failure reasons remain concise and deterministic.

## Complexity Tracking

No constitutional violation. Complexity tracking is not applicable. The baseline boundary is required by the specification, and the hybrid design is the smallest safe alternative to both full content duplication and unsafe path-only exclusion.
