# CLI Contract: SPEC-001 Commands

This document defines the user-facing command contract for SPEC-001.

## Command Surface

| Command | Responsibility | Allowed states | State transition | Failure categories |
|---|---|---|---|---|
| `changebudget init` | Initialize `.changebudget/` and state file when possible | `uninitialized`, `initialized`, `active`, `closed` | `uninitialized` -> `initialized` on first init; existing state behavior is deterministic and explicit (no-op or conflict) | `GitEnvironmentError`, `StateConflictError`, `IOStateError` |
| `changebudget start` | Validate and persist a new contract draft as active | `initialized`, `closed` (optional re-init flow), `uninitialized` not allowed | `initialized` -> `active` on success | `InputValidationError`, `GitEnvironmentError`, `StateConflictError`, `IOStateError` |
| `changebudget status` | Show lifecycle state and active contract summary | Any valid state | none | `GitEnvironmentError`, `StateCorruptionError`, `IOStateError` |
| `changebudget check` | Validate contract syntax/structure for active contract or draft file | Any valid state | none | `InputValidationError`, `GitEnvironmentError`, `StateCorruptionError`, `IOStateError` |
| `changebudget close` | Close currently active contract and persist closure metadata | `active` | `active` -> `closed` on success | `StateConflictError`, `StateCorruptionError`, `IOStateError` |

## Exit Semantics

- `0`: command success and expected output produced.
- `2`: input or validation failure (missing fields, invalid value, unsupported state transition request).
- `3`: conflicting state transition or repository state conflict (including duplicate active contract scenarios).
- `4`: environment/read-write issue (not a git repo, permission denied, unreadable files).
- `10`: unexpected implementation failure.

## Output Expectations

- Output messages are deterministic for the same state and input.
- Error output includes: failing field/value where applicable, reason, and recoverable next step.

## State-Mutation Constraint

- `check` never mutates working tree or contract files.
- All mutations are only to `.changebudget/state.json` and `.changebudget/contracts/*` as part of command responsibilities.

## Human-Readable Artifact Contract

- `state` and contract files are UTF-8 JSON for direct inspection.
- Keys and ordering are stable to keep readable diffs and deterministic snapshots.
