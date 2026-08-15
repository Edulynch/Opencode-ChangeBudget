<!--
Sync Impact Report
Version change: none -> 1.0.0
Modified principles:
- Template PRINCIPLE_1_NAME -> I. Local-first and deterministic
- Template PRINCIPLE_2_NAME -> II. Minimal architecture
- Template PRINCIPLE_3_NAME -> III. Scope is a hard boundary
- Template PRINCIPLE_4_NAME -> IV. Small changes, small workflows
- Template PRINCIPLE_5_NAME -> V. Targeted validation
- Template SECTION_2_NAME -> VI. Quality and Development Policy
- Template SECTION_3_NAME -> VII. Workflow and Governance Conventions
- Template GOVERNANCE_RULES -> VIII. Governance and versioning rules
Added sections:
- Expanded core principles to 17 explicit governance principles.
- Added two concrete additional sections.
Removed sections:
- Unresolved placeholder scaffold.
Deferred TODOs:
- None.
-->

# ChangeBudget Constitution

## Core Principles

### I. Local-first and deterministic
ChangeBudget MUST operate locally and must not depend on remote APIs, cloud services,
external databases, authentication, SaaS infrastructure, telemetry, or AI models for
core enforcement.
Decisions MUST be fully determined by the active contract, Git state,
repository files, and configured policies.

### II. Minimal architecture
Prefer the smallest architecture that solves the approved specification.
The project MUST not add backend services, web applications, dashboards,
databases, Docker infrastructure, brokers, authentication, user accounts,
cloud storage, analytics, payments, plugin ecosystems, or generalized multi-agent
orchestration unless a future approved specification explicitly requires them.

### III. Scope is a hard boundary
Only behavior explicitly required by the active specification may be implemented.
No speculative features, unrelated refactors, premature abstractions,
or future-roadmap functionality are allowed in current work.

### IV. Small changes require small workflows
Workflow overhead MUST match risk.
For low-risk, localized work, use
`specify -> plan -> tasks -> implement -> converge`.
`clarify`, `analyze`, and full-spec ceremony are used only when ambiguity,
risk, or cross-cutting impact justifies them.

### V. Targeted validation before exhaustive validation
Validation MUST be proportional to scope.
Run the smallest related checks first and use lint/typecheck/build only when applicable.
Do not repeat full suites after every local edit.

### VI. Git is the source of change truth
Change calculations MUST be based on Git revision, diffs, staged/unstaged changes,
renames, additions, deletions, and working-tree state.
No parallel state abstraction is allowed unless a future approved spec proves it
necessary.

### VII. Enforcement over suggestion
ChangeBudget enforces contracts with explicit states: `PASS`, `REPAIR`,
and `HUMAN_REVIEW`.
It MUST separate allowed change, direct violation, and cases requiring explicit
human approval.

### VIII. Human authority
The developer retains final authority for scope decisions.
The tool MUST NOT auto-expand allowed paths, budgets,
dependency permissions, migration permissions, protected-file exceptions,
or architectural permissions.

### IX. Explainable decisions
Every enforcement result MUST include rule failure, expected limit, observed value,
and affected file or resource.
No opaque scoring system can replace readable policy explanations.

### X. Fast execution
Core operations MUST stay local, deterministic, non-interactive by default,
predictable, and fast enough for repeated invocation during active coding.
Prefer targeted Git checks over expensive full scans.

### XI. Personal workflow first
Primary integration priority is Git, then OpenCode, then Spec-Kit.
Do not generalize for other agents, IDE marketplaces, teams,
enterprise workflows, hosted CI, or teams unless later specifications require it.

### XII. Tooling discipline
External tools, including documentation helpers, MAY be used when current references
are needed and only on demand.
They MUST not become mandatory runtime dependencies.

### XIII. Dogfooding
Once usable, ChangeBudget should be used to develop ChangeBudget itself where
practical.
Observed failures must become evidence for future specifications, not silent scope
expansions in the current one.

### XIV. Quality over complexity
Behavior must be explicit, readable, and testable.
Implementation should use small modules, deterministic functions, and strong typing.
Avoid hidden global state, implicit mutation, abstraction without multiple
consumers, and cleverness that reduces readability.

### XV. Specification discipline
Each active specification MUST define problem statement, user-visible behavior,
explicit scope, non-goals, acceptance criteria, failure behavior, and constraints.
A spec must not implement future roadmap functionality ahead of approval.
Material requirement gaps found during implementation must stop work and be surfaced.

### XVI. Roadmap governance
The roadmap defines planned work and sequencing.
When scope decisions conflict, apply this order:
- Constitution
- Active approved specification
- Roadmap

Future roadmap items are not permission to implement early.

### XVII. Anti-overengineering
If two valid approaches exist, prefer fewer components, fewer dependencies,
less runtime state, less infrastructure, smaller surface, and easier deterministic
testing, unless the more complex option is required by a proven need.

## Quality and Development Policy

Project quality defaults apply across all active work:

- Deterministic behavior for the same repository state and policy input.
- Small, explicit modules over monolithic abstractions.
- Strong types and testable boundaries by default.
- Useful errors and human-readable failure reasons.

## Workflow and Governance Conventions

All work uses existing Spec-Kit paths and extension hooks.
Only one specification change set is processed at a time unless roadmap order
explicitly permits parallel work.
Validation and reporting are scoped to keep iteration friction low.

## Governance

This constitution is binding for all project activity and supersedes any
contradicting proposal, plan, task, or implementation suggestion.

Amendment process:
- Propose explicit governance change intent.
- Record rationale and scope in project docs.
- Apply version bump and Sync Impact report before further execution.

Versioning policy:
- MAJOR: backward-incompatible governance change or principle removal.
- MINOR: new principle, new section, or materially expanded guidance.
- PATCH: wording clarifications and non-material refinements.

Compliance review:
- Validate decisions against the constitution before spec start and before milestones.
- Enforce traceable checks: explicit rule, observed value, affected resource.

**Version**: 1.0.0 | **Ratified**: 2026-08-15 | **Last Amended**: 2026-08-15
