# Data Model: SPEC-014

## Contract Extension

`execution_envelope` is optional. Absence means legacy behavior and is never inferred or reconstructed.

| Component | Contents | Ownership |
|---|---|---|
| Execution Envelope | Goal, criteria, bounds, canonical alternatives, satisfaction, ledger | One Change Contract |
| Acceptance Criterion | Stable id, required outcome, declared evidence mapping | Envelope |
| Material Decision | Identity, closed type, requested authority, criterion references, necessity evidence | Evaluated against Envelope |
| Governance Outcome | One verdict, reason, optional declared reduction/replacement | Stored only for valid material decisions |
| Satisfaction | `OPEN` or irreversible `CONTRACT_SATISFIED` plus evidence | Envelope |

## Closed Material Types

`scope_expansion`, `delegated_agent`, `concurrent_worker`, `reasoning_escalation`, `research_expansion`, `architecture_review`, `verification_expansion`, `documentation_expansion`, `infrastructure_expansion`, `external_service`, and `post_satisfaction_work`.

An authority-changing unrecognized operation is invalid, not inferred from free text.

## Rules

### CLI transport

`start --execution-envelope-json '<JSON>'` accepts at most one non-null object matching the normalized Envelope. Duplicate use, invalid syntax, or a non-object JSON value produces the existing field/input validation failure (`InputValidationError`) at the input boundary and never reaches the evaluator; absence preserves legacy behavior. `check --satisfaction-evidence-json '<JSON>'` accepts at most one object with `satisfied` criterion evidence items. Syntax and duplicate use are rejected at the input boundary; absence preserves legacy/read-only behavior, and accepted evidence can only advance satisfaction. Material Decisions have no CLI transport. Proposals enter through OpenCode V2 `permission.evaluate`, Runtime Guard normalization, evaluator, and projection only.
### Normalized authority forms

`scope_expansion` and `post_satisfaction_work` have no Envelope authority entry. Scope remains governed by the existing ChangeContract path policy, and post-satisfaction work remains governed by the post-satisfaction guard. The other authority-bearing kinds normalize to `{ amount, max, minimum_required, constraint }` for `delegated_agent` and `concurrent_worker`, with integer amounts and exactly `HARD` or `SOFT`, or `{ value, allowed, constraint, canonical_alternatives }` for the remaining non-scope variants, using exact opaque identifiers only. Canonical alternatives are records keyed by the exact requested value. Each record contains an allowed replacement value and nonempty `required_for` criterion references naming only declared criteria. No additional duplicate-key policy applies to canonical-alternative records. Missing known-kind authority is zero SOFT, represented by `max: 0` or `allowed: []`.

While `OPEN`, `scope_expansion` outside ChangeContract path policy uses only existing ChangeContract policy and has no governance verdict. It never returns `ESCALATE` and never duplicates scope authority. While `OPEN`, `post_satisfaction_work` is structurally invalid and returns `INVALID_PROPOSAL` without a verdict or authority.

Structural validity requires a known kind, compatible shape, nonempty necessity evidence and nonempty criterion references for every required claim, every criterion reference naming only declared criteria, `0 < minimum_required <= requested.amount` for numeric forms, exact HARD or SOFT, allowed canonical replacement values, and nonempty canonical `required_for` references naming declared criteria. Evidence is checked structurally only; no semantic evidence matching is performed. A violation is `INVALID_PROPOSAL`, with no verdict, authority, or ledger entry. A value outside a known kind's maximum or allowlist is an outside value; an unknown authority-changing kind is an invalid kind. No policy DSL, generic comparator, fuzzy, substring, or semantic matching, scoring, or LLM is permitted.

Numeric outcomes are inside `APPROVE`; outside with positive `M` is `REDUCE` to `M`; optional zero SOFT is `DEFER`; optional zero HARD is `BLOCK`; required with `N <= M` is `REDUCE` to `N`; and required with `N > M` is `ESCALATE` for either constraint. Allowlist outcomes are inside `APPROVE`; a needed canonical value inside the allowlist is `REPLACE`, before `DEFER`; otherwise optional SOFT is `DEFER`, optional HARD is `BLOCK`, and required is `ESCALATE`.

- Envelope-enabled evaluation checks structural validity, the `CONTRACT_SATISFIED` post-satisfaction guard, materiality, and governance in that order.
- Structurally invalid proposals return `INVALID_PROPOSAL`, which is not a governance verdict, grants no authority, and applies even after satisfaction.
- After satisfaction, the post-satisfaction guard precedes materiality. Only read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue without a governance verdict. Every other valid mutating or additional operation returns `BLOCK`, including normally non-material operations; materiality cannot bypass the guard.
- Missing declared evidence/mapping is invalid and has no governance verdict.
- `APPROVE` confirms predeclared authority only.
- `REDUCE` and `REPLACE` use only declared lower authority or canonical alternatives.
- Necessary irreducible overrun is always `ESCALATE`.
- Identical normalized identity replays its result; differing reuse is an invalid identity conflict.
- `CONTRACT_SATISFIED` never returns to `OPEN`; new work requires new explicit authority.
