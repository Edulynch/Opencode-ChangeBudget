# Quickstart: SPEC-005 Personal Stack Policies

Use this guide after implementing the feature changes in this folder.

## Prerequisites

- Node.js 20+ and this repository dependencies installed
- Git available in PATH
- CLI build completed with `npm run build` (entrypoint: `node dist/src/cli/index.js`)
- Feature artifacts: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `tasks.md`

## Scenario 1 — Start with a stack profile

1. Initialize a test repository and run:
   - `changebudget init`
2. Start a contract with a supported profile:
   - `changebudget start --task "Add profile" --base-revision HEAD --stack-profile node-ts --max-files 10 --max-changed-lines 100`
3. Verify lifecycle state:
   - `status` prints an active contract
   - `.changebudget/contracts/<id>.json` contains `stack_profile`

## Scenario 2 — Discoverability in default CLI output

1. Start with explicit per-rule disables:
   - `changebudget start --task "Disable one rule" --base-revision HEAD --stack-profile node-ts --disable-stack-rule node-ts/public-api`
2. Run:
   - `changebudget check`
3. Verify default output includes:
   - `Stack profile: node-ts`
   - `Stack rule status:`
   - `  - node-ts/configuration: active`
   - `  - node-ts/public-api: disabled`

## Scenario 3 — Status budget discoverability

1. Create `.changebudget/stack-policy-overrides.json`:

```json
{
  "profiles": {
    "node-ts": {
      "disable_rule_ids": ["node-ts/public-api"]
    }
  }
}
```

2. Start a node-ts contract and run:
   - `changebudget status --budget`
3. Verify default output includes:
   - `Budget report for active contract:`
   - `Stack profile: node-ts`
   - `  - node-ts/public-api: overridden`

## Scenario 4 — FR-013 start-time validation hardening

1. Attempt invalid `--stack-profile` and invalid disable configuration without a valid match:
   - `changebudget start --task "Invalid profile" --base-revision HEAD --stack-profile unknown-stack`
   - `changebudget start --task "Cross profile disable" --base-revision HEAD --stack-profile android --disable-stack-rule flutter/configuration`
2. Confirm each command fails with an `InputValidationError` and no contract transition occurs.
3. Add an override with a non-existent disable rule:

```json
{
  "profiles": {
    "android": {
      "disable_rule_ids": ["android/not-a-real-rule"]
    }
  }
}
```

4. Confirm:
   - `changebudget start --task "Invalid override" --base-revision HEAD --stack-profile android`
   - still fails before contract write with `InputValidationError`

## Scenario 5 — Rule activation controls are profile aware

1. Add a repository rule in `.changebudget/stack-policy-overrides.json` for the selected profile.
2. Start the matching profile contract.
3. Modify a matching path in the repository and run `changebudget check`.
4. Verify check reason codes include the effective `CBS-*` code and `stackPolicySummary.effectiveRuleIds` output reflects added/disabled overrides.

## Validation checklist

- `start` accepts supported values: `android`, `flutter`, `spring-boot`, `node-ts`.
- default `check` and `status --budget` output clearly print stack profile + per-rule status.
- start-time failures for unknown profile and unknown/invalid disabled rule ids are deterministic.
- repository override files are resolved only for the active profile and do not leak across repositories.
