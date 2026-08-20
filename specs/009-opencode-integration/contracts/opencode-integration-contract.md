# OpenCode Integration Contract — SPEC-009

**Branch**: `009-opencode-integration` | **Date**: 2026-08-18 | **Spec**: [../spec.md](../spec.md)

## 1. CLI Surface

```
changebudget integrate opencode [--dry-run] [--remove]
```

| Argument | Required | Description |
|---|---|---|
| opencode | yes | Integration target |
| --dry-run | no | Preview without writing |
| --remove | no | Remove ChangeBudget-owned resources |

### Exit codes

| Outcome | Exit code |
|---|---|
| Successful install/update/dry-run/removal/already-current | 0 |
| Ownership conflict / invalid opencode.json / missing build / unknown target | 2 |
| Filesystem write failure | 4 |

### Output (human only, no --json in v1)

```
Integration: READY
Plugin wrapper: CREATE .opencode/plugins/changebudget.js
Instructions: CREATE .opencode/instructions/changebudget.md
opencode.json: UPDATE (instruction entry added)
Runtime Guard: exists
```

## 2. Managed Resources

### Plugin wrapper (`.opencode/plugins/changebudget.js`)
- Line 1: `// ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode`
- Line 2: `export { default } from "<file_url>";`
- Trailing newline. Byte-identical for same installation path.

### Agent instructions (`.opencode/instructions/changebudget.md`)
- Line 1: `<!-- ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode -->`
- Body: 11 behavioral instructions from spec FR-007. Generic OpenCode only. No OMO terms.
- Byte-identical on every generation.

### opencode.json instruction entry
- Entry: `.opencode/instructions/changebudget.md` in `instructions[]`
- Existing fields/entries preserved. Entry appended only if exact string absent. Never duplicated.
- Invalid JSON → no modification, error. Non-array instructions → no modification, error.

## 3. Idempotency

- Install twice: second run = UNCHANGED, zero writes, "already current"
- Remove twice: second run = ABSENT, nothing to remove, exit 0

## 4. Conflict

- File at managed path without `ChangeBudget-managed` marker → CONFLICT → zero writes/deletes → exit 2
- Dry-run: CONFLICT reported, exit 0 (informational)

## 5. Dry-Run

- All inspection/validation, no writes. Reports CREATE/UPDATE/UNCHANGED/CONFLICT per resource. Exit 0.

## 6. Removal

- Deletes only MANAGED files. Removes exact entry from opencode.json. Preserves all other config.
- Never deletes opencode.json, AGENTS.md, .opencode/ (if unrelated content exists).
- Optionally removes empty owned directories.
- On conflict: refuses, reports, exit 2.

## 7. Git Baseline Warning

- After install/update: `git status --porcelain` on 3 managed paths. If untracked/modified → warning.
- Never stages/commits/amends/pushes. Informational only. Skipped if not a Git repo.

## 8. Backward Compatibility

- No existing command/flag/output/exit-code/policy changed.
- Projects that never run `integrate opencode` behave exactly as before.
- Zero new runtime dependencies.