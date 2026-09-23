# Quickstart: Native OpenCode V2 Integration

## Prerequisites

```bash
npm install
npm run compile
```

OpenCode V2 automatically loads plugins from `.opencode/plugins/`.

## Scenario 1 — Install

From a disposable Git repository:

```bash
changebudget integrate opencode
```

Expected: `.opencode/plugins/changebudget.js` is `CREATE`, the result is `READY`, and a baseline warning asks the user to commit the wrapper. No `opencode.json` or instruction file is created.

## Scenario 2 — Preserve user files

Create user-owned `opencode.json`, instruction files, and `AGENTS.md`, then run the command.

Expected: every user file is byte-identical; only the marked plugin wrapper is added.

## Scenario 3 — Idempotence and stale repair

```bash
changebudget integrate opencode
changebudget integrate opencode
```

Expected: the second run reports `UNCHANGED`. Replacing only the marked wrapper URL with an old URL makes the next run report `UPDATE` for the wrapper and nothing else.

## Scenario 4 — Dry-run and conflict

```bash
changebudget integrate opencode --dry-run
```

Expected: the planned wrapper action is reported and no bytes change. A user-owned file at `.opencode/plugins/changebudget.js` reports `CONFLICT` and is never overwritten.

## Scenario 5 — Removal

```bash
changebudget integrate opencode --remove
```

Expected: only the marked wrapper is removed. A second removal reports `ABSENT`; unrelated plugins, configuration, instruction files, and `AGENTS.md` survive.

## Scenario 6 — Native runtime smoke

Import the generated wrapper and provide a test context with `session.hook` and `permission.hook`.

Expected registrations are exactly `context` and `evaluate`. The session hook injects ChangeBudget context once, while permission effects aggregate as `deny > ask > allow`.

## Scenario 7 — Core lifecycle remains independent

With the plugin absent or disabled, run `changebudget status`, `changebudget check`, and the execution-gate tests. Existing baseline legacy modes and explicit structured material decisions remain unchanged.

## Final gate

```bash
npm run compile
npm run typecheck
npm test
```
