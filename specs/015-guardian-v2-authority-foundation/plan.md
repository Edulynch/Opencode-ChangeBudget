# Implementation Plan: Guardian V2 Authority Foundation

**Branch**: `015-guardian-v2-authority-foundation` | **Date**: 2026-09-29 | **Spec**: [spec.md](spec.md)

**Input**: `specs/015-guardian-v2-authority-foundation/spec.md`

**Plan status**: **READY_FOR_TASKS**. Independent Vera architecture/security review of this six-artifact package returned `PHASE_B_FOUNDATION_PLAN_REVIEW_PASS` with no findings/blockers. This is a planning-stage review only—not implementation validation, runtime security evidence, or implementation acceptance. The provider and durability stop gates below remain implementation **BLOCKERS**. No implementation, project tests, task list, commit, or release is claimed.

## Summary

Establish one ChangeBudget-owned local HARD-authority foundation, bound to the physical Git common-directory instance, a generated activation-specific `work_id`, an authenticated runtime subject, an explicit outside-governed-runtime human administration context, and an exact canonical grant. Keep the registry outside the repository, the repo-local public reference opaque and non-authoritative, and all create/revoke/use/audit/one-shot state transitions behind a strict versioned, cross-process transaction boundary with proven durability. A provider-neutral admin service supports create/list/inspect/revoke; a structured V2 metadata reference is only a locator/request descriptor and never an issuer. Absent transport remains the Phase A result; invalid present reference blocks; a valid reference never upgrades Phase A to managed lifecycle ALLOW.

The Phase A plugin remains a read-only decision projection. `PhysicalIdentityProvider`, `WorkContextResolver`, `SubjectContextProvider`, and `OperatorAdminContext` are distinct sources with distinct trust obligations. Since the current OpenCode V2 documentation does not authenticate a subject/admin or bind plugin location to every permission event, and Phase A forbids persistence in the permission hook, those are explicit stop gates, not assumed host capabilities. The design decisions and rejected alternatives are in [research.md](research.md); entity/validation rules are in [data-model.md](data-model.md); logical admin/transport contracts are in [contracts/admin-api.md](contracts/admin-api.md) and [contracts/authority-transport.md](contracts/authority-transport.md); future validation steps are in [quickstart.md](quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.9 on Node.js `>=20` (from `package.json`); no language/runtime upgrade is proposed.

**Primary Dependencies**: Existing ChangeBudget modules and `@opencode/plugin@2.0.12`. No new runtime or test dependencies. Physical identity, subject, admin, and durable storage are provider interfaces, not grounds to add a remote identity service or database.

**Storage**: One strict, versioned JSON registry snapshot in the platform's per-user local data directory outside the repo; a tiny repo-local public-reference file and persistent ChangeBudget anchor associated with Git common-dir. Same-directory temp write, file sync, atomic replacement, parent-directory sync when supported/proven, and cross-process lock are required. Existing `src/core/state/state.ts` temp+rename is a reusable pattern but currently does not sync the data file or parent directory; it is not sufficient evidence for HARD-authority durability. Unsupported or uncertain durability means no HARD success.

**Testing**: Existing TypeScript build/typecheck and Node `node:test`; focused future authority unit/integration/platform matrices; the existing `npm run test:phase-a` regression gate; full `npm test`; typecheck/compile; package-content and packaged Runtime Guard loading; `git diff --check`; independent security/correctness review. Commands are listed in `quickstart.md`. None were run for this documentation-only plan task.

**Target Platform**: Existing Node platforms, with HARD identity support opt-in only for tested Windows and POSIX filesystems. Windows file ID/generation and directory sync, POSIX inode reuse/move behavior, reparse/symlink handling, and OneDrive/cloud-synced folders are not presumed safe. OneDrive is unsupported until directly validated. A platform without provider proof stays fail-closed for HARD authority.

**Project Type**: Local-first TypeScript CLI package with an optional OpenCode V2 plugin under `opencode-plugin/`; no service, dashboard, cloud registry, or separate package.

**Performance Goals**: Preserve SC-005 provisional target only as an assumption: list/inspect up to 100 local grants within 2 seconds and complete a human create/inspect/revoke journey within 2 minutes. These are future measurements, not a baseline or promise. Lock contention/durability must never be bypassed to meet them.

**Constraints**: No cloud/network dependency; no grant data in repository copies; no identity fallback; no new dependency; no inferred human proof from host `ask`/`once`/`always`, agent/session metadata, CLI executable, or `--actor`; no Phase A hook persistence; no managed START/AMEND/CLOSE ALLOW; no schema migration, EvoSpec bridge, Phase C, issue #29/#47, stable 2.0.0 release, or beta publication. Invalid/corrupt/unavailable/undurable authority always fails closed. Independent planning review is required before task generation (passed for this package); implementation acceptance requires implementation validation.

**Scale/Scope**: One local user registry, provisional up to 100 grants, one physical local repository authority domain across linked worktrees, distinct generated work identity per validated activation, exact subject/capability/path/ceiling boundaries, reusable and one-shot grants, local durable audit/revocation/replay, and a non-upgrading structured V2 reference. No organization, multi-user, federation, or global database semantics.

## Constitution Check

### Pre-Phase 0 gate

- **I Local-first/deterministic; X fast; XI personal workflow; XII tooling** — PASS: all authority decisions and storage remain local/deterministic; no mandatory documentation/runtime service. External V2 docs were consulted only as a current reference.
- **II Minimal architecture; XVII anti-overengineering** — PASS WITH GATE: one versioned local registry and focused providers; reuse current TypeScript/Node and path/state primitives where valid. No database, server, auth product, framework, or dependency. Provider obligations are not permission to generalize infrastructure.
- **III Scope boundary; XVI roadmap governance** — PASS: only SPEC-015 foundation. No managed lifecycle grant use, EvoSpec, Phase C, issues #29/#47, or stable release work.
- **IV Small workflow; V targeted validation** — PASS: Phase 0/1 planning only; planned validation is staged from focused matrices to full gates when implementation exists.
- **VI Git is change truth; VII enforcement; VIII human authority; IX explainability** — PASS: Git remains the source for repository changes; grant boundaries cannot auto-expand; explicit external human-admin context is mandatory; failures return stable boundary-specific reasons. Registry state is limited to the authority/replay feature explicitly required by SPEC-015, not a parallel code-change accounting system.
- **XIV quality; XV specification discipline** — PASS: small, typed, testable contracts and stop gates; all authority unknowns are either resolved at the design boundary or listed as proof gates with fail-closed disposition.
- **No scope/API/dependency expansion** — PASS: contracts specify logical provider-neutral operations, not a frozen public API or CLI spelling. The package review permits task generation to specify/prove the concrete human-admin adapter; the adapter itself remains an implementation BLOCKER until its human-provenance path passes validation.

### Post-Phase 1 re-check

- Local-only registry, physical identity with no descriptive fallback, deterministic validation, stable failure reasons, and no remote runtime path remain intact.
- The single registry snapshot, lock, identity/context providers, grant service, and narrow V2 adapter are the smallest design consistent with linked-worktree binding, audit/replay atomicity, and explicit human control. Splitting them into cloud services or provider-specific grant issuers is rejected.
- Grant ceilings do not widen a requested operation; absent references do not change Phase A; present invalid references block; valid verification is not a managed lifecycle allow.
- The concrete human admin front end, trusted subject adapter, actual Windows/POSIX providers, durability proof, and out-of-hook audit path remain implementation **BLOCKERS**. No interface declaration is treated as evidence those providers exist.
- **Planning review: PASS** — Vera returned `PHASE_B_FOUNDATION_PLAN_REVIEW_PASS` with no findings/blockers for this package. **Status: READY_FOR_TASKS**; this does not pass implementation acceptance, which remains blocked pending stop-gate evidence and implementation validation.

## Project Structure

### Documentation (this feature)

```text
specs/015-guardian-v2-authority-foundation/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── admin-api.md
│   └── authority-transport.md
├── spec.md
└── tasks.md                 # Phase 2 only; intentionally not created
```

### Planned source/test layout (future implementation; no files created here)

```text
src/core/authority/
├── physical-identity.ts     # OS identity provider boundary and fail-closed result
├── repository-binding.ts   # Git common-dir anchor + user-local binding/ref
├── work-context.ts         # coherent activation and generated immutable work_id
├── subject-context.ts      # authenticated runtime/session provider boundary
├── registry.ts             # strict versioned snapshot and transaction lock
├── grants.ts               # canonical grant validation/freshness/state transitions
├── authority-service.ts    # admin and audited authorize-use transactions
└── audit.ts                 # durable authority evidence within registry transaction

opencode-plugin/src/
└── authority-reference.ts  # namespaced metadata parsing; restrictive, non-upgrading adapter

tests/unit/
├── authority-identity.test.ts
├── authority-context.test.ts
├── authority-grants.test.ts
└── authority-registry.test.ts

tests/integration/
├── authority-registry.test.ts
├── authority-transport.test.ts
├── package-contents.test.ts                    # extend existing owner
└── opencode-plugin-runtime-hook.spec.ts         # extend existing owner

tests/acceptance/
└── authority-platform-matrix.test.ts            # separate supported Windows/POSIX runs
```

Module names are proposed internal organization, not new public exports. Final minimal file split is subject to the reviewed implementation tasks. The human-facing admin invocation is deliberately not named here; it must be selected in tasks after reviewing the operator adapter/provenance proof. Do not add task/test/package/config files as part of this plan.

**Structure Decision**: Extend the existing single TypeScript project. Keep all core policy/persistence provider-neutral under `src/core/authority/`; place only the V2 envelope adapter in `opencode-plugin/src/`; reuse existing test runners and package owners. Separate physical identity, contexts, durable storage, canonical policy, and host transport so trust sources cannot be confused, while keeping each boundary narrow. No new package, service, or schema migration.

## Integrated Architecture

1. **Physical identity**: obtain Git common-dir to locate the ChangeBudget anchor; compare only a validated platform physical object identity. No path/remote/UUID/name/branch fallback.
2. **Trusted context**: resolve a coherent active contract and activation into a generated `work_id`; resolve authenticated subject and explicit operator-admin action through separate providers. Missing providers yield no authority context.
3. **Repository/work binding**: resolve the opaque repo-local locator through the user registry, verify the physical binding, and bind immutable work identity to that binding and current authority/scope epoch. `task_id` is correlation only.
4. **Durable transaction**: one cross-process lock and strict snapshot commit serialize grants, replay/consumption state, and audit. Require file and containing-directory durability proof; never claim success from temp+rename alone.
5. **Canonical grant service**: validate immutable grant bounds, create/list/inspect/revoke through the provider-neutral admin contract, enforce freshness and independent flags, and retain change/use/rejection evidence. Listing/inspection never repair.
6. **Exact verifier**: compare binding/work/subject/operation/capability/path/ceilings/freshness, then commit reusable verification evidence or one-shot consume+use evidence durably before successful use. A race has one winner maximum; crash/replay never restores a consumed grant.
7. **V2 adapter**: parse only an existing opaque grant reference and bounded request metadata from the documented existing optional metadata record. Derive all trusted context locally. Absent passes the Phase A decision through; present invalid blocks; valid does not change Phase A action or enable managed lifecycle ALLOW. Permission-hook evaluation remains read-only.
8. **Acceptance and review**: run identity/durability/authority/transport/platform matrix, Phase A regression, full package/type/build/load checks, and independent security/correctness review. Only then may a separate task plan select concrete providers/admin UX.

## Dependency DAG and First Usable Milestone

This is one forward dependency chain, not parallel subsystems with circular ownership:

```text
G0 Prove provider feasibility
   (physical object identity + trusted subject/admin sources + durable filesystem capability)
  -> G1 Verify binding/context
   (common-dir anchor + opaque repository reference + coherent generated work_id)
  -> G2 Implement durable local transaction
   (strict registry + cross-process lock + temp/file-sync/replace/directory-sync + audit)
  -> G3 Canonical grant/admin/freshness
   (create/list/inspect/revoke + exact capabilities/path/ceilings + current authority epoch)
  -> G4 Exact verifier/replay
   (reusable verification audit + one-shot concurrency/consume + crash/restart/revocation)
  -> G5 Restrictive V2 reference adapter
   (actual V2 event mapping + trusted local context + read-only hook/audit compatibility gate)
  -> G6 End-to-end/platform gates + independent review
   (Phase A, full package, Windows/POSIX claims, packaging/runtime load)
```

**First usable milestone**: after G0-G4, a supported local platform/runtime can explicitly administer a grant through the reviewed human ChangeBudget admin adapter; bind it to a real physical common-dir object, one generated work activation and authenticated subject; durably create/audit it; perform deterministic exact verification; restart and re-inspect; revoke it; and reject replay/invalid state. Demonstrate all of this on at least one explicitly named, validated filesystem/runtime. This milestone MUST NOT produce managed START/AMEND/CLOSE ALLOW, and does not imply that the OpenCode transport/audit gate G5 passed.

If G0 cannot provide real subject/admin contexts, if G2 cannot prove file+directory durability, or if audit-write failure can produce a successful outcome, the first usable milestone is blocked rather than replaced with a fake provider or weaker persistence. The initial filesystem/runtime does not certify any other platform. Before enabling transport reliance, G5 must additionally resolve the hook-read-only versus transport audit evidence boundary without violating the Phase A contract.

## Provider/Stop Gates and Risks

| Gate | Required evidence before success is enabled | Fail-closed disposition if absent |
|---|---|---|
| Windows physical identity | Common-dir anchor identity stable across tested supported volume operations; replacement/copy distinction; reparse and file-ID reuse handling | **BLOCKER** — Windows HARD authority unsupported until validated. |
| POSIX physical identity | Device/inode/generation behavior, inode reuse, same-filesystem move, copy/clone, and common-dir association tested on each claimed FS | **BLOCKER** — that POSIX filesystem is unsupported for HARD authority. |
| OneDrive/cloud sync | Direct proof for identity, rename/locking and durability semantics | **BLOCKER** — explicitly unsupported; no fallback. |
| Trusted subject | Authenticated runtime/session adapter yields exact subject without trusting session ID, agent, metadata or prompts | **BLOCKER** — no grant create/verify success. |
| Human admin path | Explicit human ChangeBudget-native action outside governed runtime, adapter-issued `OperatorAdminContext`, and agent-block proof regardless of host allow/always | **BLOCKER** — no create/revoke success; first-party executable/`--actor` do not qualify. |
| Registry durability | Cross-process lock and data+directory flush/replace proof on actual supported filesystem; injected failures and crash tests | **BLOCKER** — no success/consumption/revocation/verification; platform unsupported if unprovable. |
| Transport audit | Out-of-hook ChangeBudget-owned verification/rejection evidence route compatible with read-only Phase A permission hook | **BLOCKER** — no authority use through V2; keep the boundary at pass-through/invalid-reference block and report acceptance blocked. |
| Path/freshness | Platform case/symlink behavior and exact current authority digest/epoch comparison proven | **BLOCKER** — ambiguous path or freshness is rejected, not prompted or widened. |

**MUST_FIX implementation risks (not findings from the planning review):** (1) physical-ID reuse/copy/replacement spoofing must never inherit a binding; (2) cross-process one-shot races and crashes must never produce two successes or revive consumption; (3) host `allow`/saved `always`, metadata, or first-party executable classification must never bypass canonical verification or prove a human; (4) durability/audit failure must never yield success; and (5) the out-of-hook audit route must be resolved before V2 transport can claim audited verification. Directory durability unavailable in Node/platform APIs, identity/admin claims, partial audit/consumption commits, and unsupported OneDrive semantics remain **BLOCKERS** until demonstrated safe. The chosen architecture is unchanged.

## Test Matrix and Acceptance Evidence

All entries below are **future implementation tests**. The phase-B planning task executed no project tests.

| Area | Required cases and invariant |
|---|---|
| Physical repository identity | Same common-dir and linked worktrees share repository domain; distinct work IDs remain distinct; content/HEAD changes keep physical identity; same-filesystem move preserves only when provider proves it; clones, full copies, cross-machine transfer and same-path replacement do not inherit; equal path/remote/name/branch cannot match different physical objects; missing/unreliable provider, reparse/symlink, unsupported FS, OneDrive, file-ID reuse and permissions failure fail closed. Run on actual Windows and POSIX targets independently. |
| Work/subject/admin provenance | New activation gets a fresh generated immutable `work_id`; active contract coherence checks; `contract_id` not proof; optional `task_id` changes do not authorize; stale activation/scope digest fails; subject missing/forged/expired/mismatched blocks; agent/session/metadata/prompt/env/CLI actor claims ignored; first-party CLI proves executable only; governed agent create/revoke blocks despite saved allow/always; read-only list/inspect does not write. |
| Grant schema and exact scope | Strict versions, duplicate IDs/keys, unknown/missing fields, malformed JSON, invalid times/integers/lifecycle conflict; exact and narrower match; 18 remains 18 below ceiling 60; over-ceiling reject; path traversal, prefix sibling, case ambiguity, symlink escape, deny/protected `.changebudget/**`; new-file permission separate; dependency/migration/config/public API bits tested in every independent combination. |
| Freshness and lifecycle | Correct repository/work/subject/authority/operation/capability only; governing contract/scope/activation/authority epoch change stales; normal HEAD commit does not; reusable repeats only while current; one-shot transitions ACTIVE→CONSUMED once; revoke ACTIVE→REVOKED; terminal states never resurrect; expired/revoked/consumed/malformed/unknown schema rejects without repair. |
| Durable registry and audit | Create, verification/use, reject, consume, revoke evidence; file write/sync, rename, directory sync, lock, audit, readback and malformed-registry fault injection; no reported success without required durable state/evidence; list/inspect byte-for-byte read-only even on malformed state; crash before commit, after replace-before-directory-sync, after one-shot durable consume-before-downstream completion, after successful completion; restart keeps reusable/revoked/consumed outcomes. |
| Concurrency | At least two processes race the same one-shot grant; at most one returns `USE_ACCEPTED`; one terminal consume record and matching evidence; all losers reject; restart during/after race cannot revive grant or report success without durable records. |
| V2 transport | Absent preserves Phase A output; present malformed/unknown/stale/revoked/consumed/replayed/wrong repo/work/subject/operation/capability/path/ceiling blocks and is never absent; valid preflight preserves Phase A effect; generic allow/always cannot bypass invalidity; more restrictive incoming effect stays restrictive; explicit host deny is outside hook invocation; no reference can mint/widen/rebind; no valid result yields managed lifecycle ALLOW; permission hook does zero ChangeBudget writes. Independently prove core durable verification/audit outside hook. |
| Regression, package and review | `npm run test:phase-a`; `npm test`; `npm run typecheck`; `npm run compile`; package-content assertions; packaged V2 Runtime Guard load and host-hook integration; `git diff --check`; independent security/correctness review. Beta publication is not part of acceptance. |

**Acceptance mapping**: SPEC-015 SC-001/SC-002 map to physical identity and exact-boundary rows; SC-003/SC-007/SC-008 to restart, lock, concurrency, fault, audit and crash rows; SC-004 to transport row; SC-005 remains a provisional future measurement; SC-006 to subject/admin authority-path review and no-claim matrix. Passing implementation checks remains future evidence, not a result of this plan.

## Review Readiness

- Integrated Phase 0/Phase 1 package: **READY_FOR_TASKS**.
- Independent Vera architecture/security planning review: **PASS** — `PHASE_B_FOUNDATION_PLAN_REVIEW_PASS`; no findings/blockers on the six-artifact package. This is not runtime proof or implementation review.
- Implementation stop gates (physical identity, trusted subject/admin, durable registry, one-shot race/replay, and out-of-hook transport audit): **BLOCKER / PENDING validation**.
- Implementation acceptance: **PENDING**; no provider, platform, package, runtime-load, or implementation test results are claimed.
- `/speckit.tasks`: **not run**; `tasks.md` intentionally absent. The planning review permits task generation as a separate step.
- Product implementation, product tests, package publish, and commit/push: **not performed**.

## Complexity Tracking

No constitution violation is proposed. The user-local registry and focused provider boundaries are required by SPEC-015's physical binding, audit, replay and durability acceptance; a database, remote service, new dependency, or separate runtime is rejected. No separate complexity exception is requested.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| None | No constitution violation identified. | Not applicable. |
