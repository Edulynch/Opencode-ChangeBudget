# Implementation Plan: OpenCode V2 Runtime Guard

## Summary

SPEC-004 evaluates active ChangeBudget policy before OpenCode V2 operations and projects the result into a native permission effect. The core policy remains `PASS`, `REPAIR`, or `HUMAN_REVIEW`; the runtime projection is `allow`, `ask`, or internal `block`, mapped to V2 effects `allow`, `ask`, or `deny`.

The implementation is an optional plugin package. The ChangeBudget CLI remains usable when OpenCode is absent or the wrapper is not installed.

## Technical Context

- TypeScript 5.x and Node.js 20+.
- `@opencode/plugin@2.0.12` from the root dependency set.
- Existing ChangeBudget state, contract, check, path, and execution-gate modules.
- Local-only behavior; plugin decisions do not write `.changebudget/**`.

## Native V2 Decisions

- Export `Plugin.define({ id: 'changebudget', setup })`.
- Register `ctx.session.hook('context', ...)` to add deterministic workflow context.
- Register `ctx.permission.hook('evaluate', ...)` as the only enforcement boundary.
- Evaluate all permission resources and combine outcomes as `deny > ask > allow`.
- Preserve a more restrictive incoming effect; never weaken `deny`.
- Normalize explicit structured material decisions from permission metadata only. Ordinary requests use no fabricated decision.
- Fail closed for potentially mutating operations when state, contract, or target context cannot be evaluated safely.

## Projection Rules

1. Uninitialized repository: allow (passive mode).
2. Read-only operation: allow unless an explicit unsafe condition applies.
3. `REPAIR`: block mutation.
4. `HUMAN_REVIEW`: block unresolved mutation.
5. Denied path or `.changebudget/**`: block.
6. Out-of-scope path: ask.
7. Disallowed sensitive category: ask.
8. Otherwise: allow.

## Source Responsibilities

| Path | Responsibility |
|---|---|
| `opencode-plugin/src/index.ts` | Native setup, V2 input normalization, target extraction, hook registration, restrictive aggregation |
| `opencode-plugin/src/evaluator.ts` | Lifecycle/contract evaluation and explicit execution-gate material decisions |
| `opencode-plugin/src/projection.ts` | Deterministic policy-to-runtime mapping and rule identifiers |
| `opencode-plugin/src/target-classification.ts` | Safe lexical/effective target classification |

## Validation

Unit tests cover the projection truth table and stable reason codes. Disposable integration tests import the installed wrapper, inspect native registration names, test session context, test permission aggregation, and verify malformed state and unresolved mutation fail safely. Existing core tests cover legacy baseline data modes and explicit structured execution-gate decisions.

## Non-Goals

No alternate API adapter, fallback, version detection, migration, duplicate configuration, tool/command pre-execution hook, server callback, pseudo-handoff, sandbox, network call, audit store, or contract mutation is introduced.
