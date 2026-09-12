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

**Decision:** Reuse optional `start`/`check` inputs and Runtime Guard `permission.ask`.

**Rationale:** Existing creation, evaluation, and pre-permission boundaries avoid a new command or adapter framework.

**Rejected:** A new governance command, daemon, or automatic framework/tool inference.

## Persist only authority and audit facts

**Decision:** Persist Envelope declarations, satisfaction latch/evidence, and valid material outcomes; do not persist fast-path or invalid input.

**Rationale:** Only the persisted set is needed across restarts to protect stated invariants.

## Evaluation and satisfaction precedence

**Decision:** For an Envelope-enabled flow, evaluate structural validity, the `CONTRACT_SATISFIED` post-satisfaction guard, materiality, and governance in that order.

**Rationale:** Structurally invalid proposals return `INVALID_PROPOSAL`, not a governance verdict, grant no authority, and remain invalid after satisfaction. After satisfaction, only read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue. Every other valid mutating or additional operation returns `BLOCK`, including normally non-material operations, so materiality cannot bypass the guard.

`CONTRACT_SATISFIED` is irreversible, and new work requires new explicit authority.

## Simulate Docker acceptance

**Decision:** Use typed decision fixtures rather than Docker or GitHub.

**Rationale:** The acceptance concern is deterministic proportional governance, not environmental provisioning.
