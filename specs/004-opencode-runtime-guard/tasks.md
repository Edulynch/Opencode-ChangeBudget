# Tasks: OpenCode V2 Runtime Guard

## Setup and model

- [x] Pin `@opencode/plugin@2.0.12` and compile the isolated plugin package.
- [x] Define runtime policy/action types and stable rule constants.
- [x] Implement deterministic projection for passive, repair, review, path, sensitivity, and unresolved cases.
- [x] Implement target normalization and mutation-intent inference.
- [x] Load lifecycle state, active contracts, and existing execution-gate decisions.

## Native V2 runtime

- [x] Export `Plugin.define({ id: 'changebudget', setup })`.
- [x] Register the `session.context` hook and inject deterministic workflow guidance once.
- [x] Register the `permission.evaluate` hook and evaluate every resource.
- [x] Aggregate permission outcomes restrictively and preserve incoming denies.
- [x] Normalize explicit structured material decisions from permission metadata only.
- [x] Fail safely on corrupt state, missing contracts, evaluator failures, and unresolved mutations.

## Verification

- [x] Cover the projection truth table and stable rule identifiers.
- [x] Import the generated wrapper from disposable repositories and verify native hook names.
- [x] Cover passive allow, in-scope allow, out-of-scope ask, protected-path denial, sensitive asks, restrictive aggregation, and malformed state.
- [x] Verify core CLI behavior, baseline legacy modes, and explicit structured execution-gate decisions remain unchanged.
- [x] Build and typecheck both root and plugin projects.
