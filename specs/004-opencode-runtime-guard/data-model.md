# Data Model: OpenCode V2 Runtime Guard

> Status: **READY_FOR_TASKS — planning only**. The structures below are planning concepts and source snapshots, not a verified installed-host contract or final Guardian V2 schema/projection. Implementation and physical-identity/host validation remain pending. No new enum, field, public API, lifecycle representation, or persistence schema is introduced here.

## Runtime Guard Context

Provisional snapshot intended for each intercepted operation. The official V2 plugin documentation says `ctx.location` describes the plugin instance's location, not every session/location it can access. Resolving it to a Git root is not proof that the root belongs to the current operation; host/session binding must be demonstrated before this context can authorize anything.

| Field | Type | Required | Source |
|---|---|---|---|
| `workspaceRoot` | string | yes | Candidate operation root; `ctx.location.directory` plus Git root is not verified as the current session's repository |
| `isInited` | boolean | yes | `.changebudget/state.json` |
| `contract` | `RuntimeContractSnapshot \| null` | yes | active local contract |
| `policyDecision` | `PASS \| REPAIR \| HUMAN_REVIEW` | yes | existing ChangeBudget check |

## Operation Context

| Field | Type | Required | Notes |
|---|---|---|---|
| `sessionID` | string | yes | Proposed permission-event context; installed evaluate event shape is not verified by official docs |
| `action` | string | yes | Proposed permission-event action; hook event contract is not verified |
| `resource` | string | no | One resource from the complete request; full resource delivery is an implementation-validation requirement |
| `mutationIntent` | `mutate \| read-only` | yes | deterministic classification |
| `operationClass` | `RuntimeOperationClass` | yes at hook classification | Existing classes: `read-only`, `repository-mutation`, `changebudget-managed-mutation`, `changebudget-force-close`, `changebudget-external-mutation`, `changebudget-unsupported`, or `unresolved-mutation`; optional in the current projection input type |
| `targetPath` | string \| null | yes | repository-relative path when resolvable |
| `metadata` | `Record<string, unknown>` | yes | explicit runtime metadata |

For ChangeBudget CLI resources, the existing `operationClass` can describe a supported executable form only after recognizing the complete supported command grammar. Absolute executable paths require verified installed-package shim identity. Recognition identifies the CLI invocation; it does not itself grant authority or determine `runtimeAction`. This classification is not a new persistent schema or permission field.

## Final Authority and Provenance Model (planning concept; not a schema)

Keep distinct: (1) the exact requested human intent; (2) the ChangeBudget-canonical structured grant; and (3) the verified native ChangeBudget authorization event establishing or changing that grant. Human prose expresses intent but is not unlimited structured authority. An orchestrator may consume/reference the canonical grant identifier; only the orchestrator receives that identifier, and neither an agent, model, session memory, transport, nor ordinary OpenCode `ask` may issue or expand it. An OpenCode `ask`/`once` reply is operational permission only, never canonical HARD authority or a native authorization event.

A canonical grant binds exact paths, capabilities, numeric ceilings, repository and bounded work identity, authority/schema version, provenance, and lifecycle status. Malformed, forged, cross-repository/work, revoked, expired, reported-consumed, or stale authority blocks rather than prompting again. Reuse is limited to the matching active bounded START→AMEND→REPAIR→CLOSE lifecycle; successful close is terminal for unrelated work. Do not infer issuer or ceiling intent from prose, CLI values, task IDs, execution-envelope JSON, permission metadata, or saved host rules.

### Local registry, repository reference, and physical anchor

The selected repository authority model is a user-owned registry outside the repository, a repo-local public reference, and a physical ChangeBudget anchor associated with the Git common directory. The registry is local user-owned state, not a cloud/global grant database; the public reference is not authority on its own. Linked worktrees sharing one Git common-dir share a local repository authority domain, while grants remain work-bound.

HARD binding requires a genuine, reliable physical identity for the anchor. If that identity is unavailable or unreliable, HARD binding fails closed; routine operations not relying on HARD authority may continue. Do not fall back to a path, remote, or copied UUID. An unchanged common-directory instance is the same repository instance even when working contents change; Git baseline/contract rules govern content. A same-path replacement is a new instance only when the Git common-directory instance changes. Moves preserve HARD authority only when physical identity is verified. Clones, full copies, and cross-machine transfers do not inherit HARD authority. Rebind is an explicit human ChangeBudget administrative action, never performed by an agent through the guarded path; retain an audit of old and new binding and do not silently migrate grants.

Physical-ID availability/reliability, file-ID reuse, common-dir association, linked-worktree behavior, moves/copies, OneDrive, and POSIX/Windows behavior require implementation validation. No new physical identity proof is claimed. The threat boundary excludes a malicious unrestricted same-user OS actor able to tamper with the external registry, repository, physical anchor, or administrative path. This is not cryptographic federation or an OS sandbox.

### Native administration and bounded operation scope

The selected rule is **CHANGEBUDGET_NATIVE_APPROVAL_REQUIRED**. Any agent-invoked ChangeBudget administration that creates, expands, revokes, or rebinds canonical authority through the guarded Runtime Guard path MUST BLOCK regardless of saved `always`/allow rules. The agent may produce a minimum proposal and user-facing instructions; a human executes the ChangeBudget-owned administrative action outside governed agent execution. Genuine new HARD authority therefore yields a minimum proposal and BLOCK pending the separate native action; this user-facing request is not a runtime `ask`. A verified fresh native authorization is also required for force execution in the agent path; without it the operation MUST BLOCK, and host ASK/once/always is never a substitute.

Routine autonomy covers clean eligible init, narrow premise/grant-covered start, localized edits to the requested task surface and relevant tests/mechanical changes, within-authority repair, the minimum covered amend, and close after PASS plus required completion. It does not silently authorize protected or unrequested paths, dependencies, migrations, configuration, public API, force operations, unrelated roots, or administration. Preserve SPEC-002/003 numeric semantics: expected counts are soft drift estimates; `max_files`/`max_changed_lines` are HARD only with qualifying provenance, SOFT when verifiably unadopted, and UNRESOLVED when ambiguous. An unresolved material check remains HUMAN_REVIEW under the owner spec, while Guardian blocks operations relying on unresolved authority. SPEC-002 FR-011/FR-012 remain authoritative for allow-list/hard-deny behavior.

For autonomous authority-consuming operations and every native grant administration action (create/expand/revoke/rebind), ChangeBudget-owned lifecycle handling retains structured evidence of the operation, current grant/premise and provenance, repository/work/version/lifecycle, exact scope, minimum delta, subset/boundary checks, rationale, and outcome. A rebind includes old/new binding evidence. Permission-hook evaluation does not persist evidence. An audit-write failure must prevent the authority-consuming or administrative action from committing; idempotency/retry/recovery detail remains implementation design. No final storage field, schema, command, API, or reason code is added here.

## Runtime Contract Snapshot

```ts
interface RuntimeContractSnapshot {
  contract_id: string;
  task_description: string;
  base_revision: string;
  allow_paths: string[];
  deny_paths: string[];
  allow_new_files: boolean;
  allow_new_dependencies: boolean;
  allow_migrations: boolean;
  allow_config_changes: boolean;
  allow_public_api_changes: boolean;
}
```

## Runtime Output

```ts
interface RuntimeProjection {
  runtimeAction: 'allow' | 'ask' | 'block';
  rule: string;
  reasonCode: string;
  message: string;
}
```

The existing native permission effect is `allow`, `ask`, or `deny`; internal `block` maps to `deny`. For multiple resources, the existing strict ordering is `deny > ask > allow`. OpenCode `ask` remains an operational permission effect only. Its response never establishes ChangeBudget-native approval, creates a canonical grant, or supplies HARD authority. A user-facing minimum-authority proposal is not a runtime `ask`. The conceptual workflow word `REFOCUS` is not a permission effect or a member of this model.

## Operation Classes and State Protection

| Class | Meaning | Guardian V2 direction / status |
|---|---|---|
| `read-only` | Supported read-only action, including supported ChangeBudget inspection command forms | Classifier examples are historical evidence only; preserve incoming deny and fail-closed unsafe handling. Beta.7 is a separate runtime investigation. |
| `repository-mutation` | Ordinary targeted repository write | Continue only within exact premise/current valid authority and permitted task surface; use minimum covered delta. REFOCUS verified optional scope before escalation. A materially new HARD authority proposal BLOCKS pending native ChangeBudget action. Protected/denied/unknown targets block. |
| `changebudget-managed-mutation` | Recognized managed CLI operation such as `init`, `start`, `amend`, `close`, `integrate`, or `check` with valid satisfaction evidence | Clean eligible init, narrow covered start, minimum covered amend, within-authority repair, and normal close after PASS may be autonomous. Recognition alone is not authorization. New/expanded/revoked authority administration invoked by an agent through this guarded path always blocks. |
| `changebudget-external-mutation` | Recognized external CLI mutation (`update`) | `update --check` and proven-owned wrapper refresh may be autonomous; real package update requires explicit user request. New material HARD authority still needs separate native ChangeBudget action. |
| `changebudget-force-close` | Recognized force close/bypass with its required valid reason | Agent-path execution without a separate verified fresh native authorization MUST block. OpenCode `ask`/`once`/`always` is not that authorization. Even a valid force authorization never permits direct protected writes. |
| `changebudget-unsupported` | Unknown/malformed grammar, invalid evidence, shell operator around an attempted CLI invocation, or unrecognized wrapper for such an invocation | Block in every state; no lifecycle-authority exception. |
| `unresolved-mutation` | Potential mutation cannot be safely classified/targeted | Unsafe/unknown work blocks. Ordinary non-ChangeBudget work before initialization retains FR-004 passive behavior except direct-state protection and fail-closed unsupported ChangeBudget invocation. Current pre-init source gap remains implementation backlog. |

The operation classes distinguish recognized CLI handling from directly writing `.changebudget/**`; recognition is not authorization. Direct state protection applies in every lifecycle state. Routine autonomy is limited to clean eligible init, narrow start, localized requested task-surface edits/relevant tests/mechanical changes, within-authority repair, minimum covered amend, and close after PASS/required completion. It never silently authorizes protected or unrequested paths, dependencies, migrations, configuration, public API, force, unrelated roots, or administration.

Preserve the exact premise, continue within authority, use the mechanically implied minimum, then a minimum already covered by a valid grant. REFOCUS optional/oversized proposals only with independently verified optionality and before escalation. For new HARD authority, provide the minimum user-facing proposal and BLOCK the guarded agent operation pending the separate native action; do not substitute runtime `ask`. Invalid, stale, unknown, unsafe, denied, or protected work blocks. If optionality is absent/untrusted, an operation already within current valid authority continues. `REPAIR` alone is not a blanket stop; `HUMAN_REVIEW` is not authority. An OpenCode `ask` may still arise from normal operational permission rules, but it is never a new ChangeBudget grant or its approval event.

A path mismatch or disabled sensitive-category label alone does not establish new authority. Preserve SPEC-002 allow-list/hard-deny semantics. For legacy numeric provenance, follow SPEC-002 `spec.md` FR-021 and SPEC-003 decision consequences; unresolved material provenance stays HUMAN_REVIEW at check and blocks Guardian operations relying on it. Do not infer ceiling intent from the stored value or label.

Read-only ChangeBudget examples: `status`, `diagnose`, help/version, `check` without satisfaction evidence, `update --check`, and `integrate opencode --dry-run`. Do not generalize recognition to arbitrary wrappers or every Windows launcher.

## Material Decisions

`metadata.materialDecision` is an existing optional input. Current source may normalize this particular value as `ABSENT`, `VALID`, or `INVALID`; absence is not proof that no human premise or canonical grant exists elsewhere. Present material-decision input does not establish a native ChangeBudget authorization event. No ordinary request creates or expands a grant. Human prose expresses exact intent but not unlimited structured authority; EvoSpec may carry a previously granted authority reference but does not issue new authority. No final metadata field or schema is added here.

## Determinism and State

- Paths use repository-relative `/` separators.
- Direct `.changebudget/**` mutations are always protected in every repository state. Recognized CLI invocations are separately classified; prior universal ask mapping is obsolete. New material HARD authority and agent-path grant administration BLOCK pending separate native ChangeBudget action.
- Permission evaluation performs no plugin-owned persistence.
- ChangeBudget-owned lifecycle handling must retain structured audit evidence for every autonomous authority-consuming operation and every native grant administration action (create/expand/revoke/rebind): requested operation, current authority, grant/premise coverage, exact scope, minimum delta, subset/boundary checks, rationale, old/new binding for rebind, and result. The user-owned registry remains outside the repository, with a repo-local public reference and a physical anchor associated with Git common-dir; it is not a cloud/global grant database. This does not prescribe a schema or permit permission-hook persistence. Current implementation is not claimed to capture this evidence.
- Equal state and equal V2 input produce equal policy, action, rule, and message.
