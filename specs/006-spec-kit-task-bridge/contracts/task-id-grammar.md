# Contract: Task ID Grammar

Spec-Kit task identifiers accepted by the `start` command and recognized inside `tasks.md` lines.

## Grammar

```
task-id = /[Tt][0-9]{3,}/
```

- Case-insensitive letter `T`; three or more decimal digits.
- Examples: `T031`, `t031`, `T12345`.
- A bare uppercase pattern is emitted after canonicalization.

## Canonicalization

```
canonicalize(id) = id.toUpperCase()
```

`t031` → `T031`; `T12345` → `T12345`. Canonicalization applies to:

1. The positional argument handed to `start`, and
2. Every task-line ID token during resolution.

Resolution always operates on the canonical form, so `changebudget start t031` and `changebudget start T031` resolve identically.

## Rejection (deterministic, no fuzzy matching)

| Input | Result |
|---|---|
| `T2`, `T31`, `T031x`, `T031-notes`, `file.txt`, `specs/…` | Existing `Unexpected positional argument` input error; no match attempt |

Non-ID positionals never reach resolution; they fail in argument parsing with the existing deterministic error and exit code 2.

## Ambiguity rule

A canonical ID matching more than one distinct `tasks.md` source, or occurring twice within one file, is rejected as ambiguous. No tiebreaker is used, including `.specify/feature.json` (prohibited).