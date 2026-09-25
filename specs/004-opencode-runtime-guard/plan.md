# Implementation Plan: OpenCode V2 Runtime Guard

> Status: **READY_FOR_TASKS — planning only**. Guardian V2 product decisions are finalized. Implementation, filesystem/identity validation, and installed-host interception evidence remain pending; this is not an implementation baseline or a claim that tests/host checks passed. Source/test references are evidence locations only.

## Summary

SPEC-004 is intended to preserve the requested outcome while guarding authority and unsafe operations at the OpenCode V2 boundary. The existing policy results remain `PASS`, `REPAIR`, and `HUMAN_REVIEW`; the existing runtime vocabulary is `allow`, `ask`, and internal `block` (mapped to `allow`, `ask`, or `deny`). Guardian V2's product ordering is resolved; mapping the existing inputs to the product rules is implementation planning. `REFOCUS` is a workflow concept, not a runtime effect or new enum.

The implementation is an optional plugin package. The ChangeBudget CLI remains usable when OpenCode is absent or the wrapper is not installed.

## Technical Context

- TypeScript 5.x and Node.js 20+.
- Project metadata lists `@opencode/plugin@2.0.12`; the exact installed OpenCode/plugin build and its pinned type declarations are not verified here.
- Existing ChangeBudget state, contract, check, path, and execution-gate modules.
- Local-only product direction. Permission evaluation must not write `.changebudget/**`; current source has a material-decision ledger-write divergence noted below.

## Provisional Source/Host Hypotheses (not verified)

- The source proposes `Plugin.define({ id: 'changebudget', setup })`; official V2 docs demonstrate that plugin-definition shape generally, not this exact installed source/package combination.
- The source proposes `ctx.session.hook('context', ...)` for deterministic workflow context. Official V2 docs describe a session context hook, but context is outgoing model-call text, not admission evidence.
- The source proposes `ctx.permission.hook('evaluate', ...)` as enforcement. Official V2 docs inspected do not document that hook, its event shape, or mutable effect/message behavior. Installed-host interception proof is an implementation acceptance requirement, not a product-decision or task-generation gate.
- If a supported hook is verified, evaluate every delivered permission resource and combine outcomes as `deny > ask > allow`.
- Preserve a more restrictive incoming effect; never weaken `deny` (acceptance requirement, not a claim about current host behavior).
- Current source normalizes its existing explicit `materialDecision` value from permission metadata; this does not prescribe where the canonical grant or verified human-authorization evidence is carried. An absent value in that metadata slot is not proof that no human premise or canonical grant exists. Ordinary requests must not fabricate an authorization decision. An OpenCode `ask` reply is operational permission only and is never a ChangeBudget grant, HARD authority, or native approval event.
- When the registered permission-evaluation callback is invoked, fail closed for potentially mutating operations whose state, contract, or target context cannot be evaluated safely. If setup/registration fails before that callback exists, surface the integration as unavailable and do not claim that mutations are blocked; selecting supported host feedback is an implementation/validation item.

## Final Product Decisions and Planning Status

The Guardian V2 product decisions are finalized and READY_FOR_TASKS means planning/task-generation readiness only. It does not mean Guardian V2 is implemented, that the installed host intercepts writes, or that filesystem/identity behavior has been validated. Preserve the exact direct-human requested outcome; minimize implementation and authority delta only; do not add optional tests, refactors, or infrastructure. A premise expresses trusted intent, not unlimited structured authority. Soft estimates and legacy numeric provenance retain SPEC-002 FR-021 / SPEC-003 semantics; allow-list and hard-deny ownership remains in SPEC-002 FR-011/FR-012.

### Authority and scope invariants

- The selected authority model is **CHANGEBUDGET_NATIVE_APPROVAL_REQUIRED**. ChangeBudget administration that creates, expands, revokes, or rebinds canonical authority, when invoked by an agent through the guarded Runtime Guard path, MUST BLOCK regardless of saved OpenCode `always`/allow rules. The agent may prepare the minimum concrete proposal and user-facing instructions; a human performs the ChangeBudget-owned administrative action outside governed agent execution. An ordinary OpenCode `ask` is operational permission only, never canonical HARD authority or a native approval event.
- A canonical grant has a ChangeBudget-owned identifier/reference. Only the orchestrator receives that identifier; agent-facing work receives only the exact bounded work instructions needed for execution. Canonical evidence binds exact paths, capabilities, ceilings, authority/schema version, lifecycle, work/repository, and provenance. Native grant administration must retain ChangeBudget-owned lifecycle audit evidence. This rule governs canonical Guardian grant administration and does not alter SPEC-002/003 classification of check-level numeric ceilings from trusted exact policy provenance; that classification alone does not let an agent administer a canonical grant. No new command names, schema, public API, or numeric defaults are selected here.
- Repository authority uses a user-owned registry outside the repository, a repo-local public reference, and a physical ChangeBudget anchor associated with the Git common directory. Linked worktrees sharing one common directory share a local repository authority domain, but grants remain work-bound. HARD binding fails closed if genuine physical identity is unavailable or unreliable; routine operations not relying on HARD authority may continue. Do not fall back to a path, remote, or copied UUID. An unchanged common-directory instance remains the same repository instance even if working contents change; Git baseline/contract rules address content. A same-path replacement is a new instance only when the Git common-directory instance changes. Moves preserve HARD authority only when physical identity is verified; clones, full copies, and cross-machine transfers do not inherit it. Rebind is an explicit human administrative action with old/new binding audit and never silently migrates grants.
- This local model excludes cryptographic federation, OS sandboxing, and a malicious unrestricted same-user actor who can tamper with the external registry, repository, physical anchor, or administrative path. This threat limitation is explicit, not an identity guarantee.
- Routine autonomy covers clean eligible `init`, narrow premise/grant-covered `start`, localized edits to the requested task surface and relevant tests/mechanical changes, within-authority repair, minimum covered `amend`, and `close` after `PASS` and required completion. It never silently authorizes protected or unrequested paths, dependencies, migrations, configuration, public API, force operations, unrelated roots, or administration.

Preserve this response order: exact premise; CONTINUE within current authority; use the mechanically implied minimum concrete delta; use the minimum already covered by a valid grant; REFOCUS verified optional/oversized approaches before escalation; then handle genuinely new authority as a minimum user-facing proposal and BLOCK the governed operation pending the separate native ChangeBudget action. Invalid, stale, unknown, unsafe, denied, or protected work BLOCKS. An OpenCode `ask` may still be used for normal operational permission, but its response never creates or expands HARD authority. A `REPAIR` result is not a blanket stop; `HUMAN_REVIEW` is a check result, not authorization. Force execution in the agent path without separate verified fresh native authorization MUST BLOCK; host `ask`/`once` and saved `always` are never that authorization.

Retain ChangeBudget-owned structured evidence for every autonomous authority-consuming operation and every native grant administration action (create/expand/revoke/rebind): operation, authority/provenance, work/repository/version/lifecycle, exact target/capability/ceiling scope, minimum delta, subset/boundary checks, rationale, and result; rebind evidence includes old/new binding. Audit-write failure prevents the authority-consuming/admin action from committing. The registry is local user-owned state, not a cloud/global grant database. Permission-hook evaluation does not persist evidence.

MVP includes soft/hard provenance, bounded START/AMEND/REPAIR/CLOSE, REFOCUS, native approval for canonical grant administration, local registry/reference/physical-anchor binding, replay/staleness/rebind audit, and structured lifecycle evidence. Defer cloud/distributed authorization, arbitrary third-party issuers, organization grants, cryptographic federation, OS sandboxing, and LLM compliance judgments as enforcement authority.

## Implementation Validation Backlog (not planning blockers)

The following evidence is required before claiming implementation conformance, but does not block product finalization or task generation: implement/prove interception before covered writes; test registered-hook deny and honest integration-unavailable behavior; validate native approval and admin-path blocking; exercise physical identity availability/reliability, common-dir association, linked worktrees, move/copy/clone/cross-machine, same-path replacement, and explicit rebind auditing on supported platforms including POSIX, Windows file-ID reuse, and OneDrive; and run deterministic lifecycle, retry/audit-write, protected/multi-target, mixed-resource, out-of-repository, and pre-init cases in disposable repositories. The historical beta.7 `status` discrepancy is a **SEPARATE_RUNTIME_INVESTIGATION**, not a product gate. No physical-identity proof, POSIX/OneDrive test, host ASK trace, or runtime hook conformance is claimed here.

SPEC-002 FR-021/FR-011/FR-012 and SPEC-003 fatal-prerequisite versus completed `HUMAN_REVIEW` semantics remain authoritative. These planning documents do not generate tasks or prescribe final field names, APIs, schemas, command names, or reason codes. Scope excludes cloud/distributed authorization, third-party/org issuers, cryptographic federation, and LLM compliance as an enforcement decision.

### Legacy projection snapshot (OBSOLETE — NOT A CURRENT IMPLEMENTATION REQUIREMENT)

The source below still reflects the previous deterministic policy projection: a command-specific ask for every recognized managed/external/force-close mutation, plus broad `REPAIR`, `HUMAN_REVIEW`, out-of-scope, and sensitivity mappings. Those mappings are historical and require revision; they must not be treated as the Guardian V2 acceptance contract. The stable direct-state prohibition and fail-closed handling of unknown/unsafe operations remain requirements.

### Source-inspection snapshot (not a claim of conformance)

- `opencode-plugin/src/projection.ts` implements the legacy unsupported-command block, command-specific asks, passive mode, broad `REPAIR`/`HUMAN_REVIEW` blocks, path asks, and initialized direct-state blocking. These are source observations, not conformance with Guardian V2 product intent. Its passive return precedes both the `targetInChangeBudget` check and unresolved-mutation handling for ordinary operation classes. Direct `.changebudget/**` mutations and some unrecognized/malformed wrapper operations can therefore be allowed before initialization. This contradicts the all-state direct-state and unknown-operation requirements and remains a PENDING implementation gap.
- The Git scanner in `opencode-plugin/src/index.ts` includes `ls-files`, `check-ignore`, and status pathspec/split-resource handling, and aggregates resource outcomes restrictively. The exact supported cases are covered as source-level test locations below; host behavior is not established by fixture presence.
- Current projection messages (`opencode-plugin/src/projection.ts` `buildMessage`) include a rule/reason and optional path, but do not establish FR-012's policy rationale, active contract id, recommendation, or no-path CLI operation context. Existing assertion locations principally check the rule code. FR-012 therefore remains a PENDING implementation/evidence gap, not a claim of completed messaging.
- **PENDING SOURCE DIVERGENCE:** `opencode-plugin/src/index.ts:38-56` still injects instructions to require developer-approved paths/budget before `start`, request explicit approval for every exact-path amendment, and close only after validation and developer agreement. The amendment and close guidance conflicts with conditional autonomy for minimally covered `amend` and normal `close` after `PASS`; the start instruction may repeat approval even when the premise/grant covers the narrow contract. None of this guidance has been updated by this documentation audit. Its targeted-validation instruction concerns checks relevant to the requested task, not adding optional tests. Setup awaits hook registration before the evaluate callback exists; if setup/registration fails first, no callback can deny a request. No host-facing unavailable signal or runtime behavior is claimed established.

## Source Responsibilities

| Path | Responsibility |
|---|---|
| `opencode-plugin/src/index.ts` | Native setup, V2 input normalization, target extraction, hook registration, restrictive aggregation |
| `opencode-plugin/src/evaluator.ts` | Lifecycle/contract evaluation and explicit execution-gate material decisions |
| `opencode-plugin/src/projection.ts` | Deterministic policy-to-runtime mapping and rule identifiers |
| `opencode-plugin/src/changebudget-command.ts` | Supported CLI grammar, command classes, and verification of absolute installed-package shims |
| `opencode-plugin/src/target-classification.ts` | Safe lexical/effective target classification |

## Validation

Coverage locations inspected (not run for this documentation-only task): `tests/unit/opencode-runtime-projection.test.ts:33-108,110-168` covers legacy passive/CLI projection and primary protected/path rules; `tests/unit/changebudget-command.test.ts:12-96,98-139` covers static CLI grammar/classes, malformed forms, and absolute shim identity; `tests/integration/opencode-plugin-runtime-hook.spec.ts:171-372` covers supported Git scanner resources, split-resource cases, legacy CLI asks, and mutation cases, while `:398-429` covers initialized direct-state denials. #36/beta.6 is evidence only for supported Git scanner forms; #41/beta.7 is evidence of a static CLI classifier and its old ask mapping, not Guardian V2. The direct-state integration cases initialize the repository; pre-initialization direct-state denial is not evidenced there and remains PENDING. File/test presence is not a claim of passing results. Host capture inconsistency is tracked in `research.md` and `tasks.md`.

## Non-Goals

No alternate API adapter, fallback, version detection, migration, duplicate configuration, tool/command pre-execution hook, server callback, pseudo-handoff, sandbox, network call, plugin-owned audit store, or permission-hook persistence side effect is introduced. Required structured evidence is retained by ChangeBudget-owned lifecycle handling, with its storage location left for planning.
