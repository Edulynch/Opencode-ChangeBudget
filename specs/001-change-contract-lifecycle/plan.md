# Implementation Plan: Local Change Contract Lifecycle

**Branch**: `001-change-contract-lifecycle` | **Date**: 2026-08-15 | **Spec**: specs/001-change-contract-lifecycle/spec.md

**Input**: Feature specification from `/specs/001-change-contract-lifecycle/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command; its definition describes the execution workflow.

## Summary

SPEC-001 establishes the local lifecycle for a change contract: initialization, single active contract management, status reporting, closure, and deterministic local validation/error behavior. The implementation plan focuses on a minimal Node.js CLI with JSON file state under `.changebudget/`, strict contract schema validation, deterministic state transitions, and a command surface that is stable and intentionally scoped to local lifecycle behavior only.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20.x+ runtime (ECMAScript modules)

**Primary Dependencies**: Standard Node.js/TypeScript runtime APIs only; no external production dependencies unless required by implementation validation needs (planned initial version is dependency-minimal)

**Storage**: Local repository files only (`.changebudget/state.json`, `.changebudget/contracts/{id}.json`, `.changebudget/contracts/history.json` when enabled)

**Testing**: Node-compatible test runner (initially `bun test` or `node --test`) and lightweight fixture repos for contract lifecycle states

**Target Platform**: Local developer workstation (cross-platform: Windows/macOS/Linux)

**Project Type**: CLI utility (local-first developer tool)

**Performance Goals**: Command latency < 200ms for typical metadata operations on local repos; fully bounded by filesystem + minimal JSON parsing

**Constraints**: No network calls for lifecycle operations, no speculative workflow, deterministic behavior, and no scope to enforcement of diff budgets in this phase

**Scale/Scope**: Optimized for personal/project-level repos with frequent small-to-medium changes; support multiple repositories via independent `.changebudget` directories

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Gate: Local-first and deterministic

- Status: **PASS**
- Evidence: All state and contract artifacts are repository-local files; all transitions are explicit and deterministic.

### Gate: Scope is a hard boundary

- Status: **PASS**
- Evidence: Plan covers only SPEC-001 flow (`init`, `start`, `status`, `check`, `close`) and explicitly excludes budget enforcement, interceptor, policy engines, and remote integrations.

### Gate: Minimal architecture and no unnecessary infrastructure

- Status: **PASS**
- Evidence: No backend, DB, queue, plugin runtime, or UI service is introduced in this phase.

### Gate: Git is truth source

- Status: **PASS**
- Evidence: lifecycle base revision and repo scope validations depend on Git repo detection and Git references captured at `start` time.

## Technical Decisions (resolved)

- **Node.js vs Bun (v0.1)**: **Node.js 20+** as runtime base, with Bun allowed for local test execution only if developer preference. Rationale: broader ecosystem compatibility for future scripts and the existing workspace already includes Node-centric tooling.
- **Package manager**: **npm** for baseline clarity and cross-machine availability; Bun is optional only for local developer convenience.
- **Module system**: **ESM** for TypeScript modules for explicitness and future tree-shake compatibility.
- **CLI parsing**: **`node:util` parsing utilities** (or minimal custom parser) to avoid external dependency risk; this keeps command parsing local and transparent.
- **Persistence format**: **human-readable JSON** with explicit `schema_version` and deterministic property ordering on write.
- **Git invocation**: **native Git CLI** via `git` command executed with explicit repo path (`-C`) and targeted commands only.
- **Error model**: sealed typed error hierarchy (`InputValidationError`, `StateConflictError`, `GitEnvironmentError`, `IOStateError`) to keep output predictable.
- **Exit strategy**: explicit numeric codes (`0` success, `2` usage/validation failure, `3` state conflict, `4` repo/environment failure, `10` unknown failure) to preserve machine readability in future phases.
- **Test stack**: start with **node:test** or **bun test** and filesystem temp repos; prefer the one matching runner used by maintainers for this workspace.
- **Distribution approach**: local CLI entrypoint via package script plus optional binary wrapper later; no service deployment.

## Command Responsibilities (SPEC-001)

| Command | Responsibility | Failure handling |
|---|---|---|
| `init` | Validate repository context and create/normalize local ChangeBudget workspace | Repo errors and deterministic conflict/no-op behavior only |
| `start` | Validate and persist contract draft, then transition state to active | Hard fail on invalid input, invalid state, missing/invalid revision or unsafe partial state |
| `status` | Summarize lifecycle + active contract context | Never mutates data; deterministic failure if state is corrupt |
| `check` | Validate active contract or explicit draft against schema/rules | Never mutates data; specific reasons for first failure or full validation list |
| `close` | Close the active contract and persist closure metadata | Reject when no active contract; update references atomically |

## Git Interaction Strategy

- Detect repository root using `git -C . rev-parse --show-toplevel`.
- Accept only local repo root for workspace creation and base-revision capture.
- Resolve and persist base revision from a validated git ref (typically `HEAD`) as user-provided input at `start` time.
- Reject command flows that require repo metadata when Git is unavailable or repository is non-initialized.
- For repositories with no commits yet, `start` may accept an explicit revision input only when it resolves successfully; otherwise return explicit input guidance.

## Component Responsibilities

- **`src/cli/`**: argument parsing, command dispatch, formatting outputs.
- **`src/core/git/`**: Git repository inspection and revision validation.
- **`src/core/state/`**: state file and contract persistence read/write semantics.
- **`src/core/validation/`**: contract schema and transition validation.
- **`src/models/`**: typed definitions for contracts, lifecycle state, and error models.
- **`src/cli/parsers/`**: contract input parsing + normalization helpers.

## Git-safe error categories

- `GitEnvironmentError`: not a Git repository, no readable `.git`, or non-resolvable reference.
- `InputValidationError`: missing/invalid command input.
- `StateConflictError`: invalid state transition or active-contract conflicts.
- `StateCorruptionError`: persisted state cannot be safely reconciled.
- `IOStateError`: atomic write/read failures, permissions, path issues.

## Dependency list (resolved)

- Runtime: Node.js + TypeScript.
- Validation/helping packages: none mandatory for SPEC-001 core.
- Test tooling: node test runner or bun test (single runner selected by maintainer preference).
- Git utilities: CLI command invocation only.

## Post-Design Constitutional Review

Re-check against core principles after data model and contract boundaries were defined:

- I. Local-first and deterministic: **PASS**
- II. Minimal architecture: **PASS**
- III. Scope is a hard boundary: **PASS**
- IV. Git is source of truth: **PASS**
- V. Targeted validation before exhaustive validation: **PASS**

No violations were introduced during planning.

## Risks and SPEC-002+ Deferrals

- **Future-path risk**: adding richer base revision semantics (renames, staged-only checks, large repos) deferred to SPEC-002.
- **Policy/rule expansion risk**: stack presets and diff-budget enforcement are explicit SPEC-002+ capabilities and are not implemented in this phase.
- **Distribution risk**: shipping a single binary is deferred until core behavior is stable; for now, source-runner + package scripts are sufficient.

## Project Structure

### Documentation (this feature)

```text
specs/[###-feature]/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
```text
src/
├── cli/
│   ├── index.ts           # command entrypoint and dispatch
│   ├── commands/
│   │   ├── init.ts
│   │   ├── start.ts
│   │   ├── status.ts
│   │   ├── check.ts
│   │   └── close.ts
│   └── parsers/
│       └── contract-input.ts
├── core/
│   ├── state/
│   │   ├── state.ts
│   │   ├── contracts.ts
│   │   └── transitions.ts
│   ├── validation/
│   │   └── contract-validator.ts
│   └── git/
│       └── repo.ts
└── models/
    ├── change-contract.ts
    ├── lifecycle-state.ts
    └── errors.ts

tests/
├── contract/
│   ├── init.test.ts
│   ├── start.test.ts
│   ├── status.test.ts
│   ├── check.test.ts
│   └── close.test.ts
├── integration/
│   ├── lifecycle-state-machine.test.ts
│   └── git-repository-constraints.test.ts
└── unit/
    ├── contract-validator.test.ts
    └── state-transitions.test.ts
```

**Structure Decision**: Chosen as a small single-package CLI layout under `src/` with explicit command, core, and model boundaries. Tests are split into contract/state, integration, and unit categories to keep failure scope bounded during targeted validation.

## Complexity Tracking

No violations require justification. The plan stays on minimal architecture and does not add avoidable complexity beyond file IO, JSON parsing, command dispatch, and deterministic state transition checks.
