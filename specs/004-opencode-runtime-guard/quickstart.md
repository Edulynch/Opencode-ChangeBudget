# Quickstart: SPEC-004 Runtime Guard

Use this guide when implementing and manually validating SPEC-004 behavior.

## Prerequisites

- Node.js 20+
- `npm run build` completed for ChangeBudget core (CLI path not changed)
- OpenCode environment capable of loading local plugins
- OpenCode-enabled repository with ChangeBudget initialized
- Active contract and `.changebudget/contracts/<id>.json`

## Scenario 1 — No policy context in non-initialized repos

1. In a repository without `.changebudget/`, start an OpenCode session.
2. Trigger a file write action from OpenCode.
3. Verify:
   - No policy decision is injected.
   - Operation remains allowed for normal flow.
   - No local runtime persistence changes are produced by the plugin.

## Scenario 1A — Initialized repository without active contract

1. Start with a repository and run `changebudget init` (do not start a contract).
2. Trigger a mutating file action from OpenCode.
3. Verify:
   - Decision is `runtimeAction = block`.
   - `rule` shows unresolved context/fail-safe behavior (`OCG-UNRESOLVED-MUTATION`).
   - Mutation is stopped even though no malformed contract is present.
4. Manually ensure mutating behavior is deterministic by repeating the same action and confirming the same decision.

## Scenario 2 — Deny path blocks before write

1. Initialize and start a contract with:
   - `allow_paths: ["src/**"]`
   - `deny_paths: ["config/**", "secrets/**"]`
2. Attempt to modify `config/ci.yml` in OpenCode.
3. Verify:
   - Decision is `runtimeAction = block`.
   - `rule` indicates path deny.
   - The action is stopped before the file changes.

## Scenario 3 — Allow scope permits writes

1. Keep same contract and try to modify `src/app.ts`.
2. Verify:
   - Decision is `runtimeAction = allow`.
   - No persistent state change occurs in ChangeBudget state.

## Scenario 4 — Out-of-scope asks for explicit review

1. Keep `allow_paths: ["src/**"]` and empty `deny_paths`.
2. Attempt to modify `tests/contract.spec.ts`.
3. Verify:
   - Decision is `runtimeAction = ask`.
   - Metadata includes `reason` and a one-line recommendation.
4. Cancel the prompt, then re-run the same operation.
5. Verify:
   - second attempt still prompts again and does not inherit the first outcome.

## Scenario 5 — Sensitive-category asks and hard denies

1. Set:
   - `allow_new_dependencies = false`
   - `allow_migrations = false`
   - `allow_config_changes = false`
   - `allow_public_api_changes = false`
2. Attempt dependency/configuration or migration-related write operations exposed by OpenCode.
3. Verify:
   - Decision is `runtimeAction = ask` where category matches and operation context is deterministic.
4. Verify `.changebudget/**` is blocked:
   - Attempt to modify `.changebudget/state.json`.
   - Decision is `runtimeAction = block`.

## Scenario 6 — REPAIR/close posture behavior

1. Start a contract state that would cause `policyDecision = REPAIR` for current repo diff.
2. Trigger a mutating OpenCode action.
3. Verify:
   - Decision is `runtimeAction = block`.
4. Verify read-only action (for example command-only introspection) remains non-blocking unless marked unsafe.

## Scenario 7 — Unknown mutating target falls back to block

1. In an initialized repository, invoke a shell/tool path that writes but is not reliably parseable by the evaluator.
2. Verify:
   - Decision is deterministic and is `block`.
   - Non-mutating operation classes continue with `allow`.

## Scenario 8 — Core CLI unchanged

1. While OpenCode plugin is disabled, run:
   - `changebudget status`
   - `changebudget check`
2. Verify outputs and exit behavior are the same as SPEC-003 style before this feature work.

### Focused execution checklist (T027)

1. In an initialized repo, leave OpenCode plugin out of the execution path (plugin directory absent or not loaded).
2. Run:
   - `changebudget status`
   - `changebudget check`
   - `changebudget check --json`
   - `changebudget status --json --budget`
3. Verify each command exits with the same status code you expect from pre-004 behavior for the same repo state.
4. Verify none of the commands require `.opencode`, `opencode-plugin`, or plugin metadata to execute.

## Validation Signals

- Decision text appears inline during session.
- No file mutation by the plugin into `.changebudget` from prompts alone.
- Repeated identical operation contexts produce consistent results.
