# Tasks: OpenCode V2 Runtime Guard

> Current specification gate: Draft — READY_FOR_PLANNING for coordinated Guardian V2 work. Numeric-provenance and decision semantics are aligned with SPEC-002/003; the historical implementation checklist below is not a Guardian V2 plan, test authorization, implementation baseline, or evidence that the old policy projection is still valid.

Current product direction: preserve the exact direct-human requested outcome; minimize implementation/authority delta only; continue within current authority; use the mechanically implied minimum delta or minimum valid-grant-covered delta; REFOCUS optional work before escalation; ASK only for minimum materially new authority; BLOCK invalid/unsafe/protected/forced-without-fresh-approval/unknown work. Soft estimates are advisory; provenance-qualified `max_files`/`max_changed_lines` are hard. `REFOCUS` is not a command, exit code, runtimeAction, API, or schema. The exact sequencing, lifecycle rules, grant validity, audit evidence, owner clauses, and prohibited inventions are normative in `spec.md`.

## Setup and model

- [x] Pin `@opencode/plugin@2.0.12` and compile the isolated plugin package.
- [x] Define runtime policy/action types and stable rule constants.
- [x] Implement deterministic projection for passive, repair, review, path, sensitivity, and unresolved cases.
- [x] Implement target normalization and mutation-intent inference.
- [x] Load lifecycle state, active contracts, and existing execution-gate decisions.

## Native V2 runtime

- [x] Export `Plugin.define({ id: 'changebudget', setup })`.
- [x] Register the `session.context` hook and inject deterministic workflow guidance once.
- [x] Register the `permission.evaluate` hook and evaluate every resource.
- [x] Aggregate permission outcomes restrictively and preserve incoming denies.
- [x] Normalize explicit structured material decisions from permission metadata only.
- [x] Fail safely on corrupt state, missing contracts, evaluator failures, and unresolved mutations.

## Verification

- [x] Cover the projection truth table and stable rule identifiers.
- [x] Import the generated wrapper from disposable repositories and verify native hook names.
- [x] Cover passive allow, in-scope allow, out-of-scope ask, protected-path denial, sensitive asks, restrictive aggregation, and malformed state.
- [x] Verify core CLI behavior, baseline legacy modes, and explicit structured execution-gate decisions remain unchanged.
- [x] Build and typecheck both root and plugin projects.

## Clarification and traceability matrix (added 2026-09-24)

The historical checkmarks above are preserved as recorded history; they are not re-run or re-certified by this documentation pass. Source/test references below identify coverage locations, not passing evidence. Where those locations assert universal CLI asks, broad `REPAIR`/`HUMAN_REVIEW` blocks, or blanket out-of-scope/sensitivity asks, they evidence the prior mapping only; those rules are **OBSOLETE — REQUIRES REVISION** and are not current Guardian V2 acceptance criteria.

| Change / requirement | Implementation or coverage reference | Status / provenance |
|---|---|---|
| #36 Git scanner: supported read-only `git ls-files`, `git check-ignore`, `git status` pathspecs, split status-option/pathspec resources, and mutating/unknown resources | `opencode-plugin/src/index.ts`; `tests/integration/opencode-plugin-runtime-hook.spec.ts:171-372` | Historical #36 / beta.6 source and test locations inspected only; evidence is limited to supported scanner forms; no tests run here |
| #41 static CLI classifier and prior managed-lifecycle projection | `opencode-plugin/src/changebudget-command.ts`; `opencode-plugin/src/projection.ts`; `tests/unit/changebudget-command.test.ts:12-96,98-139`; `tests/unit/opencode-runtime-projection.test.ts:33-108`; integration lifecycle cases at `tests/integration/opencode-plugin-runtime-hook.spec.ts:206-282` | Historical #41 / beta.7 source and test locations inspected only. Classifier evidence is not Guardian V2; one-ask-per-mutation is obsolete as a universal rule; no tests run here |
| Setup/registration failure versus registered-hook evaluation failure | `opencode-plugin/src/index.ts:730-765` | **PENDING availability behavior:** the registered callback catches evaluation errors and sets `deny`; setup/registration failure before that callback exists cannot be claimed to block mutations. Surface integration unavailable; concrete supported feedback is an implementation/validation item. Source inspection only, no host test |
| Injected session instructions versus conditional lifecycle autonomy | `opencode-plugin/src/index.ts:38-56` | **PENDING SOURCE DIVERGENCE:** current guidance requires developer-approved paths/budget before start, explicit approval for every exact-path amendment, and developer agreement before close. Amendment/close guidance conflicts with conditional minimal-AMEND/normal-CLOSE autonomy; the start instruction also conflicts where prior premise/grant already covers requested paths/budget. The instructions have not been updated. Relevant validation is not authorization to add optional tests. |
| Direct `.changebudget/**` mutations blocked in every state; unsupported wrappers fail closed | Normative `spec.md` FR-010/FR-022; current `projection.ts` passive branch precedes target protection and unresolved-mutation handling; existing integration denial cases are initialized | **PENDING implementation/evidence gap:** pre-init direct-state or some malformed/unrecognized wrapper operation may be allowed; initialized-only cases do not establish all-state behavior |
| Ask message context (FR-012) | `opencode-plugin/src/projection.ts` `buildMessage`; existing CLI tests primarily assert rule codes | **PENDING:** current messages/test assertions do not establish operation context, policy rationale, contract id, and recommendation |
| Multi-target shell path coverage | CODE-INSPECTION SUSPECTED: `opencode-plugin/src/index.ts:438-450` selects the first path-like token only | **PENDING; not reproduced:** in a disposable initialized PASS repository, test ordinary + `.changebudget/state.json` targets in both operand orders; verify all targets are considered and any protected target blocks |
| Out-of-repository edit target handling | CODE-INSPECTION SUSPECTED: `toRepoRelativePath` returns `null` outside root (`index.ts:289-297`), while `toRuntimeContext` preserves `operation.isTargetResolved` in its null-path branch (`index.ts:659-677`) | **PENDING; not reproduced:** in a disposable initialized PASS repository, submit an absolute edit target outside root and verify it fails closed rather than silently allowing |
| Beta.7 `status` host discrepancy | Observations recorded in `research.md` | **PENDING / UNKNOWN:** failed-host action/resources unavailable; no caching conclusion |
| Requirements checklist review | `checklists/requirements.md` | **PENDING full reviewer-owned requirements-quality re-review.** Existing checks are historical, not fresh signoff; READY_FOR_PLANNING is the product gate only and does not mark this checklist approved. |
| Cross-spec numeric-provenance and decision semantics | SPEC-002 `spec.md` FR-009/FR-010/FR-021; SPEC-003 `spec.md` FR-002/FR-003/FR-004/FR-007 | **OWNER SEMANTICS ALIGNED:** hard ceilings require verifiable exact human/policy authority, soft recommendations remain advisory, and unresolved legacy provenance yields HUMAN_REVIEW when material to safe evaluation. No schema migration or new reason code is specified. SPEC-002 FR-011/FR-012 remain owning-spec allow-list/hard-deny rules. |
| Exact outcome, authority delta, refocus sequence, REPAIR/HUMAN_REVIEW reasons | `spec.md` Guardian V2 product direction and FR-024–FR-028 | **RESOLVED PRODUCT DIRECTION:** examples include Docker + Redis Cluster + three instances, 18→19 rather than ceiling 60, and exact `src/foo.ts` rather than `src/**`; minimality is authority delta, not architecture proof. |
| Human premise, canonical grant, verified human event, lifecycle binding/replay | `spec.md` FR-024; `contracts/runtime-decision-contract.md` | **RESOLVED PRODUCT DIRECTION; representation/plumbing is planning design.** Orchestrator is not issuer; invalid/stale/cross-boundary grants BLOCK; bounded START→AMEND→REPAIR→CLOSE reuse is not replay; successful close prevents unrelated replay. |
| Lifecycle, integration/update, sensitive-category, forced operation conditions | `spec.md` Guardian V2 product direction and FR-021/FR-025/FR-027 | **RESOLVED PRODUCT DIRECTION; exact runtime projection remains planning design.** Clean first INIT conditions, covered START, minimal grant-covered AMEND, normal CLOSE, read-only checks, explicit real-operation requests, sensitive premise, and fresh force approval are documented. |
| Structured authority evidence MVP | `spec.md` FR-017/FR-028; `plan.md` | **REQUIRED PRODUCT EVIDENCE, NOT IMPLEMENTATION CLAIM:** ChangeBudget-owned lifecycle evidence per autonomous authority-consuming operation. No store prescribed; no permission-hook side effect. |
| MVP boundary | `spec.md` MVP scope and deferrals; `plan.md` | **IN SCOPE:** provenance, covered START, canonical grant, minimum numeric/exact-path AMEND, REPAIR autonomy, REFOCUS, normal CLOSE, all-state direct protection, repo/work binding, replay/staleness, audit evidence. **DEFERRED:** cloud/distributed, arbitrary third-party issuers, organization grants, cryptographic federation, and LLM compliance as enforcement authority. |

## Pending follow-up (not implemented by this documentation task)

The technical gaps below remain evidence-based follow-up, but do not authorize implementing the obsolete blanket action mapping. Re-scope them against the resolved Guardian V2 mapping first, except that all-state direct-state protection and fail-closed treatment of unknown/unsafe inputs remain product invariants. No tests or infrastructure were added or run for this documentation audit.

- [ ] Correct runtime projection so direct `.changebudget/**` mutations and unsupported/unresolved ChangeBudget wrapper forms fail closed before passive allow in every repository state, without treating recognized CLI invocations as direct file edits or applying the obsolete universal CLI ask rule.
- [ ] Add or extend disposable integration coverage for direct `.changebudget/**` edits and unknown/malformed wrappers before initialization; current direct-state/malformed integration cases do not establish this all-state behavior.
- [ ] Implement/validate FR-012 message requirements for product-triggered new-authority asks; current message/assertion locations do not establish operation context, applicable policy rationale, active contract id, and recommendation. Do not preserve blanket obsolete ask triggers.
- [ ] Add a focused multi-target shell regression for both operand orders, including a later `.changebudget/**` target; inspect/resolve the first-path-only source risk without treating it as reproduced.
- [ ] Add a focused outside-repository absolute edit-target regression for initialized PASS; verify the null-relative-path case fails closed without treating the suspected fall-through as proven.
- [ ] Reproduce the reported EvoSpec beta.7 fresh `--standalone` status denial and capture the actual failed-host action/resources only; keep root cause UNKNOWN and do not assume caching.
- [ ] Complete the reviewer-owned requirements-quality re-review of `checklists/requirements.md`. The implementation-detail criteria and clarification-dependent criteria remain unchecked; retained checks are historical, not fresh signoff.
- [ ] Resolve how setup/permission-hook registration failure is surfaced as integration unavailable through existing supported host feedback; do not characterize an unregistered hook as blocking mutations. No new API or test infrastructure is authorized by this task.
- [ ] Reconcile the injected `index.ts:38-56` workflow text with the final Guardian V2 lifecycle mapping and distinguish running task-relevant validation from adding optional tests. Source guidance remains unchanged pending product clarification and later validation.

## Planning dependencies and unresolved evidence (not product blockers)

- [ ] Plan how implementation deterministically maps the now-aligned SPEC-002 FR-021 legacy HARD/SOFT/UNRESOLVED classifications and SPEC-003 HUMAN_REVIEW precedence to supported existing evidence/output, including fresh-authority or trusted-policy recovery. Preserve the no-schema/no-new-code constraint; this docs-only alignment is not implementation evidence.
- [ ] Plan how existing contract/path/sensitivity signals and execution-gate outcomes are evaluated in accordance with the resolved human-premise/grant distinction; do not redefine owner-spec path semantics or weaken explicit gate blocks.
- [ ] Select an implementation proof for minimum grant-covered `amend`, deterministically validate repo/task/version/lifecycle binding and terminal-close replay restrictions, and preserve a valid grant through its bounded lifecycle. Do not introduce final field names/schema in this spec.
- [ ] Plan where ChangeBudget-owned lifecycle handling retains all FR-028 audit evidence. No plugin hook persistence side effect or mandated audit store is specified; do not claim current evidence capture.
- [ ] Reconcile the injected `index.ts:38-56` workflow text with conditional START/AMEND/CLOSE autonomy and no-optional-work policy; source remains unchanged in this docs-only task.
- [ ] Resolve supported host feedback for setup/permission-hook registration failure; distinguish unavailable interception from registered-hook evaluation failure.
- [ ] Reproduce the beta.7 host discrepancy with only the failed host's action/resources needed to identify the request. Root cause remains UNKNOWN; no caching conclusion.
- [ ] Re-scope source/test follow-up for all-state direct protection, unknown wrappers, FR-012 ask context, multi-target shell paths, out-of-root target risk, and host behavior against Guardian V2; observations remain pending or suspected as labeled in `research.md`.
- [ ] Complete the reviewer-owned requirements checklist review after owner-semantic alignment and planning details are reconciled. Do not change old checkmarks into fresh signoff or mark pending items complete in this clarification-resolution task.

Product direction remains READY_FOR_PLANNING because the clarification decisions are internally consistent and owner numeric-provenance/decision semantics are now aligned. This documentation-only alignment does not certify runtime behavior or checklist approval and is not an implementation baseline. No final runtime enum, public API, schema, lifecycle representation, REFOCUS command/exit code, or reason code is proposed.
