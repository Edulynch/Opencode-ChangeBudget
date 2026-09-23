# Specification Quality Checklist: Native OpenCode V2 Integration (SPEC-009)

## Content Quality

- [x] The specification describes one project-local wrapper resource.
- [x] Native OpenCode V2 hook names and dependency are explicit.
- [x] User-owned configuration, instruction files, and `AGENTS.md` are explicitly protected.
- [x] Install, update, dry-run, removal, runtime, and failure behavior are testable.

## Requirement Completeness

- [x] No unresolved clarification markers remain.
- [x] Ownership states and resource actions are defined.
- [x] Restrictive permission aggregation is defined.
- [x] Explicit structured material-decision transport is preserved.
- [x] No compatibility, migration, or alternate API behavior is required.
- [x] Disposable-repository acceptance coverage is listed.

## Readiness

- [x] The implementation and tests use only the native V2 plugin contract.
- [x] Generated artifacts and package contents are part of the validation gate.
- [x] Existing ChangeBudget lifecycle, baseline legacy data modes, and execution-gate behavior are protected.
