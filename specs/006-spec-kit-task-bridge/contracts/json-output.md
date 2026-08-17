# Contract: JSON Output

Structured task object emitted by `check --json` and `status --budget --json`.

## Task object

| Field | Type | Notes |
|---|---|---|
| `id` | string | canonical task ID |
| `title` | string | resolved task title |
| `source_feature` | string | feature directory under `specs/` |
| `source_path` | string | repository-relative `tasks.md` path |

Object key order is fixed: `id`, `title`, `source_feature`, `source_path`.

## `check --json`

New top-level key, present only when the evaluated contract (active or draft) carries task metadata:

```json
{
  "contractSource": "active",
  "contractId": "contract-…",
  "baseRevision": "…",
  "decision": "PASS",
  "status": "PASS",
  "changedFileCount": 0,
  "changedLinesCount": 0,
  "binaryChangeCount": 0,
  "newFileCount": 0,
  "deletedFileCount": 0,
  "renamedFileCount": 0,
  "limitResults": [],
  "pathRuleResults": [],
  "stackPolicySummary": null,
  "violations": [],
  "reasonCodes": [],
  "reason_codes": [],
  "task": {
    "id": "T031",
    "title": "Implement task bridge",
    "source_feature": "006-example-feature",
    "source_path": "specs/006-example-feature/tasks.md"
  },
  "asOf": "…"
}
```

Omission rule: when the evaluated contract has no task metadata, the `task` key is **absent** from the JSON payload. This guarantees `check --json` output on task-free repositories is byte-identical to the SPEC-001..005 baseline.

## `status --budget --json`

The `budget` object carries the same task object, with the same omission rule:

```json
{
  "lifecycleState": "active",
  "activeContractId": "contract-…",
  "lastClosedContractId": null,
  "budget": {
    "decision": "PASS",
    "reasonCodes": [],
    "reason_codes": [],
    "contractSource": "active",
    "contractId": "contract-…",
    "baseRevision": "…",
    "status": "PASS",
    "changedFileCount": 0,
    "changedLinesCount": 0,
    "binaryChangeCount": 0,
    "newFileCount": 0,
    "deletedFileCount": 0,
    "renamedFileCount": 0,
    "limitResults": [],
    "pathRuleResults": [],
    "stackPolicySummary": null,
    "violations": [],
    "task": {
      "id": "T031",
      "title": "Implement task bridge",
      "source_feature": "006-example-feature",
      "source_path": "specs/006-example-feature/tasks.md"
    },
    "asOf": "…"
  }
}
```

## Backward compatibility

- Task-free contracts: `task` omitted in both payloads; payload byte-identical to baseline (FR-016, SC-004).
- `BudgetCheckResult.task` is nullable; `null` is never serialized as a `task` key.
- No existing JSON fields change names, types, or order; `reason_codes` alias relationship is untouched.