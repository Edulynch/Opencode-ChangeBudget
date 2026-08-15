# Quickstart: SPEC-001 Validation Guide

This guide validates the complete SPEC-001 lifecycle without implementing enforcement features beyond this spec.

## Prerequisites

- Local Git repository available.
- Node.js 20+ and the future ChangeBudget CLI entrypoint available in PATH or runnable from project workspace.
- Feature docs: `specs/001-change-contract-lifecycle/spec.md`
- Data model: `data-model.md`
- CLI command contract: `contracts/cli-command-contract.md`

## Scenario 1 — Initialize

1. In a Git repository, run:
   - `changebudget init`
2. Verify artifacts:
   - `.changebudget/state.json` exists.
   - `.changebudget/contracts/` exists and is empty.
3. Confirm output:
   - success for first init.
   - deterministic output for repeated init (either explicit "already initialized" or stable no-op).

## Scenario 2 — Start a valid contract

1. From initialized state, run:
   - `changebudget start --task "Refactor local CLI helper" --base-revision HEAD --preset tiny`
2. Check that:
   - lifecycle becomes `active`.
   - `.changebudget/contracts/<id>.json` is created.
   - `.changebudget/state.json` has `active_contract_id` set.
3. Run:
   - `changebudget status`
4. Verify status summary includes lifecycle state and contract metadata.

## Scenario 3 — Validation and check

1. Run `changebudget check` in active state.
2. Confirm it validates structure and returns actionable output for the active contract.
3. Provide an intentionally invalid draft file and run:
   - `changebudget check --draft <path>`
4. Confirm it exits non-zero with specific field-level reason text.

## Scenario 4 — Guarded duplicate active contract

1. In active state, run `changebudget start` again.
2. Confirm rejection with explicit error that includes current active contract identity and reason.

## Scenario 5 — Close and recover

1. Run `changebudget close`.
2. Confirm `status` shows no active contract and state transitions to `closed`.
3. Confirm closure metadata is stored on the contract.
4. Re-run `changebudget close` to confirm explicit safe failure.

## Scenario 6 — Non-git environment behavior

1. In a non-Git directory, run `changebudget init`.
2. Confirm command fails with clear error and no partial state files are created.

## Validation references

- Lifecycle behavior references: `contracts/cli-command-contract.md`
- Data shape and transitions: `data-model.md`
- Persistence format: `contracts/persistence-schema.md`
