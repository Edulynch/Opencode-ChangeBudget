# Data Model: SPEC-008 Reliability

**Branch**: `008-dogfood-reliability` | **Date**: 2026-08-18 | **Spec**: [spec.md](spec.md)

SPEC-008 changes no persisted format. This document records the persisted entities (which MUST remain stable) and the internal change-record model (whose representation changes to close the Git reliability findings).

## Persisted entities (unchanged)

### LifecycleStateRecord — `.changebudget/state.json`

| Field | Type | Notes |
|---|---|---|
| `schema_version` | string | stable |
| `lifecycle_state` | `uninitialized\|initialized\|active\|closed` | transitions enforced by `transitions.ts` |
| `active_contract_id` | string\|null | derived from lifecycle state |
| `last_closed_contract_id` | string\|null | preserved across restarts |
| `updated_at` | ISO string | |

Validation is intentionally lenient (missing/null ids normalize); SPEC-008 preserves this, but a stored id whose target file is missing/corrupt becomes a deterministic corruption error (F-M02/F-M03), never a silent null success.

### ChangeContract — `.changebudget/contracts/<id>.json`

Stable fields include `status` (`active`/`closed`), `base_revision`, `task_*` (Spec-Kit bridge), budget/allow/deny, `closed_by`/`close_reason`/`closed_at`. Invariants relevant to SPEC-008:

- `active_contract_id` set ⇒ the referenced contract file has `status: 'active'`. Any other combination is incoherent and is surfaced as a deterministic actionable error (F-M01/F-M02).
- An `active`-status contract file that no state references is an orphan from a failed `start` and is removed deterministically (F-M01).

## Internal change-record model (changes)

Representation used by the Git engine between collection and reporting. This is internal only — no persisted/user-visible format change.

### BudgetChangeItem (existing shape preserved; `staged` added)

Final merged record (extends the existing `src/core/check/diff.ts` `BudgetChangeItem`):

| Field | Type | Notes |
|---|---|---|
| `type` | `added\|modified\|deleted\|renamed` | `copy` maps to `renamed` (unchanged) |
| `path` | string | normalized repo-relative path (new path for renames) |
| `sourcePath` | string\|undef | set for renames (old path) |
| `destinationPath` | string\|undef | set for renames |
| `addedLines` | number | from the canonical worktree (`git diff <base>`) record — counted ONCE (F-M05) |
| `removedLines` | number | same canonical source |
| `staged` | boolean (NEW) | membership flag from `git diff --cached`; never adds line counts (F-M05) |
| `isBinary` | boolean | columns `-`/`-` in `-z` numstat |

`renamedFileCount` = count of merged items with `type === 'renamed'` (existing semantics preserved — no synthetic-count drift).

### Canonical collection contract

- **Totals source**: `git diff <base> -z --numstat [--find-renames] --` + `git diff <base> -z --name-status [--find-renames] --`.
- **Staged membership source**: `git diff --cached <base> -z --name-status`.
- **Untracked source**: `git ls-files --others --exclude-standard -z`.
- **Dedup identity**: normalized path (backslash→`/`, strip `./`). One record per path; union uses worktree values + `staged: true`.
- **Rename identity**: rename records carry `old`/`new` pairs; one changed-item per rename.

### Error classification (extended)

| error | exit class (unchanged) | used for |
|---|---|---|
| `InputValidationError` | input/usage | task resolution, args, parse failures, unknown stack profile (F-M12) |
| `StateConflictError` | state conflict | lifecycle violations |
| `StateCorruptionError` | corruption/environment | corrupt persisted state/JSON; incoherent active/closed state (F-M01, F-M02, F-M03) |
| `IOStateError` | corruption/environment | failed state/contract IO (F-B01 preserves-vs-error) |
| `GitEnvironmentError` | corruption/environment | git unavailable / genuine git failure |
| `GitOutputError` (new) | corruption/environment | malformed `-z` Git records (F-M06) — deterministic, with offending excerpt |

## State transitions relevant to recovery

Only existing transitions are used (`initialized→active→closed`, `closed→active`, `initialized` allows start). SPEC-008 adds **detection** at read boundaries and **re-completion of close** (re-run `close` when contract is closed but state is still `active`) — no new transition states, no automatic transitions.

## Out of scope (data)

- No new persisted fields, schema versions, migrations, cache files, or history records (`history.json` remains declared-but-unused; A-08).