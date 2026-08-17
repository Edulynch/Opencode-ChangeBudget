# Data Model: SPEC-004

## Purpose

This document defines the runtime entities required for OpenCode interception in SPEC-004.

## Entity: Runtime Guard Context

Snapshot loaded by the plugin for each decision.

| Field | Type | Required | Source | Notes |
|---|---|---|---|---|
| `workspaceRoot` | string | yes | OpenCode session context | repository root used for path normalization |
| `hasActiveChangeBudget` | boolean | yes | `.changebudget/state.json` | true when lifecycle state is initialized/active/closed; false when state is missing or `uninitialized` |
| `lifecycleState` | `uninitialized` / `initialized` / `active` / `closed` | no | `.changebudget/state.json` | only used for deterministic gating decisions |
| `contract` | `RuntimeContractSnapshot` | conditional | `.changebudget/contracts/<id>.json` | required when `lifecycleState` is `active` and `active_contract_id` exists |

## Entity: Runtime Contract Snapshot

Subset of a ChangeBudget contract used for runtime guard projection.

| Field | Type | Required | Notes |
|---|---|---|---|
| `contract_id` | string | yes | `id` in persisted contract |
| `task_description` | string | yes | not used for enforcement, surfaced in diagnostics |
| `base_revision` | string | yes | validated before evaluation where available |
| `allow_paths` | string[] | yes | empty means allow-by-default (subject to deny overrides) |
| `deny_paths` | string[] | yes | deterministic path blocker |
| `allow_new_dependencies` | boolean | yes | sensitive policy toggle |
| `allow_migrations` | boolean | yes | sensitive policy toggle |
| `allow_config_changes` | boolean | yes | sensitive policy toggle |
| `allow_public_api_changes` | boolean | yes | sensitive policy toggle |

## Entity: Policy Context

Single-operation projection input before runtime decision mapping.

| Field | Type | Required | Notes |
|---|---|---|---|
| `operationId` | string | yes | `permission.id` when available; fallback generated |
| `tool` | string | yes | normalized operation source |
| `mutationIntent` | `none` / `mutate` | yes | derived from hook inputs |
| `targetPath` | string / `null` | conditional | repository-relative path if deterministic |
| `targetKind` | `file` / `directory` / `unknown` | no | helps reason text and deterministic fallback |
| `rawMetadata` | Record<string, unknown> | yes | minimal extracted raw data for diagnostics |

## Entity: Runtime Evaluation Output

Deterministic per-operation decision output produced by the plugin.

| Field | Type | Required | Notes |
|---|---|---|---|
| `policyDecision` | `PASS` / `REPAIR` / `HUMAN_REVIEW` | yes | existing DecisionResult source |
| `runtimeAction` | `allow` / `ask` / `block` | yes | projected OpenCode action |
| `rule` | `OCG-*` code string | yes | machine-readable reason identifier |
| `message` | string | yes | stable human-readable explanation |
| `contractId` | string / `null` | yes | active contract identity when available |
| `path` | string / `null` | no | effective path used in decision |
| `metadata` | Record<string, string / number / boolean> | yes | safe runtime output only |

## Contract State Transition for Runtime Posture

- `hasActiveChangeBudget = false`: runtime guard is not applied, `runtimeAction = allow`.
- `hasActiveChangeBudget = true` + active contract missing/invalid: `runtimeAction = block` for mutating operations (fail-safe).
- Valid context and `policyDecision = PASS`: path and sensitive toggle rules decide `allow/ask/block`.
- `policyDecision = REPAIR` or `HUMAN_REVIEW` for mutation: default to `block` unless operation is proven read-only.

## Normalization and Determinism Rules

- All candidate paths are normalized to repo-relative `/`-separated form.
- `.changebudget/**` is always resolved as deny scope for this feature.
- For deterministic decisioning, repeated identical inputs must produce identical `policyDecision`, `runtimeAction`, `rule`,
  and message.
