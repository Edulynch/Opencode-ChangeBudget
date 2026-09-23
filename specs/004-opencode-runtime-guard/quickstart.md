# Quickstart: OpenCode V2 Runtime Guard

## Prerequisites

- Node.js 20+
- `npm run compile`
- OpenCode V2 with the project wrapper installed by `changebudget integrate opencode`
- A repository initialized with ChangeBudget when testing contract enforcement

## Scenario 1 — Passive mode

In a repository without `.changebudget/`, start OpenCode V2 and trigger a write. The permission effect is `allow`, no policy context is injected from state, and no plugin-owned persistence is created.

## Scenario 2 — Initialized repository without an active contract

Run `changebudget init` without starting a contract, then trigger a mutation. The effect is `deny` with `OCG-UNRESOLVED-MUTATION`. Repeating the operation produces the same result.

## Scenario 3 — Path rules

Start a contract with `allow_paths: ["src/**"]` and `deny_paths: ["config/**"]`.

- `src/app.ts` projects to `allow` when no other restriction applies.
- `config/ci.yml` projects to `deny`.
- `tests/contract.spec.ts` projects to `ask`.

Cancelling an ask does not persist an exception; the next attempt is evaluated again.

## Scenario 4 — Sensitive categories and protected state

With dependency, migration, configuration, and public-API toggles disabled, matching deterministic targets project to `ask`. Any mutation under `.changebudget/**` projects to `deny`.

## Scenario 5 — Restrictive aggregation

Submit a V2 permission request containing multiple resources. Verify all resources are evaluated and the final effect follows `deny > ask > allow`. An incoming `deny` remains `deny`.

## Scenario 6 — Explicit structured material decision

Provide a valid structured `materialDecision` in permission metadata. Verify it reaches the existing execution-gate evaluator. Remove the metadata and verify ordinary evaluation fabricates no decision.

## Scenario 7 — Failure isolation

Corrupt lifecycle state or use an unresolved mutation target in an initialized repository. Verify the hook returns a safe `deny` and does not modify `.changebudget/**`.

## Scenario 8 — Core CLI independence

With the wrapper absent, run `changebudget status`, `changebudget check`, and execution-gate tests. Existing outputs, baseline legacy modes, and explicit structured decisions remain unchanged.

## Validation

```bash
npm run compile
npm run typecheck
npm test
```
