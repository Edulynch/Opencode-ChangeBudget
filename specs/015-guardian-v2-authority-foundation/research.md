# Phase 0 Research: Guardian V2 Authority Foundation

**Feature**: SPEC-015 — `015-guardian-v2-authority-foundation`
**Branch**: `015-guardian-v2-authority-foundation`
**Date**: 2026-09-29
**Status**: Decisions recorded for design; provider proof and implementation validation remain gated.

This research resolves design choices for the Phase B plan. “Resolved” means the chosen boundary and fail-closed behavior are specified; it does not mean a Windows, POSIX, OneDrive, OpenCode-host, subject, administration, or durability provider has been implemented or proven.

## Evidence reviewed

- Feature requirements and acceptance matrix: `specs/015-guardian-v2-authority-foundation/spec.md`.
- Owner/runtime context: `specs/004-opencode-runtime-guard/spec.md` and `specs/004-opencode-runtime-guard/data-model.md`.
- Phase A V2 plugin boundary and first-party classifier: `opencode-plugin/src/index.ts`, `opencode-plugin/src/changebudget-command.ts`, `opencode-plugin/src/first-party-identity.ts`, `opencode-plugin/src/evaluator.ts`, `opencode-plugin/src/projection.ts`, and `opencode-plugin/src/target-classification.ts`.
- Existing state and lock primitives: `src/core/state/state.ts`, `src/core/state/contracts.ts`, and `src/core/state/lifecycle-lock-recovery.ts`.
- Current focused regression owners/commands: `scripts/test-phase-a-focused.mjs`, `tests/unit/opencode-runtime-projection.test.ts`, and `tests/integration/opencode-plugin-runtime-hook.spec.ts`; package scripts are in `package.json`.
- Official OpenCode V2 plugin documentation: <https://opencode.ai/v2/docs/build/plugins>. It describes `ctx.location.project.canonical` as the plugin instance's project location, not the location of every session/event; its permission-evaluation event contains `sessionID`, optional `agent`, `action`, `resources`, optional `metadata`, `source`, `effect`, and `message`. Permission hooks run for `allow` and `ask`; an explicit configured `deny` is final and does not invoke the hook. Saved session permission rules are host policy, not ChangeBudget HARD authority.

## Decisions

### R-01 — Physical repository identity

**Decision.** Resolve Git's common directory only to locate a persistent ChangeBudget anchor, then ask a `PhysicalIdentityProvider` for the operating system's identity of that physical anchor. Bind the resulting stable volume/device and file-object identity (plus a trustworthy generation component where the platform supplies one) in the user-local registry. The repo-local public reference contains only an opaque registry locator. Neither the locator nor anchor contents establish identity or grant authority. Linked worktrees that resolve to the same physical common-directory anchor share a repository authority domain; work IDs remain distinct.

Preserve identity across a same-filesystem move only when the provider can prove the same physical object. A changed/missing anchor, changed common-directory object, copied/cloned repository, cross-machine copy, same-path replacement, uncertain identity generation, inaccessible identity API, reparse/symlink ambiguity, or unvalidated cloud/sync filesystem returns `UNAVAILABLE`/`MISMATCH` and denies HARD use. Do not fall back to path, remote URL, repository name, branch, copied UUID, or content digest. The provider must reject file IDs whose reuse/collision behavior is not sufficiently trustworthy; no equality promise is made for OneDrive until tested.

**Rationale.** This implements the selected common-directory physical-binding model, makes linked-worktree sharing explicit, and prevents descriptive or copyable repository data from becoming an identity proof.

**Alternatives rejected.** Canonical path, Git remote, repository name/branch, Git common-dir path text, or a UUID stored in copied repository content can collide or be copied and therefore cannot prove physical identity. A cryptographic federation or remote identity service is out of scope.

**Validation gate.** Separate Windows and POSIX providers must demonstrate stable object identity, same-filesystem move behavior, clone/copy distinction, replacement detection, file-ID reuse handling, and reparse/symlink rejection on each claimed filesystem. Until a provider passes, that platform/filesystem is unsupported for HARD authority. OneDrive is explicitly unsupported absent evidence.

### R-02 — Registry durability, transactions, audit, and replay state

**Decision.** Store a strict, versioned registry snapshot in a per-user local data directory outside the repository. The snapshot owns repo bindings, work bindings, canonical grants, lifecycle/replay state, and append-only audit evidence. The repository contains only an opaque public reference and physical anchor. Serialize every read-modify-write authority transaction behind a cross-process exclusive lock associated with the registry, with ownership metadata and conservative contention handling. A live, stale-but-unproven, malformed, or otherwise ambiguous lock is not broken automatically; administrative recovery must be a separate explicit operator action.

Commit a stable serialized snapshot by creating a same-directory temporary file, writing it, syncing the file, atomically replacing the registry, and syncing the parent directory where the platform/filesystem supports and proves that operation. Keep the lock until the full persistence barrier completes. If file sync, atomic replacement, directory sync, lock safety, or post-write validation is unsupported or fails, report no success and fail closed. No automatic migration of unknown registry versions is permitted. Write grant creation/revocation, one-shot consumption, and their required evidence within the same locked snapshot commit. A one-shot `ACTIVE -> CONSUMED` transition and its authority-use evidence become durable before the verifier reports a successful use; if the later business operation cannot be proven, the grant remains consumed.

**Rationale.** The repository already has stable JSON serialization, a temp-write/rename primitive, a state transaction lock, and a synced lock owner record. `src/core/state/state.ts` currently writes a temp JSON file and renames it without syncing the data file or containing directory. `src/core/state/lifecycle-lock-recovery.ts` syncs lock owner metadata and its recovery audit file, while its own comment explicitly notes that absent directory sync does not cover sudden power loss. These are useful patterns, not proof of the required registry durability guarantee.

**Alternatives rejected.** Separate grant, replay, and audit files introduce partial-commit windows; an in-repository grant database exposes authority-bearing state to copies; OpenCode plugin storage is not a ChangeBudget-owned authority registry; cloud/remote databases and dependencies violate the local-first/minimal architecture.

**Validation gate.** Inject failures at temp creation/write/file-sync/rename/directory-sync/lock and readback; verify no create/revoke/consume/verification success is returned without required durable state/evidence. Exercise process crashes before rename, after rename but before directory sync, and after durable consumption but before downstream completion. Test process-level concurrency and process restart. If a platform cannot prove the required barrier, it cannot issue or accept HARD grants there.

**Audit boundary decision.** The core provider-neutral authority service owns durable successful-use and administrative audit transactions. The Phase A OpenCode permission-evaluation hook remains read-only; it must not acquire authority by writing evidence or state. A hook-only preflight is not a successful authority use. The V2 transport's rejection/verification audit requirement is an explicit integration gate: no hook result may be treated as an audited verification or authority-bearing success until a ChangeBudget-owned audit path is demonstrated without adding hook side effects. In the absence of that path, the plugin may only preserve the existing Phase A result or block an invalid present reference; it may not claim the full audit acceptance criterion is met.

### R-03 — Trusted work, subject, and administrator provenance

**Decision.** A `WorkContextResolver` creates and persists an immutable generated `work_id` for a verified active-contract activation, linked to a coherent contract snapshot, repository binding, activation epoch, and authority/scope digest. Contract ID is a local work handle only; it is not a work identity proof. `task_id` remains optional correlation data only. Contract/activation/scope/authority changes invalidate freshness; normal Git HEAD changes do not.

At verification, `SubjectContextProvider` must derive a subject from an authenticated runtime/session adapter. Missing, ambiguous, expired, or unauthenticated subject context blocks grant success. Values in prompt prose, plugin metadata, `sessionID`, optional `agent`, environment variables, shell arguments, `task_id`, or a ChangeBudget reference are not trusted subject proof. A separately injected `OperatorAdminContext` is required for human authority-changing administration outside governed runtime execution. It records the explicit administrative action and its adapter/provenance, but is not described as cryptographic proof of a human. First-party executable recognition and `--actor` are not human authorization.

**Rationale.** The current plugin has session and agent identifiers but the official V2 contract does not attest a human subject or bind `ctx.location` to every received permission event. Existing Phase A first-party resolution proves a narrow ChangeBudget executable/shim identity, not who authorized its invocation. Existing contract IDs and task correlation values cannot replace generated activation/work identity.

**Alternatives rejected.** Using `contract_id`, `task_id`, session ID, agent label, first-party CLI identity, metadata, command-line actor text, or user prompt as a trusted identity would collapse correlation with authority and allow forged/stale context. A global account/login service is outside the local-first specification.

**Validation gate.** A real `SubjectContextProvider` and a real human-operated admin adapter are required before successful grant issuance/verification can be enabled. Fake providers may support unit tests only and must not be presented as runtime proof. If no trusted adapter exists for the target runtime, return no subject/no admin context and fail closed. Select the first human-facing administration entry point during reviewed task planning; its CLI spelling or other public invocation is not fixed by these contracts.

### R-04 — Grant scope, path rules, ceilings, freshness, and state transitions

**Decision.** Canonical grants are immutable in their bounds and strict in schema/version. Each binds a grant ID; repository binding/reference; `authority_id`; `work_id`; subject; operation and capability set; canonical path scope; numeric ceilings; independent `allow_new_files`, dependency, migration, configuration, and public-API permissions; validity window; governing authority revision/digest; issuer/provenance; and lifecycle/consumption state. Canonical relative paths use `/`, are normalized once, reject traversal/ambiguous roots/symlink escapes, honor deny rules before allows, and never authorize protected `.changebudget/**`. Reuse the existing contract path-pattern semantics rather than adding a second wildcard language. A covered existing path does not imply a new-file permission; each sensitive permission is independent.

For numeric bounds, verify the requested operation against the grant ceiling without replacing the request's narrower values: a request for 18 under a ceiling of 60 remains a request for 18. Freshness is bound to the current coherent contract/scope, activation, authority epoch, and repository binding, not routine commits/HEAD movement. `REUSABLE` grants remain `ACTIVE` until expiry, revocation, or freshness failure. `ONE_SHOT` permits exactly one audited successful use (`ACTIVE -> CONSUMED`). Revocation is `ACTIVE -> REVOKED`; `CONSUMED` and `REVOKED` are terminal and durable. Expiry is evaluated deterministically from stored validity and does not silently rewrite persisted data during inspection.

**Rationale.** Independent capability bits avoid implicit widening, immutable requests preserve human intent, and freshness invalidates genuinely changed governing authority without treating ordinary repository progress as revocation.

**Alternatives rejected.** Copying the grant ceiling into the request widens the request; tying freshness to each Git HEAD would revoke on ordinary commits; reusing contract/task IDs as work IDs merges activations; auto-rewriting corrupt/expired state during inspection hides evidence; shared path/prefix string checks admit sibling collisions.

**Validation gate.** Exhaustively test exact/narrower/over-ceiling requests, all independent flags, exact paths, traversal, prefix siblings, case rules, new files, denied/protected paths, stale/revoked/expired/malformed/cross-binding requests, stable digest encoding, and the “18 remains 18 under 60” example.

### R-05 — Provider-neutral admin surface and structured OpenCode V2 transport

**Decision.** Keep grant policy and persistence behind a provider-neutral ChangeBudget authority service. Define logical admin operations for create/list/inspect/revoke and audited verification; do not lock a CLI spelling or expose persistence internals as a public API in this plan. The admin adapter obtains `OperatorAdminContext` separately from governed runtime. Listing/inspection are state-read-only and must not repair malformed state.

Use only the documented OpenCode V2 permission-evaluation hook as the current interception boundary. Its existing optional `metadata` field may contain a versioned, ChangeBudget-namespaced application payload containing an opaque existing grant reference and bounded requested-operation metadata; that payload is a locator/request, not native host authority. Derive repository, work, subject, authority, and freshness locally from trusted providers. Compare bounded request details to the actual intercepted action/resources and canonical grant; never accept caller-supplied identity fields as proof. Absent reference is a pure pass-through to the Phase A decision. A present malformed, unknown, stale, revoked, replayed, mismatched, or unresolvable reference is invalid and blocks; it is never treated as absent. A valid reference does not change the Phase A action in this batch and cannot produce managed START/AMEND/CLOSE ALLOW. Preserve more restrictive incoming host effects. A configured explicit host deny does not invoke the plugin hook and remains final.

**Rationale.** The existing plugin registers `session.context` and `permission.evaluate`, reads optional application metadata, computes its own action projection, preserves incoming restrictive effects, and denies intercepted evaluation failures. Official V2 docs identify plugin location as plugin-instance context and show permission metadata as an open record; neither makes those values authenticated. The plugin's current ASK projection and the strict Permission API vocabulary remain the compatibility baseline; this batch does not add host APIs or lifecycle grants.

**Alternatives rejected.** Inventing native OpenCode fields for trusted subject/work identity; interpreting `ctx.location.project.canonical`, saved `allow`/`always`, `ask`/`once`, event `agent`, first-party executable identity, or arbitrary metadata as human authority; adding session permission rules, a V1 adapter, an EvoSpec bridge, or a plugin-owned grant issuer.

**Validation gate.** Use actual documented host event fields and existing metadata only. Confirm event serialization and authenticated subject sourcing against an installed V2 runtime before relying on any value. Prove the read-only-hook/audit boundary described under R-02. If proof is absent, do not report transport conformance or authority-enabled operation.

### R-06 — Packaging, tests, and review sequencing

**Decision.** Reuse the existing Node/TypeScript package and `node:test` layout. Add no dependency, database, service, package version change, release, or Phase A behavior migration. Place future authority core beside existing core modules, the V2 adapter beside `opencode-plugin/src`, and focused tests under existing `tests/unit`, `tests/integration`, and platform acceptance owners. Run a first-use identity/registry/grant/restart/revoke/replay vertical slice before the structured transport adapter, then run Phase A and full package gates. Keep task generation and implementation behind independent security/correctness review of this integrated package.

**Rationale.** `package.json` already pins Node >=20, TypeScript, `@opencode/plugin@2.0.12`, compiler/typecheck/full-test scripts, and a Phase A focused gate. Existing state, plugin, and disposable-repository test fixtures provide local patterns without new runtime dependencies.

**Alternatives rejected.** New test framework, external service, cloud CI dependency, stable `2.0.0` release, beta publication, EvoSpec coupling, Phase C work, and premature project-script/package changes.

**Validation gate.** The eventual implementation must run focused Phase B identity/grant/replay/transport tests; focused Phase A tests; `npm test`; `npm run typecheck`; `npm run compile`; package-content and packaged Runtime Guard loading tests; `git diff --check`; and independent security/correctness review. This planning task ran none of those project tests and makes no implementation or review claim.

## Research conclusion

The selected architecture is sufficiently specified to plan: one local registry and serialized transaction boundary, physical object identity with no descriptive fallback, separately trusted work/subject/admin providers, exact canonical grants, and a restrictive V2 reference adapter. Windows/POSIX filesystem proofs, OneDrive support, trustworthy subject/admin adapters, directory durability, and an out-of-hook audit route remain explicit implementation stop gates rather than implied capabilities. No managed lifecycle ALLOW, implementation, product test, task list, or release is authorized by this research.
