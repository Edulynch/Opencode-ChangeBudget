# Implementation Plan: Execution Envelope & Material Decision Gate (SPEC-014)

**Branch**: `014-execution-decision-gate` | **Date**: 2026-09-11 | **Spec**: [spec.md](spec.md)

## Summary

Extend the existing Change Contract with an optional, contract-owned Execution Envelope. A pure deterministic evaluator accepts a normalized Material Decision and returns a governance verdict or a non-verdict input error. Git-budget `PASS`, `REPAIR`, and `HUMAN_REVIEW` remain a separate axis.

No lifecycle, storage domain, command, framework-adapter abstraction, policy DSL, service, LLM, or multi-agent mechanism is added.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20+

**Primary Dependencies**: Existing project dependencies and Node standard library only

**Storage**: Existing atomic JSON contract file under `.changebudget/contracts/<id>.json`

**Testing**: Existing Node unit, integration, and acceptance suites

**Target Platform**: Windows and Ubuntu CLI, plus optional OpenCode Runtime Guard

**Project Type**: Local-first CLI with a project-local OpenCode plugin

**Performance Goals**: Non-material operations use a structural, persistence-free fast path. Material evaluation is finite local comparison with no network, LLM, agent, or process calls.

**Constraints**: Preserve legacy contracts and all unflagged `init`, `start`, `status`, `check`, `close`, `amend`, `diagnose`, Runtime Guard, baseline, stack-policy, and Spec-Kit behavior.

## Constitution Check

| Principle | Plan response | Result |
|---|---|---|
| Local-first and deterministic | Pure evaluator, existing JSON persistence, no remote decision source. | Pass |
| Minimal architecture | Extend ChangeContract, state, existing CLI and Runtime Guard seams only. | Pass |
| Human authority | No verdict changes contract authority; necessary irreducible overrun is `ESCALATE`. | Pass |
| Small workflows | Non-material operations do not evaluate or persist governance. | Pass |
| Git change truth | Git Budget Engine is unchanged and remains a separate result source. | Pass |
| Explainability | Valid outcomes and invalid inputs have deterministic reason data. | Pass |

No Constitution exception is required after design.

## Design Decisions

### Reuse existing architecture

1. Add optional `execution_envelope` to `ChangeContract`. Absence means legacy behavior; no inferred Envelope or migration.
2. Reuse contract parsing, validation, draft creation, atomic write/reload, and close. Lifecycle transitions stay unchanged.
3. Add one pure `execution-gate` evaluator. It receives normalized data, never reads Git or framework names, and never writes state.
4. Reuse Runtime Guard `permission.ask` as the pre-action consumer: while `OPEN`, it evaluates only explicit structured Material Decision data and ordinary context keeps current projection behavior; after `CONTRACT_SATISFIED`, every structurally valid operation reaches the post-satisfaction guard before materiality.
5. Use `start --execution-envelope-json '<JSON>'` only to create an Envelope and `check --satisfaction-evidence-json '<JSON>'` only to submit satisfaction evidence. `start` accepts at most one non-null normalized Envelope object; duplicate use, invalid syntax, or invalid JSON type is `InputValidationError`. `check` accepts at most one evidence object, validates duplicates and syntax at the input boundary, and preserves absent-flag legacy/read-only behavior. No Material Decision CLI flag or new command is added.

### Evaluation order

1. Recognize legacy/no-envelope state.
2. Check structural validity.
3. Apply the irreversible `CONTRACT_SATISFIED` post-satisfaction guard.
4. Determine materiality.
5. Evaluate governance by comparing requested authority with declared limits and criterion mapping.
6. Produce exactly one valid outcome: `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, or `ESCALATE`.
7. Atomically append/replay valid material decisions only.

Structurally invalid proposals return `INVALID_PROPOSAL`, which is not a governance verdict, grants no authority, and applies even after satisfaction. After satisfaction, the post-satisfaction guard precedes materiality. Only read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue without a governance verdict. Every other valid mutating or additional operation returns `BLOCK`, including operations that would otherwise be non-material; materiality cannot bypass the guard. New work requires new explicit authority.

`APPROVE` confirms existing authority. `REDUCE` uses a lower declared bound. `REPLACE` uses a declared canonical alternative and prevails over `DEFER` when needed for the criterion. `DEFER` is optional work without such an alternative. Optional HARD prohibition is `BLOCK`. Every necessary, irreducible out-of-envelope expansion is `ESCALATE`, whether originating from HARD or SOFT limits.

### Closed comparison contract

The evaluator receives normalized closed forms only. The identifiers are `scope_expansion`, `delegated_agent`, `concurrent_worker`, `reasoning_escalation`, `research_expansion`, `architecture_review`, `verification_expansion`, `documentation_expansion`, `infrastructure_expansion`, `external_service`, and `post_satisfaction_work`. `scope_expansion` reuses existing ChangeContract path policy. `delegated_agent` and `concurrent_worker` use integer `{ amount, max, minimum_required, constraint }`; the remaining non-scope variants use exact opaque `{ value, allowed, constraint, canonical_alternatives }`. Constraint is exactly `HARD` or `SOFT`; canonical alternatives contain an allowlisted value and declared criterion references. Missing known-kind authority is `{ max: 0, constraint: SOFT }` or `{ allowed: [], constraint: SOFT }`. No DSL, generic comparator, fuzzy, substring, semantic matching, scoring, or LLM is allowed.

While `OPEN`, `scope_expansion` outside ChangeContract path policy uses only existing ChangeContract policy and has no governance verdict. It never returns `ESCALATE` and never duplicates scope authority. While `OPEN`, `post_satisfaction_work` is structurally invalid and returns `INVALID_PROPOSAL` without a verdict or authority.

Structural validation rejects unknown material kinds, incompatible shapes, missing criterion references or evidence, invalid numeric bounds where `0 < minimum_required <= requested.amount` is false, invalid constraint, non-allowlisted canonical values, and canonical references to undeclared criteria as `INVALID_PROPOSAL`. A known-kind value outside its maximum or exact allowlist is an outside comparison value. Numeric inside is `APPROVE`; outside is `REDUCE` to positive `M`, optional zero SOFT `DEFER`, optional zero HARD `BLOCK`, required `REDUCE` to `N` when `N <= M`, and `ESCALATE` when `N > M`. Allowlist inside is `APPROVE`, then needed canonical `REPLACE`, then optional SOFT `DEFER`, optional HARD `BLOCK`, or required `ESCALATE`. `REPLACE` precedes `DEFER`.

Readiness cannot approve until inside/outside, limits, `REDUCE`, and `REPLACE` have normalized deterministic comparisons and the Docker fixture simulates every outcome, including `INVALID_PROPOSAL` and post-satisfaction `BLOCK`. Any invented comparison semantics returns `NEEDS_REVISION`.

### Minimal persistence

| Value | Persist? | Reason / invariant |
|---|---|---|
| Goal, criteria, evidence mapping, limits, canonical alternatives | Yes | Not derivable from Git; protects correctness and monotonic authority across restart. |
| Satisfaction evidence and latch | Yes | Completion must survive process exit; protects irreversible `CONTRACT_SATISFIED`. |
| Normalized material-decision ledger and outcome | Yes | Enables audit and idempotent replay across restart. |
| Non-material classification, derived comparison, invalid proposal | No | Recomputed locally; no audit authority; preserves fast path. |

## Project Structure

```text
src/
├── models/
│   ├── change-contract.ts              # optional Envelope ownership
│   └── execution-gate.ts               # closed input/outcome/reason types
├── core/
│   ├── execution-gate.ts               # pure decision-table evaluator
│   ├── validation/contract-validator.ts
│   └── state/contracts.ts               # atomic Envelope and ledger persistence
├── cli/
│   ├── parsers/contract-input.ts
│   └── commands/{start,check,status}.ts
└── integration/opencode-runtime.ts      # existing package boundary retained

opencode-plugin/src/
├── evaluator.ts                         # compose optional gate result
├── projection.ts                        # preserve runtime/Git precedence
└── index.ts                             # existing permission.ask boundary

tests/
├── unit/execution-gate.test.ts
├── integration/execution-gate.spec.ts
├── integration/opencode-plugin-runtime-hook.spec.ts
└── acceptance/spec014-execution-decision-gate.test.ts
```

**Structure Decision**: one new pure evaluator and closed model types are necessary because the repository has no existing pre-action authority decision component. Everything else extends existing ownership and test seams.

## Internal Contract

[contracts/execution-gate.md](contracts/execution-gate.md) defines the framework-neutral boundary. It is an internal contract, not a public API or policy DSL.

## Test Strategy

1. Pure decision-table tests: fast path; all six outcomes; invalid evidence/type; reason determinism; replay conflict; HARD/SOFT; satisfaction latch.
2. Persistence tests: optional-field round trip, legacy absent-envelope behavior, atomic ledger replay, and irreversible satisfaction.
3. Existing-command integration: optional Envelope creation and satisfaction evidence inputs while locking unflagged behavior and Git-budget results; proposal transport remains the Runtime Guard path.
4. Runtime Guard tests: normalized proposals reach evaluation only through `permission.ask` -> Runtime Guard normalization -> evaluator -> projection; ordinary `allow`/`ask`/`block` precedence is unchanged.
5. Acceptance fixture: typed Docker-runner decision table only; no Docker, runner, workflow, credential, or GitHub infrastructure.

## Docker Runner Acceptance

The fixture declares Linux runner setup and smoke validation as required using exact opaque identifiers. Expected results: extra worker `REDUCE`; expensive reasoning, documentation, architecture review, and release readiness `DEFER`; optional Windows runner `BLOCK`; full regression `REPLACE` by required smoke; undeclared necessary infrastructure or external service `ESCALATE`; malformed or unknown-kind proposals `INVALID_PROPOSAL`; and a post-satisfaction refactor `BLOCK`. Every case separately asserts no change to the Git-budget axis.

## Anti-Overengineering Review

| Candidate | Decision | Reason |
|---|---|---|
| New lifecycle/state machine | Exclude | Contract-owned satisfaction latch is sufficient. |
| New command | Exclude | Optional existing `start`/`check` inputs suffice. |
| Separate ledger/database | Exclude | Contract JSON is the sole persistence owner. |
| Generic adapter layer | Exclude | Existing Runtime Guard is one sufficient consumer. |
| LLM, court, scoring, provider quotas | Exclude | Violates local deterministic scope. |
| Docker/GitHub test infrastructure | Exclude | Typed fixtures demonstrate the gate. |
| New test harness | Exclude | Existing Node suites cover the work. |

## Complexity Tracking

No complexity exception is planned.
