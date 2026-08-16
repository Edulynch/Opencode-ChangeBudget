# Persistence Contract: SPEC-001 Artifacts

## Repository-owned paths

| Path | Purpose | Owner |
|---|---|---|
| `.changebudget/state.json` | lifecycle state record | ChangeBudget CLI |
| `.changebudget/contracts/` | per-contract persistent objects | ChangeBudget CLI |
| `.changebudget/contracts/<id>.json` | serialized contract payload | ChangeBudget CLI |
| `.changebudget/contracts/history.json` | optional append-only list of recent closed contracts | ChangeBudget CLI |

## File format

- Plain UTF-8 JSON.
- Stable key ordering (`schema_version` first) for deterministic diffs.
- No binary files, no embedded environment secrets, no remote links.

## Versioning strategy

- `schema_version` uses semver-like tokens and defaults to `1.0.0` for SPEC-001.
- On read, unknown future fields must either be safely ignored for read tolerance or produce a clear migration error if unknown fields can alter execution safety.
- Writes always emit the current supported `schema_version` for forward consistency.

## Safety expectations

- Writes are atomic where practical (write-temp-and-rename pattern).
- If writing fails, no partial file changes are applied.
- On detected partial/corrupt state, commands fail with explicit actionable error and refuse unsafe transitions.

## Required artifacts per command

- `init`: creates `.changebudget/state.json` and `.changebudget/contracts/` when absent.
- `start`: creates a new contract file and updates `state.json` with `active_contract_id`.
- `close`: updates contract file closure fields and updates `state.json` (`last_closed_contract_id`).
- `status`/`check`: no new artifacts required.
