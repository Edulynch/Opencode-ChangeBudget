# Data Model: SPEC-001

## Purpose

This document extracts persisted entities and core lifecycle state from `spec.md` and defines the validation rules for SPEC-001.

## Entity: Change Contract

Stored as `specs/001-change-contract-lifecycle/data-model.md` and serialized in `.changebudget/contracts/<contract-id>.json`.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `schema_version` | string | yes | Semver-like token (e.g., `1.0`) | Version for future compatibility checks |
| `id` | string | yes | unique within repository | repository-level identifier |
| `task_description` | string | yes | non-empty, trimmed length > 0 | human summary of intent |
| `base_revision` | string | yes | git reference that exists in local repo | captured by `start` |
| `allow_paths` | array<string> | no | each element non-empty string path pattern | defaults to `[]` |
| `deny_paths` | array<string> | no | each element non-empty string path pattern | defaults to `[]` |
| `max_files` | number \/ null | no | integer >= 0 when present | controls contract metadata only in SPEC-001 |
| `max_changed_lines` | number \/ null | no | integer >= 0 when present | controls contract metadata only in SPEC-001 |
| `allow_new_files` | boolean | yes | strict boolean | default false if omitted |
| `allow_new_dependencies` | boolean | yes | strict boolean | default false if omitted |
| `allow_migrations` | boolean | yes | strict boolean | default false if omitted |
| `allow_config_changes` | boolean | yes | strict boolean | default false if omitted |
| `allow_public_api_changes` | boolean | yes | strict boolean | default false if omitted |
| `preset` | string | no | one of `tiny`, `normal`, `free`, `custom` | optional label preserved by future specs |
| `status` | string | yes | `draft`, `active`, `closed` | lifecycle state of contract object |
| `created_at` | string | yes | ISO-8601 timestamp in UTC | RFC3339-compliant recommended |
| `updated_at` | string | yes | ISO-8601 timestamp in UTC | updated on state transitions |
| `closed_at` | string \/ null | no | timestamp in UTC when closed | only for `closed` state |

### Contract validation rules

- `task_description` and `base_revision` are mandatory and must be non-empty after trimming.
- `max_files` / `max_changed_lines` must be non-negative integers when present.
- `preset`, if set, must be one of the allowed labels.
- Any missing non-required fields must be auto-populated with deterministic defaults only when the system creates a contract.
- Unknown fields should be preserved for forward compatibility only if harmless; otherwise treat as schema error and fail safely.

## Entity: Lifecycle State Record

Stored as `.changebudget/state.json`.

| Field | Type | Required | Constraints | Notes |
|---|---|---|---|---|
| `schema_version` | string | yes | Semver-like token | persisted state schema marker |
| `lifecycle_state` | string | yes | `uninitialized`, `initialized`, `active`, `closed` | governs allowed commands |
| `active_contract_id` | string \/ null | no | when `lifecycle_state` is `active`, must reference existing contract |
| `last_closed_contract_id` | string \/ null | no | optional audit pointer |
| `updated_at` | string | yes | ISO-8601 timestamp in UTC | state mutation timestamp |

### State transition rules

- `uninitialized` -> `initialized` via successful `init`.
- `initialized` -> `active` via successful `start`.
- `active` -> `closed` via successful `close`.
- `closed` -> `initialized` by starting a new contract or by re-init behavior defined in `commands`.

All other transitions are invalid and must fail with explicit error.

## Relationship

- `state.active_contract_id` must point to a contract file path under `.changebudget/contracts/` when `lifecycle_state === "active"`.
- `state.last_closed_contract_id` must point to a contract with `status === "closed"` when present.

## Derived command behavior impact

- `status` reads `Lifecycle State Record` and resolves contract summary from active contract if available.
- `check` validates the active contract or draft and reports deterministic schema-level reasons; it does not perform file-diff enforcement in SPEC-001.
