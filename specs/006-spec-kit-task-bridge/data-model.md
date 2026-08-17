# Data Model: SPEC-006 — Spec-Kit Task Bridge

## Purpose

This document defines the Spec-Kit task bridge domain objects and their combination with the existing Change Contract lifecycle and output models. SPEC-006 is strictly additive: no existing lifecycle, budget, path-policy, stack-policy, reporting, exit-code, or OpenCode guard behavior changes (FR-007).

## Entity: SpecKitTaskResolution (derived, in-memory)

Result of resolving a canonical task ID against local `tasks.md` files. Produced by `resolveSpecKitTask` and consumed only by `runStart`.

| Field | Type | Required | Source |
|---|---|---|---|
| `task_id` | string (`T` + digits) | yes | canonicalized input ID |
| `task_title` | string | yes | plain text after ID and markers on the matched task line |
| `source_feature` | string | yes | feature directory name under `specs/` |
| `source_path` | string | yes | repository-relative `tasks.md` path, forward slashes |
| `budget_default` | `tiny` \| `normal` \| `free` \| null | no | explicit `[budget:<preset>]` token on the line |

`budget_default` is present only when the task line carries an explicit `[budget:...]` token with a valid preset value. Completion markers (`[x]`/`[X]`) are metadata only and never block or affect resolution (spec Clarification).

## Entity: Task budget annotation

Optional, explicit, deterministic marker in a `tasks.md` task line: `[budget:tiny]`, `[budget:normal]`, or `[budget:free]`.

- Extracted by the line parser as a marker token, never as part of the title.
- Validated only when it is the effective budget source (no explicit CLI budget flag).
- Explicit CLI budget flag always overrides the annotation; the annotation is then ignored, not an error.
- Invalid annotation value (`[budget:custom]`, `[budget:small]`, etc.) → deterministic `InputValidationError` before contract persistence, when the annotation would be used (FR-012).

Precedence (highest wins):

```
explicit CLI budget flag (--preset | --tiny | --normal | --free)
  >  task-line [budget:<preset>] annotation
  >  null (existing default behavior)
```

## Entity: Change Contract task surface (persisted, additive)

Contract extension fields stored on every contract file; all nullable and strictly additive.

| Field | Type | Required | Notes |
|---|---|---|---|
| `task_id` | string \| null | yes | canonical `T<digits>` or `null` |
| `task_title` | string \| null | yes | resolved human-readable title, always stored when `task_id` is set |
| `task_source_feature` | string \| null | yes | feature directory under `specs/` |
| `task_source_path` | string \| null | yes | repository-relative `tasks.md` path (forward slashes) |

Rules:

- Fields are `null` for every contract started without a task ID (backward compatibility, FR-016).
- Setting `task_id` on a task-tied contract always sets the other three fields (FR-005).
- `task_description` (existing field) defaults to `task_title` when no explicit `--task` is given; an explicit `--task` wins and `task_title` is stored separately (FR-006).
- `schema_version` stays `1.0.0`; no ownership migration. Existing readers parse unknown fields defensively, so legacy and new contracts are mutually readable.

## Entity: Task output object (machine-readable projection)

Structured task context emitted by `check --json` and `status --budget --json`, derived from the evaluated contract.

| Field | Type | Notes |
|---|---|---|
| `id` | string | canonical task ID |
| `title` | string | resolved task title |
| `source_feature` | string | feature directory |
| `source_path` | string | repository-relative `tasks.md` path |

Carried on `BudgetCheckResult.task` (nullable). The `task` key is **omitted** from JSON payloads when absent, guaranteeing byte-identical no-Spec-Kit output (FR-009, SC-004).

## Entity: Task source (discovery)

A candidate `specs/<feature>/tasks.md` file located directly under the repository `specs/` directory.

| Field | Type | Notes |
|---|---|---|
| `feature` | string | directory name, `localeCompare`-sorted |
| `relative_path` | string | `specs/<feature>/tasks.md`, forward slashes |

Discovery rules:

- Only direct children of `specs/` that are non-symlink directories are candidates.
- A candidate exists when `<dir>/tasks.md` is present (`pathExists`).
- Reading is via `node:fs/promises` `readdir`/`readFile` only — read-only, never mutates the file, working tree, or git state (FR-013).
- Unreadable `tasks.md` → deterministic `IOStateError` naming the path (never a silent "not found").

## Resolution algorithm (deterministic)

Input: repository root + canonical task ID.

1. If `specs/` is absent or yields zero sources → **not found** error naming the scanned list (empty).
2. For each source in sorted order, parse each line in file order with `parseTaskLine`.
3. Collect every exact ID match with its source path and parsed fields.
4. If matches span more than one distinct source path, or duplicate occurrences exist within one file → **ambiguity** error listing every distinct source path (sorted); never guess, never read `.specify/feature.json` (FR-004).
5. If zero matches → **not found** error naming the scanned list (FR-003).
6. If the single match has an empty title → **not resolvable** error naming the source (edge case).
7. If the single match carries an invalid `[budget:...]` and no CLI flag overrides → **invalid annotation** error (FR-012).
8. Otherwise return the single `SpecKitTaskResolution`.

All error messages and orderings are byte-stable per repository state (FR-017).

## Task line grammar (parser contract)

```
task-line   := "-" SP checkbox SP task-id (SP marker)* (SP title)?
checkbox    := "[ ]" | "[x]" | "[X]"
task-id     := /[Tt][0-9]{3,}/            # canonicalized via uppercase
marker      := "[" text "]"
title       := remaining plain text, trimmed (no Markdown parsing)
```

Parser behavior:

- Non-task lines (missing `-`/checkbox) → `null`, skipped.
- Missing/invalid ID token after checkbox → `null`, skipped.
- `[budget:<preset>]` among markers extracts `budget_default`.
- Empty title after ID and markers → resolvable match with empty title (resolution error if it is the single match).
- Duplicate task IDs and multi-source matches are handled by the resolution algorithm.

## State transitions

No new lifecycle states. Task metadata is carried passively:

- `start`: resolution → contract persisted with task fields → `transitionToActive`.
- `status`: reads active or last-closed contract; task context from contract fields or `budgetResult.task`.
- `check`: reads the evaluated contract; task flows through `CheckEvaluationInput` → `BudgetCheckResult.task`.
- `close`: `closeContractInPlace` preserves task fields; output mentions task ID + source path.
- Check PASS never implies task completion (explicit non-goal).

## Determinism rules

- Sources ordered lexicographically by feature name; lines in file order; matches aggregated in that order.
- Canonicalization: `id.toUpperCase()` (whole string) on a string already validated against `^[Tt][0-9]{3,}$`.
- Error lists (`scanned_sources`, ambiguity `sources`) are sorted; message template is fixed per error kind.
- Paths normalized to forward slashes; no locale/time/network influence; no git subprocesses in the resolution path.
- JSON `task` object key order matches the spec order (`id`, `title`, `source_feature`, `source_path`).

## Output projection rules

| Surface | Task metadata present | Task metadata absent |
|---|---|---|
| `status` human (active/last-closed) | `Task: <task_id>` + `Source: <path>` | existing `Task: <task_description>` unchanged |
| `check --json` | `task` object included | `task` key omitted |
| `status --budget --json` | `task` object included | `task` key omitted |
| `close` human | `Task: <task_id>` + `Source: <path>` | existing `Contract closed.` unchanged |
| OpenCode guard projection | unchanged (task fields never consumed) | unchanged |