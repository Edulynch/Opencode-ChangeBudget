# SPEC-013 Future Implementation Verification Guide

This guide records the verification order and the observed SPEC-013 implementation evidence.

## Prerequisites

Use Node.js 20+, npm, Git, and disposable repositories on Windows and Ubuntu. Keep the implementation checkout separate from fixture repositories. Do not modify user files, index content, refs, commits, or nested worktrees during verification.

## Verification order

1. Run focused unit tests for strict NUL parsing, slash normalization, code-unit ordering, explicit `comparison_mode` recognition, descriptors, digest verification, snapshot selection, binary zero-line behavior, rename handling, symlink objects, gitlinks, case ambiguity, and `.changebudget/**` exclusion.
2. Run lifecycle integration tests for validate, observe-before/capture/observe-after consistency, evidence persistence, contract persistence, pointer-last activation, concurrency rejection, crash recovery, restart, close retention, cleanup after failure, and legacy/no-baseline mode.
3. Run the complete 56-scenario acceptance matrix, including five HEAD binding cases and twelve integrity cases.
4. Run typecheck, build, and the full test suite.
5. Repeat the matrix and lifecycle checks on Windows and Ubuntu, comparing decisions, classifications, reason data, and path ordering.

## Recorded verification evidence

The documented order was followed. Focused tests, lifecycle tests, the complete 56-scenario matrix, typecheck, build, full suite, and cross-platform repetitions were run with the repository's required gates.

- Windows local validation: 699 passed, 0 failed.
- Ubuntu CI workflow `32775605364`, job `97585844057`: 699 total, 698 passed, 1 expected Windows-only skip, 0 failed.
- The Ubuntu result is not 699 passed. The single skip is the expected Windows-only case.
- The platform and cross-cutting gates covered T040 platform behavior, T041 mutation safety, T042 storage observations, and T043 authority and forbidden-operation review.

Traceability reconciliation found rows 1 through 56 exactly once. Scenarios 1 through 39 are executable acceptance coverage in T037, scenarios 40 through 44 are in T038, and scenarios 45 through 56 are in T039. All 56 rows have implementation and deterministic evidence: 56 mapped, 56 with implementation and deterministic evidence, 0 uncovered, and 0 generic-only rows.

## Manual lifecycle walkthrough

In a disposable repository, prepare clean, dirty tracked, staged, staged plus unstaged, and untracked entries. Start a contract and record that repository files, `.git/**`, the index, refs, commits, stash, and nested worktrees are unchanged. Confirm public status exposes `comparisonMode` and `baselineState=captured`. Make a new change, edit a pre-existing entry, stage and unstage byte-identical content, delete a pre-existing file, and perform a rename. Check that only post-start effective deltas become `BudgetChangeItem[]` values and that existing rules determine the result.

Repeat with binary content, paths containing spaces and Unicode, Windows separators, symlinks, tracked gitlinks, case-only renames, ambiguous equivalent paths, and HEAD unchanged, advanced, switched, returned, and retained cases. Confirm symlink targets and nested submodule worktrees are not recursively baselined. Confirm binary entries contribute zero lines. At activation, record exact HEAD and require equality at check; a mismatch yields `BASELINE_HEAD_MOVED` and HUMAN_REVIEW without mutation.

## Failure walkthrough

Exercise unreadable required content during start, a value changing between before and after observations, evidence persistence failure, competing activation, missing reference or artifact, contract/evidence mismatch, missing payload, digest mismatch, duplicate canonical path, invalid repository path, identity collision, unsupported schema or entry type, malformed or partial artifact, and unavailable evidence after restart. Start must leave no active pointer and no valid-looking partial evidence or contract where possible. Later status and check must retain baseline mode for invalid baseline evidence, never return PASS, and expose the existing HUMAN_REVIEW path.

Check an older contract schema without `comparison_mode` and without baseline evidence. It must disclose legacy/no-baseline mode, use base-revision semantics, and avoid reconstruction. A newer baseline-enabled contract with missing evidence must not be treated as legacy.

## Output compatibility checks

Verify that normal status and check output is concise and deterministic. New public JSON uses only `comparisonMode`, `baselineState`, `decision`, `reasonCodes`, `excludedUnchangedCount`, `detectedDeltaCount`, and optional `stagingTransitionCount`; `baselineState` is exactly `captured`, `legacy`, `unavailable`, `invalid`, or `incompatible`. Detailed causes appear only in `reasonCodes`, with no aliases. Unchanged-entry exclusion and detected deltas have actionable summaries. Byte-identical staging transitions remain silent in normal output. Record storage fixture entry count, evidence bytes, capture time, persistence time, and comparison time without applying an arbitrary limit. Existing PASS, REPAIR, HUMAN_REVIEW meanings, exit codes, rule precedence, and policy categories do not change.
