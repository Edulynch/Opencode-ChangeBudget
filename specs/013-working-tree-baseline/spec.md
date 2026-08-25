# Feature Specification: Working Tree Baseline (SPEC-013)

**Feature Branch**: `013-working-tree-baseline`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: Capture the contract-start working tree so ChangeBudget evaluates only changes made after start.

## Problem Statement

ChangeBudget currently compares against a base revision and overlays staged and untracked observations. That cannot reliably distinguish work that existed before a contract from work introduced after it. A valid `tasks.md` was created, yet 28 pre-existing untouched untracked Spec-Kit Git-extension files outside scope caused `CBV-PATH-NOT-ALLOWED` and required human forensic review and manual closure. SPEC-013 establishes the contract-start working tree as an additional observable boundary, so inherited repository noise is not mistaken for contract work while later changes remain enforceable.

## Clarifications

### Session 2026-08-24

- **Q: How are staging-only transitions handled?** **A:** A staging or unstaging transition with byte-identical content is excluded from changed-file and changed-line budgets. Normal status and check output remain silent about the transition. An explicit structured or diagnostic report may show an aggregate informational transition count. Any content deletion, creation, rename, mode change, type change, symlink-target change, or gitlink change remains evaluated.
- **Q: What happens when a required baseline entry cannot be captured?** **A:** Start fails safely with no active contract unless all required evidence persists. The system must not omit the entry, fall back to timestamps, mutate user files, the index, refs, or commits, stash, or widen scope. It reports an error or `HUMAN_REVIEW` result according to the existing CLI model. If failure occurs after persistence begins, no valid-looking partially active contract may remain.
- **Q: What repository object and path semantics apply?** **A:** A symlink itself is the object. Its target or value and its type changes are evaluated without recursively snapshotting the target. A tracked submodule is a gitlink, and its commit change is evaluated without recursively baselining the nested worktree. Nested dirty work outside gitlink semantics is unsupported and must be disclosed with deterministic `HUMAN_REVIEW`, never silently claimed covered. Path identity follows repository and Git platform semantics, never global lowercasing. Case-only renames are detected when meaningful. Equivalent-path ambiguity resolves deterministically or fails safely, never bypassing policy.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Start with an honest baseline (Priority: P1)

As a developer, I want starting a contract to record the repository state I am handing to the task, without changing my work, so that later checks measure the task rather than inherited dirt.

**Why this priority**: A trustworthy boundary is required for every later decision.

**Independent Test**: Prepare clean, dirty, and untracked repositories, start a contract, and confirm repository contents, index state, refs, and commits are unchanged while status exposes a usable baseline mode.

### User Story 2 - Evaluate only post-start work (Priority: P1)

As a developer, I want unchanged pre-existing entries excluded while any later edit to them is checked against every existing rule, so that baseline capture does not weaken scope enforcement.

**Why this priority**: The feature must remove false violations without creating an escape hatch.

**Independent Test**: Seed each entry type before start, leave some untouched, change others after start, and compare decisions and explanations with the expected rule outcomes.

### User Story 3 - Recover safely across lifecycle boundaries (Priority: P1)

As a developer, I want baseline evidence to survive restart and to fail visibly when unavailable or untrustworthy, so that no invocation silently invents a safe result.

**Why this priority**: Persistence and integrity failures affect human authority and auditability.

**Independent Test**: Restart between start and check, then exercise missing, corrupt, tampered, and persistence-failure conditions and verify explicit failure or HUMAN_REVIEW behavior.

### User Story 4 - Preserve familiar decisions and explanations (Priority: P2)

As a developer, I want PASS, REPAIR, and HUMAN_REVIEW to retain their current meaning and reports to explain baseline decisions, so that the new boundary fits existing workflows.

**Why this priority**: Users must be able to act on results without learning a new authority model.

**Independent Test**: Run representative passing, repairable, and unsafe cases in baseline and legacy modes and inspect status and check output.

### Acceptance Scenario Matrix

Each scenario is independently testable and maps to the requirements listed below.

1. **Clean PASS**: Given a clean repository at contract start, when no user change follows, then check returns PASS with lightweight or empty baseline semantics equivalent to current behavior.
2. **Untouched pre-existing unstaged**: Given an unstaged entry exists before start and remains byte-identical, when check runs, then it is excluded from the post-start change set.
3. **Untouched pre-existing staged**: Given a tracked change is staged before start and remains byte-identical, when check runs, then it is excluded from the post-start change set.
4. **Untouched pre-existing staged plus unstaged**: Given a tracked entry has staged and worktree changes before start and both effective states remain unchanged, when check runs, then it is excluded without duplicate budget contribution.
5. **Untouched pre-existing untracked text**: Given an untracked text file exists before start and remains byte-identical, when check runs, then it is excluded from the post-start change set.
6. **Untouched pre-existing untracked binary**: Given an untracked binary file exists before start and remains byte-identical, when check runs, then it is excluded with no file or line budget contribution.
7. **Tracked changed again**: Given a tracked entry was changed before start and changed again after start, when check runs, then only the post-start delta is evaluated.
8. **Untracked changed again**: Given an untracked entry existed before start and its content changes after start, when check runs, then the post-start change is detected and evaluated.
9. **Pre-existing file deleted during contract**: Given a file exists at start and is deleted after start, when check runs, then the deletion is detected and evaluated normally.
10. **Pre-existing file renamed during contract**: Given a file exists at start and is renamed after start, when check runs, then source deletion and destination participation are represented consistently with current modeling and evaluated normally.
11. **New after start**: Given a path does not exist at start, when it is created after start, then it is included and subject to all applicable rules.
12. **Outside allow untouched**: Given an outside-allow entry exists before start and remains unchanged, when check runs, then it causes no path violation.
13. **Same outside modified**: Given an outside-allow entry exists before start and changes after start, when check runs, then the path violation is detected and reported.
14. **Sensitive untouched**: Given a sensitive or denied entry exists before start and remains unchanged, when check runs, then it is excluded without weakening the policy.
15. **Sensitive modified**: Given a sensitive or denied entry exists before start and changes after start, when check runs, then the relevant sensitive rule produces REPAIR or HUMAN_REVIEW as currently defined.
16. **Process restart**: Given a contract is started and the process exits, when a new process checks it, then it reloads the same authoritative baseline and produces the same result.
17. **Missing or corrupt baseline**: Given baseline evidence is missing, malformed, or tampered with, when status or check runs, then it never returns PASS and exposes an unsafe or HUMAN_REVIEW state.
18. **Persistence failure**: Given authoritative baseline persistence cannot complete atomically, when start runs, then activation does not present a partially active contract and the failure is explicit and safe.
19. **Legacy contract**: Given a contract predates this feature and has no baseline, when status or check runs, then existing base-revision semantics are used, legacy/no-baseline mode is disclosed, no historical migration is required or performed, and no baseline is reconstructed automatically.
20. **`.changebudget` exclusion**: Given `.changebudget/**` changes, when a user budget is evaluated, then those paths remain recursively excluded while Runtime Guard continues to deny their mutation.
21. **Spaces**: Given paths contain spaces, when start and check collect and compare them, then matching and reporting are correct.
22. **Windows separators**: Given observations use Windows separators, when paths are compared, then slash-normalized matching and deny precedence remain stable.
23. **Unicode**: Given paths or contents contain Unicode, when start and check run, then matching, ordering, and decisions are deterministic.
24. **Large or binary**: Given large objects or binary changes are present, when safe evidence is available, then file-level evaluation is deterministic and binary changes contribute zero lines; when safe evidence is unavailable for a policy-critical object, start fails safely.
25. **Many untracked**: Given many pre-existing untracked files exist, when start and check run, then unchanged entries are excluded, post-start deltas are found, and no path is ignored wholesale by pattern.
26. **Close and audit retention**: Given an active baseline-aware contract, when a developer closes it under existing human-authority semantics, then close behavior remains compatible and the baseline evidence remains associated with the closed contract for later audit.
27. **Concise baseline reporting**: Given baseline, legacy/no-baseline, excluded-entry, detected-delta, or unsafe-evidence conditions, when status or check reports them, then output identifies the active comparison mode and provides concise deterministic summaries and actionable reasons without noisy per-entry output during normal operation.
28. **Identical unstaged to staged**: Given content is byte-identical before and after an unstaged-to-staged transition, when check runs, then the transition is excluded from changed-file and changed-line budgets and produces no normal-output noise.
29. **Identical staged to unstaged**: Given content is byte-identical before and after a staged-to-unstaged transition, when check runs, then the transition is excluded from changed-file and changed-line budgets and produces no normal-output noise.
30. **Staging transition plus content delta**: Given content is staged or unstaged and also changes, when check runs, then the content delta is evaluated and is not hidden by the staging transition.
31. **Unreadable pre-existing dirty start**: Given a required pre-existing dirty entry cannot be safely read at start, when start runs, then it fails with no active contract and cannot produce PASS.
32. **Baseline persistence failure**: Given baseline persistence fails after it begins, when start runs, then no valid-looking partial baseline or active contract remains.
33. **Unchanged pre-existing symlink**: Given a symlink exists before start and its target or value and type remain unchanged, when check runs, then it is excluded from the post-start change set without recursively snapshotting its target.
34. **Changed symlink target**: Given a symlink exists before start and its target or value changes, when check runs, then the symlink change is evaluated.
35. **Symlink replaced with regular file**: Given a symlink exists before start and is replaced by a regular file, when check runs, then the type change is evaluated.
36. **Unchanged tracked submodule gitlink**: Given a tracked submodule gitlink exists before start and its recorded commit remains unchanged, when check runs, then it is excluded without recursively baselining the nested worktree.
37. **Changed gitlink**: Given a tracked submodule gitlink exists before start and its recorded commit changes, when check runs, then the gitlink change is evaluated.
38. **Windows case-only rename**: Given a case-only rename occurs on Windows, when check runs, then repository and platform semantics detect and classify it deterministically when meaningful.
39. **Equivalent path ambiguity**: Given equivalent paths are ambiguous on a case-insensitive filesystem, when check runs, then the ambiguity resolves deterministically or fails safely with policy enforcement never bypassed.

### Additional executable acceptance scenarios

The following scenarios are independently executable. Each names the initial state, captured identity or evidence, mutation, check result and decision, and primary assertion.

40. **HEAD unchanged**: Initial state is a baseline-enabled contract at commit H0 with complete valid evidence. Captured identity is exact HEAD H0. Mutation is none. Check result is an ordinary B-to-C evaluation and decision is PASS when no policy delta exists. Primary assertion: exact HEAD equality permits normal comparison.
41. **HEAD advances**: Initial state is a baseline-enabled contract captured at H0. Captured identity is H0. Mutation advances HEAD to descendant H1. Check result is `BASELINE_HEAD_MOVED` and decision is HUMAN_REVIEW, never PASS. Primary assertion: no baseline, history, Git, or user state is rewritten.
42. **HEAD switches to existing commit**: Initial state is a baseline-enabled contract captured at H0. Captured identity is H0. Mutation switches HEAD to an existing commit H2. Check result is `BASELINE_HEAD_MOVED` and decision is HUMAN_REVIEW, never PASS. Primary assertion: switching to an existing commit is still unequal and is not silently accepted.
43. **HEAD moves away and returns**: Initial state is a baseline-enabled contract captured at H0 with complete valid evidence. Captured identity is H0. Mutation moves HEAD away and then exactly back to H0. Check result is normal B-to-C evaluation and decision is PASS only when integrity is valid. Primary assertion: exact return resumes comparison only after integrity validation.
44. **HEAD movement preserves evidence**: Initial state is a baseline-enabled contract captured at H0 with complete retained baseline evidence and exact captured HEAD binding H0. Captured identity is H0. Mutation moves HEAD away from H0 while the contract remains retained. Check result is `BASELINE_HEAD_MOVED` and decision is HUMAN_REVIEW, never PASS, without mutating or deleting retained baseline evidence. Primary assertion: the baseline evidence and exact HEAD binding remain available for audit and are not replaced by the later HEAD observation.
45. **Missing reference**: Initial state is a baseline-enabled contract whose evidence reference is absent. Captured identity is the contract's recorded activation context. Mutation removes or withholds the referenced baseline association. Check result is `BASELINE_REQUIRED_MISSING` and decision is HUMAN_REVIEW, never PASS. Primary assertion: a baseline-enabled contract is never reclassified as legacy.
46. **Missing artifact**: Initial state is a baseline-enabled contract with a reference to a complete artifact. Captured identity is the artifact association. Mutation makes the referenced artifact unavailable. Check result is `BASELINE_REQUIRED_MISSING` and decision is HUMAN_REVIEW, never PASS. Primary assertion: missing evidence cannot be treated as an empty baseline.
47. **Contract and evidence mismatch**: Initial state is a baseline-enabled contract and matching evidence for contract C1. Captured identity is C1 and its evidence association. Mutation substitutes evidence belonging to C2. Check result is `BASELINE_MISMATCH` and decision is HUMAN_REVIEW, never PASS. Primary assertion: contract-to-evidence association must match exactly.
48. **Missing payload**: Initial state is a baseline-enabled contract with an artifact descriptor requiring a payload. Captured identity is the descriptor and its payload association. Mutation removes the required payload while leaving metadata present. Check result is `BASELINE_REQUIRED_MISSING` and decision is HUMAN_REVIEW, never PASS. Primary assertion: metadata cannot substitute for required content evidence.
49. **Integrity mismatch**: Initial state is a baseline-enabled contract with a complete artifact and recorded integrity evidence. Captured identity is the recorded integrity evidence. Mutation changes the artifact or its integrity evidence. Check result is `BASELINE_CORRUPT` and decision is HUMAN_REVIEW, never PASS. Primary assertion: integrity failure blocks evaluation.
50. **Duplicate canonical path**: Initial state is a baseline-enabled contract with one canonical entry per repository path. Captured identity is the canonical path and entry identity. Mutation introduces two entries for the same canonical path. Check result is `BASELINE_PATH_AMBIGUITY` and decision is HUMAN_REVIEW, never PASS. Primary assertion: duplicate identity cannot be resolved by choosing an arbitrary entry.
51. **Invalid repository path**: Initial state is a baseline-enabled contract with repository-valid canonical paths. Captured identity is each normalized repository path. Mutation introduces an absolute, traversal, malformed, or otherwise repository-invalid path. Check result is `BASELINE_PATH_AMBIGUITY` and decision is HUMAN_REVIEW, never PASS. Primary assertion: path validation precedes comparison and policy evaluation.
52. **Identity collision**: Initial state is a baseline-enabled contract with distinct repository and platform identities. Captured identity is each entry identity. Mutation creates two distinct records that resolve to one repository/platform identity. Check result is `BASELINE_MISMATCH` and decision is HUMAN_REVIEW, never PASS. Primary assertion: identity collisions are not silently merged.
53. **Unsupported schema**: Initial state is a baseline-enabled contract using a supported evidence schema. Captured identity is the supported schema identity. Mutation changes the artifact to an unsupported schema. Check result is `BASELINE_UNSUPPORTED` and decision is HUMAN_REVIEW, never PASS. Primary assertion: unsupported schema is not parsed as a compatible baseline.
54. **Unsupported entry type**: Initial state is a baseline-enabled contract containing supported entry types. Captured identity is each entry type descriptor. Mutation introduces an unsupported policy-critical entry type. Check result is `BASELINE_UNSUPPORTED` and decision is HUMAN_REVIEW, never PASS. Primary assertion: unsupported entry types cannot be omitted.
55. **Malformed artifact**: Initial state is a baseline-enabled contract with a well-formed artifact. Captured identity is the artifact structure and required fields. Mutation corrupts the artifact structure or encoding. Check result is `BASELINE_CORRUPT` and decision is HUMAN_REVIEW, never PASS. Primary assertion: malformed evidence fails closed.
56. **Partial artifact**: Initial state is a baseline-enabled contract whose evidence was persisted completely before activation. Captured identity is the complete artifact association. Mutation leaves only part of the artifact or a partial write visible. Check result is `BASELINE_REQUIRED_MISSING` and decision is HUMAN_REVIEW, never PASS. Primary assertion: pointer-last activation and reload validation reject partial evidence.

Traceability: scenario 1: FR-001, FR-005, FR-013, FR-023. Scenario 2: FR-002, FR-003. Scenario 3: FR-002, FR-007. Scenario 4: FR-002, FR-007. Scenario 5: FR-002, FR-003, FR-028. Scenario 6: FR-002, FR-003, FR-009, FR-028. Scenario 7: FR-004, FR-007. Scenario 8: FR-004, FR-028. Scenario 9: FR-008. Scenario 10: FR-008, FR-024. Scenario 11: FR-004, FR-008. Scenario 12: FR-003, FR-026. Scenario 13: FR-004, FR-026. Scenario 14: FR-003, FR-026. Scenario 15: FR-004, FR-026. Scenario 16: FR-014. Scenario 17: FR-019, FR-020, FR-033, FR-034. Scenario 18: FR-013, FR-018, FR-035. Scenario 19: explicit comparison mode rule, FR-015, FR-016. Scenario 20: FR-021, FR-024. Scenario 21: FR-010, FR-028. Scenario 22: FR-010, FR-027. Scenario 23: FR-010, FR-027, FR-028. Scenario 24: FR-009, FR-011, FR-028, FR-029. Scenario 25: FR-003, FR-004, FR-011, FR-028. Scenario 26: FR-012, FR-017. Scenario 27: FR-022, FR-025. Scenario 28: FR-007. Scenario 29: FR-007. Scenario 30: FR-007. Scenario 31: FR-011, FR-019, FR-029, FR-034. Scenario 32: FR-013, FR-018, FR-035. Scenario 33: FR-030. Scenario 34: FR-030. Scenario 35: FR-030. Scenario 36: FR-031. Scenario 37: FR-031. Scenario 38: FR-032. Scenario 39: FR-032. Scenarios 40 through 44: FR-036. Scenarios 45 through 56: integrity validation matrix, FR-019, FR-029, FR-035.

### Edge Cases

- A staging or unstaging transition alone, when content is byte-identical, is excluded from changed-file and changed-line budgets and produces no normal-output noise. It must not hide a content or semantically relevant state change. An explicit structured or diagnostic report may show only an aggregate informational transition count.
- Moving content between the index and worktree, including staging, unstaging, and resolving staged plus unstaged states, must compare effective content without duplicate contribution while evaluating any content or semantically relevant state change.
- Strict NUL-delimited parsing errors are explicit failures, never silent omissions.
- Code-unit ordering and slash-normalized path matching remain stable across repeated evaluations.
- A malformed or unavailable active context fails safely and cannot fabricate PASS.
- Rename source and destination handling must not double-count content or hide a post-start modification.
- Symlink targets are not recursively baselined, and nested submodule worktrees are not recursively baselined.

## Requirements *(mandatory)*

### Explicit comparison mode and recognition

Every contract has an explicit internal or persisted `comparison_mode` discriminator. A newly started contract is `baseline` only after complete start evidence is persisted and verified. A contract is `legacy` only when it is an older schema that lacks `comparison_mode` and has no baseline reference. A baseline-enabled contract whose evidence is missing, malformed, corrupt, tampered with, unavailable, or incomplete remains baseline mode with unsafe evidence; it is never reclassified as legacy and never returns `PASS`. New public status and check JSON expose only the canonical camelCase fields defined below.

### Baseline Capture and Comparison

- **FR-001**: Start MUST capture authoritative, content and state based evidence of the contract-start working tree without modifying user files, Git index content, refs, or commits.
- **FR-002**: The comparison boundary MUST be the current observable repository state minus the contract-start observable state, not base-revision-only classification.
- **FR-003**: Evaluation MUST never wholesale ignore entries solely by path because they were present at start. Only unchanged pre-existing entries may be excluded.
- **FR-004**: Any post-start delta to a pre-existing tracked or untracked entry MUST be detected and evaluated by all existing file, line, path, dependency, configuration, migration, public API, stack, and budget rules.
- **FR-005**: A clean start MUST have lightweight or empty baseline semantics equivalent to current behavior.
- **FR-006**: Baseline evidence MUST be authoritative by content and observable state, not by modification time.
- **FR-007**: Staged, unstaged, and staged plus unstaged states MUST be evaluated without duplicate effective content against the comparison boundary. A byte-identical staging or unstaging transition MUST be excluded from changed-file and changed-line budgets and MUST produce no normal-output noise. It MUST NOT hide content deletion, creation, rename, mode, type, symlink-target, or gitlink changes. An explicit structured or diagnostic report MAY show an aggregate informational transition count only.
- **FR-008**: Tracked deletion, new files, untracked files, rename source and destination participation, and copy-as-currently-modeled behavior MUST remain consistent with current collection semantics.
- **FR-009**: Binary changes MUST have deterministic file-level treatment and contribute zero changed lines.
- **FR-010**: Strict NUL-delimited parsing failures MUST fail explicitly. Stable code-unit ordering, slash-normalized matching, and deny precedence MUST remain in force.
- **FR-011**: The system SHOULD track only the baseline surfaces needed to distinguish dirty or untracked start state where practical, with no arbitrary size limit. If any required evidence cannot be captured or persisted safely, start MUST fail with no active contract rather than omit work or activate a partial baseline.

### Lifecycle and Persistence

- **FR-012**: Baseline evidence MUST remain associated with the closed contract for auditability.
- **FR-013**: Persistence and activation MUST have failure-safe, all-or-nothing observable semantics. If capture or persistence fails, no invocation may expose an active contract or valid-looking partial baseline whose authoritative evidence is incomplete.
- **FR-014**: Persisted evidence MUST be reloaded for each invocation, and restart MUST preserve the same observable baseline and result.
- **FR-015**: Legacy contracts without baseline evidence MUST continue existing base-revision semantics, disclose legacy/no-baseline mode in status and check, and never be reconstructed automatically.
- **FR-016**: No historical migration is required.
- **FR-017**: PASS, REPAIR, and HUMAN_REVIEW MUST retain their current meanings. Close MUST remain compatible with human authority and MUST NOT redefine validation authority.

### Safety and Integrity

- **FR-018**: Baseline capture and comparison MUST not mutate user files, Git index content, refs, or commits, and MUST not stash, commit, reset, restore, or widen scope. Capture or persistence failure MUST leave no active contract or valid-looking partial baseline.
- **FR-019**: Missing, malformed, corrupt, tampered, unavailable, or uncapturable required baseline evidence during capture or persistence MUST fail safely at start with no active contract. Missing or invalid evidence encountered after activation MUST never produce PASS and MUST expose the existing unsafe or `HUMAN_REVIEW` result. The system MUST NOT omit evidence or use a timestamp fallback.
- **FR-020**: Invalid base or Git context MUST fail safely and MUST NOT fabricate PASS.
- **FR-021**: `.changebudget/**` MUST remain recursively excluded from user budgets, while Runtime Guard MUST continue blocking its mutation.
- **FR-022**: Reports MUST identify whether baseline or legacy/no-baseline semantics were used, provide a concise deterministic summary of excluded unchanged entries, and explain detected deltas and unsafe evidence states without requiring noisy normal output.

### Compatibility and UX

- **FR-023**: Existing clean-tree behavior MUST remain valid and must not require baseline evidence to be treated as a heavy or user-visible change.
- **FR-024**: Existing file cardinality, rename, binary, special-path, and decision semantics MUST be preserved unless explicitly changed by a future approved specification.
- **FR-025**: Status and check MUST provide deterministic, stakeholder-readable evidence for baseline mode and decision reason.
- **FR-026**: Baseline evaluation MUST preserve every existing enforcement rule and MUST NOT treat baseline capture as permission to modify denied or sensitive paths.

### Scale and Platform

- **FR-027**: The behavior MUST cover Windows and Ubuntu with equivalent observable decisions and deterministic path handling.
- **FR-028**: Large objects, binary content, spaces, Unicode, separator variants, and many untracked files MUST be handled without unsafe omission.
- **FR-029**: Any unsupported policy-critical object or platform condition that prevents safe evidence capture MUST fail at start safely with no active contract or valid-looking partial baseline, rather than silently excluding it, using an error or `HUMAN_REVIEW` result according to the existing CLI model. No arbitrary size limit may be used as a substitute for safe evidence.

### Repository Object and Path Semantics

- **FR-030**: For baseline-enabled contracts, a symlink MUST be evaluated as the symlink object itself. Its target or value and type changes MUST be evaluated without recursively baselining the target. An unchanged pre-existing symlink MUST be excluded.
- **FR-031**: For baseline-enabled contracts, a tracked submodule MUST be evaluated as its gitlink, and a recorded commit change MUST be evaluated without recursively baselining the nested worktree. Nested dirty work outside gitlink semantics MUST be disclosed as unsupported with deterministic `HUMAN_REVIEW` rather than silently claimed covered.
- **FR-032**: For baseline-enabled contracts, path identity MUST follow repository, Git, and platform semantics and MUST NOT use global lowercasing. Meaningful case-only renames MUST be detected. Equivalent-path ambiguity MUST resolve deterministically or fail safely, and MUST never bypass policy.

### Read-only capture and consistency

- **FR-033**: Start capture MUST observe the repository and Git state without writing `.git/**`, the index, refs, commits, stash, or nested worktrees. Baseline snapshots and metadata MUST be written only under `.changebudget/**`; those writes are ChangeBudget evidence, not user-budget changes.
- **FR-034**: For every required value, capture MUST use an observe-before, capture, observe-after protocol. The before and after observations MUST agree on identity, mode, type, size, and content or digest evidence before the value is accepted. A bounded number of retries MAY be used; exhaustion MUST fail safely with no active contract and MUST NOT use timestamps or omission.
- **FR-035**: Activation MUST be pointer-last and concurrency-safe. The implementation MUST reject a competing active-contract change or stale activation token, MUST never overwrite a newer active pointer, and MUST leave no active contract after a crash before pointer activation. A crash after pointer activation is valid only when both referenced artifacts are complete and verifiable.
- **FR-036**: Activation MUST capture and retain the exact HEAD commit identity for every baseline-enabled contract. Check MUST require exact equality before normal B-to-C evaluation. Any inequality MUST produce `BASELINE_HEAD_MOVED` and HUMAN_REVIEW, never PASS, without rewriting baseline, history, Git state, or user state. Exact return to the captured identity MAY resume comparison only after integrity validation. Legacy contracts have no HEAD binding.

### Key Entities

- **Working-Tree Baseline**: The authoritative observable contract-start state retained with a contract to distinguish inherited state from later work.
- **Baseline Entry State**: The content and relevant repository participation of one path at start, including tracked, staged, unstaged, untracked, deletion, rename, copy-as-currently-modeled, binary, and special-path distinctions where needed for safe comparison.
- **Post-Start Change Set**: The set of current observable entries whose effective content or relevant repository state differs from the baseline, after unchanged pre-existing entries are excluded and before all contract rules are applied.
- **Baseline Integrity State**: The observable condition of baseline evidence, such as valid, legacy/no-baseline, missing, corrupt, tampered, or unavailable, which controls whether evaluation may proceed and which decision is safe.

### Output and reason model

New public JSON exposes only the canonical camelCase fields `comparisonMode`, `baselineState`, `decision`, `reasonCodes`, `excludedUnchangedCount`, `detectedDeltaCount`, and optional `stagingTransitionCount`. `baselineState` is exactly one of `captured`, `legacy`, `unavailable`, `invalid`, or `incompatible`. Detailed causes exist only in `reasonCodes`; no public aliases are introduced. Snake_case names are internal or persisted schema conventions only and are not public output. Normal output prints the mode, decision, and concise reason summary only. Existing reason codes may remain where compatible, but public diagnostics for the corresponding new conditions MUST use one compact category from the normative grouping below.

| Stable diagnostic category | Corresponding condition |
|---|---|
| `BASELINE_REQUIRED_MISSING` | Missing baseline reference, artifact, required entry, or payload |
| `BASELINE_CORRUPT` | Malformed artifact or failed payload/integrity verification |
| `BASELINE_MISMATCH` | Contract/evidence association mismatch or identity collision |
| `BASELINE_UNSUPPORTED` | Unsupported schema or entry type |
| `BASELINE_PATH_AMBIGUITY` | Duplicate canonical path, invalid path identity, or unresolved path ambiguity |
| `BASELINE_HEAD_MOVED` | Current HEAD differs from the exact activation-captured HEAD |
| `BASELINE_UNSTABLE_CAPTURE` | Observe-before/capture/observe-after inconsistency or exhausted TOCTOU retry |
| `BASELINE_SUBMODULE_DIRTY` | Unsupported dirty nested submodule work outside gitlink semantics |

Every listed category for a baseline-enabled condition maps to HUMAN_REVIEW and never PASS. A HEAD return to the captured identity resumes normal evaluation only after integrity validation.

### Integrity validation matrix

Every baseline-enabled check MUST validate the following dimensions before excluding entries or returning PASS. A failure in any row remains nonlegacy, produces HUMAN_REVIEW, and never produces PASS. Path collision is resolved deterministically only when the implementation proves the resolution safe; otherwise it produces HUMAN_REVIEW.

| Dimension | Required validation | Failure handling |
|---|---|---|
| Path | Canonical repository-relative path, normalization, traversal and repository-root validity | Invalid path remains baseline-enabled and yields HUMAN_REVIEW |
| Entry identity | Unique repository/platform identity, object type, mode, and path association | Collision or ambiguity yields HUMAN_REVIEW |
| Association | Contract, evidence reference, captured HEAD identity, and entry ownership match | Mismatch yields HUMAN_REVIEW |
| Completion | All required entries, descriptors, and payloads are present | Missing or partial artifact yields HUMAN_REVIEW |
| Payload and integrity | Required content/state evidence and its integrity verification are present and valid | Missing payload or mismatch yields HUMAN_REVIEW |
| Schema and type | Supported evidence schema and supported entry type | Unsupported or malformed value yields HUMAN_REVIEW |

### B-to-C transition semantics

The baseline state is B and the current observed state is C. Equality is evaluated on effective content plus relevant object state, not on status flags or timestamps. For baseline-enabled contracts, the exact commit identity captured at activation is also bound to the check. HEAD equality permits normal B-to-C evaluation. Any inequality produces `BASELINE_HEAD_MOVED` and HUMAN_REVIEW, never PASS, without rewriting baseline or history. Returning exactly to the captured commit resumes only after integrity is valid. Legacy contracts have no HEAD binding.

| B state | C state | Result |
|---|---|---|
| tracked or untracked value | identical value and object state | Exclude as unchanged |
| staged, unstaged, or both | same effective value and object state | Exclude; aggregate staging transition is diagnostic only |
| any existing value | different content | Emit one post-start delta and apply all rules |
| any existing value | deleted | Emit deletion and apply all rules |
| absent | new value | Emit creation and apply all rules |
| existing path | renamed path | Preserve current source and destination participation without double counting |
| any object | different mode, type, symlink value, or gitlink commit | Emit semantic delta and apply all rules |
| binary value | changed binary value | Emit file-level delta with zero changed lines |
| required value cannot be compared | unknown | Fail safely; never exclude and never return PASS |

## Compatibility

This feature extends the current base-revision comparison and staged flag overlay. The clarified staging, capture, repository object, and path rules apply to baseline-enabled contracts. It does not replace Git as change truth, alter existing rule precedence, or change the lifecycle authority held by the developer. Contracts created with this feature use baseline semantics. Closed contracts retain their evidence. Older contracts retain current base-revision semantics in disclosed legacy/no-baseline mode and are not silently upgraded or reconstructed.

## Safety and Integrity

The baseline is an audit boundary, not a permission list. Capture must be read-only with respect to user and Git state. For baseline-enabled contracts, activation must be observable as either a complete valid contract with its baseline or no active contract. If capture, persistence, or integrity cannot be established, the system must expose failure and preserve the HUMAN_REVIEW path rather than returning a convenient PASS. Symlink targets and nested submodule worktrees are not recursively baselined. Legacy/no-baseline contracts retain current base-revision behavior without reconstruction.

## Explicit Non-Goals

- No wholesale ignore-by-path behavior for pre-existing files.
- No modification of user files, index content, refs, commits, or working-tree state.
- No automatic contract widening, rollback, stash, commit, reset, restore, or deletion.
- No reconstruction or historical migration of legacy baselines.
- No prescribed storage schema, hash algorithm, object format, temporary-file layout, Git command sequence, or module architecture.
- No timestamp-based authority, new policy categories, or replacement of current rule semantics.
- No recursive baseline of symlink targets or nested submodule worktrees.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The complete 56-scenario acceptance matrix, including five HEAD scenarios and twelve integrity scenarios, passes on every supported implementation.
- **SC-002**: Across all changed-after-start fixtures, detection is 100 percent, including edits to entries that existed before start.
- **SC-003**: Untouched pre-existing tracked and untracked entries produce zero false violations in the acceptance fixtures.
- **SC-004**: Clean-tree checks show no behavioral regression from current results.
- **SC-005**: Repeated checks and checks after process restart produce byte-identical or otherwise equivalent deterministic decisions, classifications, and reason data.
- **SC-006**: Tests demonstrate zero mutation of user files, Git index content, refs, or commits during start, check, status, and close.
- **SC-007**: No existing file, line, path, dependency, configuration, migration, public API, stack, deny, or budget enforcement rule is weakened by baseline mode.
- **SC-008**: Corrupt, missing, tampered, or unavailable baseline evidence produces no PASS result.
- **SC-009**: The full acceptance and regression coverage passes on Windows and Ubuntu.

## Assumptions

- The current default is that staging or unstaging alone, with byte-identical effective content, is not a user-file delta.
- Unsupported policy-critical objects fail at start safely when authoritative evidence cannot be captured.
- Existing rename and cardinality semantics remain unchanged, including current source and destination participation.
- Existing special-path semantics, deny precedence, binary zero-line treatment, strict NUL parsing, stable code-unit ordering, and slash-normalized matching remain current defaults.
- The active contract remains the authority for evaluation, while close remains compatible with an explicit human decision.
- Legacy contracts may be checked using their existing base-revision semantics, and their status and check output identifies the absence of a baseline.
- Baseline evidence is retained with the closed contract for auditability; no historical migration is expected.
- For baseline-enabled contracts, clarified symlink, gitlink, nested dirty submodule, case identity, and equivalent-path rules apply. Legacy/no-baseline contracts retain current base-revision semantics without reconstruction.
- Baseline snapshots and metadata are stored under `.changebudget/**`; `.git/**` is read-only during capture and comparison.
- Accuracy is measured against the B-to-C matrix: every changed-after-start fixture must be emitted exactly once, every unchanged pre-existing fixture must be excluded, and any uncertain comparison must fail safely.
