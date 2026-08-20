# Research: SPEC-009 OpenCode Integration Decisions

**Branch**: `009-opencode-integration` | **Date**: 2026-08-18 | **Spec**: [spec.md](spec.md)

## R-1 — Runtime Guard path resolution (FR-002, FR-003)

**Decision**: Derive ChangeBudget installation root from `import.meta.url` of the compiled CLI entrypoint, then join to compiled Runtime Guard path.

**Resolution chain**: `import.meta.url` → `fileURLToPath()` → `dirname()` ×3 → root → `join(root, 'opencode-plugin/dist/opencode-plugin/src/index.js')` → `pathToFileURL(entrypoint).href`

**Rationale**: `import.meta.url` is the most reliable way for a compiled ES module to find its own location at runtime. Works regardless of how the CLI was invoked. Three `dirname()` calls navigate from `dist/src/cli/index.js` to the repository root.

**Alternatives rejected**: hardcode at build time (breaks if moved), env var (adds config surface), `require.resolve` (ESM not CJS), npm package resolution (private package).

## R-2 — Windows-safe file URL generation (FR-003)

**Decision**: Use `node:url.pathToFileURL()`.

**Rationale**: Handles Windows drive letters, backslashes, Unicode, UNC paths. Standard Node API since 10.12. No manual slash replacement.

**Prototype verified**: `file:///D:/WORKSPACE/...` format loads successfully on Windows.

## R-3 — Ownership marker design (FR-004, FR-005, FR-009, FR-019, FR-020)

**Decision**: First-line comment containing `ChangeBudget-managed`. JS: `// ChangeBudget-managed: ...`, MD: `<!-- ChangeBudget-managed: ... -->`.

**Detection**: Read first line → contains `ChangeBudget-managed` → owned. Content comparison detects staleness.

**No version numbers**: Content comparison catches all changes (path, template, formatting) in one check. Version parsing adds complexity for no benefit.

**Alternatives rejected**: JSON sidecar manifest (adds state), versioned marker (doesn't catch template-only changes), file permissions (not portable), no marker (violates no-overwrite guarantee).

## R-4 — opencode.json merge strategy (FR-010..FR-014)

**Decision**: Parse-modify-reserialize with deterministic 2-space formatting.

**Algorithm**: Read → `JSON.parse` → validate `instructions` is array → append entry if absent → `JSON.stringify(obj, null, 2) + '\n'`.

**Key ordering**: V8 preserves insertion order; `JSON.stringify` serializes in that order. No sorting. Existing key order preserved.

**Tradeoff**: Reserializing reformats the entire document to 2-space indent. Main tradeoff. Acceptable because: opencode.json is typically small/machine-managed; 2-space is common convention; alternative (textual surgery) is fragile; idempotency guaranteed; no new dependency.

**Invalid JSON**: `JSON.parse` throws → `InputValidationError` → no modification. **Non-array instructions**: `Array.isArray` check → `InputValidationError` → no modification.

**Alternatives rejected**: textual surgery (fragile), preserve original indent (complex detection), third-party formatter (zero deps).

## R-5 — Pre-flight conflict strategy (FR-024)

**Decision**: All-or-nothing. If ANY resource is CONFLICT → ZERO writes.

**Rationale**: Partial installs are the worst outcome — inconsistent state, hard to diagnose. Check-before-act is simple and prevents predictable partial installs.

**Runtime failures**: Filesystem errors after pre-flight passes are rare. Write order minimizes impact. Error reports exactly what succeeded and what's pending. No rollback (deleting files adds risk). User re-runs to complete.

## R-6 — Write order (FR-024)

**Decision**: Wrapper → Instructions → opencode.json.

**Rationale**: Wrapper first (most critical, new file, least conflict). Instructions second (new file, prerequisite dir exists). opencode.json last (highest-risk user file, all prerequisites in place). If opencode.json fails, managed files exist but aren't registered — clear, actionable state.

## R-7 — Git baseline warning (FR-022)

**Decision**: `git status --porcelain` scoped to 3 managed paths. If output → warning. Never stage/commit. Informational only. Skipped if not a Git repo.

**Rationale**: Prototype found untracked integration files trigger REPAIR. Warning prevents confusion. Error would block installation in non-Git projects.

## R-8 — CLI availability non-detection (FR-023)

**Decision**: Do NOT detect PATH availability in v1. Spec says "MAY warn" — we choose not to.

**Rationale**: Command is running ChangeBudget, proving availability. Adding PATH detection adds complexity for marginal value. User knows their environment.

## R-9 — Removal CLI syntax

**Decision**: `changebudget integrate opencode --remove`.

**Rationale**: Follows existing subcommand + flags pattern. Alternative `unintegrate` adds a new top-level command for a single feature — disproportionate.

## R-10 — Empty directory cleanup during removal

**Decision**: After removing managed files, optionally remove `.opencode/plugins/` and `.opencode/instructions/` if now empty. Never remove `.opencode/`, `opencode.json`, or `AGENTS.md`.

## Decisions not requiring changes (verified by prototype)

- Compiled Runtime Guard is self-contained within `opencode-plugin/dist/` — no external deps
- `file://` wrapper approach works — no alternative loading mechanism needed
- Plugin export shape `{ id, server }` is standard OpenCode — no adapter needed
- Generic instructions coexist with existing OpenCode config — no conflict resolution beyond markers
- AGENTS.md is not touched — no special protection logic needed