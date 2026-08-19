# Contract: `start` Command

Behavior of `changebudget start` with Spec-Kit task support, on top of the SPEC-001..005 contract.

## Synopsis

```
changebudget start [TASK_ID] [<flags>]
```

`TASK_ID` is an optional positional argument matching the [task ID grammar](./task-id-grammar.md). At most one positional is allowed; any other positional is rejected with the existing deterministic argument error.

## Flags

| Flag | Effect |
|---|---|
| `--task <text>` | Sets `task_description` explicitly (existing). With `TASK_ID`, the resolved `task_title` is still stored separately (FR-006). |
| `--preset tiny\|normal\|free\|custom` | Existing flag; sets budget preset. |
| `--tiny` / `--normal` / `--free` | Exact aliases for `--preset tiny\|normal\|free` (FR-011). |
| all existing SPEC-001..005 flags | Unchanged. |

## Mutually exclusive

- `--tiny`/`--normal`/`--free` combined with `--preset` → deterministic input error (exit 2).

## Budget preset precedence

```
CLI flag (--preset | --tiny | --normal | --free)
  >  [budget:<tiny|normal|free>] annotation on the task line
  >  null (existing default)
```

- Annotation applies only when no CLI budget flag is present.
- With a CLI flag present, the annotation is ignored entirely — even if its value is invalid (not an error).
- With the annotation as the effective source and an invalid value (`[budget:custom]`) → deterministic input error before any contract is written.

## Resolution failure modes (before any persistence)

| Condition | Result |
|---|---|
| ID in zero sources (incl. no `specs/`) | Deterministic "not found" error listing scanned sources; `InputValidationError`, exit 2; no state write |
| Same ID in ≥2 distinct sources, or duplicated within one file | Deterministic ambiguity error listing every distinct source path; no guess |
| Single match with empty title | Deterministic "not resolvable" error naming source |
| `tasks.md` exists but unreadable | Deterministic `IOStateError`, exit 4; no "not found" fallback |

In every failure case `.changebudget/` remains byte-identical (FR-015).

## Contract fields produced

When `TASK_ID` resolves: persisted contract carries `task_id`, `task_title`, `task_source_feature`, `task_source_path`; `task_description` defaults to `task_title` unless `--task` is given. When no `TASK_ID`: all four fields are `null` and behavior is identical to SPEC-001..005.

## Read-only guarantee

Resolution reads `specs/<feature>/tasks.md` only. It never modifies the file, the working tree, or git state; never marks a task complete; never infers completion; never invokes Spec-Kit commands (FR-013).