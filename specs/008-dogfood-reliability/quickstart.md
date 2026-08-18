# Quickstart: SPEC-008 Reliability Validation

**Branch**: `008-dogfood-reliability` | **Date**: 2026-08-18 | **Spec**: [spec.md](spec.md) | **Contracts**: [contracts/reliability-guarantees.md](contracts/reliability-guarantees.md)

Controlled reliability scenarios for the v1.0 gate. **All fixtures are disposable dummy Git repositories created in temporary directories.** No existing personal/work repository is touched (Constitution XIII; spec.md assumptions).

## Prerequisites

```bash
npm install
npm run build
```

## Scenario 1 — Lifecycle failure matrix (FR-001..FR-003, SC-001)

Verify with a disposable repo that failed writes never destroy previous state and failures are recoverable (automated in `tests/integration/lifecycle-init-start-status-check.spec.ts` + the SPEC-008 acceptance suite; the manual probes below use a deterministic injection artifact if available, otherwise the injected-EPERM seam described in `research.md` R-1):

```bash
TMP=$(mktemp -d) && cd "$TMP" && git init -q
# init
changebudget init
# start succeeds; simulate a failed state.json write (locked/EPERM) during close
# In automatic runs this is injected via the state-write seam.
# Expected: a documented error, previous state.json intact byte-for-byte,
#           re-running "changebudget close" completes and state becomes "closed".
```

**Expected outcomes**: previously-valid files preserved; orphaned/unreferenced contracts removed on next `start`; closed-contract vs active-state mismatch reported with an actionable message and reconciled by re-running `close`.

## Scenario 2 — Observational commands are read-only (FR-014, SC-002)

```bash
cd "$TMP"
sha256sum .changebudget/state.json .changebudget/contracts/*.json > before.txt
changebudget status; changebudget status --budget; changebudget check; changebudget diagnose --allow-path "src/**"
sha256sum .changebudget/state.json .changebudget/contracts/*.json > after.txt
git status --porcelain > gitstate.txt
```

**Expected**: `before.txt == after.txt`; `gitstate.txt` reflects only user edits; `diagnose` leaves `.changebudget/**` and repository files byte-identical.

## Scenario 3 — Deterministic outputs and errors (FR-005..FR-007, SC-003)

Run each command twice on the same (including corrupt) state; diff outputs and record exit codes:

```bash
changebudget status > s1.txt; changebudget status > s2.txt; diff s1.txt s2.txt
# corrupt .changebudget/state.json, then:
changebudget status; changebudget status --budget; changebudget check   # same error, same exit code
```

**Expected**: byte-identical outputs across runs; identical corruption diagnosis and exit across `status`/`status --budget`/`check`.

## Scenario 4 — Budget correctness and byte-stability (FR-008..FR-012, SC-003)

Disposable repo with: a partially staged file, a renamed directory, a filename containing literal ` => `, an untracked binary, and non-ASCII paths:

```bash
# expected: changed-line totals match a single diff vs base (no double-count)
# expected: renames report correct old/new paths (no phantom paths)
# expected: untracked binary is classified binary on Windows
# expected: identical human+JSON check/status output across runs and locales
```

## Scenario 5 — OpenCode-independent and Spec-Kit-independent operation (FR-013/FR-014, SC-005/SC-006)

```bash
# without OpenCode plugin: full init→start→edit→check→close cycle works
# without specs/ directory: lifecycle + diagnose work identically
# empty repo: init succeeds; start/check/diagnose produce documented deterministic errors
# detached HEAD with valid base: lifecycle behaves like the branch case
# repo path containing spaces: all commands behave identically
```

## Scenario 6 — Plugin degraded decisions (FR-015/FR-016, SC-003)

Load the plugin into the hook harness with: missing state, malformed state, active contract whose file is missing, unresolvable target path, and a long sequence of asks.

**Expected**: the hook always completes with a documented decision (never throws); retained context memory stays bounded.

## Scenario 7 — Stack-policy robustness (FR-017/FR-018, SC-003/SC-007)

```bash
# malformed .changebudget/stack-policy-overrides.json → deterministic actionable error, documented exit
# unknown/duplicate rule IDs → deterministic error (no internal crash)
# valid overrides + contract disables still work (SPEC-005 semantics unchanged)
# Maven pom.xml version-only edit still triggers review → ACCEPTED_LIMITATION A-05 (not a defect)
```

## Final gate

```bash
npm run build && npm run typecheck && npm test
```

**Expected**: full suite green (SC-007, existing 245/245 + SPEC-008 additions), SPEC-008 acceptance metrics recorded (SC-001..SC-008), BLOCKER count 0, MUST_FIX count 0.

## Manual dogfood gate (user opt-in, not automated)

Real-project self-hosting ("use ChangeBudget to develop ChangeBudget") is an explicit, manual, user-opt-in gate. It is never an automated test and never touches other existing user repositories (spec.md assumptions).