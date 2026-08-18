# Implementation Plan: Personal Stack Policies

**Branch**: `005-personal-stack-policies` | **Date**: 2026-08-16 | **Spec**: `specs/005-personal-stack-policies/spec.md`

## Summary

This feature extends contract lifecycle and check evaluation to apply deterministic stack-aware rule packs.

Scope:

- add `--stack-profile` and `--disable-stack-rule` to contract creation
- resolve active profile + repository overrides into deterministic effective stack rules
- evaluate stack-sensitive matches alongside existing file/line/allow-deny checks
- surface stack reasons in check and status outputs using `CBS-*` reasons and a stack summary
- keep SPEC-001 to SPEC-004 behavior unchanged when no profile is selected

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js 20+ (ESM modules)

**Storage**: existing repository-local `.changebudget/` files

**New persistence**: `.changebudget/stack-policy-overrides.json` (per-repository overrides, optional)

**Primary APIs**:

- `src/core/check/patterns.ts` for deterministic glob-like matching and validation
- `src/models/check-result.ts` for enriched result projection
- `src/cli/parsers/contract-input.ts` and `src/core/validation/contract-validator.ts`
- `src/cli/commands/start.ts`, `src/cli/commands/check.ts`, `src/cli/commands/status.ts`
- `src/cli/index.ts` output printers

## Technical Decisions

- `CheckViolation.rule` stays stable for core rules and adds one stable stack rule marker: `stack_profile_rule`.
- Each stack match emits a deterministic `CBS-*` reason code derived from the stack rule ID, for parseable policy attribution.
- The effective stack rule set is computed as:
  `builtin profile rules -> repository override additions -> contract disablements removed`.
- Duplicate and invalid identifiers are rejected before check evaluation to preserve deterministic failures.
- Contract output and check pipeline continue to be non-mutating.

## Execution Plan

### Phase 1: Model and parser foundations

- Add stack policy model (`StackProfile`, `StackPolicyRule`, override file types) and built-in profiles.
- Extend `src/models/change-contract.ts` with `stack_profile` and `disabled_stack_rules`.
- Extend parser/validator support for `--stack-profile` and repeatable `--disable-stack-rule`.
- Add input-level validation for allowed profile values, disabled list format, and duplicate tokens.

### Phase 2: Override resolution + policy engine integration

- Add override loader and resolver in a new stack-policy module with deterministic normalization/sorting.
- Resolve repository override file from `.changebudget/stack-policy-overrides.json` if present.
- Validate override rules and compile patterns to catch malformed rules early.
- Expand check evaluation input/result to include stack summaries and violations.

### Phase 3: Command and output wiring

- In `start`, block contract creation on invalid profile ids or unresolved disable ids.
- In `check`, evaluate active/draft contracts with stack context and add violations for matching stack rules.
- In `status`, pass through stack summary to budget result and include summary in JSON output.
- Extend `printCheckResult`, `printCheckResultJson`, `printStatusBudgetResult`, `printStatusResultJson` with concise stack visibility.

### Phase 4: Tests and verification

- Add unit tests for parser/validator and stack resolution edge cases.
- Add unit tests for stack violations and ordering with existing deterministic expectations.
- Add integration tests for profile selection and repository overrides.
- Run build + full test suite.

## Risks and Compatibility

- **Schema migration**: existing contracts are backward compatible because `stack_profile` and `disabled_stack_rules` are optional.
- **Behavioral safety**: if stack profile is not selected, existing check and status flows must remain byte-equivalent except for added neutral output fields.
- **Error parity**: malformed override files should fail fast and surface `InputValidationError`.
