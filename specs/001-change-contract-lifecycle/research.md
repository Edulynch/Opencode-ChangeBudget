# Research Notes: SPEC-001

## Decision Log

### Decision: Runtime and language

- **Decision**: TypeScript 5.x on Node.js 20+.
- **Rationale**: aligns with roadmap stack guidance, keeps implementation close to the existing ecosystem, and avoids a separate runtime bootstrap while still allowing strict typing.
- **Alternatives considered**: Python and Go were reviewed and rejected for this phase because they would shift the implementation model away from the intended TypeScript-first CLI trajectory.

### Decision: Bun vs Node for v0.1

- **Decision**: Use Node.js as the execution baseline.
- **Rationale**: Node is available in the broadest set of environments and predictable for local developer usage; Bun can still be supported as an optional runner for speed where available.
- **Alternatives considered**: Bun-first execution was considered, but rejected for v0.1 to avoid runtime lock-in before SPEC-002.

### Decision: Dependency policy

- **Decision**: No mandatory runtime dependencies for SPEC-001 core.
- **Rationale**: this keeps startup fast, preserves local determinism, and avoids dependency churn for a governance-focused baseline.
- **Alternatives considered**: CLI frameworks (`commander`, `oclif`) were evaluated but deferred to reduce boilerplate and keep the command surface minimal.

### Decision: CLI argument parsing

- **Decision**: Use Node standard parsing (`node:util` + structured command dispatcher) and avoid framework-level command frameworks.
- **Rationale**: SPEC-001 has only five commands and fixed, predictable flags; minimal parser surface lowers implementation complexity and risk.
- **Alternatives considered**: `commander` and `yargs` were rejected for v0.1 due to dependency and API surface overhead.

### Decision: Storage format

- **Decision**: Human-readable JSON files under `.changebudget/` with versioned schema fields.
- **Rationale**: explicit inspection, deterministic diffs, and no external stores or migrations.
- **Alternatives considered**: YAML and SQLite were rejected for increased parser/setup overhead and higher corruption/compatibility risk.

### Decision: Git interaction strategy

- **Decision**: Use Git CLI commands with explicit repo path (`git -C <repo> ...`) only for repo detection and revision capture.
- **Rationale**: matches existing project assumptions and keeps truth anchored in Git metadata.
- **Alternatives considered**: Library-based Git wrappers were rejected; additional abstraction can be added in later specs if needed.

### Decision: Error and exit behavior

- **Decision**: Define deterministic, typed error classes and numeric exit codes that separate validation/state failures from environment failures.
- **Rationale**: enables local tooling to integrate later with scripts while keeping messages human-readable today.

### Decision: Testing approach

- **Decision**: targeted filesystem + Git integration tests with temporary directories and temporary git repos; avoid broad matrix at this stage.
- **Rationale**: keeps Phase 1 verification aligned to SPEC-001 risk and avoids expensive full-suite cycles.

## Research Result Summary

- No unresolved `NEEDS CLARIFICATION` items remain for initial implementation planning.
- All technical decisions were made to minimize dependencies and preserve a clean extension point for future specs.
- Explicitly deferred work is recorded in plan and contract docs under risks/deferrals and post-SPEC-001 scope sections.
