# Implementation Plan: Deterministic Git Budget Engine

**Branch**: `002-deterministic-git-budget-engine` | **Date**: 2026-08-15 | **Spec**: specs/002-deterministic-git-budget-engine/spec.md

**Input**: Feature specification from `/specs/002-deterministic-git-budget-engine/spec.md`

## Summary

SPEC-002 upgrades `changebudget check` from contract syntax validation only to deterministic Git-based budget enforcement.
The feature adds a stable changed-file and line delta measurement pipeline, applies allow/deny path policies, and emits a deterministic check result with rule-by-rule pass/fail details while keeping SPEC-001 lifecycle transitions untouched.

The change is scoped to the existing CLI command surface and local filesystem artifacts.
`check` remains non-mutating for working tree, index state, and `.changebudget` state files.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20.x+ runtime (ECMAScript modules)

**Primary Dependencies**: No mandatory runtime dependencies. Git commands are executed via `node:child_process` and standard Node.js modules; path matching is implemented with a deterministic, small utility matcher to avoid dependency drift.

**Storage**: Existing repository-local `.changebudget/` files only. No new persistence objects are introduced in SPEC-002.

**Testing**: `node --test` over fixture repositories and temporary directories with staged/unstaged, rename, delete, and untracked scenarios.

**Target Platform**: Local developer workstation (cross-platform: Windows, Linux, macOS).

**Project Type**: CLI utility with local check enforcement behavior.

**Performance Goals**: Stable performance in local repos. Command time is bounded by explicit Git diff operations and small in-memory merges.

**Constraints**: No network calls, no state mutation by check, deterministic repeatable output for identical inputs, and explicit failure on invalid Git context or base revision.

**Scale/Scope**: Optimized for repository-local developer use and repeated check cycles on medium-size repos.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Gate: Local-first and deterministic

- Status: **PASS**
- Evidence: All budget outcomes come from Git data and contract files in the active repository.

### Gate: Scope is a hard boundary

- Status: **PASS**
- Evidence: Feature only changes `check` command behavior and output; lifecycle commands stay API-compatible.

### Gate: Minimal architecture and no unnecessary infrastructure

- Status: **PASS**
- Evidence: Existing CLI structure is extended with narrowly-scoped modules; no services or new stores are added.

### Gate: Git is source of truth

- Status: **PASS**
- Evidence: Metrics are computed from `git diff` (staged and unstaged), tracked deletions, renames, and untracked files.

### Gate: Enforcement over suggestion

- Status: **PASS**
- Evidence: Results are explicit, rule-scoped, and return deterministic non-pass output when checks fail.

### Gate: Explainable decisions

- Status: **PASS**
- Evidence: check result includes `violations`, expected vs observed counts, and path reasons for path policy failures.

## Technical Decisions (resolved)

- **Runtime**: keep Node.js execution baseline and TypeScript modules.
- **Git commands**: use the existing `ensureGitRepository()` + dedicated helpers in `core/git` for diff extraction and repository checks.
- **Revision resolution**: validate `base_revision` using `git rev-parse --verify --quiet <ref>^{commit}` before evaluation.
- **Canonical diff shape**: compute a normalized change set from three inputs:
  - staged diff (`git diff --cached --name-status`, `--numstat`)
  - unstaged/worktree diff (`git diff --name-status`, `--numstat`)
  - untracked files (`git ls-files --others --exclude-standard`)
  deduplicated by normalized path.
- **Rename handling**: canonical rename events are represented consistently using source/destination pairs and included as changed paths.
- **Line counting**: use `--numstat` totals for text changes; use explicit binary fallback for binary-only paths (deterministic, non-text contribution policy).
- **Path rules**: implement deterministic glob-like matcher with normalized `/` relative paths; malformed patterns are validation errors.
- **Output shape**: deterministic `CheckResult` object printed by CLI in stable, line-ordered format.
- **Error strategy**: `InputValidationError` for bad contract/patterns/missing draft, `GitEnvironmentError` for missing/invalid base or invalid git state, and existing state error classes for contract state failures.

## Command Responsibilities (SPEC-002)

| Command | Responsibility | Failure handling |
|---|---|---|
| `check` | Resolve contract source (active or `--draft`), validate contract and base revision, compute budgets, enforce path rules, return deterministic result | `InputValidationError` for invalid input/paths/draft, `GitEnvironmentError` for non-git/bad revision, `StateCorruptionError` for invalid persisted state, no mutation on success or failure |

## Git Interaction Strategy

- Keep repo discovery and revision checks strict and deterministic.
- Fail fast when git context or base revision is invalid.
- Build canonical path set before rule evaluation and use stable sorting to guarantee output determinism.
- Include adds, edits, deletions, renames, and non-ignored untracked files.
- Avoid any index or working-tree mutation.

## Component Responsibilities

- `src/cli/commands/check.ts`: input parsing, contract source selection, run budget engine, render deterministic output.
- `src/core/check/result.ts` (new): shared typed result models.
- `src/core/check/diff.ts` (new): staged/unstaged/untracked extraction and normalization.
- `src/core/check/rules.ts` (new): file/line totals, path policy evaluation, status/violation assembly.
- `src/core/check/patterns.ts` (new): deterministic glob-like matcher + pattern validator.
- `src/models/check-result.ts` (new): result, path rule, limit, and violation interfaces.

## Dependency list (resolved)

- Runtime: Node.js + TypeScript.
- Git utility: CLI command execution from existing `core/git/repo.ts`.
- Tests: node test runner.

## Project Structure

### Documentation (this feature)

```text
specs/002-deterministic-git-budget-engine/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── cli-check-contract.md
    └── check-result-contract.md
```

### Source Code (repository root)

```text
src/
├── cli/
│   ├── commands/
│   │   └── check.ts
│   ├── index.ts
│   └── output.ts
├── core/
│   ├── check/
│   │   ├── diff.ts
│   │   ├── patterns.ts
│   │   ├── result.ts
│   │   └── rules.ts
│   ├── git/
│   │   └── repo.ts
│   └── state/
│       ├── contracts.ts
│       ├── state.ts
│       └── transitions.ts
├── models/
│   ├── change-contract.ts
│   ├── check-result.ts
│   ├── errors.ts
│   └── lifecycle-state.ts

tests/
├── integration/
│   ├── lifecycle-init-start-status-check.spec.ts
│   └── check-budget-engine.spec.ts
└── unit/
    ├── check-patterns.test.ts
    ├── check-rules.test.ts
    ├── check-result.test.ts
    └── contract-validator.test.ts
```

**Structure Decision**: Continue with the existing single-package CLI layout and add modular `core/check` helpers.

## Risks and SPEC-003+ Deferrals

- Status-to-resolution mapping (PASS / REPAIR / HUMAN_REVIEW) is deferred to SPEC-003.
- Fine-grained large-repo performance and cache warming are deferred for later specs.
- Extended policy categories (dependency/type/stack-specific logic) remain out of scope.

## Post-Design Constitutional Review

Re-check against core principles after data model and contracts are defined:

- I. Local-first and deterministic: **PASS**
- II. Minimal architecture: **PASS**
- III. Scope is a hard boundary: **PASS**
- IV. Git is source of change truth: **PASS**
- V. Targeted validation: **PASS**
- VI. Explainable decisions: **PASS**

No violations were introduced during planning.

## Complexity Tracking

No violations require justification. The implementation stays intentionally narrow to one command and deterministic diff-to-rule evaluation.
