# Contract: `diagnose` Command

Behavior of `changebudget diagnose`. Advisory and read-only; it never creates, widens, or closes a contract, never touches `.changebudget/**`, never stages or commits, never invokes OpenCode/Spec-Kit/network (FR-002).

## Synopsis

```
changebudget diagnose [TASK_ID] [<flags>]
```

`TASK_ID` is an optional positional argument matching the SPEC-006 task ID grammar (`^[Tt][0-9]{3,}$`). At most one positional is allowed; any other positional is rejected with the existing deterministic argument error. With no arguments at all, the command still runs and recommends `manual review` (no deterministic evidence; FR-009 edge case).

## Flags

| Flag | Effect |
|---|---|
| `--task <text>` / `--task-description <text>` | Prose captured as input context only; never semantically interpreted (FR-005, FR-003). |
| `--allow-path <glob>` / `--allow-paths <glob>` | Repeatable; adds a declared allow prefix (aliases). |
| `--deny-path <glob>` / `--deny-paths <glob>` | Repeatable; adds a declared deny prefix (aliases). |
| `--stack-profile <profile>` | One of the SPEC-005 profile identifiers; validated, otherwise deterministic input error (FR-014). |
| `--json` | Emit structured JSON; also accepts `--json=true`/`--json=false` like the existing CLI. |

Declared path prefixes (`allow` + `deny`) define `P` and scope the read-only Git lookup for `N`.

## Rejected inputs (deterministic error, exit 2, no work done)

| Condition | Result |
|---|---|
| Budget flags (`--preset`, `--tiny`, `--normal`, `--free`, `--custom`) | `InputValidationError` — `diagnose` never selects a preset for the developer |
| Unknown flags | `InputValidationError` |
| More than one positional | existing deterministic argument error |
| Positional failing the task ID grammar | existing deterministic argument error |
| Invalid `--stack-profile` value | `InputValidationError`, naming the invalid value |
| Unknown or ambiguous task ID | deterministic SPEC-006 resolution error (same failure behavior; never reads `.specify/feature.json`) |

In every failure case, no recommendation is made and the repository and `.changebudget/**` remain byte-identical (FR-014).

## Resolution reuse (SPEC-006)

When `TASK_ID` is given, resolution reuses the SPEC-006 resolver (`resolveSpecKitTask`) unchanged: same canonicalization, same unknown/ambiguous/not-resolvable failure behavior, read-only reads of `specs/<feature>/tasks.md` only (FR-004). An invalid `[budget:...]` value is treated as absent — a recommendation error for `diagnose`, never a "not recommended" block (FR-007).

## Recommendation output

Produces exactly one of `tiny`, `normal`, `free`, `manual review`, with its reason list (FR-008). See [human-output.md](./human-output.md) and [json-output.md](./json-output.md).

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Successful diagnosis, **including** `manual review` (a valid advisory outcome, not an error) |
| `2` | Input problems: unknown/budget flags, bad positionals, invalid stack profile, task resolution failures (existing mapping) |
| `3` | Unused by `diagnose` |
| `4` | Git/environment failures (e.g., `git ls-files` unavailable) via the existing environment mapping |

No decision exit codes (PASS/REPAIR/HUMAN_REVIEW) are produced; `diagnose` never feeds the enforcement path (FR-013).

## Read-only and lifecycle independence

- Ignores any active contract and any working-tree diff state as evidence (FR-011); does not read or depend on the active contract.
- `N` is the count of tracked files in the Git index under declared prefixes — one `git ls-files`-style read-only inspection, only when declared paths exist; never a diff count.
- Never reads `.changebudget/**`, never reads `.specify/feature.json`, never mutates `tasks.md`, never stages/commits, never invokes Spec-Kit/OpenCode/network (FR-002, FR-004).

## Example

```
changebudget diagnose T031 --allow-path "src/ui/**" --allow-path "tests/ui/**"
```
```
Recommendation: tiny
Source: explicit
Reasons:
  - declared_paths: 2
  - tracked_files: 6
  - task_id: T031
  - task_budget_default: tiny
```