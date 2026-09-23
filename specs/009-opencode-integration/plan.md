# Implementation Plan: Native OpenCode V2 Integration (SPEC-009)

## Summary

Implement one idempotent CLI integration command that manages only `.opencode/plugins/changebudget.js`. The wrapper points at the compiled native V2 plugin. The plugin registers session context and permission evaluation hooks using `@opencode/plugin@2.0.12`.

## Production Modules

| Module | Responsibility |
|---|---|
| `src/core/integration/opencode-types.ts` | One managed path, ownership states, resource actions, result types |
| `src/core/integration/opencode-content.ts` | Deterministic wrapper content |
| `src/core/integration/opencode-runtime.ts` | Compiled plugin root and Windows-safe URL |
| `src/core/integration/opencode-ownership.ts` | Exact marker and content classification |
| `src/core/integration/opencode-preflight.ts` | Runtime existence, ownership, and conflict inspection |
| `src/core/integration/opencode-install.ts` | Create/update wrapper and baseline warning |
| `src/core/integration/opencode-dry-run.ts` | Non-mutating action preview |
| `src/core/integration/opencode-remove.ts` | Ownership-safe wrapper removal |
| `src/core/integration/opencode-discovery.ts` | Four native wrapper refresh states |
| `src/cli/commands/integrate.ts` | CLI parsing and concise human output |
| `opencode-plugin/src/index.ts` | Native V2 setup and hook registration |
| `opencode-plugin/src/evaluator.ts` | Existing ChangeBudget evaluation and explicit material decisions |
| `opencode-plugin/src/projection.ts` | Deterministic `allow`/`ask`/`block` projection |

## Integration Flow

1. Resolve the ChangeBudget installation root from the compiled CLI module URL.
2. Resolve and verify `opencode-plugin/dist/opencode-plugin/src/index.js`.
3. Classify the one wrapper by exact first-line marker and expected content.
4. Refuse all writes on a user-owned conflict.
5. Create or update only the wrapper; report Git baseline status without Git mutation.
6. On removal, delete only a marked wrapper and clean empty directories.

`opencode.json`, instruction files, `AGENTS.md`, global configuration, and `.changebudget/**` are never write targets.

## Native Runtime Flow

1. `Plugin.define` exposes id `changebudget` and `setup(ctx)`.
2. Setup resolves the repository root and registers `session.context`.
3. Setup registers `permission.evaluate` and evaluates every resource.
4. Structured material decisions are normalized only when explicitly present in permission metadata.
5. Projections aggregate as `deny > ask > allow`; evaluator failures deny potentially mutating work.
6. Cleanup disposes both registrations.

## Testing Strategy

- Unit tests cover ownership, deterministic content, URL resolution, action summaries, discovery, and projection ordering.
- Disposable-repository integration tests cover install, update, conflict, dry-run, remove, baseline warnings, wrapper import, session context, permission aggregation, malformed state, and explicit material decisions.
- Acceptance tests assert that unrelated files remain byte-identical and that no old hook surface or extra managed resource is present.
- Build output is regenerated and checked for zero drift.

## Constraints

- No alternate OpenCode API adapter, fallback, version detection, duplicate configuration, migration, or dead compatibility state.
- No automatic Git add/commit/push, network lookup, plugin vendoring, or global configuration.
- Preserve existing ChangeBudget lifecycle, baseline legacy data modes, and execution-gate structured material decisions.
