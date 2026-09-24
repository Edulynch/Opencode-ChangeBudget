# Quickstart: OpenCode V2 Runtime Guard

> Status: Draft — **NEEDS_CLARIFICATION**. Product semantics align with SPEC-002/003, but authenticated human issuer, local repository binding, and actual installed host permission-hook behavior are unverified blocking gates. This is a conditional acceptance strategy, not READY_FOR_TASKS, an implementation baseline, or evidence of tests. Use only disposable repositories/host captures. Pre-initialization direct-state denial is a known PENDING implementation gap.

## Safe setup

- Use a disposable repository and a disposable OpenCode host configuration. Never use a real working tree to exercise mutation cases.
- The hook outcome is the subject of the matrix; do not execute a CLI mutation merely to inspect its permission outcome.
- This document pass did not run npm tests, CLI integration, or a host session. See `tasks.md` for coverage locations and pending items.
- Do not start implementation acceptance runs until the three evidence gates in `plan.md` have passed. If an issuer, repository identity, or actual installed hook cannot be evidenced, record NEEDS_CLARIFICATION rather than simulating success with a mock-only fixture.

## Regression matrix

| State / input | Guardian V2 product direction | Runtime mapping / evidence status |
|---|---|---|
| Plugin absent or intentionally disabled | Core ChangeBudget CLI remains usable; no OpenCode runtime interception guarantee | Optional integration, not a successful block. Do not claim mutations are guarded |
| Plugin setup or permission-hook registration fails before the evaluate hook is registered | Surface the integration as unavailable; do not claim potentially mutating requests are blocked because no registered hook can intercept them | Concrete supported availability feedback is pending implementation/validation; no host check run |
| Registered permission-evaluation hook is invoked and its evaluation fails for a potentially mutating operation | `BLOCK` that intercepted operation through the supported permission path | `index.ts` catches callback evaluation failure and assigns `deny`; source inspection only, not a host-test result |
| Before initialization, ordinary non-ChangeBudget operation outside `.changebudget/**` | Passive behavior remains the existing direction | Existing FR-004 direction; not a claim of universal host behavior |
| Direct explicit human premise (including Docker + Redis Cluster + three instances) | Pursue that exact outcome; never shrink or replace it to reduce the implementation delta. Do not add optional tests/refactors/infrastructure | Normative product direction; human prose expresses intent but is not unlimited structured authority |
| Work within the explicit requested outcome and current authority | `CONTINUE`; preserve the requested outcome | Product direction; exact runtime projection is implementation planning, not a product blocker |
| Necessary mechanical closure or expansion already within human-granted authority | Use the minimum delta needed; do not shrink the requested outcome | Product direction; minimality measures authority delta, not architectural-necessity proof |
| Soft expected file/line estimate overrun | Warn of drift; overrun alone is not ASK or BLOCK | Do not silently convert estimates into `max_files`/`max_changed_lines` hard ceilings |
| Legacy non-null numeric value with no explicit provenance | Determine HARD/SOFT/UNRESOLVED from verifiable evidence; if unresolved classification is necessary, check returns HUMAN_REVIEW, never a guessed hard violation or PASS. Guardian BLOCKS an operation relying on unresolved authority; HUMAN_REVIEW is not an ASK substitute | SPEC-002 `spec.md` FR-021 defines migration/recovery; SPEC-003 `spec.md` FR-002/FR-003/FR-004/FR-007 defines decision precedence. Keep known violations and deny/protected boundaries in the report |
| Human-entered exact numeric CLI value versus preset/recommendation | HARD only if verified evidence establishes the authorized human's exact value and intent as a ceiling in the relevant repository/work, or trusted policy provenance establishes that exact ceiling. A CLI invocation alone cannot prove actor or ceiling intent. A verifiable unadopted planner/preset/advisor recommendation is SOFT; ambiguous origin/intent is UNRESOLVED | Numbers, `max_*` names, preset labels/selections, task budget/defaults, free-text reasons, storage, and historic check results prove neither issuer nor hard-ceiling intent. Existing contracts remain readable; no schema migration or retroactive grant |
| Provenance-qualified hard `max_files`/`max_changed_lines` exceeded | Check reports a concrete REPAIR violation; new authority is required for Guardian to rely on a higher bound, and only the minimum delta is considered | Owner semantics are aligned at SPEC-002 `spec.md` FR-009/FR-010/FR-021 and SPEC-003 `spec.md` FR-002/FR-003/FR-004/FR-007; example 18→19, not ceiling 60 |
| Minimal exact-path authority amendment | Amend only the required exact path, e.g. `src/foo.ts`, not `src/**` | Product direction; existing owner allow-list/deny-list semantics stay intact |
| Direct file/edit, shell, or Git mutation targeting `.changebudget/**`, including before initialization | `BLOCK` in every repository state | Normative product invariant; current source has a passive-order gap and this is PENDING, not passing |
| Recognized read-only CLI examples (`status`, `diagnose`, help/version, read-only `check`, `update --check`, `integrate opencode --dry-run`) | Classifier examples only; read-only intent is distinct from lifecycle mutation | Static forms appear in #41 evidence; beta.7 host observations conflict, so do not claim universal allow/conformance |
| Recognized `start` | Autonomous when no authority beyond the human premise/valid grant is needed; create narrow requested contract values, never max grant ceilings as a template | Product condition; runtime projection is not claimed implemented |
| Minimal grant-covered `amend` and necessary `REPAIR` | Use the minimum concrete delta and continue; no new ask when a valid grant already covers it | REPAIR is not a blanket stop; minimality is authority delta |
| Normal `close` after `PASS` and required completion conditions | Autonomous | Product condition; source's developer-agreement instruction is a pending divergence |
| Clean first-time CLI `init` | May proceed autonomously in an eligible repo with no conflict/overwrite when an authenticated direct setup request or a verified parent premise for the bounded work covers necessary initialization; no separate exact-init request is required | A raw CLI invocation alone is not authorization; CLI init is distinct from direct `.changebudget/**` writes, which block in every state |
| `integrate opencode --dry-run`, `update --check`, proven-owned wrapper refresh | Autonomous | Read-only/proven ownership condition; not a claim of current host conformance |
| First real integration or real package update | Requires explicit human setup/integration request or explicit user update request respectively; no background coding update | Prior universal ask rule is obsolete; explicit request conditions are normative |
| Satisfaction-evidence `check` or another lifecycle form not enumerated as autonomous | Apply the authority sequence; do not assign a blanket ask or invent an effect | Product sequence is defined; exact projection is planning design |
| Force close or bypass | Preflight may ASK for the exact fresh approval only through a verified human channel; do not execute while pending. An actual force execution attempt without prior approval, a rejected/stale approval, or an unavailable/unverified channel BLOCKS/is unavailable. Fresh approval covers one force operation only; never permits direct protected writes | A generic host `ask` reply or saved `always` rule does not authenticate approval; stale/ordinary grant reuse is insufficient |
| Optional or unnecessary/oversized approach | REFOCUS only when optionality is separately verifiable; an untrusted/absent optionality hint does not affect an operation already within current valid authority, which CONTINUES | Workflow concept only; REFOCUS is not a command, exit code, runtimeAction, enum, state, API, or schema |
| Genuine minimum new authority/material work | ASK only for a concrete uncovered minimum through a verified fresh-human channel; without it, do not execute or mint authority and surface approval as unavailable | Do not repeat consent for already granted authority |
| Sensitive category explicitly named in the human premise | No redundant ask solely because of the category | Novel expansion is authority-evaluated; protected and force gates remain separate |
| Unsafe, protected, forged, unknown, malformed, or unrecognized attempted ChangeBudget invocation | BLOCK / fail closed | Product invariant; some pre-initialization classification is a known PENDING source-order gap |
| Grant is malformed, forged, cross-repository/task, revoked, expired, consumed, or stale | BLOCK rather than ASK | A reported-consumed grant blocks; stage-to-stage reuse in one active bounded START→AMEND→REPAIR→CLOSE lifecycle is not consumed replay; no unrelated replay after CLOSE |
| Autonomous authority-consuming lifecycle operation | Retain structured ChangeBudget-owned evidence: requested operation, current authority, grant/premise coverage, minimal delta, subset/boundary checks, no-prompt rationale, and any REFOCUS/ASK/BLOCK decision and reason | MVP evidence requirement supersedes historical no-audit clarification; no store prescribed and current implementation is not claimed to capture it |
| MVP boundary | Provenance, covered START, canonical grants, minimum numeric/exact-path AMEND, REPAIR autonomy, REFOCUS, normal CLOSE, all-state direct protection, repo/work binding, replay/staleness, and evidence are in scope | Defer cloud/distributed authorization, arbitrary third-party issuers, organization grants, cryptographic federation, and LLM compliance as enforcement authority |
| Absolute CLI executable path | Recognize only after verified identity as shim for installed ChangeBudget package | Classifier evidence only; matching a string/name is insufficient and universal Windows-wrapper support is not claimed |
| Supported `git ls-files`, `git check-ignore`, and `git status` pathspec/split-resource forms | Treat only the complete recognized resource set as read-only; do not let unknown/mutating siblings inherit that classification | #36/beta.6 source/test evidence covers supported forms only; no claim of all-host Git parsing |
| Budget/file/line estimate overrun | Warn of drift; a minor estimate overrun alone does not block an exact authorized outcome | Owner semantics now distinguish advisory estimates from provenance-qualified hard caps; retain soft drift as an auditable advisory, never silently reinterpret |
| Out-of-scope path or sensitive-category match by itself | Evaluate the concrete operation against current premise/grant: CONTINUE if covered; REFOCUS only on separately verified optionality; ASK only for a proven uncovered minimum through a verified channel; without a channel, do not execute and surface approval as unavailable; BLOCK actual protected/denied/unsafe or unknown target/authority | Prior blanket asks are OBSOLETE; lack of optionality proof alone does not block a covered operation. SPEC-002 allow-list and hard-deny semantics remain owned and must not be weakened |
| Existing `REPAIR` or `HUMAN_REVIEW` policy result | Neither alone grants authority nor defines a blanket runtime stop | REPAIR within current authority may continue; HUMAN_REVIEW reasons distinguish REFOCUS, ASK, or BLOCK per the product sequence. Exact runtime projection is planning design |

For initialized direct-state cases, verify that shell and file/edit attempts against `.changebudget/**` block as well. Existing integration coverage locations are listed in `tasks.md`; their presence is not a result for this matrix.

For asks required by the resolved new-authority rule, FR-012's operation context, applicable policy rationale, active contract id, and one-line recommendation remain unverified by current source/test locations. Implement and validate those details against the product-triggered asks; do not preserve blanket old ask triggers.

The current injected session guidance in `opencode-plugin/src/index.ts:38-56` remains a **PENDING SOURCE DIVERGENCE**: it requires explicit approval for every exact-path amendment and developer agreement before close, while Guardian V2 permits conditional autonomy for minimally covered `amend` and normal `close` after `PASS`. It also requires developer-approved paths/budget before `start`, potentially duplicating approval when prior authority already covers the requested contract. The guidance is not documented as updated. Its targeted-validation text concerns checks relevant to the requested outcome; it does not authorize adding optional test files or unrequested infrastructure.

The estimate/hard-ceiling semantics and audit evidence above are internally consistent for planning and align with the owner clauses cited in `spec.md`; SPEC-002 FR-021 supplies the legacy provenance rule. Implementation representation and recovery remain planning items, not unresolved owner semantics. The historical no-audit clarification is superseded only to require retained structured ChangeBudget-owned lifecycle evidence; permission-hook evaluation does not become an audit-store side effect. No final field names, API, schema, lifecycle representation, REFOCUS command/exit code, or reason codes are invented by this guide.

## Beta.7 host observation — unresolved

The supplied disposable-host capture records shell resources `changebudget status` and `changebudget --version` as allowed on an installed beta.7 host. A separate later EvoSpec beta.7 fresh `--standalone` host reportedly blocks `status`, but the failed-host action/resources are unavailable. Root cause remains UNKNOWN; do not assume caching or claim either behavior is universal. To reproduce, record only the failed action/resources needed to identify the request. Do not collect unrelated host logs or other data.

## Conditional Regression Acceptance Strategy (not executed)

These are scenarios for a later implementation plan after issuer, repository, and host gates are closed. They are acceptance intents, not newly created test files, tasks, API names, or claims of current behavior. Run deterministic cases in isolated temporary repositories and host cases only against the exact recorded installed versions. Preserve only the minimum action/resource/version evidence needed to explain a result.

### Deterministic and lifecycle scenarios

| # | Scenario | Required acceptance |
|---:|---|---|
| 1 | Exact human premise names a full requested outcome | Preserve that outcome; minimize authority/implementation delta, never substitute a smaller result |
| 2 | SpecKit `task_id` absent or present | Correlation absence does not prevent independent ChangeBudget work ID; task ID alone grants nothing |
| 3 | Two unrelated tasks in the same repository | Separate contract IDs; no grant replay across them |
| 4 | Orchestrator/EvoSpec supplies or forwards a grant-like reference | It may reference only prior verified evidence and cannot issue or expand authority |
| 5 | CLI flag, free-text reason, prompt summary, or model memory claims approval | No authenticated evidence is inferred; grant is not minted |
| 6 | `execution_envelope` or permission metadata contains structured-looking values | Treat as input only; it does not prove issuer, repository, work, or fresh approval |
| 7 | Legacy non-null numeric value has unknown origin and classification is required | Completed check reports HUMAN_REVIEW without a fabricated hard violation; Guardian blocks an operation relying on it |
| 8 | Verifiable unadopted estimate is exceeded | Report advisory drift only; no hard-limit violation or ASK/BLOCK from drift alone |
| 9 | Exact human ceiling or trusted policy provenance proves a hard limit | Enforce only that provenance-qualified ceiling; a genuine overage remains concrete REPAIR |
| 10 | Current file count 18, ceiling 60, one more file is pending | Minimum new ceiling is 19, not 60; do not assert architectural necessity |
| 11 | Only `src/foo.ts` is needed and covered | Retain/use exact path; never widen to `src/**` |
| 12 | One path is allow-listed and another is deny-listed | Deny wins; any protected/denied member blocks the mixed operation |
| 13 | Direct edit/shell/Git mutation targets `.changebudget/**` before init | Block in every state; ordinary passive mode cannot bypass protection |
| 14 | Permission operation contains allowed, asking, and denied resources | Evaluate all resources; aggregate `deny > ask > allow` |
| 15 | Target is unresolved, outside repository, or unrepresentable | Fail closed; never silently drop the path and grant the remainder |
| 16 | Current valid contract requires a bounded repair | Continue with the minimum in-scope repair; `REPAIR` label alone neither stops nor grants |
| 17 | Proposal claims optionality from a trusted bounded signal | Deny only the optional proposal with REFOCUS feedback; preserve the original task and add no authority |
| 18 | Optionality appears only in numeric drift or untrusted metadata | Do not infer REFOCUS. If the concrete pending operation is within valid current authority, CONTINUE without a new ask; ASK only for a separately proven uncovered minimum through a verified fresh channel; without one, do not execute and surface approval as unavailable. BLOCK only if the target or authority actually relied on is unknown/unsafe |
| 19 | REFOCUS includes outgoing session context guidance | Guidance is advisory to a later request and changes no permission effect, contract, or grant |
| 20 | New path/limit exceeds current union by a concrete minimum | ASK only for that uncovered minimum through a verified fresh human channel; without one, do not execute or mint authority and surface approval as unavailable |
| 21 | Client chooses host permission `always` | Saved project rule never counts as a ChangeBudget grant and never skips per-operation evaluation |
| 22 | Force close is requested before fresh approval | Preflight-ASK for the exact force-close operation only through a verified supported human channel; do not execute while pending. A generic host `ask`/`once` response or saved `always` is not sufficient by itself |
| 23 | Force execution is attempted without prior verified approval, or approval is rejected/stale/channel is unavailable | BLOCK execution (or report integration unavailable if the verified channel cannot be established); the initial preflight is only an ASK, and no ordinary/stale grant or saved host rule may substitute |
| 24 | Grant used across START→AMEND→REPAIR→CLOSE for one active contract | Permit only bounded stage reuse within that lifecycle and retain each authority-consuming event |
| 25 | Closed contract grant is presented for later unrelated work | Block; closed identity is terminal for replay |
| 26 | Repository is cloned or moved and binding tuple changes | Mark prior evidence stale and require fresh authorization; do not prompt to rebind old evidence |
| 27 | `.changebudget` is copied or repository replaced at the same path | Do not claim identity safety unless the declared binding detects it; otherwise gate remains unresolved and operation blocks |
| 28 | Audit/evidence write fails before an authority-consuming lifecycle transition | Fail closed; do not commit the state/operation without retained evidence |
| 29 | Same authorization/operation request is retried after a crash or duplicate delivery | Deterministic dedupe prevents reapplying/widening; ambiguous partial write stops for reconciliation |
| 30 | Clean first-time `init` versus conflicting/pre-existing state | Authenticated direct setup request **or** verified parent premise covering necessary initialization may initialize only eligible clean state; no separate exact-init request is needed. Raw CLI invocation alone is not authorization; conflict or overwrite blocks |
| 31 | `start` runs before any active contract exists | Mint/use a draft work ID; retain verified authorization before activation; never presume an active grant |
| 32 | Normal close follows PASS and required completion conditions | Close the matching active work autonomously and terminally; no redundant developer-agreement ask |
| 33 | `integrate opencode --dry-run` versus first real integration | Exact dry-run is read-only; real integration requires explicit verified setup intent |
| 34 | Proven-owned wrapper refresh versus unowned target | Refresh only proven-owned exact target; ownership uncertainty or out-of-repo path blocks |
| 35 | `update --check` versus real package update | Check is read-only; real update requires explicit user update request and is not background coding |
| 36 | Unknown/malformed ChangeBudget command or attempted wrapper before init | Block/fail closed; no blanket ASK and no passive-mode bypass |
| 37 | Permission evaluator receives valid `materialDecision` | Evaluation does not persist a ledger; lifecycle-owned transaction is the only allowed place for retained evidence |
| 38 | Shell mutation names ordinary and protected paths in both operand orders | Classify all operands; block if any target is protected (current multi-target risk is suspected, not reproduced) |
| 39 | Edit targets an absolute path outside the worktree | Block as out-of-repository even if ordinary in-repo paths are also present |
| 40 | Check has a fatal repo/contract/base prerequisite versus unresolved numeric evidence | Fatal prerequisite yields no completed result as specified; unresolved material provenance yields completed HUMAN_REVIEW when prerequisites pass |
| 41 | Concrete operation is within current valid authority but an untrusted/absent hint calls it optional | CONTINUE the covered operation; do not REFOCUS or ASK from the hint, do not infer authority failure, and make no LLM optionality judgment |
| 42 | Force close preflight, pending response, and next operation | ASK for one exact force operation only via verified fresh-human channel; do not execute while pending; rejection/stale/unavailable channel blocks; a fresh exact event permits only that operation |

### Installed OpenCode V2 host acceptance scenarios

| # | Scenario | Required evidence |
|---:|---|---|
| H1 | Capture exact OpenCode build and installed `@opencode/plugin` package/types | Versioned evidence shows the supported registration and exact permission-evaluate event/effect/message contract; source mocks do not count |
| H2 | Register hook and issue a simple edit and shell mutation | Demonstrate callback runs before the operation, receives exact action and complete resource set, and its supported deny actually prevents the operation |
| H3 | Multi-resource permission evaluation with incoming deny | Show all resources reach evaluation, mixed outcomes combine deny-first, and incoming deny is never weakened |
| H4 | Client responds to ask with `once`, `always`, and reject | `once` is limited to the pending host request; `always` persists a project rule but never creates a grant or skips ChangeBudget evaluation; record exact observed scope |
| H5 | Prompt admission hook transforms input | Confirm it transforms persisted user text and exposes no typed rejection/verified issuer result; do not treat transformed text as original authority |
| H6 | Session context hook adds guidance | Confirm it affects outgoing model-call context only, not persisted transcript or an already denied operation |
| H7 | Plugin or permission-hook registration fails | Show the supported integration-unavailable feedback; do not claim that a missing/unregistered hook denied the mutation |
| H8 | Fresh isolated reproduction of beta.7 `status` discrepancy | Capture only failed host version, action, exact resources, and outcome; compare with supplied allowed capture without assuming a root cause |
| H9 | Fresh approval/force response correlation | Prove a human-originated response is bound to the exact pending operation/scope and ChangeBudget event; if unavailable, issuer gate remains blocked |
| H10 | Plugin instance location versus session/worktree location | Prove each operation is bound to its actual current repository, including session/worktree changes; plugin `ctx.location` alone is insufficient |
| H11 | Force-close preflight and host approval replies | Verify a fresh exact approval is correlated to one force-close operation before execution; generic `ask`/`once`/saved `always` does not itself prove the ChangeBudget issuer event; rejected/stale/unavailable approval blocks or surfaces unavailable, and direct `.changebudget/**` remains denied |

This documentation task ran no project test, type check, build, CLI mutation, or host session. The listed scenarios are unexecuted acceptance requirements only.
