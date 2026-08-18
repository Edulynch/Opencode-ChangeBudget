# Quickstart: SPEC-007 — Diagnose & Budget Advisor

Runnable validation scenarios proving the advisor end-to-end. These are verification steps for the implementation phase; contract details live in [`contracts/`](contracts/), model details in [`data-model.md`](data-model.md).

## Prerequisites

- Repository with a Git repo and `changebudget` built: `npm run build`
- Disposable fixture repos per scenario (temp dirs, reset/removed after) — one Git seed commit exists before each run.
- Invoke the CLI like the acceptance harness does: `node dist/src/cli/index.js diagnose [args]` from the fixture root.

## Scenario 1 — Structural recommendation on declared paths (SC-001, FR-008)

Fixture: a repo with a small `src/ui/` area (say 4 tracked files).

```text
changebudget diagnose --allow-path "src/ui/**"
#   Recommendation: tiny
#   Source: inferred
#   Reasons:
#     - declared_paths: 1
#     - tracked_files: 4
echo $LASTEXITCODE   # 0
```

**Expected**: outcome follows rule 4 (`N ≤ 5 && P ≤ 2 && C empty`). Add a second declared path (`tests/ui/**`) with more tracked files to observe rule 5 (`normal`) and rule 6 (`free`).

## Scenario 2 — Manual review on missing evidence (SC-004, FR-009)

```text
changebudget diagnose
#   Recommendation: manual review
#   Source: inferred
#   Reasons:
#     - declared_paths: 0
echo $LASTEXITCODE   # 0
```

Prose-only variant:

```text
changebudget diagnose --task "Refactor the auth module"
#   Recommendation: manual review   (prose never interpreted)
```

**Expected**: `manual review`, never a fabricated default; exit 0.

## Scenario 3 — Spec-Kit task + explicit annotation precedence (SC-001, FR-004, FR-007)

Fixture: repo with `specs/007-example-feature/tasks.md`:

```
- [ ] T031 [budget:tiny] Implement task bridge
```

```text
changebudget diagnose T031
#   Recommendation: tiny
#   Source: explicit
#   Reasons:
#     - task_id: T031
#     - task_budget_default: tiny
```

Now with conflicting scope (paths that would normally imply `normal`):

```text
changebudget diagnose T031 --allow-path "src/ui/**" --allow-path "tests/**" --allow-path "misc/**"
#   Recommendation: tiny        # explicit annotation still wins
#   Source: explicit
```

Invalid-annotation variant (`- [ ] T032 [budget:custom] Start`):

```text
changebudget diagnose T032 --allow-path "src/ui/**"
#   Recommendation: normal or free per table; never "custom"; [budget:custom] ignored
```

Unknown/ambiguous task ID variant:

```text
changebudget diagnose T999
#   InputValidationError: deterministic SPEC-006 not-found error
echo $LASTEXITCODE   # 2
```

**Expected**: explicit annotation dominates; invalid annotation treated as absent; resolution failures reuse SPEC-006 behavior; no `.specify/feature.json` read.

## Scenario 4 — Stack-profile-sensitive manual review (FR-006, FR-015, decision rule 3)

Fixture: a Spring Boot repo; declared paths match a migration area under profile `spring-boot`.

```text
changebudget diagnose --stack-profile spring-boot --allow-path "src/main/resources/db/changelog/**"
#   Recommendation: manual review
#   Reasons:
#     - declared_paths: 1
#     - tracked_files: 3
#     - sensitive_category: migrations
```

No-profile variant (no automatic stack detection):

```text
changebudget diagnose --allow-path "src/main/resources/db/changelog/**"
#   Recommendation: tiny          # C empty; only structural signals used
```

**Expected**: rule 3 triggers `manual review` on migrations/release_artifacts categories; without a profile, categories are never assumed.

## Scenario 5 — No-Spec-Kit, no-stack backward compatibility (SC-005, FR-013)

In a repo with no `specs/` and no profile:

```text
changebudget diagnose --allow-path "src/**"
#   deterministic recommendation from structural evidence or manual review
git status --short   # unchanged
```

**Expected**: `diagnose` works with no Spec-Kit and no stack profile; existing SPEC-001..006 suites unchanged.

## Scenario 6 — Byte-stability and zero mutation (SC-002, SC-003)

```text
git status --short | sha256sum
changebudget diagnose --allow-path "src/ui/**"   > out1.txt
changebudget diagnose --allow-path "src/ui/**"   > out2.txt
cmp out1.txt out2.txt        # identical (human)
changebudget diagnose --allow-path "src/ui/**" --json > j1.json
changebudget diagnose --allow-path "src/ui/**" --json > j2.json
cmp j1.json j2.json          # identical (JSON)
git status --short | sha256sum   # identical to the first hash
```

**Expected**: repeated runs byte-identical; working tree, `.changebudget/**`, and any `tasks.md` bytes unchanged.

## Scenario 7 — Active-contract and working-tree independence (FR-011)

In a repo with an active contract and uncommitted changes:

```text
changebudget diagnose --allow-path "src/ui/**"
changebudget diagnose --allow-path "src/ui/**"
#   identical output; no lifecycle read; exit 0
git status --short   # unchanged (diff ignored as evidence, nothing staged)
```

**Expected**: `diagnose` never fails/blocks on lifecycle state and never touches contract/diff state.

## Gates

- Full suite: `npm test` (build + all unit/integration/acceptance tests) green.
- Acceptance metrics: `tests/acceptance/spec007-diagnose-metrics.test.ts` writes `specs/007-diagnose-budget-advisor/acceptance-metrics.md`; SC-001..SC-006 must PASS.
- All scenarios run in disposable dummy repos only (SC-006 reference classification uses identical signals; automated gate never touches real projects).