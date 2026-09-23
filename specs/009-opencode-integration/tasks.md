# Tasks: Native OpenCode V2 Integration

All tasks use disposable repositories for project operations. The integration manages exactly one resource: `.opencode/plugins/changebudget.js`.

## Core integration

- [x] Define the single managed path, ownership states, resource actions, and result model.
- [x] Resolve the compiled plugin entry and generate a Windows-safe `file://` URL.
- [x] Implement exact marker ownership detection and deterministic wrapper generation.
- [x] Implement preflight, install, dry-run, remove, Git baseline warning, and wrapper discovery.
- [x] Remove obsolete configuration, instruction, profile, and compatibility modules.

## Native V2 plugin

- [x] Pin `@opencode/plugin@2.0.12` and build the plugin with strict TypeScript settings.
- [x] Replace the old entry shape with `Plugin.define({ id: 'changebudget', setup })`.
- [x] Register `session.context` for deterministic workflow context.
- [x] Register `permission.evaluate` for lifecycle policy projection.
- [x] Aggregate every permission resource restrictively and preserve incoming denies.
- [x] Route explicit structured material decisions through normalization and the existing evaluator.
- [x] Fail safely on malformed state, unresolved mutation targets, and evaluator errors.

## Validation

- [x] Convert unit, integration, acceptance, update-refresh, and tagged-install tests to the one-resource V2 contract.
- [x] Add wrapper import and native hook registration coverage.
- [x] Add restrictive aggregation and malformed-state coverage.
- [x] Update README, quickstarts, contracts, command metadata, CI/package checks, and smoke harness.
- [x] Rebuild tracked runtime artifacts and remove stale generated modules.
- [ ] Run the final release gate after the working tree is reviewed; do not commit or publish as part of this task.
