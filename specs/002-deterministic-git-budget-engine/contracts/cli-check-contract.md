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
- Contract `base_revision` must resolve to a local commit before metric collection. If it does not resolve, this is a fatal Git/command error before result creation; retain the existing Git error category and exit `4`, not a completed SPEC-003 `HUMAN_REVIEW` decision.
- A numeric contract value is not proof of numeric authority. The check applies the deterministic evidence/migration rules in SPEC-002 `spec.md` FR-021; a legacy value with unresolved origin is neither silently hard nor soft. CLI invocation, preset selection, field name, free-text reason, storage, and historic result do not establish human/policy provenance.

## Evaluation Pipeline

1. Resolve and validate repository and base revision.
2. Build canonical changed set from staged diff, unstaged diff, and untracked files.
3. Evaluate path policy rules, numeric-limit provenance, and numeric limits. Preserve concrete path/capability violations even when a numeric evaluation precondition is unresolved.
4. Assemble deterministic result and print deterministic fields. A soft estimate overrun is an auditable advisory, not a rule violation; an unresolved numeric classification that is necessary for evaluation MUST NOT yield `PASS` and is reported as SPEC-003 `HUMAN_REVIEW` with explicit recovery guidance.

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

Only when required repository, contract, and base prerequisites succeeded and evaluation can produce a completed decision, but a material numeric input cannot safely be classified, use SPEC-003's existing `HUMAN_REVIEW` decision/exit mapping (`2`); do not reinterpret the value as a hard-cap violation or fabricate `PASS`. Fatal command/input/environment/repository/state errors—including non-git context and an unresolved base revision—remain hard CLI errors with their existing error/exit behavior and do not produce a decision result. This does not define a new exit code.

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
