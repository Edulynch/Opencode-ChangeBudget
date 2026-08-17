# Implementation Plan: Policy Results, Reports & Exit Codes

**Branch**: `003-policy-results-exit-codes` | **Date**: 2026-08-16 | **Spec**: `specs/003-policy-results-exit-codes/spec.md`

**Input**: Feature specification from `/specs/003-policy-results-exit-codes/spec.md`

## Summary

This feature finalizes SPEC-003 by making `changebudget check` emit a stable `decision` and reason model, by returning consistent machine-readable JSON fields, and by mapping those decisions to fixed exit codes used by CI. The work reuses SPEC-002 evaluation semantics and adds deterministic output/error handling only at the command/reporting boundary.

## Technical Context

**Language/Version**: TypeScript, Node.js CLI
**Primary Dependencies**: Node stdlib, existing ChangeBudget modules (`diff`, `rules`, `contracts`, `state`, `git`)
**Storage**: Repository-local git/JSON state under `.changebudget`
**Testing**: Node `test` runner + existing TypeScript CLI integration/unit tests
**Target Platform**: Local Git repositories (Windows and POSIX shells)
**Project Type**: Single-project CLI
**Performance Goals**: Same asymptotic behavior as current checks; output must be deterministic across same repository state
**Constraints**: Preserve local-first enforcement semantics, no contract mutations on check
**Scale/Scope**: Existing quickstart and integration flows plus new SPEC-003 scenarios

## Constitution Check

- **GATE 1**: keep logic local-first and deterministic (Constitution I, VI).
- **GATE 2**: keep architecture minimal and avoid unrelated refactors (Constitution II, III, XVII).
- **GATE 3**: enforce explainable decisions with human-readable context (Constitution VII, IX).

## Project Structure

### Documentation (this feature)

```text
specs/003-policy-results-exit-codes/
├── plan.md
├── checklists/
│   └── requirements.md
├── spec.md
└── tasks.md
```

### Source Code

```text
src/
├── cli/
│   ├── commands/
│   │   ├── check.ts
│   │   └── status.ts
│   └── index.ts
├── core/
│   ├── check/
│   │   ├── rules.ts
│   │   └── patterns.ts
│   └── state/
│       └── state.ts
└── models/
    ├── check-result.ts
    ├── errors.ts
    └── change-contract.ts

tests/
├── unit/
│   └── check-rules.test.ts
└── integration/
    ├── check-budget-engine.spec.ts
    └── lifecycle-init-start-status-check.spec.ts
```

## Planned Approach

- **Decision behavior**: in `runCheck` (`src/cli/commands/check.ts`), catch evaluation-time and input/validation failures and return `HUMAN_REVIEW` result objects instead of throwing where safe, preserving human output and CI-friendly exit code mapping.
- **Reason mapping**: map exception sources to canonical codes in `check.ts` for decision output.
- **Deterministic ordering**: keep violations and limit ordering stable in `src/core/check/rules.ts` (`rule` then `reason_code` then `path`, then `max_files` before `max_changed_lines`).
- **Human output**: include all required decision/context fields in `printCheckResult`/`printStatusBudgetResult` when non-JSON.
- **Machine output**: extend `--json` payloads in `src/cli/index.ts` with explicit `reason_code` and `severity` fields for violations plus `reason_codes` aliasing.
- **Status reuse**: keep status budget behavior non-destructive while surfacing the same check result schema in `status --budget --json`.

## Validation Plan

- Add/adjust unit coverage for deterministic ordering in `src/core/check/rules.ts`.
- Add/adjust integration coverage for:
  - pass / repair / human-review outcomes,
  - exit code behavior,
  - machine JSON fields (`decision`, `reason_codes`, sorted violations),
  - `status --budget` non-mutation and reason propagation.

## Notes

- Existing SPEC-002 behavior remains the policy engine source of truth; this feature only changes result shaping, decision taxonomy, ordering guarantees, and reporting/exit handling.

## Summary

[Extract from feature spec: primary requirement + technical approach from research]

## Technical Context

<!--
  ACTION REQUIRED: Replace the content in this section with the technical details
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: [e.g., Python 3.11, Swift 5.9, Rust 1.75 or NEEDS CLARIFICATION]

**Primary Dependencies**: [e.g., FastAPI, UIKit, LLVM or NEEDS CLARIFICATION]

**Storage**: [if applicable, e.g., PostgreSQL, CoreData, files or N/A]

**Testing**: [e.g., pytest, XCTest, cargo test or NEEDS CLARIFICATION]

**Target Platform**: [e.g., Linux server, iOS 15+, WASM or NEEDS CLARIFICATION]

**Project Type**: [e.g., library/cli/web-service/mobile-app/compiler/desktop-app or NEEDS CLARIFICATION]

**Performance Goals**: [domain-specific, e.g., 1000 req/s, 10k lines/sec, 60 fps or NEEDS CLARIFICATION]

**Constraints**: [domain-specific, e.g., <200ms p95, <100MB memory, offline-capable or NEEDS CLARIFICATION]

**Scale/Scope**: [domain-specific, e.g., 10k users, 1M LOC, 50 screens or NEEDS CLARIFICATION]

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

[Gates determined based on constitution file]

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
<!--
  ACTION REQUIRED: Replace the placeholder tree below with the concrete layout
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
# [REMOVE IF UNUSED] Option 1: Single project (DEFAULT)
src/
├── models/
├── services/
├── cli/
└── lib/

tests/
├── contract/
├── integration/
└── unit/

# [REMOVE IF UNUSED] Option 2: Web application (when "frontend" + "backend" detected)
backend/
├── src/
│   ├── models/
│   ├── services/
│   └── api/
└── tests/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── tests/

# [REMOVE IF UNUSED] Option 3: Mobile + API (when "iOS/Android" detected)
api/
└── [same as backend above]

ios/ or android/
└── [platform-specific structure: feature modules, UI flows, platform tests]
```

**Structure Decision**: [Document the selected structure and reference the real
directories captured above]

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| [e.g., 4th project] | [current need] | [why 3 projects insufficient] |
| [e.g., Repository pattern] | [specific problem] | [why direct DB access insufficient] |
