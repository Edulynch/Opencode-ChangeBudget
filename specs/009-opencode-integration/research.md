# Research: Native OpenCode V2 Integration Decisions

## R-1 — Native plugin API

**Decision:** use `@opencode/plugin@2.0.12` and `Plugin.define({ id, setup })`.

**Reason:** OpenCode V2 loads local plugins automatically and provides typed registration domains on the setup context. No compatibility layer is needed.

## R-2 — Hook surface

**Decision:** register `ctx.session.hook('context', ...)` and `ctx.permission.hook('evaluate', ...)`.

The context hook adds deterministic workflow guidance to the model request. The permission hook is the single policy boundary and receives all resources for one evaluation.

No tool pre-execution, command pre-execution, server callback, or pseudo-handoff transport is used.

## R-3 — Permission aggregation

Each permission resource is evaluated independently. Results are combined with the strict ordering `deny > ask > allow`, and an incoming restrictive effect is never weakened. The internal projection action `block` maps to the V2 effect `deny`.

## R-4 — Wrapper loading

The project wrapper is the only managed resource. It re-exports the compiled default plugin through a URL produced by Node `pathToFileURL()`. This handles Windows drives, spaces, Unicode, UNC paths, and POSIX paths without manual path rewriting.

## R-5 — Ownership and refresh

The first-line marker distinguishes ChangeBudget content from user content. Exact content comparison yields `MISSING`, `MANAGED_CURRENT`, `MANAGED_STALE`, or `CONFLICT`. There is no integration manifest, version discriminator, migration state, or fallback path.

## R-6 — Project isolation

The CLI does not create or edit `opencode.json`, instruction files, `AGENTS.md`, global configuration, or `.changebudget/**`. Preflight validates the compiled plugin and wrapper ownership before any write.

## R-7 — Structured decisions

Explicit structured material decisions continue through permission metadata normalization, the existing evaluator, and the execution-gate projection. Ordinary permission requests use an absent decision; the plugin does not fabricate one. Existing baseline legacy modes remain core-domain behavior and are not integration states.
