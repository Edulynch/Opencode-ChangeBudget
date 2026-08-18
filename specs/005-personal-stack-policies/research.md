# Research Notes: SPEC-005

## Sources Checked

- Existing specification artifacts:
  - `specs/001-change-contract-lifecycle/spec.md`
  - `specs/002-deterministic-git-budget-engine/spec.md`
  - `specs/003-policy-results-exit-codes/spec.md`
  - `specs/004-opencode-runtime-guard/spec.md`
- Existing implementation surfaces:
  - `src/models/change-contract.ts`
  - `src/cli/parsers/contract-input.ts`
  - `src/core/validation/contract-validator.ts`
  - `src/core/check/rules.ts`
  - `src/core/check/patterns.ts`
  - `src/models/check-result.ts`
  - `src/cli/commands/check.ts`
  - `src/cli/commands/status.ts`
  - `src/cli/commands/start.ts`
  - `src/cli/output.ts`
- Current project roadmap:
  - `ChangeBudget_Roadmap.md`
- Existing test patterns:
  - `tests/unit/contract-validation.test.ts`
  - `tests/unit/state-validation.test.ts`
  - `tests/integration/lifecycle-init-start-status-check.spec.ts`
  - `tests/unit/status-check-close.test.ts`

## Decision Log

### Decision: stack profile source model

- Decision: Represent profile selection as a first-class optional contract field `stack_profile` and resolve a single active profile during check and status operations.
- Rationale: keeps profile selection in command history with the contract and allows contract-level overrides to take effect deterministically.
- Alternatives considered: adding profile selection as a separate global command file. Rejected because this made active profile drift difficult to reason about across contract cycles.

### Decision: repository override storage

- Decision: store repository overrides in `.changebudget/stack-policy-overrides.json` and load them lazily during evaluation.
- Rationale: override rules are repository-local, should not be mixed into lifecycle state, and should be easy to inspect/edit directly.
- Alternatives considered: environment variable override file path and hidden global config. Rejected to preserve local-first simplicity.

### Decision: deterministic merge order

- Decision: effective rule set = `builtin -> repository delta -> contract disablements`.
- Rationale: deterministic precedence matches explicit request ordering and supports repository baseline tuning plus contract-specific narrow exceptions.
- Alternatives considered: giving contract precedence first and then repo. Rejected because it would prevent local repository policy from applying consistently across contracts.

### Decision: stable rule identifiers and reason namespace

- Decision: keep rule IDs as a fixed profile-scoped string namespace (for example `android/signing`) and emit dedicated reason codes under a new family (`CBS-*`).
- Rationale: user-facing diagnostics need to be machine-parseable and clearly distinguish stack reasons from baseline path/budget reasons.
- Alternatives considered: reusing existing reason codes from path checks for stack policy. Rejected due to ambiguous attribution and hard-to-differentiate mixed failures.

### Decision: where stack reasons appear

- Decision: include stack reasons in existing `BudgetCheckResult` as additional violations and include a dedicated status summary block in `status --json` output.
- Rationale: avoids adding a separate command while keeping output discoverable in normal workflow.
- Alternatives considered: new command sub-flag and separate file output. Rejected to preserve feature discoverability in existing flows.

### Decision: command surface

- Decision: extend `changebudget start` with:
  - `--stack-profile <android|flutter|spring-boot|node-ts>`
  - repeatable `--disable-stack-rule <rule-id>`
- Rationale: explicit profile selection without heuristics and direct support for per-contract exceptions.
- Alternatives considered: infer profile from changed files. Rejected for determinism and user control reasons.

### Decision: error posture

- Decision: malformed profile names, malformed override files, duplicate/unknown rule ids, and disabled rule ids not present in resolved rules must fail contract creation with deterministic validation errors.
- Rationale: prevents silent drift and aligns with SPEC-004 and SPEC-002 fail-safe posture.
- Alternatives considered: warning and fallback to no stack checks. Rejected because it weakens deterministic behavior.

## Open Design Notes

- Built-in rule categories should stay strict path patterns only; no AST, language parser, or dynamic imports.
- Override files and contract fields should be normalized and sorted before evaluation for stable output ordering.
- Runtime interception behavior from SPEC-004 should continue to consume the same policy input and map new stack reasons with deterministic labels where applicable.

## Research Summary

- No external framework or API dependency was introduced for this feature design.
- Existing project primitives support local JSON persistence and deterministic checking, so stack profiles should extend those primitives instead of creating a new processing path.
- The highest risk for this spec is conflict resolution and error clarity; both will be handled explicitly in data model and validation tasks.
