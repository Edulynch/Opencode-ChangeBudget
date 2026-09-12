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

Scope/surface expansion, `delegated_agent`, `concurrent_worker`, `reasoning_escalation`, `research_expansion`, `architecture_review`, verification expansion, unrequired documentation, `infrastructure_expansion`, `external_service`, and post-satisfaction work.

An authority-changing unrecognized operation is invalid, not inferred from free text.

## Rules

- Envelope-enabled evaluation checks structural validity, the `CONTRACT_SATISFIED` post-satisfaction guard, materiality, and governance in that order.
- Structurally invalid proposals return `INVALID_PROPOSAL`, which is not a governance verdict, grants no authority, and applies even after satisfaction.
- After satisfaction, only read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue. Every other valid mutating or additional operation returns `BLOCK`, including normally non-material operations; materiality cannot bypass the guard.
- Missing declared evidence/mapping is invalid and has no governance verdict.
- `APPROVE` confirms predeclared authority only.
- `REDUCE` and `REPLACE` use only declared lower authority or canonical alternatives.
- Necessary irreducible overrun is always `ESCALATE`.
- Identical normalized identity replays its result; differing reuse is an invalid identity conflict.
- `CONTRACT_SATISFIED` never returns to `OPEN`; new work requires new explicit authority.
