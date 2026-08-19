# Feature Specification: Dogfood, Reliability & Personal v1.0 (SPEC-008)

**Feature Branch**: `008-dogfood-reliability`

**Created**: 2026-08-18

**Status**: Draft

**Input**: User description: "Implement the final roadmap milestone: SPEC-008 — Dogfood, Reliability & Personal v1.0 ... a HARDENING milestone"

## Problem Statement

ChangeBudget (SPEC-001 through SPEC-007) is feature-complete and CONVERGED. Every capability — contract lifecycle, deterministic Git budget engine, decisions/exit codes, OpenCode runtime guard, stack policies, Spec-Kit task bridge, and the diagnose advisor — has passing unit, integration, and acceptance suites (245/245 on master).

SPEC-008 converts that feature set into a trustworthy personal v1.0 tool. It is strictly a **hardening** milestone: it stabilizes proven reliability gaps discovered by an evidence-based inspection of the shipped implementation, and it defines the measurable gate for daily personal use. It does **not** add a new product feature family.

### Evidence basis

This specification is grounded in a code-level inspection of the converged implementation:

- `src/core/state/*` and lifecycle commands `init`/`start`/`status`/`check`/`close`
- `src/core/git/repo.ts`, `src/core/check/diff.ts`, `src/core/check/rules.ts`, `src/core/check/patterns.ts`, `src/core/check/stack-policy.ts`
- `src/core/spec-kit/tasks.ts`, `src/core/diagnose/*`, `src/cli/*`, `src/models/*`
- `opencode-plugin/src/*`
- Existing unit/integration/acceptance suites and prior acceptance metrics

Findings below are recorded with the hardening classification defined in **Requirements**; the concrete evidence (file locations and observed behavior) is listed in **Findings Register**.

## User Scenarios & Testing

Stories are prioritized by impact on daily personal reliability.

### User Story 1 - A failed lifecycle operation never destroys or strands state (Priority: P1)

As a user, when `init`, `start`, or `close` fails midway (e.g., a file cannot be written because it is temporarily locked), I expect no previously-valid ChangeBudget state or contract to be lost, and no incoherent "half-applied" state to be left behind. If a partial write ever survives, the next command run must recover or report it deterministically — never silently.

**Why this priority**: State/contract loss is the highest-severity risk the inspection found. A specific non-atomic fallback path can delete a previously-valid state or contract file before replacement succeeds (`src/core/state/state.ts`), and `start`/`close` persist two files that are not updated as a unit (`src/cli/commands/start.ts`, `src/cli/commands/close.ts`), producing orphaned or incoherent persisted state on mid-command failure.

**Independent Test**: Fully testable with disposable dummy repositories where a controlled write failure is injected at each persistence point: assert the previously-valid file is intact (byte-identical), the CLI exits with a documented error, and a rerun of the same command succeeds or deterministically reports/reconciles.

**Acceptance Scenarios**:

1. **Given** a repository with a valid active contract, **When** the state write during `close` is made to fail once, **Then** no previously-valid file is deleted, a documented error is emitted, and re-running `close` deterministically completes without duplicating or corrupting the contract.
2. **Given** an initialized repository, **When** a `start` write fails midway, **Then** no orphaned contract is silently left referenced, and the retried `start` behaves exactly like a fresh `start`.

### User Story 2 - The same broken state gives the same actionable answer everywhere (Priority: P1)

As a user or script writer, when local state is corrupt or inconsistent, I expect the same diagnosis, severity, and exit code from every command that reads it. I expect actionable messages and no silent swallowing of corruption, regardless of which command I run.

**Why this priority**: The inspection found the same corruption produces different exit codes per command (`status` hard-fails with environment code while `check` and `status --budget` soft-fail with a review code), one read path silently swallows any error, and one missing-file check relies on string-matching OS error text. That is a deterministic-output risk for scripts and hides real damage.

**Independent Test**: Testable with disposable dummy repositories whose `.changebudget/state.json` or contract file is deliberately malformed: assert byte-identical error output and identical exit code across `status`, `status --budget`, and `check`.

**Acceptance Scenarios**:

1. **Given** a repository whose active contract file is corrupt, **When** `status`, `status --budget`, and `check` are each run, **Then** all three emit the same deterministic actionable corruption error and the same exit code.
2. **Given** a repository whose `last_closed_contract_id` points at a corrupt or missing file, **When** `status` runs, **Then** the corruption is surfaced consistently — never silently ignored.

### User Story 3 - Budget results are correct, stable, and reproducible (Priority: P1)

As a user, when a file is partially staged, or files are renamed, or the repository uses unusual names, I expect the reported changed-file and changed-line totals and renames to reflect the true diff against the base revision, and I expect byte-identical output for equivalent input on every machine — including Windows.

**Why this priority**: The inspection found concrete correctness defects with direct budget impact: staged+unstaged lines of the same file are counted twice (systematic over-reporting against `max_changed_lines`), directory renames and literal `=>` in filenames are mis-parsed, malformed change records are silently dropped (undercounting changed files), untracked-binary detection can silently disable on Windows, and ordering uses locale-dependent comparison — which breaks byte-stable reproducibility across machines/Node builds.

**Independent Test**: Testable with disposable dummy repositories exercising partial staging, directory renames, binary files, spaces in path, and equivalent inputs run repeatedly; assert exact totals, correct rename classification, and byte-identical output across runs and platforms.

**Acceptance Scenarios**:

1. **Given** a file that is both staged and further modified in the working tree, **When** the diff is calculated, **Then** its changed lines are counted exactly once relative to the base revision.
2. **Given** a renamed directory and a file whose name literally contains ` => `, **When** `status`/`check` report changes, **Then** each change is classified deterministically without phantom paths or mis-splits.
3. **Given** the same repository state and command input, **When** the command runs twice on machines with different locales, **Then** output and exit codes are byte-identical.

### User Story 4 - Edge environments fail cleanly instead of confusingly (Priority: P2)

As a user, when I run ChangeBudget in an empty repository (no commits), on a detached HEAD, with a missing/invalid base revision, or in a repository whose path contains spaces, I expect the CLI to work where it can and to produce a deterministic, actionable, correctly-classified error elsewhere.

**Why this priority**: These are realistic everyday Git situations for a local CLI. The engine already handles most of them implicitly (Git is invoked without a shell, revisions are validated before use), but none are covered by tests and a couple degrade silently.

**Independent Test**: Testable with freshly created disposable repositories (including empty ones, detached-HEAD checkouts, and directories with spaces): assert documented exit codes, actionable messages, and read-only guarantees for every command in each environment.

**Acceptance Scenarios**:

1. **Given** an empty repository, **When** `init` runs, **Then** it succeeds; and `start`/`check`/`diagnose` emit deterministic actionable errors with documented exit codes instead of hanging, crashing, or undercounting.
2. **Given** a repository checked out on a detached HEAD with a valid base revision, **When** the full lifecycle runs, **Then** it behaves identically to the branch case.

### User Story 5 - The OpenCode guard degrades safely and never crashes the session (Priority: P2)

As a user, when ChangeBudget state is missing or malformed while the runtime guard is active, or a target path cannot be resolved, I expect the plugin to make a documented deterministic decision (or safe pass-through) and never to throw out of the hook, and I expect it to stay memory-stable across a long session.

**Why this priority**: The inspection found the plugin reads lifecycle state outside its error boundary (`opencode-plugin/src/evaluator.ts`), so malformed state can throw out of a `permission.ask` hook; hook bodies have no internal catches; and session-matching maps grow without bound across a long-lived session.

**Independent Test**: Testable by loading the plugin into a harness with malformed state, missing state, unresolvable targets, and a long sequence of simulated asks; assert the hook always resolves to a documented decision (never a thrown exception) and that memory growth is bounded.

**Acceptance Scenarios**:

1. **Given** a repository with malformed `.changebudget/state.json`, **When** the runtime guard evaluates a permission ask, **Then** the hook completes with the documented degraded decision rather than throwing.
2. **Given** a long-lived OpenCode session with many tool asks, **When** context is repeatedly consumed, **Then** stale context is released so memory remains bounded.

### User Story 6 - Stack-policy configuration errors are deterministic and tested (Priority: P3)

As a user, when my repository override file is malformed or references an unknown rule, I expect a deterministic, actionable error with a documented exit code — never an internal crash — and I expect the existing behavior (built-in rules, repository overrides, contract disables, Liquibase support) to be proven stable by direct tests.

**Why this priority**: The inspection found malformed-overrides handling exists but has no direct unit coverage, and one path can raise an uncaught internal error if a profile lacks built-in rules. This is error-quality scope, not a redesign.

**Independent Test**: Testable with disposable repositories containing malformed/partial override files and unknown rule references; assert deterministic errors, exit codes, and no internal crash reports.

**Acceptance Scenarios**:

1. **Given** a `.changebudget/stack-policy-overrides.json` with invalid JSON or an unknown rule ID, **When** `start`/`check` with that stack profile runs, **Then** a deterministic actionable error is emitted with the documented exit code and no internal stack trace.
2. **Given** the existing stock rule sets (including Spring Boot Liquibase/Flyway paths), **When** the complete suite runs, **Then** direct tests prove deterministic matching and classification.

### User Story 7 - The v1.0 gate is proven and documented (Priority: P1 gate)

As a user, I can run an automated acceptance gate on disposable dummy repositories proving: zero state corruption under controlled failures, zero working-tree mutation from observational commands, deterministic outputs/errors, successful end-to-end lifecycle cycles, full independence from OpenCode and Spec-Kit, preserved SPEC-001..007 behavior, zero open CRITICAL/HIGH defects and no blocking MEDIUM defect, and documented accepted limitations.

**Why this priority**: This is the Definition of Done for Personal v1.0. It is a cross-feature gate, not a re-test of every unit feature.

**Independent Test**: A single acceptance suite over disposable repositories (the existing metrics-suite pattern reused) exercising only cross-feature reliability boundaries.

**Acceptance Scenarios**:

1. **Given** disposable dummy repositories, **When** the SPEC-008 acceptance suite runs, **Then** every SC-* criterion in **Success Criteria** passes and its evidence is recorded.
2. **Given** the complete project suite, **When** it runs after all SPEC-008 changes, **Then** all existing SPEC-001..007 tests still pass.

### Edge Cases

Edge cases carry a disposition that maps to the hardening classification (see **Requirements**). Cases marked ACCEPTED are documented, safe, and non-blocking; cases in this list that are incorrect today are addressed by the corresponding FR.

- **State/lifecycle**: write fails on `init` after directory creation; `start` writes contract then fails on state; `close` marks contract closed then fails on state; the destination file is locked so a replace retry is needed; command interrupted mid-write (process kill); concurrent `start`/`close` processes racing a read-then-write; corrupt `state.json`; corrupt or missing active contract; corrupt `last_closed_contract_id`.
- **Git/repo**: empty repository (no HEAD); detached HEAD; missing/invalid base revision; repository path containing spaces; non-UTF-8 or newline/tab filenames; partial staging of one file; staged+unstaged combined; binary files including untracked binaries; renamed files and renamed directories; literal `=>` in a filename; deleted and recreated files; malformed `numstat` records.
- **Stack policies**: invalid JSON in overrides; unknown/duplicate rule IDs; unreadable file; profile without built-in rules.
- **Spec-Kit**: duplicate `Txxx` IDs across features or within a file; `[budget:...]` markers (first-marker-wins, invalid values); CRLF line endings in `tasks.md`; task file unreadable.
- **Diagnose**: bare/prose-only inputs; both human and JSON output; repeated equivalent runs; no-Spec-Kit and no-stack-profile runs; `--json` byte-stability.
- **Plugin**: missing state; malformed state; contract missing while state says active; unresolvable target path; cross-drive/`..` targets; long-lived sessions.
- **Windows/cross-platform**: path separators; drive letters in draft paths; `rename` over an existing file (EEXIST/EPERM); untracked-binary detection; CRLF output; locale-dependent ordering of non-ASCII paths.

Dispositions: each concrete edge case above is either (a) already handled and covered by existing tests, (b) addressed by an FR in **Requirements**, or (c) recorded in **Accepted Limitations** with its deterministic, safe behavior when no change is warranted. No NEW product feature is implied by any edge case.

## Requirements

Hardening requirements are grouped by the four classifications in the **Hardening finding model**. Only requirements backed by an evidence item (bug, reproducible edge case, acceptance/dogfood finding, corruption/data-loss risk, deterministic-output risk, compatibility risk, material workflow friction, or a missing v1.0 operational guarantee) are in scope.

### Hardening finding model

| Classification | Meaning |
|---|---|
| **BLOCKER** | Data loss/corruption, unsafe mutation, deterministic policy failure, core lifecycle unusable, or major compatibility regression. Must be fixed before v1.0. |
| **MUST_FIX** | Reproducible issue that materially affects everyday workflow. Must be fixed before v1.0. |
| **ACCEPTED_LIMITATION** | Known, safe, documented limitation. Does not block v1.0. |
| **OUT_OF_SCOPE** | Future functionality or speculative improvement. Explicitly excluded from SPEC-008. |

### Findings Register

Evidence collected during inspection of the converged implementation (paths relative to the repository root). Dispositions:

**BLOCKER**

- **F-B01 — destructive replace fallback**: `src/core/state/state.ts` `writeJsonFileAtomic` deletes the existing destination file (`rm(path, force)`) before retrying `rename` on `EEXIST`/`EPERM`; a failure between the two operations loses the previously-valid file. Justification: data-loss/corruption risk on Windows where locked files realistically produce EPERM. → FR-001

**MUST_FIX**

- **F-M01 — non-transactional lifecycle writes**: `start` (src/cli/commands/start.ts) and `close` (src/cli/commands/close.ts + src/core/state/contracts.ts) persist two files with no unit ordering or recovery; a mid-write failure leaves an orphaned active contract or a contract-marked-closed with state still active. Justification: reproducible partial-state risk.
- **F-M02 — same corruption, different exits**: a corrupt/unknown active contract hard-fails `status` (environment exit) but soft-fails `check` and `status --budget` (review exit). Justification: deterministic-output risk for scripts.
- **F-M03 — silent corruption swallow**: `getLastClosedContract` (src/cli/commands/status.ts) returns `null` on any read error, hiding corrupt/missing last-closed-contract state. Justification: hidden corruption.
- **F-M04 — fragile missing-file detection**: `readJsonFileOptional` (src/core/state/state.ts) infers "file missing" by string-matching `/ENOENT/` in a stringified error; an OS/runtime text change would misclassify missing as corrupt. Justification: classification fragility.
- **F-M05 — staged+unstaged double count**: `diff.ts` merges staged and unstaged `numstat` records for the same path by summing; a partially-staged file's lines are counted twice (currently enshrined in a test). Justification: reproducible edge case; systematic budget over-report → material workflow friction.
- **F-M06 — silent record drops in diff parsing**: `numstat`/`name-status` records with malformed shapes are silently skipped, undercounting changed files; git's quoted/escaped paths are never unescaped; empty numeric fields parse to zero instead of failing. Justification: deterministic-policy-failure risk (silent undercount).
- **F-M07 — rename parsing gaps**: `numstat` split on literal ` => ` mis-parses filenames containing ` => ` and directory renames reported as `{old => new}/file`; paired rename records count a rename as two items. Justification: reproducible rename edge case against the claimed rename support.
- **F-M08 — Windows untracked-binary fragility**: untracked-binary detection (`diff.ts` using `git diff --no-index`) treats non-empty stderr on exit 1 as failure, which on Windows (CRLF/`/dev/null` noise) silently disables detection. Justification: compatibility risk on a claimed platform.
- **F-M09 — locale-dependent ordering**: path/violation/feature ordering uses `localeCompare`, whose byte-order varies by ICU locale and Node build, breaking cross-machine byte-stable output. Justification: deterministic-output risk.
- **F-M10 — plugin crash boundary**: the OpenCode plugin reads lifecycle state outside its try/catch (`opencode-plugin/src/evaluator.ts`) and hook bodies have no internal catch; malformed state can throw out of a `permission.ask` hook. Justification: failure-isolation requirement of SPEC-004; session breakage.
- **F-M11 — unbounded plugin context maps**: session/tool-context maps have per-session caps but sessions accumulate without bound in a long-lived process. Justification: reliability/memory growth.
- **F-M12 — profile-without-builtin-rules crash**: `getBuiltInStackProfileRules` indexes an object with no fallback; an extension or future profile without builtins raises an uncaught internal error. Justification: error quality; internal crash vs deterministic error.
- **F-M13 — missing direct coverage**: no unit tests exist for `src/core/git/repo.ts` (empty repo, detached HEAD, invalid base, paths with spaces) nor for `resolveStackPolicy`/override parsing; malformed-overrides error shape is untested; no CRLF fixture for `tasks.md`. Justification: claimed guarantees must be provable; missing v1.0 operational certainty.

**ACCEPTED_LIMITATION** (documented in **Accepted Limitations**)

- **F-A01** — exit-code numeric collision between `HUMAN_REVIEW` and usage errors (both exit 2), documented per command.
- **F-A02** — non-UTF-8 and newline/tab filenames degrade deterministically (not fully supported).
- **F-A03** — concurrent working-tree mutation during one `check` can span the probe window (re-run expected).
- **F-A04** — porcelain `git diff` refreshes the index stat-cache (standard Git read behavior; not content mutation).
- **F-A05** — path-only stack rules mean a Maven `pom.xml` version-only edit still triggers review (no content inspection; no automatic review elimination).
- **F-A06** — plugin keyword/context heuristics can misclassify some commands (documented; guard remains advisory).
- **F-A07** — no `fsync` durability; atomic rename is the baseline and any surviving corruption surfaces as an actionable state-corruption error.
- **F-A08** — `history.json` is declared but never written; no history feature is added by this spec.
- **F-A09** — invalid draft contract JSON is reported under the rule-config reason namespace rather than an input one (documented behavior).
- **F-A10** — per-untracked-file subprocess cost; no performance work without evidence.

**OUT_OF_SCOPE** — see **Non-Goals**.

### Functional Requirements

Stable IDs; each must be testable.

**State integrity**

- **FR-001**: A failed or interrupted lifecycle write (state or contract) MUST NOT destroy or leave unrecoverable a previously-valid ChangeBudget file; replacement MUST become effective only via an atomic temp+rename, and the existing destination MUST be preserved on any failure. [F-B01]
- **FR-002**: Failed `start` MUST NOT leave an orphaned unreferenced active contract; the next `start`/`status` MUST deterministically reconcile or report it. [F-M01]
- **FR-003**: Interrupted `close` (contract marked closed while state still active) MUST be deterministically recognized and recovered or reported by the next lifecycle read — the CLI MUST NOT present a closed contract as active. [F-M01]
- **FR-004**: Any corrupted persisted file that survives a failure MUST surface as a deterministic, actionable state-corruption error with the documented exit code — never as a silent success. [F-A07]
- **FR-005**: `status`, `status --budget`, and `check` MUST emit the same deterministic corruption diagnosis and exit code for the same corrupt/unknown active contract. [F-M02]
- **FR-006**: Missing-file detection MUST be derived from the actual errno identifier, not by matching rendered error text. [F-M04]
- **FR-007**: Missing or corrupt state referenced by `last_closed_contract_id` MUST be surfaced consistently with active-contract handling, never silently ignored. [F-M03]

**Budget correctness and determinism**

- **FR-008**: Changed-line totals for a file that is both staged and further modified MUST equal a single diff against the base revision (counted once, not summed). [F-M05]
- **FR-009**: Change parsing (name-status/numstat) MUST NOT silently drop records; malformed records MUST produce a deterministic actionable error rather than an undercount. [F-M06]
- **FR-010**: Rename handling MUST deterministically classify file and directory renames, including directory-rename notation and filenames literally containing ` => `, without phantom paths or mis-splits. [F-M07]
- **FR-011**: Untracked-binary detection MUST work on Windows (no silent disablement via exit/stderr noise or POSIX-only paths). [F-M08]
- **FR-012**: Ordering of changed files, violations, and feature discovery MUST be byte-stable across machines, locales, and Node builds. [F-M09]

**Repository/environment edges**

- **FR-013**: The CLI MUST produce deterministic, actionable, documented-exit-code results for: empty repositories (init succeeds; other commands error clearly), detached HEAD, missing/invalid base revisions, and repository paths containing spaces. [F-M13]
- **FR-014**: Existing read-only behaviors MUST be preserved and re-verified: `status`, `check`, `diagnose`, and the plugin MUST NOT write `.changebudget/**`, project files, Spec-Kit tasks, Git index content, refs, or commits. [Read-only gate]

**Plugin reliability**

- **FR-015**: The OpenCode plugin MUST NOT throw out of any hook for missing/malformed ChangeBudget state, unresolvable targets, or evaluation errors; it MUST complete with a documented deterministic decision. [F-M10]
- **FR-016**: Plugin context matching MUST keep memory bounded across a long-lived session (stale consumed context released). [F-M11]

**Stack-policy robustness**

- **FR-017**: Malformed/unreadable `stack-policy-overrides.json` and unknown/duplicate rule references MUST produce deterministic, actionable errors with the documented exit code — never an internal crash. [F-M12]
- **FR-018**: Direct tests MUST prove stack-policy override parsing, built-in rule determinism (including Spring Boot Liquibase/Flyway paths), and malformed-file error shape. [F-M13]

**Testing and acceptance**

- **FR-019**: Focused regression tests (table-driven where suitable, disposable repositories only) MUST cover FR-001 through FR-018, reusing existing tests wherever a guarantee is already proven. [F-M13]
- **FR-020**: A final cross-feature acceptance suite (SPEC-008 metrics) MUST run the SC-* **Success Criteria** above all existing suites (SPEC-001..007) unchanged/green, with evidence recorded in the feature's acceptance metrics document.
- **FR-021**: SPEC-008 MUST introduce zero new runtime dependencies.

## Success Criteria

Measurable, technology-agnostic outcomes. Resource restrictions apply: disposable dummy repositories only (see **Assumptions**).

### Measurable Outcomes

- **SC-001 — Zero state corruption across controlled failure scenarios**: In the controlled failure matrix (FR-001/FR-002/FR-003 scenarios, each injected in disposable repositories), zero scenarios result in a destroyed previously-valid file, an orphaned referenced contract, or a closed contract presented as active; every scenario ends either fully applied or deterministically recovered/reported.
- **SC-002 — Zero working-tree mutation from observational commands**: Over repeated runs of `status`, `check` (all decision branches), and `diagnose` (human and JSON), Git state and project files remain byte-identical in disposable repositories.
- **SC-003 — Deterministic outputs and errors**: For equivalent inputs and equivalent (including corrupt) state, commands emit byte-identical stdout/stderr and identical exit codes across repeated runs — including error paths.
- **SC-004 — Successful end-to-end lifecycle cycles**: At least 20 consecutive full lifecycle cycles (init → start with each preset and interaction: plain, Spec-Kit task, stack profile → real edits → check PASS → close) complete successfully in fresh disposable repositories with no leftover side effects.
- **SC-005 — OpenCode-independent CLI**: The full lifecycle and the diagnose advisor work identically in disposable repositories with the OpenCode plugin absent.
- **SC-006 — Spec-Kit-independent CLI**: The full lifecycle and the diagnose advisor work identically in disposable repositories with no `specs/` structure present.
- **SC-007 — Cross-feature compatibility**: After all SPEC-008 changes, the complete project suite (unit + integration + acceptance) passes in full, and one diagnose→start→check flow and one Spec-Kit task start→check flow both pass end-to-end.
- **SC-008 — v1.0 blocker count = 0**: Zero open BLOCKER findings; zero open MUST_FIX findings; all ACCEPTED_LIMITATION entries documented in this feature; cross-machine byte-stability proven for at least one non-ASCII-path fixture (FR-012).

Definition of Done for Personal v1.0 is satisfied when SC-001 through SC-008 all pass with recorded evidence.

## Assumptions

- **Test targets**: Automated and exploratory validation uses only newly-created disposable dummy Git repositories and controlled fixtures. No existing personal/work application repository is used as a test target. Self-hosting ("dogfooding") is defined as an explicit, manual, user-opt-in gate — not an automated fixture — per the task brief.
- **Scope**: SPEC-008 is a hardening milestone with a finite scope. Findings without a concrete reliability justification are recorded as OUT_OF_SCOPE.
- **Baseline preserved**: SPEC-001..007 behaviors, CLI surface, flags, exit codes, and output formats are preserved; fixes change only incorrect/undetermined behavior in concrete findings.
- **Platforms**: Windows and Node.js (as already claimed). No new platforms, runtimes, or OS-support matrices are introduced.
- **Dependencies**: Zero new runtime dependencies; existing Node.js/Git capabilities are sufficient for every accepted fix.
- **Performance**: No performance work without reproducible evidence; only a regression guard is defined (existing operations must not regress to unusable in plan validation).
- **Local history**: Local history is explicitly OUT_OF_SCOPE unless a concrete v1.0 recovery requirement proves it necessary; none did in the evidence collected, so it is excluded.
- **Maven `pom.xml` version-only noise**: Not a v1.0 blocker unless controlled evidence shows material workflow harm; treated as an accepted limitation.

## Compatibility Impact

- **Compatibility maintained**: CLI commands, flags, presets, JSON/human output schemas, reason-code namespaces, and documented exit codes are unchanged except where a concrete finding requires a deterministic error or correct total. No new commands are added.
- **Behavior changed only in concrete findings**: changed-line totals for partially-staged files (FR-008), rename classification (FR-010), silent-drop/undercount removal (FR-009), corruption classification consistency (FR-005), Windows untracked-binary detection (FR-011), and plugin degraded decisions (FR-015).
- **Backward compatibility gates**: The full existing suite must stay green (SC-007); SPEC-005/006/007 acceptance metrics must not regress.
- **No external contracts**: No public npm package, API, or third-party integration is affected.

## Non-Goals

The following are explicitly out of scope for SPEC-008 (also OUT_OF_SCOPE in the hardening model):

- New SaaS/backend/cloud functionality, accounts/teams, telemetry/analytics
- New coding-agent integrations; no expansion beyond OpenCode (no support for other coding agents). No GitHub/GitLab integrations.
- Automatic repair/revert; automatic contract widening; auto-contract-creation other than current behavior
- AI/LLM functionality; AST analysis; semantic code review as a source of truth
- New stack autodetection; new stack-policy categories without a concrete reproducible defect
- Generalized plugin system; new agents/IDE marketplace support
- Web UI, dashboards, package marketplace, publication/npm-release automation
- Large architecture rewrite; migration to another language/runtime
- Speculative performance optimization; microbenchmark-driven refactors
- Unrelated code cleanup, style/format churn, and general dependency cleanup with no concrete reliability need
- Local history/archive feature (no concrete v1.0 recovery need was established)
- Redesigning error messages purely for wording consistency; changing exit-code numbering that is already documented and disjoint within each command
- Re-testing every SPEC-001..007 unit behavior independently (existing suites already prove them)

## Accepted Limitations

Documented, safe, deterministic, and non-blocking for v1.0 (mapped from the Findings Register):

- **A-01**: The numeric exit-code value 2 is shared by the `HUMAN_REVIEW` decision and input/usage errors; the meaning is unambiguous per command and documented (no renumbering).
- **A-02**: Non-UTF-8 and newline/tab-bearing filenames degrade deterministically; full `-z`-style quoting support is out of scope until concrete need.
- **A-03**: A repository mutated by another process during one `check` run may be reflected across probe windows; re-running `check` is the reliable workflow.
- **A-04**: Porcelain Git reads may refresh the index stat-cache; this is standard Git behavior and never changes index content or commits.
- **A-05**: Path-only stack rules trigger review for any edit (including Maven `pom.xml` version-only changes); no content inspection or automatic noise suppression.
- **A-06**: Plugin command keyword/context inference is heuristic and may misclassify some commands; decisions remain deterministic for a given context and changes are never auto-widened.
- **A-07**: Writes are atomic via temp+rename without `fsync`; any surviving corruption surfaces as a deterministic actionable error (FR-004), never a silent success.
- **A-08**: `history.json` is declared but unused; no history feature is added by SPEC-008.
- **A-09**: Invalid draft JSON is reported under the rule-config reason namespace (documented classification; no behavior change).
- **A-10**: One Git subprocess per untracked file for binary detection remains acceptable on evidence; future evidence may revisit.

## Acceptance Scenarios (v1.0 gate)

The gate runs all SC-* criteria. Representative executable gate scenarios (disposable repositories):

1. **Given** a disposable repository, **When** the FR-001..FR-003 failure matrix is injected at every persistence point, **Then** every scenario reports a documented deterministic error and a previously-valid file survives (SC-001, FR-001).
2. **Given** an initialized disposable repository whose `state.json` is then corrupted, **When** `status`, `status --budget`, and `check` run, **Then** all emit byte-identical actionable corruption errors with the same exit code (SC-003, FR-005/FR-06/FR-007).
3. **Given** a disposable repository with staged + unstaged edits, a renamed directory, a literal `=>` filename, a binary file, and non-ASCII paths, **When** the full suite plus the SPEC-008 acceptance scenarios run on two different locale settings, **Then** totals and classifications are correct and outputs are byte-identical (SC-003, FR-008..FR-012).
4. **Given** empty, detached-HEAD, spaces-in-path, and missing-base disposable repositories, **When** each CLI command runs, **Then** results are deterministic and actionable with documented exit codes (SC-003, FR-013).
5. **Given** disposable repositories with no OpenCode plugin and no Spec-Kit structure, **When** the full lifecycle and diagnose run, **Then** behavior is identical to integrated setups (SC-005, SC-006).
6. **Given** the plugin harness, **When** malformed state, missing state, unresolved targets, and a long sequence of asks are exercised, **Then** the hook always completes with a documented decision and never throws (SC-003, FR-015/FR-016).
7. **Given** the complete project, **When** all existing SPEC-001..007 suites and the SPEC-008 acceptance metrics run, **Then** all pass and evidence is recorded (SC-007, SC-008).

## Definition of Done — Personal v1.0

SPEC-008 is complete (CROSSING this milestone's gate) when:

- All FR-001..FR-021 are implemented and verified by the corresponding tests and the SPEC-008 acceptance metrics suite.
- SC-001..SC-008 all pass with recorded evidence in `specs/008-dogfood-reliability/`.
- Zero BLOCKER and zero MUST_FIX findings remain open; ACCEPTED_LIMITATION entries are documented in this spec.
- The complete existing suite (SPEC-001..007) passes unchanged (245/245 baseline preserved after adding SPEC-008 tests).
- No new runtime dependencies are added.
- No unimplemented SPEC features are referenced; User stories/requirements that look beyond this milestone are recorded as OUT_OF_SCOPE, not implemented.
- A manual, user-opt-in self-hosting smoke (ChangeBudget developing ChangeBudget) is defined as the final dogfooding gate, outside automated fixtures.