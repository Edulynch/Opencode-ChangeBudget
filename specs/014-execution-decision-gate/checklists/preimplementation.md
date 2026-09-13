# Pre-Implementation Review Checklist: Execution Envelope & Material Decision Gate (SPEC-014)

**Purpose**: Review whether SPEC-014 requirements and planning artifacts are minimal, clear, consistent, and complete enough to authorize task generation.
**Created**: 2026-09-11
**Feature**: [spec.md](../spec.md), [plan.md](../plan.md), [research.md](../research.md), [data-model.md](../data-model.md), [internal contract](../contracts/execution-gate.md), [quickstart.md](../quickstart.md)

**Note**: This is a reviewer-owned requirements-quality checklist, not an implementation or code-verification checklist.
**Review Ownership**: Mark an item `[x]` only when the reviewer determines the written criterion is satisfied.
**Marker Semantics**: `[x]` records requirements-quality approval only; it does not mean implementation work is complete.

## Minimal Architecture

- [x] CHK001 Is the optional Execution Envelope justified as the smallest way to retain goal, criteria, authority bounds, and satisfaction across process restarts? [Completeness, Spec §Conceptual Model; Plan §Minimal persistence]
- [x] CHK002 Is the pure execution-gate evaluator's responsibility bounded to deterministic pre-action authority decisions, without absorbing Git-budget, lifecycle, or framework behavior? [Clarity, Plan §Reuse existing architecture]
- [x] CHK003 Does the plan identify why embedded contract persistence is necessary and why a separate ledger file, database, or lifecycle is excluded? [Minimality, Plan §Minimal persistence]
- [x] CHK004 Is each optional existing-command input documented as necessary for creating an Envelope or submitting declared decision/evidence data, rather than future convenience? [Minimality, Plan §Reuse existing architecture]
- [x] CHK005 Do the artifacts require removal or explicit justification of every proposed component that fails the anti-overengineering gate? [Completeness, Plan §Anti-Overengineering Review]
- [x] CHK006 Are services, daemons, policy DSLs, LLM governance, multi-agent courts, generic adapters, and Docker/GitHub infrastructure explicitly excluded consistently? [Consistency, Spec §Non-Goals; Plan §Anti-Overengineering Review]

## Compatibility And Domain Separation

- [x] CHK007 Do the requirements state unambiguously that absence of `execution_envelope` preserves legacy contract behavior without inference, migration, or reconstruction? [Clarity, Spec FR-003/FR-004; Data Model §Contract Extension]
- [x] CHK008 Are `PASS`, `REPAIR`, and `HUMAN_REVIEW` consistently described as Git-budget results rather than governance verdicts? [Consistency, Spec FR-001/FR-002; Plan §Summary]
- [x] CHK009 Are the six governance verdicts consistently described as separate from Git-budget results and Runtime Guard projection actions? [Consistency, Contract §Output; Contract §Compatibility]
- [x] CHK010 Does the plan explicitly preserve lifecycle, baseline, amendments, stack policies, diagnose, existing Runtime Guard behavior, and Spec-Kit behavior outside Envelope-enabled flows? [Completeness, Spec §Compatibility; Plan §Technical Context]
- [x] CHK011 Are unflagged existing command semantics and exit behavior explicitly protected from optional Envelope/proposal/evidence inputs? [Clarity, Plan §Reuse existing architecture]

## Authority And Invalid Proposals

- [x] CHK012 Is `APPROVE` defined only as confirmation of already-declared authority, never as an authority increase? [Clarity, Spec FR-008; Data Model §Rules]
- [x] CHK013 Are scope, permissions, execution resources, and other authority increases consistently excluded from autonomous authorization? [Completeness, Spec §Invariants; Plan §Constitution Check]
- [x] CHK014 Is every necessary, irreducible expansion outside the current Envelope required to produce `ESCALATE` for both HARD and SOFT limits? [Consistency, Spec FR-011/FR-012; Plan §Evaluation order]
- [x] CHK015 Is an invalid proposal clearly separate from all six governance verdicts when declared criterion evidence or mapping is missing? [Clarity, Spec FR-009; Contract §Output]
- [x] CHK016 Is an authority-changing operation with an unknown material type clearly specified as invalid rather than inferred, blocked, or escalated arbitrarily? [Clarity, Spec FR-007; Data Model §Closed Material Types]
- [x] CHK017 Do invalid-proposal requirements state that invalid input grants no authority and creates no ledger entry? [Consistency, Spec §Failure Behavior; Plan §Minimal persistence]

## Materiality And Verdict Boundaries

- [x] CHK018 Are the non-material fast-path operations listed as structural categories, with no requirement for governance persistence or semantic free-text interpretation? [Clarity, Spec FR-006/FR-007; Plan §Evaluation order]
- [x] CHK019 Do the artifacts address both false positives for reads, local search, Git status, inspection, authorized directory creation, and focused tests, and false negatives for authority-changing work? [Coverage, Spec User Story 2]
- [x] CHK020 Is the closed material vocabulary complete for the approved initial scope and free of framework- or agent-specific names? [Completeness, Spec FR-005/FR-019; Data Model §Closed Material Types]
- [x] CHK021 Is `REDUCE` limited to the same action at a lower declared authority bound? [Clarity, Spec FR-013; Plan §Evaluation order]
- [x] CHK022 Is `REPLACE` limited to a declared canonical, proportional alternative needed by the same acceptance criterion? [Clarity, Spec FR-012/FR-013]
- [x] CHK023 Does the written precedence make `REPLACE` prevail over `DEFER` when a canonical alternative is necessary, while reserving `DEFER` for useful but unnecessary work? [Consistency, Spec Clarifications; Spec FR-012]
- [x] CHK024 Are `BLOCK` and `ESCALATE` distinguished by optional HARD prohibition versus necessary irreducible authority expansion? [Clarity, Spec FR-011/FR-014]

## Satisfaction And Persistence

- [x] CHK025 Is the evidence condition for `CONTRACT_SATISFIED` specified as all declared criteria having required evidence, rather than executor assertion alone? [Clarity, Spec FR-016; Data Model §Contract Extension]
- [x] CHK026 Is `CONTRACT_SATISFIED` explicitly irreversible within a contract, with no autonomous `SATISFIED → OPEN` transition? [Consistency, Spec Clarifications; Spec FR-016]
- [x] CHK027 Are the only post-satisfaction autonomous actions precisely limited to authorized validation, ChangeBudget checking, necessary incidental cleanup, and normal closure? [Completeness, Spec User Story 3; Spec FR-016/FR-017]
- [x] CHK028 Does every persisted item meet all three stated tests: process survival, non-derivability, and protection of a named invariant? [Measurability, Plan §Minimal persistence]
- [x] CHK029 Is the material-decision ledger limited to valid material proposals and sufficient to explain idempotent replay without persisting fast-path or invalid input? [Minimality, Spec FR-018; Plan §Minimal persistence]
- [x] CHK030 Is the plan explicit that satisfaction is a contract-owned field and not a lifecycle state or parallel storage domain? [Consistency, Data Model §Contract Extension; Plan §Anti-Overengineering Review]

## Pre-Action Integration And Framework Independence

- [x] CHK031 Does the internal contract define the exact abstract information entering the evaluator and the three distinct output classes: fast-path continuation, invalid input, and governance outcome? [Completeness, Contract §Input; Contract §Output]
- [x] CHK032 Is `permission.ask` described solely as the existing integration boundary, with explicit structured Material Decision input and no fabricated decision for ordinary runtime context? [Clarity, Contract §Runtime Boundary; Plan §Reuse existing architecture]
- [x] CHK033 Are the conditions for invoking and not invoking governance sufficiently explicit to preserve fail-closed behavior without routing routine calls through the evaluator? [Coverage, Plan §Evaluation order; Contract §Runtime Boundary]
- [x] CHK034 Do the evaluator and domain model remain free of OpenCode, OMO, Oracle, Sisyphus, Hephaestus, provider, and agent-framework names? [Framework Independence, Spec FR-019; Plan §Reuse existing architecture]
- [x] CHK035 Is the plan free of a generic adapter layer while still identifying the one existing pre-action consumer required to demonstrate interception? [Minimality, Plan §Anti-Overengineering Review]

## Docker Scenario And Testability

- [x] CHK036 Does the Docker-runner scenario state the required Linux runner, minimum workflow path, and smoke validation separately from optional expansion proposals? [Completeness, Spec §Self-hosted Docker runner; Plan §Docker Runner Acceptance]
- [x] CHK037 Are proportional Docker-scenario outcomes specified for second worker, expensive reasoning, Windows runner, documentation, architecture review, full regression, and release readiness? [Coverage, Spec §Self-hosted Docker runner; Quickstart §Docker-Runner Results]
- [x] CHK038 Is the requirement to use typed fixtures rather than Docker, GitHub, credentials, or remote runner infrastructure explicit and consistent? [Minimality, Research §Simulate Docker acceptance; Plan §Test Strategy]
- [x] CHK039 Does the written test strategy cover fast path, invalid proposals, all six verdicts, HARD/SOFT, replacement precedence, necessary escalation, irreversible satisfaction, legacy compatibility, and result-domain separation? [Completeness, Plan §Test Strategy; Quickstart §Validation Sequence]
- [x] CHK040 Are test requirements limited to deterministic decision tables and existing test infrastructure, without introducing an unnecessary test platform? [Minimality, Plan §Anti-Overengineering Review]

## Closed Authority Readiness Invariant

The required normalized forms are existing ChangeContract path policy for `scope_expansion`, numeric `{ amount, max, minimum_required, constraint }` for `delegated_agent` and `concurrent_worker`, and exact opaque `{ value, allowed, constraint, canonical_alternatives }` for the remaining non-scope identifiers. Missing known-kind authority is zero SOFT. Numeric and allowlist comparisons must produce the specified `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, or `ESCALATE` result; structural violations produce `INVALID_PROPOSAL`. `REPLACE` precedes `DEFER`, and post-satisfaction uses the comparator-free guard.

- [x] CHK041 Does every authority-changing kind have a normalized closed form, with existing ChangeContract path policy for `scope_expansion`, numeric max plus HARD/SOFT for delegated agents and concurrency, and exact opaque allowlists plus HARD/SOFT and declared canonical alternatives for the remaining variants? [Completeness, Spec §Closed Authority Comparison; Contract §Normalized comparison]
- [x] CHK042 Are missing known-kind declarations zero SOFT, unknown known-kind values distinguished from unknown authority-changing kinds, and all structural violations defined as `INVALID_PROPOSAL` with no verdict or authority? [Clarity, Spec §Closed Authority Comparison; Data Model §Normalized authority forms]
- [x] CHK043 Are numeric and allowlist outcomes executable for every `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, and `ESCALATE` branch, with `REPLACE` preceding `DEFER`? [Testability, Spec §Closed Authority Comparison; Quickstart §Docker-Runner Results]
- [x] CHK044 Does readiness refuse `READY_FOR_IMPLEMENTATION` unless inside/outside, limits, `REDUCE`, and `REPLACE` have normalized deterministic comparisons and all outcomes, including post-satisfaction, are simulated without invented semantics? [Readiness, Quickstart §Validation Sequence]

## Notes

- Review this artifact before `/speckit.tasks`; leave items unchecked when the written requirements need clarification or simplification.
- Do not use checkbox state as evidence that code has been implemented or tested.
- Add findings inline using the relevant CHK identifier.
