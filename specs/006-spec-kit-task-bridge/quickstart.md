# Quickstart: SPEC-006 — Spec-Kit Task Bridge

Runnable validation scenarios proving the bridge end-to-end. These are verification steps for the implementation phase; contract details live in [`contracts/`](contracts/), model details in [`data-model.md`](data-model.md).

## Prerequisites

- Repository with a Git repo and `changebudget` built: `npm run build`
- Two disposable fixture repos per scenario (temp dirs, reset/removed after).
- A Git seed commit exists before `init`/`start`.

Fixtures (create before each scenario):

```
specs/006-example-feature/tasks.md:
  - [ ] T031 Implement task bridge [budget:tiny]
  - [x] T030 Sign off baseline
specs/007-other/tasks.md:
  - [ ] T031 Implement task bridge (duplicate copy)
  - [ ] T999 Unique task
```

Invoke the CLI like the acceptance harness does: `node dist/src/cli/index.js <command> [args]` from the fixture root.

## Scenario 1 — Fast path lifecycle (SC-001, SC-006, FR-014)

```text
changebudget init
changebudget start T031 --tiny
changebudget status
#   Task: T031
#   Source: specs/006-example-feature/tasks.md
#   Task description states "Implement task bridge", preset tiny
# edit/commit a change in an allow list, then:
changebudget check --json
#   payload.task.id == "T031", .source_path == "specs/006-example-feature/tasks.md"
changebudget close --actor quickstart --reason r1
#   "Task: T031"
#   "Source: specs/006-example-feature/tasks.md"
```

**Expected**: task ID, title, source feature, and source path retained and reported identically at every stage; no Spec-Kit ceremony; exit 0.

## Scenario 2 — Unknown task ID (SC-002, FR-003)

```text
changebudget init
changebudget start T999 --tiny   # T999 absent from fixtures above
#   InputValidationError: ... not found ... (scanned specs/...)
echo $LASTEXITCODE   # 2
git status --short .changebudget   # byte-identical to before the command
```

**Expected**: fixed error naming scanned sources; no contract or lifecycle state written.

## Scenario 3 — Ambiguous task ID (SC-003, FR-004)

```text
changebudget init
changebudget start T031 --tiny
#   InputValidationError: ... ambiguous ... lists both
#     specs/006-example-feature/tasks.md
#     specs/007-other/tasks.md
echo $LASTEXITCODE   # 2
git status --short .changebudget   # unchanged
```

**Expected**: deterministic ambiguity error listing every source; zero guesses; no `.specify/feature.json` consulted.

## Scenario 4 — Budget default precedence (FR-011, FR-012)

```text
changebudget init
changebudget start T031            # T031 has [budget:tiny]; no CLI flag
# preset == tiny
changebudget close --actor quickstart --reason r2
changebudget start T031 --normal   # explicit CLI wins
# preset == normal (annotation ignored)
changebudget close --actor quickstart --reason r3
changebudget start T031 --preset normal  # same as --normal
changebudget close --actor quickstart --reason r4
changebudget start T031 --preset tiny --tiny
#   InputValidationError (mutually exclusive), exit 2
```

Fixture variant — invalid annotation (`- [ ] T032 x [budget:custom] Start`):

```text
changebudget start T032
#   InputValidationError before any contract is written, exit 2
changebudget start T032 --tiny
#   OK: CLI wins; annotation ignored
```

**Expected**: precedence and mutual-exclusion per the contract.

## Scenario 5 — No-Spec-Kit backward compatibility (SC-004, FR-016)

In a repo with no `specs/` directory:

```text
changebudget init
changebudget start --task "manual task"
changebudget status
#   Task: manual task   (existing line, no Task ID/Source lines)
changebudget check --json
#   no "task" key in the payload
changebudget close --actor quickstart --reason r5
#   "Contract closed." only
```

**Expected**: human output, JSON payloads, and persisted contract byte-identical to the SPEC-001..005 baseline (assert via the existing unit/integration suites plus a byte-compare fixture).

## Scenario 6 — Read-only guarantee (SC-005, FR-013)

```text
git status --short | sha256sum        # record
sha256sum specs/006-example-feature/tasks.md   # record
changebudget init
changebudget start T031 --tiny
git status --short | sha256sum        # identical
sha256sum specs/006-example-feature/tasks.md   # identical
```

**Expected**: working tree and `tasks.md` bytes unchanged; no task marked complete; no Spec-Kit command invoked.

## Scenario 7 — Lifecycle rules still enforced (US edge case)

```text
changebudget start T031 --tiny
changebudget start T999 --tiny    # active contract exists → StateConflictError unchanged
echo $LASTEXITCODE   # 3
```

**Expected**: task resolution does not bypass existing lifecycle guards (spec edge case, FR-007).

## Gates

- Full suite: `npm test` (build + all unit/integration/acceptance tests) green.
- Acceptance metrics: `tests/acceptance/spec006-task-bridge-metrics.test.ts` writes `specs/006-spec-kit-task-bridge/acceptance-metrics.md`; SC-001..SC-006 must PASS.
- Resolution errors and output orderings run twice → identical bytes (FR-017).