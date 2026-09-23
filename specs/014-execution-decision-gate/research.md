# Research: SPEC-014 Execution Envelope & Material Decision Gate

## Extend ChangeContract

**Decision:** Add one optional contract-owned Envelope.

**Rationale:** Existing optional fields, atomic JSON persistence, and legacy recognition provide compatible ownership.

**Rejected:** A standalone governance file, database, or lifecycle duplicates current contract authority.

## Add one pure evaluator

**Decision:** Keep materiality, validation, authority comparison, and verdict selection in one pure local module.

**Rationale:** This preserves separate Git-budget semantics and allows deterministic decision tables.

**Rejected:** Mixing governance into Git diff evaluation or Runtime Guard projection would conflate result domains.

## Reuse current surfaces

**Decision:** Reuse optional `start`/`check` inputs and the native Runtime Guard `permission.evaluate` hook.

**Rationale:** Existing creation, evaluation, and pre-permission boundaries avoid a new command or adapter framework.

**Rejected:** A new governance command, daemon, or automatic framework/tool inference.

## Persist only authority and audit facts

**Decision:** Persist Envelope declarations, satisfaction latch/evidence, and valid material outcomes; do not persist fast-path or invalid input.

**Rationale:** Only the persisted set is needed across restarts to protect stated invariants.

## Evaluation and satisfaction precedence

**Decision:** For an Envelope-enabled flow, evaluate structural validity, the `CONTRACT_SATISFIED` post-satisfaction guard, materiality, and governance in that order.

**Rationale:** Structurally invalid proposals return `INVALID_PROPOSAL`, not a governance verdict, grant no authority, and remain invalid after satisfaction. After satisfaction, only read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue. Every other valid mutating or additional operation returns `BLOCK`, including normally non-material operations, so materiality cannot bypass the guard.

`CONTRACT_SATISFIED` is irreversible, and new work requires new explicit authority.

## Closed comparison semantics

The normalized input is deliberately closed. The identifiers are `scope_expansion`, `delegated_agent`, `concurrent_worker`, `reasoning_escalation`, `research_expansion`, `architecture_review`, `verification_expansion`, `documentation_expansion`, `infrastructure_expansion`, `external_service`, and `post_satisfaction_work`. `scope_expansion` uses existing ChangeContract path policy. Numeric `delegated_agent` and `concurrent_worker` use integer `amount`, `max`, `minimum_required`, and `constraint`; the remaining non-scope variants use exact opaque `value`, `allowed`, `constraint`, and declared canonical alternatives. Constraint is exactly `HARD` or `SOFT`. Missing known-kind authority is zero SOFT, `max: 0` or `allowed: []`. Unknown values of a known kind are outside comparison; unknown authority-changing kinds are `INVALID_PROPOSAL`.

Structural validity requires a known kind, compatible shape, criterion references, evidence, valid numeric bounds `0 < minimum_required <= requested.amount`, valid constraint, allowlisted canonical values, and canonical `required_for` references to declared criteria. Violations have no verdict or authority. Numeric inside is `APPROVE`; outside is `REDUCE` to positive `M`, optional zero SOFT `DEFER`, optional zero HARD `BLOCK`, required `REDUCE` to `N` when `N <= M`, or `ESCALATE` when `N > M`. Allowlist inside is `APPROVE`; a needed canonical value is `REPLACE` before optional `DEFER`; otherwise optional HARD is `BLOCK` and required is `ESCALATE`. This is exact comparison only, with no DSL, generic comparator, fuzzy, substring, semantic matching, scoring, or LLM.

The readiness fixture must normalize and simulate inside/outside, limits, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, `ESCALATE`, `INVALID_PROPOSAL`, and post-satisfaction guard outcomes. Missing representation or invented comparison semantics requires `NEEDS_REVISION`.

## Simulate Docker acceptance

**Decision:** Use typed decision fixtures rather than Docker or GitHub.

**Rationale:** The acceptance concern is deterministic proportional governance, not environmental provisioning.
