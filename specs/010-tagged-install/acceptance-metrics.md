# SPEC-010 Acceptance Evidence

Generated from the final T041-T044 validation block. Evidence is deterministic
and uses only local fixtures, injected GitHub responses, and disposable npm
prefixes.

## Validation Results

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck | PASS | `npm run typecheck` |
| Build | PASS | `npm run build` |
| Full suite | PASS | Windows: `npm test`, 506/506 tests; Ubuntu/WSL: 471 passed, 0 failed, 1 intentional Windows-only skip |
| Package contents | PASS | `npm pack --dry-run --json`; explicit required/forbidden path assertions |
| Network use | NONE | GitHub fetches are injected/mocked; tagged install uses `git+file://` |
| Real global npm mutation | NONE | All install tests use a temporary prefix |
| Cross-platform validation | PASS | Windows real validation; Ubuntu/WSL real validation (471 passed, 0 failed, 1 intentional Windows-only drive-letter URL skip); macOS covered by POSIX-compatible tests, with no physical-device run required |
| npm compatibility | PASS | Supported range is npm >=8 <12; npm 12 Git dependency/lifecycle policy changes are explicitly outside this release |
| T037 evidence | PASS | Disposable tagged Git fixture proves npm invokes `prepare`, global layout, built runtime, CLI, Runtime Guard, integration, spaces, and cleanup. The fixture uses a sentinel prepare hook; the production `tsc` prepare command is validated separately by normal build/typecheck/install evidence. |
| Quick Start evidence | PASS | T037 covers installation; T031 covers documented init/integrate behavior; SPEC-009 tests cover Runtime Guard behavior. The automated suite does not launch an external OpenCode process. |

## Exit Code Matrix

| Outcome | Code | Evidence |
| --- | ---: | --- |
| `--version` success | 0 | Tagged-install acceptance |
| `update --check` success/current/compatible/newer-major | 0 | Update orchestration tests |
| `update` success/no-op/major refusal | 0 | Update orchestration and isolation tests |
| Invalid CLI usage | 2 | `edge-cases.test.ts` |
| Version/discovery/integrity environment failure | 4 | Update failure and edge-case tests |
| npm unavailable/launch/non-zero/signal failure | 4 | npm adapter and update failure tests |
| Unexpected internal failure | 10 | Update orchestration test |
| Exit 1 updater error | Not used | No SPEC-010 updater path returns exit 1 |

## Edge Cases

Covered by `tests/unit/core/update/{github,version,npm,update,edge-cases}.test.ts`:

- Stable numeric ordering, duplicates, current-newer, compatible-plus-major, and multiple majors.
- Prerelease, malformed, alias, and injection-like tags.
- Integrity match, mismatch, malformed JSON, missing version, and non-string version.
- Pagination, API/network failure, npm launch/non-zero/signal failure, and Windows `ComSpec` behavior.
- Arbitrary cwd, unrelated package.json, no `.git`, project byte/Git-state isolation, and no automatic integration.

## FR Traceability

All 49 functional requirements are covered. Key evidence groups:

| Requirements | Evidence |
| --- | --- |
| FR-001..FR-006 | `tagged-install.test.ts`, package-content test |
| FR-007..FR-014 | version, GitHub, edge-case, and tagged-install tests |
| FR-015..FR-023 | isolation, update, GitHub integrity, and SPEC-009 tests |
| FR-024..FR-031 | exit matrix and update failure tests |
| FR-032..FR-043 | isolation, package-content, npm, and tagged-install tests |
| FR-044..FR-049 | full regression suite, disposable utilities, and edge-case matrix |

## SC Traceability

All 12 success criteria pass:

| Criteria | Evidence |
| --- | --- |
| SC-001..SC-002 | Tagged local Git installation |
| SC-003..SC-005 | Version selection and major-blocking tests |
| SC-006..SC-007 | Project byte/Git-state isolation tests |
| SC-008..SC-009 | SPEC-009 compatibility and failure isolation tests |
| SC-010 | Disposable npm prefix and cleanup tests |
| SC-011 | Integrity validation tests |
| SC-012 | Quick-start acceptance test |
