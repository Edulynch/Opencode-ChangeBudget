# Data Model: SPEC-005

## Purpose

This document defines the stack-policy domain objects added by `SPEC-005` and how they combine with existing contract and lifecycle models.

## Entity: Stack Profile

Catalog name selected by a contract at start time.

| Field | Type | Required | Source |
|---|---|---|---|
| `profile_id` | `android` \/ `flutter` \/ `spring-boot` \/ `node-ts` | yes when active | `--stack-profile` flag |
| `rules` | `StackPolicyRule[]` | yes | builtin profile pack |

The same repo can use only one active profile per contract.

## Entity: Stack Profile Rule

Path/sensitivity rule in a profile pack.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | Stable across releases, e.g. `android/signing` |
| `profile_id` | `android` \/ `flutter` \/ `spring-boot` \/ `node-ts` | yes | Owning profile |
| `category` | `dependencies` \/ `migrations` \/ `configuration` \/ `public_api` \/ `release_artifacts` \/ `runtime` | yes | Human-readable grouping |
| `target_patterns` | string[] | yes | Deterministic glob-like paths, no heuristics |
| `message` | string | yes | Human-readable rationale |
| `severity` | `review` \/ `deny` | yes | `review` maps to `HUMAN_REVIEW`, `deny` to `HUMAN_REVIEW` with high priority |

## Entity: Stack Policy Override (Repository)

Repository-local delta persisted in `.changebudget/stack-policy-overrides.json`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `profiles` | `Record<string, RepositoryStackProfileOverride>` | no | keyed by stack profile id |
| `profiles[profile_id].disable_rule_ids` | string[] | no | disable rule IDs from effective policy |
| `profiles[profile_id].added_rules` | `StackPolicyRuleInput[]` | no | append-only additions for this repo |

Rule inputs in the file share the same shape as `StackProfileRule` with local scope assumptions and are validated before write-time.

## Entity: Contract Stack Fields

Contract extension fields stored on every contract.

| Field | Type | Required | Notes |
|---|---|---|---|
| `stack_profile` | `android` \/ `flutter` \/ `spring-boot` \/ `node-ts` \/ `null` | yes | `null` means no stack policy for this contract |
| `disabled_stack_rules` | string[] | yes | explicit, contract-specific disable list |

`stack_profile` and `disabled_stack_rules` are persisted in all contract files and ignored by existing consumers if unrecognized.

## Entity: Stack Evaluation Context

Input used while evaluating budget checks.

| Field | Type | Source | Notes |
|---|---|---|---|
| `selected_profile` | `string \/ null` | contract | raw profile id |
| `disabled_rule_ids` | string[] | contract | stable order, unique values |
| `repo_disabled_rule_ids` | string[] | override file | repo-specific disabled set |
| `repo_added_rules` | `StackPolicyRule[]` | override file | appended to built-in rules |
| `effective_rules` | `StackPolicyRule[]` | resolved | deduped, deterministic order |
| `rule_status_map` | `Map<string, 'active' \/ 'overridden' \/ 'disabled'>` | resolved | for status output |

`effective_rules` is always deterministic:

- built-in rules in sorted ID order
- then repository added rules sorted by ID
- then contract disables removed from effective set

## Entity: Stack Violation

Stack failures are represented as normal `BudgetViolation` entries with special reason codes in family `CBS-*`.

| Field | Type | Notes |
|---|---|---|
| `rule` | `stack_profile_rule` | fixed internal rule alias |
| `path` | string | path that triggered the rule |
| `message` | string | includes stack profile + rule ID context |
| `reasonCode` | `CBS-*` | distinct namespace for stack policy reasons |

## Status Output Projection

`BudgetCheckResult` includes a stack summary for visibility.

| Field | Type | Description |
|---|---|---|
| `stackPolicySummary` | `StackPolicySummary / null` | present when any profile is resolved |

`StackPolicySummary` contains:

- `profile_id`
- `effectiveRuleIds`
- `overriddenRuleIds`
- `disabledRuleIds`
- `statusByRuleId`

`statusByRuleId` is a deterministic list sorted by rule ID.

## Determinism Rules

- Input arrays are normalized and sorted once before evaluation.
- Duplicate and empty strings are rejected before any check evaluation.
- Unknown profile IDs and unknown rule IDs fail fast with explicit validation messages.
- Override file and pattern compilation failures are deterministic for the same repo+contract input.
