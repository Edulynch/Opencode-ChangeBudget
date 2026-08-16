# CLI Contract: SPEC-002 Check Command

This document defines the public behavior of `changebudget check` after SPEC-002.

## Command Surface

| Command | Responsibility | Allowed states | Failure categories |
|---|---|---|---|
| `changebudget check [--draft <path>]` | Resolve contract source (active contract or `--draft`), validate contract and base revision, evaluate deterministic Git budget checks, print structured check result | `initialized`, `active`, `closed` | `InputValidationError`, `GitEnvironmentError`, `StateCorruptionError`, `IOStateError`, `StateConflictError` |

`check` does not change lifecycle state and does not mutate working tree or index.

## Input Rules

- `--draft <path>` may be absolute or relative to repository root.
- If `--draft` is omitted, `check` loads `state.json` and resolves `active_contract_id`.
- If neither active contract nor valid draft is available, check fails with `InputValidationError`.
- Draft and active contract payload are validated through existing contract input validation rules before evaluation.
- Contract `base_revision` must resolve to a local commit before metric collection.

## Evaluation Pipeline

1. Resolve and validate repository and base revision.
2. Build canonical changed set from staged diff, unstaged diff, and untracked files.
3. Evaluate path policy rules and numeric limits.
4. Assemble deterministic result and print deterministic fields.

## Output Contract

`check` writes a stable human-readable summary with these required fields for this spec:

- `contractSource` (`active` or `draft`)
- `contractId` when source is `active` or draft has an `id`
- `baseRevision`
- `changedFileCount`
- `changedLinesCount`
- `binaryChangeCount`
- `newFileCount`
- `deletedFileCount`
- `renamedFileCount`
- `status`
- `violations` (ordered list)

The command should print all failure details with stable ordering so repeated runs can be compared as plain text.

## Exit Semantics

- `0`: all checks pass (`PASS`).
- `2`: missing input, malformed path, malformed contract draft, or malformed path patterns.
- `3`: lifecycle/state conflict where applicable (e.g., invalid active state reference to missing contract file).
- `4`: git environment failure (not inside git repo, base revision unreachable, git execution failure), state I/O parse failure.
- `10`: unexpected runtime failure.

## Determinism Requirements

- For identical repository state, contract input, and base revision, output ordering and values are unchanged.
- Result ordering is deterministic by canonical path and then by rule name.
- Failures are explicit; no synthetic PASS is returned when git context is invalid.

## State-Mutation Constraint

- `check` must never:
  - write to or stage files in index
  - change working tree file contents
  - write to `.changebudget/state.json`
  - write to `.changebudget/contracts/*.json`

## Notes

- `--draft` mode is useful for preflight validation and is strictly read-only.
- Base revision failures are fatal and must include revision string and cause in error context.
