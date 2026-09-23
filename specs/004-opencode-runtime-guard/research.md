# Research Notes: OpenCode V2 Runtime Guard

## Sources

- OpenCode V2 plugin documentation.
- `@opencode/plugin@2.0.12` type declarations for `Plugin.define`, session context hooks, and permission evaluation hooks.
- Existing ChangeBudget state, contract, check, projection, and execution-gate modules.

## Decisions

### Native plugin shape

Use `Plugin.define({ id: 'changebudget', setup(ctx) })`. The setup context is the source of truth for the V2 plugin API. No older API shape is recognized or translated.

### Hook surface

Use `ctx.session.hook('context', ...)` for deterministic model context and `ctx.permission.hook('evaluate', ...)` for enforcement. V2 permission evaluation already carries the action and all resources, so no supplemental pre-execution hook or correlation map is needed.

### Restrictive aggregation

Project each resource independently, then select the strictest result. The order is `deny > ask > allow`; internal `block` becomes V2 effect `deny`. An incoming restrictive effect is never weakened.

### Unknown and broken context

An uninitialized repository is passive and allows normal operations. An initialized repository with missing/corrupt state, no active contract, or an unresolved mutation target fails safe with a denial. Read-only work remains allowed when it can be classified as read-only.

### Structured material decisions

Material decisions are explicit structured values. They enter only through permission metadata, are normalized before evaluation, and use the existing execution-gate governance. Ordinary requests use `ABSENT`; the runtime never fabricates a proposal and never persists an approval.

### Local-first behavior

The plugin reads existing local state and performs no network calls or plugin-owned state writes. The core CLI remains independent when the plugin is unavailable.
