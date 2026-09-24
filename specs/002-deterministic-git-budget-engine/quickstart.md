# Quickstart: SPEC-002 Validation

Use this guide after implementing SPEC-002 in the checked-out repository.

## Prerequisites

- Node.js 20+
- CLI built and runnable (`npm run compile` then `node dist/src/cli/index.js`)
- Git available in PATH
- Feature docs: `spec.md`, `research.md`, `data-model.md`, `contracts/*`

## Scenario 1 — Budget pass on allowed change

1. In a git repository, run `changebudget init`.
2. Start a contract: `changebudget start --task "Budget check" --base-revision HEAD --max-files 2 --max-changed-lines 40 --allow-paths src/** --deny-paths src/secrets/**`.
3. For the expected PASS below, independently verify that the exact values `max_files=2` and `max_changed_lines=40` are authorized as hard ceilings for this repository/work context, through direct human provision with ceiling intent or trusted policy provenance. The CLI invocation supplies values but does not by itself prove their issuer or intent.
4. Edit one file under `src/` and save.
5. Run `changebudget check`.
6. Validate:
   - exit code `0`
   - status indicates `PASS`
   - `changed_file_count` is `1`
   - path rule result for edited file is `allow`
   - if either numeric value is instead a verified soft estimate, it is not an enforced ceiling; a soft overrun alone is advisory and does not prevent PASS. If material numeric provenance is unresolved, a completed check returns `HUMAN_REVIEW` with status `FAIL` (exit code `2`), not PASS.

## Scenario 2 — File budget violation

1. Keep an active contract with `max_files=1` only when independently verifiable evidence establishes that exact value as a hard ceiling for this repository/work context, through direct human provision with ceiling intent or trusted policy provenance. The field, a CLI flag, persistence, free-text rationale, or a historical check alone does not establish this authority.
2. Edit two tracked files.
3. Run `changebudget check`.
4. Validate:
   - exit code is `1`
   - decision is `REPAIR` and status is `FAIL`
   - output lists a `max_files` hard-ceiling violation with expected count `1` and observed count `2`
   - changed file count is at least `2`
   - if `max_files=1` is a verified soft estimate instead, the overrun is advisory drift, not a violation or `REPAIR` by itself; if its provenance is materially unresolved, a completed check returns `HUMAN_REVIEW` with status `FAIL` (exit code `2`) without inferring a hard-cap violation or PASS

## Scenario 3 — Staged/unstaged/new file coverage

1. Stage one tracked file.
2. Modify another file without staging.
3. Delete one tracked file.
4. Create one untracked file outside ignore rules.
5. Run `changebudget check`.
6. Validate:
   - counted files include all four changes
   - repeated runs keep the same counts and violation IDs when no edits are made

## Scenario 4 — Line budget with mixed edits

1. Set contract `max_changed_lines=9`.
2. Edit one tracked file with `6` added lines and `3` deletions.
3. Run `changebudget check`.
4. Validate:
   - `changed_lines_count` is exactly `9`
   - status is stable across repeated runs

## Scenario 5 — Path policy precedence

1. Set contract `allow_paths=["src/**"]`, `deny_paths=["src/generated/**"]`.
2. Modify one file `src/app.ts` and one file `src/generated/auto.ts`.
3. Run `changebudget check`.
4. Validate:
   - deny target is listed as violation even if it matches allow
   - generated file status is `deny`

## Scenario 6 — Rename/delete and binary stability

1. Rename one tracked file to a new path and change file content.
2. Delete one tracked file.
3. Modify one binary file.
4. Run `changebudget check`.
5. Validate:
   - deterministic output includes rename event and delete event representation
   - binary change counted in `binary_change_count` and contributes to file budget path count
   - line contribution for binary path follows deterministic non-text policy

## Scenario 7 — Draft-only evaluation

1. Create `draft.json` with a valid contract payload and a known `base_revision`.
2. Run `changebudget check --draft draft.json`.
3. Validate:
   - command resolves draft and returns a check result.
   - active lifecycle state is unchanged after execution.

## Scenario 8 — Deterministic error modes

1. Run `changebudget check` in a non-git directory.
2. Validate output failure is deterministic non-pass and does not claim pass.
3. Create active contract with invalid `base_revision` and run check from repo.
4. Confirm output includes the revision and the reason (`missing/unreachable/not-a-commit`) every time.

## Scenario 9 — Unreachable base revision

1. Set `base_revision` to a non-existent hash.
2. Run `changebudget check`.
3. Validate:
   - non-zero exit code
   - explicit safe message includes the invalid reference
   - no state mutation occurs in `.changebudget/`

## Scenario 10 — Duplicate execution stability

1. Run `changebudget check` twice with no working tree changes.
2. Capture the required summary fields from both outputs.
3. Validate byte-level match for key metrics (`changed_file_count`, `changed_lines_count`, violation ids).
