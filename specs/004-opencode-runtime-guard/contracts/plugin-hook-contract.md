# Contract: OpenCode V2 Plugin Hooks

## Scope

The runtime package exports a native V2 plugin with id `changebudget`. Setup registers exactly two hooks:

- `ctx.session.hook('context', callback)`
- `ctx.permission.hook('evaluate', callback)`

There are no tool/command pre-execution adapters, server callback, correlation map, or compatibility transport.

## Session Context

The context callback receives a mutable V2 session context containing `system`. It appends one deterministic ChangeBudget system text when that text is not already present. It performs no filesystem or lifecycle-state write.

## Permission Evaluation

The evaluate callback receives a V2 permission evaluation with `sessionID`, `action`, `resources`, optional metadata, and mutable `effect`/`message` fields.

For each resource it:

1. normalizes the operation and target context;
2. evaluates existing ChangeBudget state and active contract policy;
3. normalizes an explicit `materialDecision` metadata value when present;
4. projects `allow`, `ask`, or internal `block` with a stable rule; and
5. aggregates all results as `deny > ask > allow`.

Internal `block` is emitted as V2 effect `deny`. The callback preserves an incoming `deny` and denies potentially mutating work if evaluation fails.

## Determinism and Side Effects

For identical repository state, permission input, and metadata, the effect, rule, and message are identical. Permission evaluation does not amend contracts, persist approvals, change `.changebudget/**`, or call external services.
