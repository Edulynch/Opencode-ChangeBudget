# SPEC-009 Acceptance Metrics

This record describes the native OpenCode V2 gate. The executable acceptance suite writes refreshed evidence when `UPDATE_ACCEPTANCE_METRICS=1` is set.

| SC | Requirement | Evidence | Result |
|---|---|---|---|
| SC-001 | One wrapper is created in a clean disposable repository. | `integration-opencode-disposable.spec.ts` install scenario | PASS |
| SC-002 | Repeated installation is byte-identical. | `UNCHANGED` wrapper action and exact content comparison | PASS |
| SC-003 | User-owned wrapper content is never overwritten. | Conflict preflight returns zero writes | PASS |
| SC-004 | Dry-run is non-mutating. | Wrapper remains absent after dry-run | PASS |
| SC-005 | Marked stale wrapper URLs are repaired. | Only `.opencode/plugins/changebudget.js` changes | PASS |
| SC-006 | Removal is ownership-safe and idempotent. | `REMOVE` then `ABSENT`; unrelated files preserved | PASS |
| SC-007 | Native V2 hooks are registered. | Wrapper import records `session:context` and `permission:evaluate` | PASS |
| SC-008 | Permission resources aggregate restrictively. | Runtime tests cover `deny > ask > allow` and incoming deny preservation | PASS |
| SC-009 | URLs are platform-safe. | `pathToFileURL` round-trip resolves the compiled plugin entry | PASS |
| SC-010 | Core behavior remains independent. | Full CLI, baseline legacy-mode, and execution-gate suite | PASS |

The integration does not create or edit `opencode.json`, instruction files, `AGENTS.md`, global configuration, or `.changebudget/**`.
