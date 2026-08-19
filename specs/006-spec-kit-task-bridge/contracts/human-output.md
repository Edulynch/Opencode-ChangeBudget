# Contract: Human-readable Output

Task lines added to `changebudget status` and `changebudget close` output. The existing `Task: <task_description>` line is replaced for task-tied contracts only; all other lines and outputs are unchanged.

## `status` (active or last-closed contract)

Task metadata present on the contract:

```
Task: T031
Source: specs/006-example-feature/tasks.md
```

- `Task:` prints the canonical task ID (`task_id`).
- `Source:` prints the repository-relative `tasks.md` path (`task_source_path`).

Task metadata absent (task-free contracts, SPEC-001..005):

```
Task: <task_description>
```

Existing behavior — identical to baseline. No `Source:` line.

## `status --budget` (human)

Unchanged. Task context is surfaced in this mode only through the JSON object when `--json` is also passed (see [json-output.md](./json-output.md)).

## `close`

When the closed contract carries task metadata:

```
Contract closed.
Task: T031
Source: specs/006-example-feature/tasks.md
```

Otherwise exactly the existing `Contract closed.` output.

## Byte-stability

- Task lines appear only when the relevant contract carries task metadata.
- No-Spec-Kit repositories and task-free `start` runs produce output byte-identical to the SPEC-001..005 baseline (FR-016, SC-004).
- Line order for a given contract state is fixed, satisfying FR-017.