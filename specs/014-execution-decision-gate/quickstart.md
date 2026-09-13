# Validation Guide: SPEC-014

## Preconditions

- Node.js 20+ and normal repository dependencies.
- Disposable repositories for observable contract persistence.
- No Docker daemon, GitHub access, runner credential, or remote service.

## Validation Sequence

1. Run pure execution-gate tests for fast path, six verdicts, invalid input, replay, HARD/SOFT, and satisfaction.
2. Run persistence and legacy tests to preserve lifecycle and Git-budget behavior without an Envelope.
3. Run existing CLI and Runtime Guard tests to prove ordinary behavior is unchanged.
4. Run the typed Docker-runner acceptance fixture.
5. Run normal typecheck and targeted suites, then the ChangeBudget validation workflow.

Validation coverage must include the Envelope-enabled order of structural validity, the `CONTRACT_SATISFIED` post-satisfaction guard, materiality, and governance evaluation. It must verify that structurally invalid proposals return `INVALID_PROPOSAL` without a governance verdict or authority, including after satisfaction. It must verify that after satisfaction only read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue, while every other valid mutating or additional operation returns `BLOCK`, including normally non-material operations. It must also verify that satisfaction is irreversible and new work requires new explicit authority.

The readiness gate cannot return `READY_FOR_IMPLEMENTATION` unless every proposal has a normalized representation for inside/outside comparison, limits, `REDUCE`, and `REPLACE`. The fixture must simulate `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, `ESCALATE`, `INVALID_PROPOSAL`, and post-satisfaction `BLOCK`; if any case requires invented semantics, it returns `NEEDS_REVISION`.

## Docker-Runner Results

| Proposal | Expected result |
|---|---|
| Required Linux runner and smoke path | `APPROVE` |
| Extra worker | `REDUCE` |
| Optional Windows runner | `BLOCK` |
| Reasoning, architecture review, documentation, release readiness | `DEFER` |
| Full regression where smoke is required | `REPLACE` |
| Necessary undeclared infrastructure/service | `ESCALATE` |
| Malformed shape, missing evidence, unknown authority-changing kind | `INVALID_PROPOSAL` |
| Valid refactor after `CONTRACT_SATISFIED` | `BLOCK` |

Every row must separately show unchanged Git-budget `PASS`, `REPAIR`, and `HUMAN_REVIEW` meanings.

The Docker fixture uses exact opaque identifiers, not substring or semantic matching. `runner.linux` and `validation.smoke` are required allowlisted targets and return `APPROVE`; `validation.full` maps to canonical `validation.smoke` and returns `REPLACE`; `service.github` is an undeclared required service and returns `ESCALATE`. Numeric worker requests use `amount`, `max`, and `minimum_required` and return `REDUCE` when a positive declared maximum exists.
