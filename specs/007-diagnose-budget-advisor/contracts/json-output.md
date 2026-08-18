# Contract: JSON Recommendation Output

Structured object emitted by `changebudget diagnose --json`. Meaning and ordering equal the human output (FR-012).

## Object shape (fixed key order)

| Key | Type | Notes |
|---|---|---|
| `recommendation` | string | `"tiny"` \| `"normal"` \| `"free"` \| `"manual_review"` |
| `source` | string | `"explicit"` \| `"inferred"` |
| `reasons` | object[] | ordered `{ signal, value }` pairs |
| `inputs` | object | deterministic echo of explicit inputs |

Reason objects use the same signals and ordering as human output: `declared_paths`, `tracked_files`, `task_id`, `task_budget_default`, `sensitive_category`. `value` is a number for `declared_paths`/`tracked_files` and a string otherwise.

## `inputs` object (fixed key order)

| Key | Type | Notes |
|---|---|---|
| `task_id` | string \| null | canonicalized task ID, or `null` |
| `task_description` | string \| null | prose input, or `null` |
| `allow_paths` | string[] | declared allow prefixes |
| `deny_paths` | string[] | declared deny prefixes |
| `stack_profile` | string \| null | explicit profile, or `null` |

## Byte-stability

- No timestamps, no random ordering (FR-010, SC-002).
- `manual_review` is the literal JSON string (underscore form, FR-012).
- Repeated runs against the same repository and inputs are byte-identical.
- Existing JSON outputs (`check --json`, `status --json`) are untouched; `diagnose` adds new output only (FR-013).

## Example

```
changebudget diagnose T031 --stack-profile node-ts --allow-path "src/ui/**"
```
```json
{
  "recommendation": "tiny",
  "source": "explicit",
  "reasons": [
    { "signal": "declared_paths", "value": 1 },
    { "signal": "task_id", "value": "T031" },
    { "signal": "task_budget_default", "value": "tiny" }
  ],
  "inputs": {
    "task_id": "T031",
    "task_description": null,
    "allow_paths": ["src/ui/**"],
    "deny_paths": [],
    "stack_profile": "node-ts"
  }
}
```
Note the explicit annotation wins (rule 1) even though the declared stack profile matches sensitive categories — the path/category signals are still observed but do not override configured intent (FR-007).