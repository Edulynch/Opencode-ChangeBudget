# Feature Specification: Execution Envelope & Material Decision Gate (SPEC-014)

**Feature Branch**: `014-execution-decision-gate`

**Created**: 2026-09-11

**Status**: Draft

**Input**: User description: Govern material execution decisions before they produce scope creep while preserving ChangeBudget v1.3.1 Git-budget results.

## Problem Statement

ChangeBudget currently evaluates the Git changes produced after work occurs. An executor can still expand scope before a diff exists by adding workers, broader verification, documentation, infrastructure, external services, or additional product work. The developer needs a local, deterministic way to decide whether such a proposed material expansion is justified by the active objective without weakening the objective to save effort.

SPEC-014 adds an optional Execution Envelope to a Change Contract. It governs only material execution decisions. It does not replace the contract, the lifecycle, or the Git Budget Engine.

## Goals

- Distinguish normal, non-material operations from material execution proposals deterministically.
- Produce one separate governance verdict: `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, or `ESCALATE`.
- Keep `PASS`, `REPAIR`, and `HUMAN_REVIEW` unchanged as Git Budget Engine results.
- Preserve correctness: restrictions must not silently make an acceptance criterion weaker.
- Stop autonomous material expansion after the declared acceptance criteria are satisfied.
- Retain a minimal auditable record of material decisions.
- Keep governance less costly than the expansion it prevents.

## Clarifications

### Session 2026-09-11

- Q: When an optional SOFT proposal has a canonical alternative necessary for a criterion, should `REPLACE` take precedence over `DEFER`? -> A: `REPLACE` takes precedence; `DEFER` applies only when no required canonical alternative exists.
- Q: If an executor claims an expansion is necessary without the declared acceptance-criterion evidence or mapping, what result should apply? -> A: Reject the proposal as invalid without a governance verdict; the executor must resubmit declared evidence.
- Q: After `CONTRACT_SATISFIED` activates with all declared evidence, may it autonomously return to `OPEN`? -> A: No. `CONTRACT_SATISFIED` is irreversible within the contract.
- Q: If a necessary expansion exceeds a SOFT limit and has no proportional reduction or canonical alternative, should it produce `ESCALATE`? -> A: Yes. Every necessary, irreducible expansion beyond the Envelope produces `ESCALATE`.
- Q: If an operation does not match a closed material kind, how should real expansion avoid passing as normal work? -> A: Reject it as invalid if it could change authority; it must be resubmitted with a closed material kind.
- Q: What precedence applies after `CONTRACT_SATISFIED`, including invalid and normally non-material operations? -> A: For an Envelope-enabled flow, structural validity precedes the post-satisfaction guard, then materiality, then governance evaluation. An invalid proposal always returns `INVALID_PROPOSAL` without a governance verdict or authority. After satisfaction, only read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue; every other mutating or additional operation returns `BLOCK` without using materiality as a bypass.

## Non-Goals

- Replacing ChangeContract, lifecycle, baseline, stack policies, diagnose, Runtime Guard, or the Spec-Kit bridge.
- LLM governance, a Decision Court, deliberation rounds, or model/provider quotas.
- A general-purpose policy language, presets, complete project context, or a policy marketplace.
- Backends, dashboards, daemons, databases, cloud services, telemetry, or cryptographic approval.
- Multiple framework adapters or framework-specific agent names in the core vocabulary.
- Docker attestation, remote-execution management, or a runtime Docker dependency for ChangeBudget.

## Invariants

1. **Correctness before thrift**: a cost or scope constraint may restrict solutions, but it may not silently reduce an acceptance criterion's meaning.
2. **Authority is monotonic**: autonomous action may preserve or reduce declared authority, never increase it.
3. **Executor proposes; governor authorizes**: a proposal is not approval and cannot amend its own Envelope.
4. **Good practice is not automatically required practice**: optional hardening, research, documentation, or validation must not become mandatory without a proportional, declared need.
5. **Material decisions only**: ordinary work has a deterministic fast path with no governance record.
6. **Satisfaction closes autonomous expansion authority**: once the contract is satisfied, additional material work needs new justification or authority.
7. **Governance remains cheaper than prevented behavior**: the result derives from finite declared data and local comparison, without delegation or remote calls.
8. Governance verdicts are a separate axis from `PASS`, `REPAIR`, and `HUMAN_REVIEW`; neither axis redefines the other.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Govern a proposed expansion (Priority: P1)

As a developer, I want an executor to submit a material execution proposal before it expands work, so that I retain authority over scope before scope creep becomes a Git diff.

**Why this priority**: This is the core value of the feature.

**Independent Test**: Use a contract with an Execution Envelope and submit one proposal for each initial material decision kind; verify the same normalized input always receives the same separate governance verdict and reason.

**Acceptance Scenarios**:

1. **Given** an in-envelope proposal needed by a declared criterion, **when** governance evaluates it, **then** it returns `APPROVE` without changing the Change Contract.
2. **Given** a proposal that exceeds a declared reducible limit, **when** a smaller declared limit satisfies the same criterion, **then** it returns `REDUCE` with that limit.
3. **Given** a proposal whose declared canonical alternative meets the same criterion with less authority, **when** governance evaluates it, **then** it returns `REPLACE` with the alternative.
4. **Given** an optional material proposal, **when** it has no acceptance-criterion need, **then** it returns `DEFER`.
5. **Given** an optional HARD-prohibited proposal, **when** governance evaluates it, **then** it returns `BLOCK`.
6. **Given** a necessary, irreducible HARD expansion, **when** governance evaluates it, **then** it returns `ESCALATE` and does not grant the expansion.

---

### User Story 2 - Preserve ordinary execution (Priority: P1)

As an executor, I want routine work to continue without governance overhead, so that a small task remains a small workflow.

**Why this priority**: An execution gate that reviews ordinary work would defeat ChangeBudget's fast local workflow.

**Independent Test**: Observe file reads, reasonable local search, `git status`, code inspection, directory creation within authorized scope, necessary small implementation operations, and already-authorized focused tests; verify none creates a governance decision.

**Acceptance Scenarios**:

1. **Given** a routine operation inside an `OPEN` active contract, **when** it does not alter execution authority, **then** it is non-material and continues.
2. **Given** an operation whose classification cannot be determined from the closed material vocabulary, **when** it could increase authority, **then** it is treated as material rather than silently bypassed.

---

### User Story 3 - Close autonomous expansion at satisfaction (Priority: P1)

As a developer, I want declared acceptance criteria to close autonomous expansion once satisfied, so that completed work does not acquire unrelated polishing work.

**Why this priority**: Completion must be a boundary, not an invitation for additional work.

**Independent Test**: Mark every criterion complete with its declared evidence, then evaluate allowed cleanup and a new refactor proposal.

**Acceptance Scenarios**:

1. **Given** every declared acceptance criterion is satisfied, **when** the contract enters `CONTRACT_SATISFIED`, **then** already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure remain available.
2. **Given** `CONTRACT_SATISFIED`, **when** a refactor, documentation, architecture hardening, infrastructure change, or feature is proposed, **then** it is material and cannot be autonomously expanded.
3. **Given** `CONTRACT_SATISFIED`, **when** an operation is structurally valid but is neither read-only/introspection, already-authorized validation, `changebudget check`, necessary incidental cleanup, nor normal closure, **then** it returns `BLOCK`, even if it would otherwise be non-material.

---

### User Story 4 - Keep correctness intact under constraints (Priority: P1)

As a developer, I want a cost policy to be unable to fake requirement completion, so that an economical result remains the requested result.

**Why this priority**: Scope control that silently weakens requirements would be unsafe.

**Independent Test**: Declare the criterion "Login real recuperable entre dispositivos" and a constraint against a self-owned backend; submit a local-only login proposal and a compatible external-service proposal.

**Acceptance Scenarios**:

1. **Given** the cross-device recovery criterion, **when** an executor proposes local-only SQLite login as a substitute, **then** it is not approved as satisfying the criterion.
2. **Given** the same criterion, **when** an external compatible solution, explicit exception, conscious requirement change, or feature deferral is proposed, **then** governance preserves the distinction rather than claiming equivalent completion.

### Acceptance Scenario - Self-hosted Docker runner

**Goal**: Restore GitHub Actions capacity through a self-hosted Linux runner in Docker.

**Acceptance criteria**: Docker is available; functional GitHub access exists; a Linux runner is configured and online; a workflow can route a job to it; and one smoke test succeeds.

**Proportional authorized work**: verify Docker and GitHub access, configure the Linux runner, make the minimum workflow adjustment, and run the smoke test.

| Proposed decision | Expected verdict when not needed by the criteria |
|---|---|
| More delegated agents or concurrent workers than the Envelope permits | `REDUCE` to the declared limit |
| Windows or macOS runner | `BLOCK` when it is HARD-prohibited and optional |
| JIT architecture, architecture review, deep research, or expensive reasoning | `DEFER` |
| New documentation or release-readiness work | `DEFER` |
| Full regression instead of the declared smoke validation | `REPLACE` with the declared smoke validation |
| Product Truth change | `BLOCK` unless independently authorized |
| Necessary undeclared external service or infrastructure | `ESCALATE` |

The normative Docker fixture uses exact opaque identifiers such as `runner.linux`, `validation.smoke`, `runner.windows`, `validation.full`, `reasoning.deep`, `documentation.release`, `architecture.review`, and `service.github`. The required `runner.linux` and `validation.smoke` targets are inside their declared allowlists and return `APPROVE`. An extra worker with `amount: 2`, `max: 1`, and `minimum_required: 1` returns `REDUCE` to `1`. `validation.full` outside the allowlist with canonical `validation.smoke` required for the smoke criterion returns `REPLACE`; optional reasoning, architecture, and documentation return `DEFER`; optional Windows under a HARD allowlist returns `BLOCK`; required undeclared service or infrastructure returns `ESCALATE`; malformed shape, missing evidence, or an unknown material kind returns `INVALID_PROPOSAL`. After satisfaction, a valid refactor returns `BLOCK`, while the listed comparator-free operations continue.

### Edge Cases

- A legacy contract has no Execution Envelope: existing behavior continues without migration or reconstructed history.
- Malformed, unsupported, or incomplete governance input must not be interpreted as a non-material approval.
- Repeating the same proposal identifier must not create conflicting audit entries.
- A material action may be in scope for the Git Contract but still require governance because it expands execution authority.
- After `CONTRACT_SATISFIED`, structurally invalid input returns `INVALID_PROPOSAL`; materiality cannot bypass the post-satisfaction guard for any other mutating or additional operation.
- A governance `APPROVE` does not make an eventual out-of-budget Git diff pass.
- A Git `PASS` does not retroactively approve an ungoverned material expansion.
- An accepted criterion cannot be silently rewritten to make an optional cheaper proposal appear necessary.

## Requirements *(mandatory)*

### Conceptual Model

- **Goal**: the outcome the active contract is intended to deliver.
- **Acceptance Criterion**: a stable identifier, required outcome, and required evidence for completion.
- **Execution Envelope**: optional declared bounds on execution authority for one Change Contract.
- **Material Decision**: an executor proposal using a closed material-decision kind, the requested authority, cited criteria, and necessity evidence.
- **Governance Verdict**: one of the six results defined below, with deterministic reason and any permitted reduced or replacement authority.
- **Satisfaction Condition**: `OPEN` until all declared criteria have their required evidence, then `CONTRACT_SATISFIED`.
- **Decision Ledger**: the minimum append-only audit record for each material decision.

### Closed Authority Comparison

The closed material identifiers are `scope_expansion`, `delegated_agent`, `concurrent_worker`, `reasoning_escalation`, `research_expansion`, `architecture_review`, `verification_expansion`, `documentation_expansion`, `infrastructure_expansion`, `external_service`, and `post_satisfaction_work`. `scope_expansion` and `post_satisfaction_work` have no Envelope authority entry: scope remains governed by existing ChangeContract path policy, and post-satisfaction work remains governed by the post-satisfaction guard. The other authority-bearing kinds use `{ amount, max, minimum_required, constraint }` for `delegated_agent` and `concurrent_worker`, with integer amounts and exactly `HARD` or `SOFT`, or `{ value, allowed, constraint, canonical_alternatives }` for the remaining non-scope variants. Values and allowlist entries are exact opaque identifiers. A canonical-alternative record is keyed by the exact requested value and contains an allowed replacement value plus nonempty `required_for` criterion references, all of which must name declared acceptance criteria. No additional duplicate-key policy applies to canonical-alternative records. No policy DSL, generic comparator, fuzzy, substring, semantic matching, scoring, or LLM is permitted.

While `OPEN`, a `scope_expansion` outside ChangeContract path policy uses only that existing policy and has no governance verdict. It never returns `ESCALATE` and never duplicates or changes scope authority. While `OPEN`, `post_satisfaction_work` is structurally invalid and returns `INVALID_PROPOSAL` without a verdict or authority.

Missing authority for a known kind is zero SOFT: numeric kinds normalize to `max: 0`, and allowlist kinds normalize to `allowed: []`. A value outside a known kind's maximum or exact allowlist is an unknown known-kind value, not an unknown material kind. An authority-changing kind outside the closed vocabulary is `INVALID_PROPOSAL`.

Structural validity requires a known kind, compatible proposal shape, nonempty necessity evidence and nonempty criterion references for every required claim, every criterion reference naming a declared acceptance criterion, `0 < minimum_required <= requested.amount` for numeric forms, only `HARD` or `SOFT`, canonical replacement values inside the allowlist, and nonempty canonical `required_for` references naming declared acceptance criteria. Evidence is checked structurally only; no semantic evidence matching is performed. Any violation returns `INVALID_PROPOSAL`, creates no verdict or authority, and creates no ledger entry.

Numeric comparison is inside `APPROVE`. Outside the maximum, a reducible proposal with `M > 0` is `REDUCE` to `M`; with `M = 0`, optional SOFT is `DEFER` and optional HARD is `BLOCK`. A required proposal with `N <= M` is `REDUCE` to `N`; when `N > M`, either constraint is `ESCALATE`. Allowlist comparison is inside `APPROVE`; outside it, a canonical value inside the allowlist needed for an unsatisfied required criterion is `REPLACE`, which precedes `DEFER`; otherwise optional SOFT is `DEFER`, optional HARD is `BLOCK`, and required is `ESCALATE`.

The existing comparator-free post-satisfaction guard retains its exact prior precedence after structural validity and before materiality. Only the previously allowed read-only or introspection operations, already-authorized validation, `changebudget check`, necessary incidental cleanup, and normal closure continue without a governance verdict. Every other valid mutating or additional operation is `BLOCK` without authority.

### CLI Transport Contract

`changebudget start --execution-envelope-json '<JSON>'` accepts at most one non-null JSON object matching the normalized Execution Envelope. Duplicate use, invalid JSON syntax, or any other JSON type is an `InputValidationError`. When absent, `start` preserves legacy behavior. `changebudget check --satisfaction-evidence-json '<JSON>'` accepts at most one JSON object containing `satisfied` criterion evidence items. It validates syntax and duplicate use at the input boundary, preserves legacy and read-only behavior when absent, and can only advance satisfaction monotonically. No Material Decision CLI flag exists. Normalized proposals reach the evaluator only through OpenCode `permission.ask`, Runtime Guard normalization, the evaluator, and projection.

Readiness cannot return `READY_FOR_IMPLEMENTATION` unless inside/outside status, limits, `REDUCE`, and `REPLACE` all have normalized deterministic comparisons. The acceptance fixture must simulate `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, `ESCALATE`, `INVALID_PROPOSAL`, and post-satisfaction outcomes. If any outcome requires invented semantics, readiness returns `NEEDS_REVISION`.

### Functional Requirements

- **FR-001**: The system MUST preserve the current meanings, exit behavior, and enforcement paths of `PASS`, `REPAIR`, and `HUMAN_REVIEW`.
- **FR-002**: The system MUST provide governance verdicts only as a separate domain: `APPROVE`, `REDUCE`, `REPLACE`, `DEFER`, `BLOCK`, and `ESCALATE`.
- **FR-003**: An Execution Envelope MUST be optional and MUST complement, not replace, the existing Change Contract, lifecycle, amendments, baseline, stack policies, Runtime Guard, diagnose, and persistence.
- **FR-004**: Without an Execution Envelope, existing contracts and commands MUST retain their current behavior; no migration, inferred envelope, or historical reconstruction is permitted.
- **FR-005**: Governance MUST classify only the following initial kinds as material: scope/surface expansion; delegated agent; concurrency increase; reasoning or research escalation; verification expansion; unrequired documentation; infrastructure expansion; external-service expansion; and post-satisfaction work.
- **FR-006**: While the Satisfaction Condition is `OPEN`, file reading, reasonable local search, Git status, inspection, directory creation within authorized scope, necessary small implementation work, and already-authorized focused tests MUST remain non-material.
- **FR-007**: The non-material path is a persistence-free structural check against the declared fast-path operations. An operation outside that path which could change authority and does not match a closed material kind is invalid, receives no governance verdict, and MUST be resubmitted with a closed material kind.
- **FR-008**: An autonomous result MUST never increase Envelope authority or amend the active Change Contract.
- **FR-009**: A material proposal MUST identify its kind, requested authority, nonempty cited acceptance-criterion references that name only declared criteria, and nonempty declared necessity evidence. A proposal missing required decision evidence or using undeclared criterion references is invalid, receives no governance verdict, grants no authority, and MUST be resubmitted with the declared evidence. Evidence is validated structurally and is not semantically matched to a criterion.
- **FR-010**: For an Envelope-enabled flow, governance MUST evaluate in this order: structural validity; `CONTRACT_SATISFIED` post-satisfaction guard; materiality; governance evaluation (authority comparison, acceptance-criterion necessity, HARD or SOFT handling, deterministic verdict); material-decision audit. Legacy/no-envelope recognition precedes this flow. Structural invalidity returns `INVALID_PROPOSAL` without a governance verdict or authority, including after `CONTRACT_SATISFIED`.
- **FR-011**: HARD limits MUST return `BLOCK` for optional proposals and `ESCALATE` for a necessary, irreducible proposal. Neither result grants an expansion.
- **FR-012**: SOFT limits MAY return `APPROVE`, `REDUCE`, `REPLACE`, or `DEFER` only from declared limits, criterion evidence, and a declared canonical alternative; they MUST NOT invent an alternative or widen authority. A necessary, irreducible expansion beyond the Envelope returns `ESCALATE`, whether the relevant limit is HARD or SOFT. When an optional proposal has a canonical alternative required for the same criterion, `REPLACE` takes precedence over `DEFER`; `DEFER` applies only when no required canonical alternative exists.
- **FR-013**: `REDUCE` MUST return only a lower authority already declared by the Envelope. `REPLACE` MUST return only a canonical lower-authority alternative already declared for the same criterion.
- **FR-014**: `DEFER` MUST identify that the proposal is useful but not required for the stated acceptance criteria. `BLOCK` MUST identify the relevant HARD limit. `ESCALATE` MUST identify the required expansion and affected criteria.
- **FR-015**: A correct solution MUST not be represented as satisfied by reducing the semantic requirement. A local-only implementation cannot satisfy a declared cross-device recovery requirement unless the criterion itself is consciously changed outside autonomous governance.
- **FR-016**: When all acceptance criteria have required evidence, the system MUST expose `CONTRACT_SATISFIED`. After structural validity succeeds, it MUST allow only read-only or introspection operations, already-authorized validation, ChangeBudget checking, necessary incidental cleanup, and normal closure; any other mutating or additional operation MUST return `BLOCK` without authority, even when it would otherwise be non-material. `CONTRACT_SATISFIED` is irreversible within the contract and MUST NOT autonomously return to `OPEN`.
- **FR-017**: After `CONTRACT_SATISFIED`, refactors, documentation, architecture hardening, infrastructure, additional features, and any other non-allowed mutating or additional operation MUST return `BLOCK`; new work requires new explicit authority.
- **FR-018**: The decision ledger MUST record only material proposals and their deterministic outcome, reason, criterion references, and proposal identity. It MUST be append-only and idempotent for the same proposal identity.
- **FR-019**: Governance MUST be local, deterministic, framework-independent, and explainable. The core vocabulary MUST use abstract concepts such as `delegated_agent`, `concurrent_worker`, `reasoning_escalation`, `research_expansion`, `architecture_review`, `verification_expansion`, `external_service`, and `infrastructure_expansion` rather than framework or agent names.
- **FR-020**: The feature MUST not require a new adapter, service, daemon, external connection, background process, dashboard, database, LLM, or multi-agent deliberation.
- **FR-021**: `start --execution-envelope-json '<JSON>'` MUST accept at most one non-null JSON object matching the normalized Envelope; duplicate use, invalid syntax, and non-object JSON MUST produce the existing field/input validation failure (`InputValidationError`) at the input boundary and MUST never reach the evaluator, while absence preserves legacy behavior.
- **FR-022**: `check --satisfaction-evidence-json '<JSON>'` MUST accept at most one object containing `satisfied` criterion evidence items, validate syntax and duplicate use at the input boundary, preserve legacy/read-only behavior when absent, and drive only monotonic satisfaction.
- **FR-023**: No Material Decision CLI flag exists. Normalized proposals MUST reach the evaluator only through OpenCode `permission.ask`, Runtime Guard normalization, evaluator, and projection.

### Expansion Request

An executor may request additional authority, but cannot grant it. A necessary and irreducible expansion is recorded as an Expansion Request with the requested authority, affected criteria, and deterministic reason for `ESCALATE`. This feature does not define self-approval, automatic amendment, or an approval workflow. A developer may make a conscious external decision through existing human-authority processes or establish new authorized work.

### Minimal Persistence

The active Change Contract may contain one optional Execution Envelope, its satisfaction state, and its material decision ledger. No parallel lifecycle, separate policy repository, additional daemon state, or new storage domain is required. The exact representation remains an implementation concern.

## Compatibility

SPEC-014 is additive. It preserves `init`, `start`, `status`, `check`, `close`, `amend`, `diagnose`, `integrate`, existing ChangeContract behavior, lifecycle, Git Budget Engine, Working Tree Baseline, stack policies, Runtime Guard, Spec-Kit bridge, and prior contracts. Existing commands do not acquire changed authority merely because this feature exists.

## Failure Behavior

- Structurally invalid input, including invalid or incomplete material-decision evidence, MUST return `INVALID_PROPOSAL` without a governance verdict or authority, including after `CONTRACT_SATISFIED`.
- An unavailable or unsupported Envelope must not be silently treated as a broader Envelope.
- A malformed legacy contract remains subject to existing lifecycle and safety behavior; it is not converted into a governance-enabled contract.
- Governance records must not mutate user files, Git history, Git index, Git refs, or contract permissions.
- An existing Git-budget failure remains visible and actionable regardless of governance outcome.

## Explicit Non-Goals and Deferred Items

- Multiple adapters, adapter registration, or framework event interception.
- Real accounting for model price, tokens, provider quotas, or finance systems.
- Automatic detection of agent identity, reasoning cost, or external-service necessity.
- Full project context, company presets, a complete decision taxonomy, or a reusable policy DSL.
- Decision Court actors as software components; Developer, Saver, Finance, Risk, and Manager remain explanatory roles only.
- Human-approval cryptography, signatures, remote approvals, or a new authorization service.
- Process Amplification Ratio and governance analytics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The six governance verdicts are mutually distinguishable in the acceptance scenarios and never replace a Git Budget Engine result.
- **SC-002**: All listed normal-operation examples complete with zero governance records in the acceptance fixtures.
- **SC-003**: Every listed material-decision kind receives a deterministic governance result from identical declared input in repeated evaluation.
- **SC-004**: Every optional HARD expansion fixture returns `BLOCK`, and every necessary irreducible HARD-expansion fixture returns `ESCALATE` without an authority increase.
- **SC-005**: In the Docker-runner scenario, all listed non-required expansions are reduced, deferred, replaced, blocked, or escalated before execution; the proportional runner path remains approvable.
- **SC-006**: A contract without an Execution Envelope continues to produce the same lifecycle and Git-budget decisions as before this feature.
- **SC-007**: Once all declared criteria are satisfied, 100 percent of sampled post-satisfaction refactor, documentation, hardening, infrastructure, and feature proposals are recognized as material.

## Assumptions

- The developer supplies the Goal, acceptance criteria, and authority bounds when choosing to use an Execution Envelope.
- Acceptance evidence is explicit enough to determine completion without semantic reinterpretation by governance.
- Existing human authority over contract amendment remains outside this feature.
- The Docker runner is an external acceptance environment, not required ChangeBudget infrastructure.
- The initial vocabulary is deliberately finite; a future specification may add a kind only with observed evidence that the minimum set is insufficient.

## Minimality Gate

The design removes a new command, a parallel lifecycle, separate ledger storage, approval workflow, general policy language, provider metadata, adapters, and automated Decision Court. The remaining optional Envelope, finite material kinds, satisfaction state, and material-decision record are the minimum mechanism needed to test whether deterministic pre-execution governance prevents real scope creep without changing Git-budget semantics.
