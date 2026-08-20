# Implementation Plan: OpenCode Project Integration (SPEC-009)

**Branch**: `009-opencode-integration` | **Date**: 2026-08-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/009-opencode-integration/spec.md`

## Summary

SPEC-009 automates the already-proven ChangeBudget → OpenCode project-local integration into a single idempotent CLI command: `changebudget integrate opencode`. The feature manages exactly three project-local resources (plugin wrapper, agent instructions, `opencode.json` instruction entry) with deterministic ownership markers, conflict detection, dry-run support, safe removal, and a Git baseline warning. It does not redesign ChangeBudget, the Runtime Guard, or OpenCode. Zero new runtime dependencies.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20+ (existing).

**Primary Dependencies**: none beyond existing — Node standard library (`node:url`, `node:path`, `node:fs/promises`, `node:child_process`). Zero new runtime dependencies (FR-027).

**Storage**: project-local files only (`.opencode/plugins/changebudget.js`, `.opencode/instructions/changebudget.md`, `opencode.json`). No `.changebudget/**` state is created or modified by the integration command.

**Testing**: Node built-in test runner (`node --test`); table-driven unit + integration tests using disposable dummy Git repositories only.

**Target Platform**: Windows and Node.js (already claimed). Windows `file://` URL generation explicitly supported.

**Project Type**: local CLI + optional OpenCode plugin integration command.

**Performance Goals**: not applicable — install-management command, not hot-path.

**Constraints**: local-first, deterministic, no silent overwrites, no auto-commits, no network, no npm publishing, no global config modification, no AGENTS.md modification.

**Scale/Scope**: finite — 3 managed resources, 1 new CLI subcommand, 1 new core module, 1 new CLI command file, test coverage. Approximately 18–25 implementation tasks.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design — passed.*

| Principle | Verification |
|---|---|
| I. Local-first & deterministic | Integration is local-only; no network, no cloud, no remote APIs. All content generation is deterministic. PASS |
| II. Minimal architecture | One new core module + one CLI command file. No framework, no plugin manager, no config engine. PASS |
| III. Scope is a hard boundary | Exactly 3 managed resources, exactly 1 new subcommand. No speculative features. Non-goals explicitly listed. PASS |
| IV. Small changes, small workflows | 4 phases, large coherent blocks. Full suite reserved for final gate. PASS |
| V. Targeted validation first | Unit tests for pure functions; integration tests for disposable-repo scenarios. Full suite only in final gate. PASS |
| VI. Git is the source of truth | Integration files are project files tracked by Git. Git baseline warning uses `git status`. PASS |
| VII. Enforcement over suggestion | Integration does not change enforcement behavior. Runtime Guard semantics unchanged. PASS |
| VIII. Human authority | Integration never auto-commits, auto-stages, or auto-widens. User owns the decision to baseline. PASS |
| IX. Explainable decisions | Status output reports each resource state (CREATE/UPDATE/UNCHANGED/CONFLICT) with clear readiness verdict. PASS |
| X. Fast execution | Integration is a one-shot command, not a hot-path. No performance work needed. PASS |
| XI. Personal workflow first | Only OpenCode integration. No other agents, no IDE marketplace, no enterprise. PASS |
| XII. Tooling discipline | Zero new runtime dependencies. Node standard library only. PASS |
| XIII. Dogfooding | ChangeBudget can use itself to integrate with its own OpenCode environment. PASS |
| XIV. Quality over complexity | Small modules, deterministic functions, strong typing, typed errors. PASS |
| XV. Specification discipline | Spec defines problem, scope, FRs, SCs, non-goals, acceptance scenarios. PASS |
| XVI. Roadmap governance | SPEC-009 is the approved next milestone. Nothing beyond it. PASS |
| XVII. Anti-overengineering | One leaf module, not a framework. Ownership via comment markers, not a manifest database. Config merge via parse-modify-reserialize, not a config engine. PASS |

No violations require complexity justification (Complexity Tracking stays empty).

## Module Boundaries

### New files

```text
src/
├── cli/
│   ├── commands/
│   │   └── integrate.ts          # CLI command: parse args, call core, render output
│   └── index.ts                  # Modified: add 'integrate' to SUPPORTED_COMMANDS + dispatch
├── core/
│   └── integration/
│       └── opencode.ts           # Core: all integration domain logic
└── models/
    └── errors.ts                 # Modified: add IntegrationConflictError (if needed)

tests/
├── unit/
│   └── integration-opencode.test.ts   # Unit: ownership, generators, path URL, config merge, pre-flight
└── integration/
    └── integration-opencode-disposable.spec.ts  # Integration: 18-case disposable-repo matrix
```

### Responsibility allocation

| Responsibility | Location | Rationale |
|---|---|---|
| CLI parsing (`integrate opencode`, `--dry-run`, `--remove`) | `src/cli/commands/integrate.ts` | Follows existing pattern: CLI command parses args, calls core, renders output |
| Integration inspection/status | `src/core/integration/opencode.ts` | Domain logic, not CLI rendering |
| Ownership-marker detection | `src/core/integration/opencode.ts` | Pure function: read file, check first-line marker |
| Expected-content generation (wrapper + instructions) | `src/core/integration/opencode.ts` | Pure deterministic functions: same input → byte-identical output |
| Runtime Guard compiled-path resolution | `src/core/integration/opencode.ts` | Uses `import.meta.url` to derive ChangeBudget root |
| Windows-safe `file://` URL generation | `src/core/integration/opencode.ts` | Uses `node:url.pathToFileURL()` |
| `opencode.json` parsing/merge | `src/core/integration/opencode.ts` | Parse-modify-reserialize with deterministic formatting |
| Managed-file writes | `src/core/integration/opencode.ts` | Reuses `writeJsonFileAtomic` pattern for opencode.json; direct writes for wrapper/instructions |
| Removal | `src/core/integration/opencode.ts` | Ownership check → delete → config update |
| Git baseline-status inspection | `src/core/integration/opencode.ts` | `git status --porcelain` on managed paths |
| Human output | `src/cli/commands/integrate.ts` | Concise status rendering |
| JSON output | not required by spec | Spec does not define `--json` for integrate; human output only |

### Existing files modified

| File | Change | Backward-compatible |
|---|---|---|
| `src/cli/index.ts` | Add `'integrate'` to `SUPPORTED_COMMANDS`; add `case 'integrate':` to `executeCommand` | Yes — new command, no existing behavior changed |
| `src/cli/output.ts` | No change needed (reuse existing `printError`/`getExitCode`) | Yes |

## Runtime Guard Path Resolution

**Source of truth**: The ChangeBudget installation root is derived from `import.meta.url` of the compiled CLI entrypoint (`dist/src/cli/index.js`). The root is three levels up: `dist/src/cli/index.js` → `dist/` → ChangeBudget root. The compiled Runtime Guard entrypoint is at `<root>/opencode-plugin/dist/opencode-plugin/src/index.js`.

**Resolution chain**:
1. `import.meta.url` → `fileURLToPath()` → current module path
2. `dirname()` × 3 → ChangeBudget root (e.g., `<repository-root>`)
3. `join(root, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js')` → Runtime Guard entrypoint
4. `pathToFileURL(entrypoint).href` → `file:///D:/WORKSPACE/.../index.js` (platform-safe, Windows-correct)

**Validation**: `access(entrypoint, F_OK)` before any writes. If missing → `InputValidationError` with actionable message: "Compiled Runtime Guard not found. Run `npm run build` in the ChangeBudget repository."

**No auto-build, no npm link, no network.**

## Ownership Model

**Marker format**: First line of each managed file is a deterministic comment containing the marker string `ChangeBudget-managed`.

| File type | Marker line |
|---|---|
| `.js` (wrapper) | `// ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode` |
| `.md` (instructions) | `<!-- ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode -->` |

**Detection states**: MISSING, MANAGED_CURRENT, MANAGED_STALE, CONFLICT

**Rules**: only MANAGED files may be overwritten; CONFLICT → zero writes; stale → safe update; removal requires ownership.

No manifest database. No version numbers — staleness detected by content comparison.

## Expected Content Generation

### Plugin wrapper (2 lines + newline)
```js
// ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode
export { default } from "file:///...";
```

### Agent instructions (fixed markdown, 11 behavioral items from spec FR-007)
Generic OpenCode wording only. No OMO terms. Byte-identical on every call.

Both generators are pure functions: same input → byte-identical output. No timestamps, no random elements.

## opencode.json Merge Strategy

**Decision**: Parse-modify-reserialize with deterministic 2-space formatting.

- Existing file: parse → preserve all fields → append entry if absent → reserialize with `JSON.stringify(obj, null, 2) + '\n'`
- Missing file: create minimal config with `$schema` and `instructions` containing the entry
- Invalid JSON: fail, no modification
- `instructions` not array: fail, no modification
- Key order preserved (V8 insertion order)

**Tradeoff**: Reserializing reformats the whole document to 2-space. Simplest no-dependency approach. Acceptable for typically small/machine-managed `opencode.json`. Alternative (textual surgery) is fragile and complex. Documented in research.md.

## Pre-flight / Write Strategy

**Pre-flight**: inspect all 3 resources → classify CREATE/UPDATE/UNCHANGED/CONFLICT → if ANY CONFLICT → ZERO writes → exit 2.

**Write order**: 1) wrapper, 2) instructions, 3) opencode.json. Deterministic. If failure after some writes → report exactly what succeeded and what's pending → never claim READY.

**No transaction subsystem. No rollback (deleting files we just wrote adds risk). User re-runs to complete.**

## Dry Run

Reuses same pre-flight logic. Reports CREATE/UPDATE/UNCHANGED/CONFLICT per resource. Zero writes. Tests prove byte-identity.

## Removal (`--remove`)

Inspect ownership → delete only MANAGED files → remove exact entry from opencode.json → preserve all other config → never delete opencode.json/AGENTS.md/.opencode/ (if unrelated content) → optionally remove empty owned directories → idempotent.

## Git Baseline Warning

After install/update: `git status --porcelain` on 3 managed paths → if untracked/modified → warning. Never git add/commit/amend/push. Warning is informational only. Skipped if not a Git repo.

## CLI Availability

No PATH detection in v1 (spec says MAY). The command is running ChangeBudget, proving availability. Minimal complexity.

## Status / Output Model

```typescript
type ResourceAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'REMOVE' | 'CONFLICT' | 'ABSENT';
interface IntegrationResult {
  operation: 'install' | 'remove' | 'dry-run';
  resources: { pluginWrapper; instructions; opencodeConfig: IntegrationResourceStatus };
  runtimeGuardTargetExists: boolean;
  baselineWarning: string | null;
  readiness: 'READY' | 'NEEDS_ATTENTION';
}
```

Human output only (no --json in v1). No timestamps. Concise multi-line format.

## Backward Compatibility

No existing command/flag/output/exit-code/policy changed. Projects that never run `integrate opencode` behave exactly as before. CLI remains usable without OpenCode.

## Testing Strategy

**Unit** (`tests/unit/integration-opencode.test.ts`): ownership detection, wrapper generation, instructions generation, file URL generation, config merge, pre-flight plan — all pure functions.

**Integration** (`tests/integration/integration-opencode-disposable.spec.ts`): 18-case table-driven matrix with disposable dummy Git repos.

**Runtime smoke**: import generated wrapper → verify hooks returned. No interactive OpenCode needed.

## Implementation Phases

### Phase 1 — Models + inspection + ownership + generators + config merge (~5 tasks)
Core domain logic, no CLI surface. Unit tests for all pure functions.

### Phase 2 — Install/update/dry-run/remove + CLI/output (~5 tasks)
CLI command, orchestration, Git baseline warning, output rendering, index.ts dispatch.

### Phase 3 — Integration/runtime/disposable-repo validation (~5 tasks)
18-case disposable-repo matrix, runtime smoke test, AGENTS.md byte-identity proof.

### Phase 4 — Acceptance + final regression/convergence gate (~3 tasks)
Acceptance suite (SC-001..SC-011), full project suite regression, convergence gate.

**Estimated total**: ~18 tasks.

## Project Structure

```text
specs/009-opencode-integration/
├── spec.md, checklists/requirements.md, plan.md, research.md, data-model.md
├── quickstart.md
└── contracts/opencode-integration-contract.md

src/cli/commands/integrate.ts              # NEW
src/core/integration/opencode.ts           # NEW
src/cli/index.ts                           # MODIFIED (add 'integrate' dispatch)
tests/unit/integration-opencode.test.ts    # NEW
tests/integration/integration-opencode-disposable.spec.ts  # NEW
```

## Complexity Tracking

No constitution violations — table intentionally empty (all gates PASS).

## Non-Goals (implementation)

No AGENTS.md modification; no OMO-specific config; no global OpenCode integration; no automatic commits/staging/pushes; no npm publishing; no `npm link` automation; no Runtime Guard policy changes; no new stack policies; no new ChangeBudget policy behavior; no automatic contract creation; no general-purpose doctor; no other coding-agent integrations; no cloud/network services; no plugin copying/vendoring; no install manifest database; no integration history.

## Final Self-Check

- [x] exactly 3 managed integration resources
- [x] AGENTS.md zero modifications
- [x] global OpenCode zero modifications
- [x] OMO zero modifications
- [x] install is idempotent
- [x] known conflicts produce zero writes
- [x] dry-run produces zero writes
- [x] uninstall touches only owned resources
- [x] opencode.json unrelated fields preserved
- [x] stale absolute wrapper path repair is planned
- [x] Windows file URL is explicitly covered
- [x] Git baseline warning does not commit/stage
- [x] no new runtime dependency
- [x] no product scope beyond successful prototype automation
- [x] plan can be implemented in large coherent blocks