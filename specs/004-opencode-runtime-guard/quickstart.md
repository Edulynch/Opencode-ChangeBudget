# Quickstart: OpenCode V2 Runtime Guard

> Status: **READY_FOR_TASKS — planning only**. Guardian V2 product decisions are finalized. Implementation, filesystem/identity validation, and installed-host interception evidence remain pending. This is not an implementation baseline or evidence that tests, host checks, or physical-identity proofs passed.

## Safe setup and status

- This document pass ran no project tests, CLI mutations, filesystem identity probes, or OpenCode host sessions.
- Future implementation validation uses disposable repositories and host profiles. Never use a real working tree for mutation experiments.
- A missing or unregistered hook is an integration-unavailable condition, not a successful block. Do not claim writes are blocked unless supported interception is proven.
- No live OpenCode once/reject ASK experiment is required for task generation. A host ASK response is operational only and cannot establish ChangeBudget-native approval or canonical HARD authority.

## Focused Phase A repository gate (definition only)

`npm run test:phase-a` compiles the project and runs only the explicit repository-relative test manifest below. The manifest is fixed by ownership, not discovered from Git, globs, or a numeric test-count target. `npm test` remains unchanged and continues to be the full-suite command. To inspect the exact list and compiled runner arguments without compiling or running tests, use `node scripts/test-phase-a-focused.mjs --list`.

The first group contains the Phase A tests already modified or added in this work set (19 modified files and the new recovery test):

- `tests/acceptance/spec005-stack-policy-metrics.test.ts`
- `tests/acceptance/spec008-reliability-metrics.test.ts`
- `tests/integration/amend-runtime-re-evaluation.spec.ts`
- `tests/integration/check-budget-engine.spec.ts`
- `tests/integration/lifecycle-init-start-status-check.spec.ts`
- `tests/integration/opencode-plugin-runtime-hook.spec.ts`
- `tests/integration/cli/amend.test.ts`
- `tests/integration/package-contents.test.ts`
- `tests/unit/amend-command.test.ts`
- `tests/unit/changebudget-command.test.ts`
- `tests/unit/check-rules.test.ts`
- `tests/unit/contract-validation.test.ts`
- `tests/unit/forced-close.test.ts`
- `tests/unit/integration-opencode-invariants.test.ts`
- `tests/unit/opencode-runtime-projection.test.ts`
- `tests/unit/scope-amend-command.test.ts`
- `tests/unit/start-command.test.ts`
- `tests/unit/state-validation.test.ts`
- `tests/unit/status-check-close.test.ts`
- `tests/unit/lifecycle-lock-recovery.test.ts`

The direct-owner additions cover first-party/tagged-install identity, lifecycle transitions and state helpers, CLI help, baseline activation, installed Runtime Guard behavior, and packaged runtime behavior:

- `tests/unit/smoke-tagged-install.test.ts`
- `tests/unit/state-transitions.test.ts`
- `tests/unit/state-helpers.test.ts`
- `tests/integration/integration-opencode-runtime.spec.ts`
- `tests/integration/cli/help.test.ts`
- `tests/integration/baseline/activation.spec.ts`
- `tests/acceptance/tagged-install.test.ts`

Together these are 27 explicitly owned TypeScript test files, mapped deterministically to their `dist/tests/**/*.js` outputs and passed as explicit arguments to Node's test runner with its default concurrency. The list includes provenance/check coverage, lifecycle START/CLOSE/recovery and audit coverage, evaluator purity, T016-related tagged-install diagnostics, first-party identity, and packaged Runtime Guard coverage. Historical suite-size/count claims are not authoritative for this focused gate; this definition is not a passing-test or conformance claim.

## Product decision matrix

| Situation | Final product behavior | Evidence/status |
|---|---|---|
| Exact direct-human premise | Preserve the complete requested outcome, including Docker + Redis Cluster + three instances. Minimize implementation/authority delta; do not add optional tests, refactors, or infrastructure. | Final product decision; no implementation claim. |
| Routine authorized work | Autonomous scope includes clean eligible `init`, narrow premise/grant-covered `start`, localized edits to the requested task surface and relevant tests/mechanical changes, within-authority repair, minimum covered `amend`, and `close` after `PASS` plus required completion. | Does not silently authorize protected or unrequested paths, dependencies, migrations, config, public API, force, unrelated roots, or admin. |
| New material HARD authority | Provide only a minimum concrete proposal and user-facing instructions; BLOCK the guarded agent operation pending a separate native ChangeBudget action performed by a human outside governed agent execution. | This request/proposal is not a runtime `ask`. No ChangeBudget grant is created by an agent. |
| ChangeBudget create/expand/revoke/rebind from an agent through guarded Runtime Guard path | MUST BLOCK, regardless of saved OpenCode `always`/allow rules. Human executes the ChangeBudget-owned administrative action outside that path. | Selected model: **CHANGEBUDGET_NATIVE_APPROVAL_REQUIRED**. Rebind audit includes old/new binding; grants do not silently migrate. |
| Ordinary OpenCode `ask`/`once`/`always` | May remain an operational permission mechanism for normal host operations. It never establishes canonical HARD authority, creates/expands a grant, satisfies native approval, or replaces per-operation ChangeBudget evaluation. | `always` is not a ChangeBudget grant. No live ASK trace claimed or needed for task generation. |
| Canonical grant reference | ChangeBudget-owned identifier/reference bound to exact paths, capabilities, ceilings, repository/work, authority/schema version, provenance, and lifecycle. Only the orchestrator receives the canonical identifier; agents receive bounded work instructions. | No new field/schema/API/command/default is selected here. |
| Repository binding | User-owned registry outside the repository + repo-local public reference + physical ChangeBudget anchor associated with Git common-dir. Linked worktrees sharing the common-dir share a local repository authority domain; grants remain work-bound. | Registry is local user-owned state, not a cloud/global grant database. No binding proof claimed. |
| Physical identity unavailable/unreliable | HARD binding fails closed. Routine operations not relying on HARD authority may continue. No path, remote, or copied-UUID fallback. | File-ID/reliability proof is implementation validation. |
| Same common-dir with changed working contents | Same repository instance; Git baseline/contract rules handle content. A same-path replacement is a new instance only when the Git common-directory instance changes. | Product definition; filesystem cases remain untested. |
| Move, clone, copy, cross-machine | Move preserves HARD authority only with verified physical identity. Clone/full-copy/cross-machine transfer does not inherit HARD authority. | No silent grant migration. Explicit human rebind is audited old/new. |
| Threat boundary | Excludes a malicious unrestricted same-user OS actor able to tamper with external/repository/anchor/admin paths. | No cryptographic federation or OS sandbox is claimed. |
| Soft estimates and legacy provenance | Expected file/line counts are advisory; overrun alone does not ask/block. HARD numeric ceilings require qualifying provenance; verified unadopted estimates are SOFT; ambiguous legacy values are UNRESOLVED. | SPEC-002 FR-021 and SPEC-003 remain authoritative. Check-level HUMAN_REVIEW remains distinct from runtime BLOCK when an operation relies on unresolved authority. |
| Minimum authority delta | With current 18 and ceiling 60, one needed file means 18→19, not 18→60. If sufficient, authorize `src/foo.ts`, not `src/**`. | Minimality is authority delta, not an architectural-necessity proof. |
| REFOCUS | Before escalation, refocus a verified optional/oversized proposal to the exact requested outcome. An absent/untrusted optionality hint does not stop a covered operation. | Workflow concept only; not runtime effect, command, exit code, enum, API, or schema. |
| Path and category policy | Preserve SPEC-002 allow-list and hard-deny semantics. A path mismatch or sensitive-category label alone is not a universal ASK. Protected/denied paths always block. | No weakening of owner semantics. |
| Force execution | Agent-path force execution without separate verified fresh native authorization MUST BLOCK. Host `ask`/`once`/saved `always` is never that authorization. Valid force authorization covers only that operation and never direct protected writes. | No force-channel proof or runtime conformance claimed. |
| Direct `.changebudget/**` mutation | BLOCK in every repository state, including before initialization. Recognized CLI lifecycle operations remain distinct from direct state writes. | Current source has known pre-init gap; implementation validation pending. |
| Hook absent/setup/registration failure | Core CLI remains usable; report integration unavailable through supported feedback and do not claim writes were blocked. | Concrete host feedback and interception proof are implementation acceptance. |
| Registered hook invoked; mutating evaluation fails | BLOCK only the intercepted operation via supported deny path. | Source inspection is not host proof; registration failure is not successful blocking. |
| Lifecycle and integration | Clean eligible init, narrow covered start, minimum covered amend, within-authority repair, and normal close after PASS may proceed. `integrate opencode --dry-run`, `update --check`, and proven-owned wrapper refresh may be autonomous; real integration/update need explicit user request. | Raw CLI invocation alone is not authorization; new canonical authority uses the native admin flow above. |
| Audit | ChangeBudget-owned lifecycle handling retains structured evidence for every autonomous authority-consuming operation and every native grant administration action (create/expand/revoke/rebind); rebind evidence includes old/new binding. Permission-hook evaluation does not persist it. | Audit-write failure must prevent the consuming/admin operation from committing; implementation/retry behavior pending. |

## Implementation validation backlog (not task-generation blockers)

Run only in disposable repositories/host profiles. These are acceptance requirements for implementation conformance, not product-decision gates. This planning pass did not execute them.

| Area | Required future validation |
|---|---|
| Native admin boundary | Prove guarded agent-path create/expand/revoke/rebind always blocks even with saved host allow/always; prove minimum proposal/user instructions and human ChangeBudget-owned action outside the governed path; prove host ASK never becomes canonical HARD authority. |
| Hook enforcement and availability | Verify exact installed OpenCode/plugin versions, supported registration, complete resources, pre-operation interception, deny/effect behavior, incoming-deny preservation, and supported integration-unavailable feedback. A registered callback failure may deny only an intercepted operation; an unavailable/unregistered hook is not proof of a block. |
| Physical/local binding | Validate user-local registry, repo-local reference, physical anchor/common-dir association, linked worktrees, same-instance content changes, same-path replacement, moves, clone/full-copy/cross-machine behavior, physical-ID unavailability/reliability/reuse, and explicit audited rebind. Cover POSIX, Windows file-ID reuse, and OneDrive. |
| Filesystem/target safety | Validate direct-state protection, multi-target mixed operations, out-of-repository/unrepresentable resources, unknown wrappers, pre-init cases, and full-resource restrictive aggregation. These are not yet reproduced or passed. |
| Lifecycle evidence | Validate minimum scope, grant/work/repository/version/lifecycle binding, write failure, duplicate/retry/crash behavior, close terminality, and audit retention without permission-hook writes. |
| Historical beta.7 observation | **SEPARATE_RUNTIME_INVESTIGATION**. The supplied `status` observations conflict and the failed-host action/resources are missing. Root cause is unknown; do not infer caching or claim universal behavior. Capture only the minimum action/resource/version evidence if separately investigated. |

No new physical-identity proof, POSIX/Windows/OneDrive result, host ASK trace, beta.7 reproduction, multi-target/out-root test result, or installed-hook conformance is claimed. These future validations do not prevent task generation. No tasks are generated by this document.
