# Implementation Plan: OpenCode Runtime Guard

**Branch**: `004-opencode-runtime-guard` | **Date**: 2026-08-16 | **Spec**: `specs/004-opencode-runtime-guard/spec.md`

**Input**: Feature specification from `/specs/004-opencode-runtime-guard/spec.md`

## Summary

This feature adds a minimal optional OpenCode plugin that evaluates active ChangeBudget contract policy before OpenCode writes mutate repository state. The plugin projects the existing deterministic `PASS`/`REPAIR`/`HUMAN_REVIEW` result into an OpenCode `runtimeAction` (`allow`, `ask`, `block`) using path rules, sensitive toggles, and fail-safe defaults.

The feature is intentionally narrow: no workflow changes outside OpenCode interception, no audit log requirements, no deep shell prediction. Existing CLI remains unchanged when the plugin is disabled or unavailable.

## Technical Context

**Language/Version**: TypeScript 5.x and Node.js 20+ runtime baseline (ECMAScript modules).

**Primary Dependencies**:

- Existing ChangeBudget modules (`state`, `contracts`, `check` models and path evaluator).
- `@opencode-ai/plugin` at version pinned in `.opencode/package.json`.

**Storage**: Existing repository-local `.changebudget/` state only.

**Testing**: Unit + integration tests in `tests/**/*.ts`, plus manual OpenCode session exercises.

**Target Platform**: Local developer workstation (Windows, macOS, Linux).

**Project Type**: CLI core plus optional OpenCode plugin package.

**Performance Goals**:

- Keep plugin decision latency low enough for interactive prompts.
- Fail-safe decisions (`block`/`deny`) must be deterministic for identical repo state + operation context.

**Constraints**:

- No network calls; fully local-first.
- No side effects to `.changebudget` state from plugin decisions.
- Preserve SPEC-001 to SPEC-003 behavior when plugin is unavailable.

**Scale/Scope**: Per-repository session runtime; no new persistence layer.

## Constitution Check

*GATE: Must pass before execution and is re-checked after implementation planning.*

- Local-first and deterministic: PASS
- Minimal architecture: PASS
- Explicit policy boundaries: PASS
- No hard dependency on OpenCode for core behavior: PASS

## Technical Decisions

- **Hook surface selection**: use `permission.ask` as the primary enforcement path because it returns an explicit runtime decision (`allow` | `deny` | `ask`).
- **Projection strategy**: compute a deterministic `policyDecision` for the active repository contract, then deterministically project to `runtimeAction`.
- **Path policy source**: reuse existing path matching semantics from SPEC-002 to keep allow/deny behavior stable with `allow_paths` and `deny_paths`.
- **Critical path block list**: always deny any mutating operation targeting `.changebudget/**`.
- **Fail-safe mode**: in initialized repositories, unknown context or non-deterministic mutating targets resolve to `block`; in non-initialized repositories resolve to `allow`.
- **Ask scope**: one-shot operation-only approval with no persisted policy mutation.
- **Error posture**: evaluator failures (contract invalid, state mismatch, bad base revision, or runtime hook error) should not permit mutating operations unless an explicit safe path is established.

## Command and Source Responsibilities

### CLI Layer (unchanged in this spec)

No command contract changes are introduced in `src` for this spec. Existing check result fields and decision semantics remain the policy source for plugin projection.

### Runtime Layer (new in this spec)

Add an OpenCode runtime package that:

- Loads active contract context from repo state and resolves a policy snapshot.
- Evaluates the operation target + operation semantics.
- Applies deterministic projection into `runtimeAction` with one rule code.
- Returns decision to OpenCode using `permission.ask` output status.
- Writes only optional session output text (no file writes). 

### Optional support hooks

Record non-mutating and unsupported operations for diagnostics only (for logs/messages), but only enforce through `permission.ask` decisions.

## Documentation Structure

### Documentation (this feature)

```text
specs/004-opencode-runtime-guard/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── plugin-hook-contract.md
│   └── runtime-decision-contract.md
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/
├── cli/
│   └── [existing command modules unchanged]

# New plugin package (separate entrypoint)
opencode-plugin/
├── package.json
└── src/
    ├── evaluate.ts
    ├── evaluator.ts
    └── index.ts

tests/
├── unit/
└── integration/
```

**Structure Decision**: Keep existing CLI structure intact and add an isolated optional OpenCode plugin implementation outside `src/` so CLI and runtime guard remain independently buildable.

## Execution Plan

- Implement a shared projection module that accepts `(policyDecision, operationContext, contract)` and returns `(runtimeAction, rule, reasonCode)`.
- Resolve active contract context and derive a normalized operation context with deterministic target extraction.
- Handle `.changebudget/**` and sensitive flags (`allow_new_dependencies`, `allow_migrations`, `allow_config_changes`, `allow_public_api_changes`) before fallback checks.
- Implement hook adapter that maps projection result to OpenCode permission hook output.
- Add unit tests for projection truth table and all deterministic edge paths.
- Add manual quickstart validation scenarios that cover at least the first 6 success criteria.
- Confirm no behavioral changes in `changebudget` CLI commands when plugin is not installed or initialization fails.

## Risks and Deferrals

- Exact OpenCode `permission` payload shape for every built-in tool may vary by version; we treat it as a deterministic parse target and add fail-safe unknown-operation denial rules.
- Deep shell write prediction and stack-specific policy packs are explicitly out of scope per spec clarifications.

## Post-Design Constitutional Review

- Local-first and deterministic: PASS
- Minimal architecture: PASS
- Scoped enforcement only: PASS
- Non-breaking core behavior: PASS
- Human-centred decisioning: PASS

## Complexity Tracking

No complexity violations requiring special justification remain after planning.
