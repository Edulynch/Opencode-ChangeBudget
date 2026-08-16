# Research Notes: SPEC-002

## Decision Log

### Decision: Git command strategy for canonical change set

- **Decision**: Compute changed paths from a union of:
  - `git diff --name-status --find-renames <base> --`
  - `git diff --cached --name-status --find-renames <base> --`
  - `git ls-files --others --exclude-standard --`
- **Rationale**: This captures unstaged, staged, renamed, deleted, and untracked non-ignored changes using only local Git data.
- **Alternatives considered**: a single combined diff command against index and working tree was considered but does not fully preserve deterministic working-tree vs index semantics, and path visibility for untracked files is incomplete.

### Decision: Base revision validation path

- **Decision**: validate the configured `base_revision` before any measurement using `git rev-parse --verify --quiet <ref>^{commit}`.
- **Rationale**: avoids ambiguous behavior and guarantees consistent failure mode for missing/unreachable refs.
- **Alternatives considered**: lazy validation at first diff call, but this delayed failure could hide exact revision context and reduce determinism.

### Decision: Text line counting and binary handling

- **Decision**: use `git diff --numstat` for line contributions. For non-text output (`-` entries), produce deterministic non-text markers and treat line contribution as `0` for this spec stage while preserving file impact.
- **Rationale**: line totals remain deterministic and stable even when binary data is present.
- **Alternatives considered**: rejecting binary paths in all cases was rejected because spec requires stable deterministic behavior, not unsafe skips.

### Decision: Rename representation

- **Decision**: represent rename events consistently using `from` and `to` path fields and include both paths in the canonical path set.
- **Rationale**: this keeps path-level policies deterministic and preserves visibility for both affected locations.
- **Alternatives considered**: collapsing rename into destination path only was considered but loses explicit change provenance for deterministic audits.

### Decision: Path pattern engine

- **Decision**: implement a small deterministic matcher supporting `*`, `**`, `?`, and bracket classes over normalized `/` paths in repository-relative form.
- **Rationale**: avoids external dependencies and keeps behavior explicit and testable.
- **Alternatives considered**: introducing a new matching package was rejected for added dependency and lock-in risk.

### Decision: malformed pattern behavior

- **Decision**: malformed path patterns fail `check` immediately as validation issues with exact pattern text in error context.
- **Rationale**: partial evaluation can be nondeterministic, and this spec requires explicit, safe failure.
- **Alternatives considered**: ignoring bad patterns and treating them as unmatched to continue evaluation was rejected due to unclear security and policy semantics.

### Decision: output format

- **Decision**: keep command output human-readable for CLI usage in v0.2 but include all required result fields in deterministic text form.
- **Rationale**: avoids a breaking CLI format change and stays aligned with SPEC-001 output style while adding enough structure for deterministic tests.
- **Alternatives considered**: JSON-only output only was rejected because integration tests and users currently rely on plain lines.

### Decision: test shape

- **Decision**: implement focused fixtures for each major path type and deterministic behavior, with fixture count target at least 8 scenarios as required by SC-001.
- **Rationale**: directly maps to explicit success criteria and keeps regressions discoverable.
- **Alternatives considered**: one broad property-based test set was considered but difficult to control deterministic edge expectations.

## Research Result Summary

- Deterministic budget enforcement can be implemented entirely within current command and state architecture.
- No additional persistence schema or lifecycle transitions are required.
- A deterministic canonicalization strategy over staged, unstaged, and untracked paths is mandatory to satisfy repeated-run stability.
- Path policy evaluation must happen after canonicalization and before status derivation.
- Git validity failures are always non-pass outcomes and must be surfaced clearly in output.
