# Contract: Human-readable Recommendation Output

Human output of `changebudget diagnose`. Exactly one `Recommendation` line, one `Source` line, and a `Reasons` list, in fixed order. Example output is from the current CLI conventions (`Recommendation:` mirrors `check`'s `Decision:` style).

## Compact form

```
Recommendation: tiny
Source: inferred
Reasons:
  - declared_paths: 2
  - tracked_files: 6
```

## Full form (task metadata present)

```
Recommendation: normal
Source: inferred
Reasons:
  - declared_paths: 3
  - tracked_files: 42
  - task_id: T031
  - sensitive_category: dependencies
```

## Outcome values

| Outcome | `Recommendation:` text |
|---|---|
| tiny | `tiny` |
| normal | `normal` |
| free | `free` |
| manual review | `manual review` (space, matching FR-001's literal) |

## `Source:` line

- `explicit` — a valid `[budget:...]` annotation on the resolved task decided the outcome (FR-007).
- `inferred` — the outcome came from the decision table over structural/stack signals.

## Reason ordering (FR-010, fixed)

1. Structural: `declared_paths: <P>`, then `tracked_files: <N>` (only when declared paths exist).
2. Task metadata: `task_id: <id>` (when a task resolved), then `task_budget_default: <preset>` (only when a valid annotation exists).
3. Sensitive categories: one `sensitive_category: <category>` line per category, lexicographically sorted (only when a stack profile was explicitly given and categories triggered).

A reason appears only when the signal exists. `manual review` via rule 2 surfaces `declared_paths: 0`; via rule 3 it surfaces the triggering `sensitive_category:` reason (FR-009).

## Byte-stability

- No timestamps, no randomness, no trailing-variable lines beyond the fixed block.
- Repeated runs against the same repository and inputs are byte-identical (FR-010, SC-002).
- Content and ordering match the JSON output's `recommendation`, `source`, and `reasons` arrays (FR-012).
- Existing command outputs are untouched; `diagnose` adds new output only (FR-013).