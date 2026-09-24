# Data Model: OpenCode V2 Runtime Guard

> Status: Draft — **NEEDS_CLARIFICATION**. The structures below are planning concepts and source snapshots, not a verified installed-host contract or final Guardian V2 schema/projection. Authenticated human issuer, dependable local repository binding, and actual installed permission-hook behavior remain unverified. No new enum, field, public API, lifecycle representation, or persistence schema is introduced here.

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
| `resource` | string | no | One resource from the complete request; full resource delivery is a host gate |
| `mutationIntent` | `mutate \| read-only` | yes | deterministic classification |
| `operationClass` | `RuntimeOperationClass` | yes at hook classification | Existing classes: `read-only`, `repository-mutation`, `changebudget-managed-mutation`, `changebudget-force-close`, `changebudget-external-mutation`, `changebudget-unsupported`, or `unresolved-mutation`; optional in the current projection input type |
| `targetPath` | string \| null | yes | repository-relative path when resolvable |
| `metadata` | `Record<string, unknown>` | yes | explicit runtime metadata |

For ChangeBudget CLI resources, the existing `operationClass` can describe a supported executable form only after recognizing the complete supported command grammar. Absolute executable paths require verified installed-package shim identity. Recognition identifies the CLI invocation; it does not itself grant authority or determine `runtimeAction`. This classification is not a new persistent schema or permission field.

## Minimal Authority and Provenance Model (conditional; not a schema)

Keep three things separate. **Human intent** is the exact explicitly requested outcome and may justify pursuing that outcome without redundant consent; prose does not grant arbitrary paths, limits, or capabilities. A **ChangeBudget-canonical grant** is bounded structured authority. A **verified authorization event** is evidence from an authenticated human or trusted exact policy source that establishes that grant. The orchestrator, model, session memory, or transport can consume/reference an existing grant but never issue or expand one. Arbitrary CLI flags, task IDs, execution-envelope JSON, permission metadata, prompt summaries, user-looking text, or a host saved `always` rule are not issuer evidence.

### Work identity and pre-START evidence

Use a ChangeBudget-minted existing `ChangeContract.id` as the generic local work identity. It remains distinct for unrelated work; optional `task_id` is only SpecKit correlation. Reuse existing `draft` → `active` → `closed` contract lifecycle status for an authorized work unit. An active contract does not exist before `START`: first establish a draft identity, bind the verified human/policy event and its exact bounded scope to that identity, retain that evidence in a ChangeBudget-owned lifecycle transaction, and only then activate/use the grant. Do not model an implicit active grant, use `task_id` as identity, or grant the contract's maximum ceilings as the requested scope.

Current `ChangeContract` has an ID/status and optional task/source fields but no issuer/provenance or repository identity; current lifecycle state has active/last-closed contract IDs but no repository ID. The execution envelope and permission metadata do not prove an issuer. Existing contract snapshots and amendment lists likewise cannot establish the source event by themselves. First test whether existing ChangeBudget-owned contract/lifecycle history can validate both pre-start authorization and later operation evidence. Only if it cannot, the minimum conceptual addition is a local event/journal associated with the draft/contract identity—not a standalone global registry. No final storage path, schema, or field names are selected; SPEC-002's existing contract readability and FR-021 legacy rule remain unchanged.

### Local repository binding candidate and limits

The candidate local binding is the canonical Git worktree root plus Git common directory plus a ChangeBudget init-local identity, checked on every grant use. This identity is not currently present: the inspected Git helper returns the Git top-level root, and the lifecycle state has no repository ID. Bind the event to the authority version and work identity as well. A changed/missing binding (including ordinary clone or move where the canonical tuple changes) makes the evidence stale and requires fresh authorization, not an ASK that silently reuses it.

This is only a local stale-context detector, not cryptographic identity. A copied `.changebudget` directory, same-path repository replacement, path alias/symlink/case behavior, worktree/common-dir handling, and cross-platform canonicalization could defeat or ambiguously change the candidate. Until these cases and an acceptable threat model are evidenced, do not claim clone/copy/move resistance or that path+Git metadata authenticates the repository. If same-path replacement/copy cannot be safely distinguished under the accepted model, the repository gate remains unresolved.

### Scope, consumption, and evidence

Before allowing an authority-consuming operation, derive its concrete target set from the pending exact operation or deterministic Git change set; speculative/planner-proposed paths do not prove need. The complete proposed set of paths, metrics, and capabilities must be a subset of the union of current human premise and currently valid structured grants. Apply deny/protected rules first; unknown, malformed, mixed-resource, out-of-repository, or otherwise unrepresentable targets fail closed. Do not infer architecture necessity. Human intent may cover an exact requested outcome, but structured scope still needs verified evidence.

Each autonomous authority-consuming ChangeBudget lifecycle transaction retains structured evidence for the operation and all targets; current authority and provenance-event reference; repository/work/version/status; authority delta and subset/boundary evaluation; why no new approval was needed; result; and any REFOCUS/ASK/BLOCK reason. Persist it through ChangeBudget-owned lifecycle handling, not from the permission hook. A failed evidence write means the consuming operation does not commit. Retries require deterministic idempotency/deduplication and crash-recovery semantics; a duplicate cannot widen or reapply the grant. If write outcome is ambiguous, fail closed pending reconciliation. The exact transactional representation remains open until history/storage capabilities are evidenced.

Authority is valid only for its matching repository, work ID, authority/schema version, and lifecycle status. Reuse is allowed across stages only within one active bounded START→AMEND→REPAIR→CLOSE lifecycle. Revoked, stale, malformed, forged, cross-repository/work, wrong-version, or reported-consumed evidence blocks rather than prompting again; successful close is terminal for unrelated work. These requirements do not add fields or assert that current source implements them.

The MVP remains local and bounded. Cloud/distributed authorization, arbitrary third-party issuers, organization grants, cryptographic federation, a global registry/database/token service, and LLM compliance as enforcement authority are explicitly deferred.

Soft planner/agent expected file/line counts are drift estimates; overrun alone neither asks nor blocks. `max_files`/`max_changed_lines` are hard only with verifiable exact human/policy provenance, and exceeding a qualified hard ceiling requires new authority. A verifiable unadopted recommendation is SOFT; unknown/ambiguous provenance is UNRESOLVED and yields HUMAN_REVIEW when classification is necessary. SPEC-002 `spec.md` FR-021 defines deterministic legacy classification and preserves contract readability without schema migration; SPEC-003 `spec.md` FR-002/FR-003/FR-004/FR-007 defines PASS/REPAIR/HUMAN_REVIEW consequences. SPEC-002 FR-011/FR-012 keep existing path-policy ownership. `expected_files`/`expected_changed_lines` here name the user-specified concepts, not proposed final contract fields. The 18→19 rather than 60 and exact `src/foo.ts` rather than `src/**` examples express authority-delta minimality, not a new schema.

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

The existing native permission effect is `allow`, `ask`, or `deny`; internal `block` maps to `deny`. For multiple resources, the existing strict ordering is `deny > ask > allow`. The conceptual workflow word `REFOCUS` is not a permission effect or a member of this model.

## Operation Classes and State Protection

| Class | Meaning | Guardian V2 direction / status |
|---|---|---|
| `read-only` | Supported read-only action, including supported ChangeBudget inspection command forms | Existing classifier examples are evidence only; preserve independent unsafe/incoming-deny handling and beta.7 host uncertainty |
| `repository-mutation` | Ordinary targeted repository write | Apply the ordered premise/current-authority/minimum-delta/refocus/new-authority/invalid-state product sequence; exact runtime projection is planning design. Direct `.changebudget/**` remains `block` in every state |
| `changebudget-managed-mutation` | Recognized managed CLI operation such as `init`, `start`, `amend`, `close`, `integrate`, or `check` with valid satisfaction evidence | Product conditions are in `spec.md`: clean first-init, covered narrow `start`, minimum grant-covered `amend`, normal close after PASS, read-only dry-run. Recognition alone is not authorization; projection implementation is pending |
| `changebudget-external-mutation` | Recognized external CLI mutation (`update`) | `update --check` and proven-owned wrapper refresh are autonomous; real package update needs explicit user update request, not background coding. Projection implementation is pending |
| `changebudget-force-close` | Recognized `close --force` with its required valid reason | Preflight may request exact fresh approval only through a verified human channel; an actual force execution attempt without it blocks. A host `ask` alone is not the issuer. Even valid approval never authorizes direct protected writes; no final prompt/API representation is specified |
| `changebudget-unsupported` | Unknown/malformed grammar, invalid evidence, shell operator around an attempted CLI invocation, or unrecognized wrapper for such an invocation | `block` in every state; no automatic lifecycle-authority exception |
| `unresolved-mutation` | Potential mutation cannot be safely classified/targeted | Unsafe/unknown work blocks. Before initialization, ordinary non-ChangeBudget work retains FR-004 passive behavior except direct-state protection and fail-closed unsupported ChangeBudget invocation. Current pre-init source gap remains PENDING |

The existing operation classes distinguish a supported CLI invocation from directly writing a path under `.changebudget/**`; recognition is not authorization. Direct state protection applies in every lifecycle state. Ordinary non-ChangeBudget operations without active context remain passive/allowed except for this direct-state rule and fail-closed classification requirements. The former blanket `ask` projection for recognized lifecycle, external, and force-close operations is **OBSOLETE — REQUIRES REVISION**.

Product workflow intent is CONTINUE within the exact requested outcome and existing authority; use the mechanically implied minimum concrete delta, then the minimum already covered by a valid grant; REFOCUS only when optionality is separately verified; ASK only for minimum materially new authority; and BLOCK invalid/unsafe/protected/actual-force-without-fresh-approval/unknown work. If an optionality signal is untrusted or absent, a covered concrete operation still CONTINUES; lack of that signal alone is not an authority failure. `REPAIR` alone is not a blanket stop. `HUMAN_REVIEW` reasons distinguish verified optional expansion/REFOCUS, genuine new authority/ASK, invalid or unsafe authorization/state/BLOCK. These are not additional `operationClass` or `runtimeAction` values. A soft estimate is not a contract hard cap; owner decision semantics are aligned, while implementation representation remains for planning.

The previous automatic `ask` for every path outside `allow_paths` or every disabled sensitive category is **OBSOLETE - REQUIRES REVISION**. Such a signal alone does not establish new authority. Preserve SPEC-002's allow-list and hard-deny meanings. For legacy numeric provenance, follow SPEC-002 `spec.md` FR-021 and the decision consequences in SPEC-003; do not infer an issuer or ceiling intent from the stored value or its label.

Read-only ChangeBudget examples: `status`, `diagnose`, help/version, `check` without satisfaction evidence, `update --check`, and `integrate opencode --dry-run`. Do not generalize recognition to arbitrary wrappers or every Windows launcher.

## Material Decisions

`metadata.materialDecision` is an existing optional input. Current source may normalize this particular value as `ABSENT`, `VALID`, or `INVALID`; absence of this metadata value is not proof that there is no human premise or ChangeBudget-canonical grant elsewhere, and the model does not assume grant authority must be transported in this slot. Present material-decision input still flows through the existing execution-gate handling. No ordinary request creates a material proposal. Human prose expresses exact intent but not unlimited structured authority; EvoSpec may carry a previously granted authority reference but does not issue new authority. No final metadata field or schema is added here.

## Determinism and State

- Paths use repository-relative `/` separators.
- Direct `.changebudget/**` mutations are always protected in every repository state. Recognized CLI invocations are separately classified; their prior universal ask mapping is obsolete and their exact projection remains unresolved.
- Permission evaluation performs no plugin-owned persistence.
- ChangeBudget-owned lifecycle handling must retain structured audit evidence for every autonomous authority-consuming operation: requested operation, current authority, grant/premise coverage, minimum delta, subset/boundary checks, no-prompt rationale, and any REFOCUS/ASK/BLOCK decision and reason. This supersedes the historical no-audit clarification for MVP without prescribing an audit store or permitting a permission-hook side effect. Current implementation is not claimed to capture this evidence.
- Equal state and equal V2 input produce equal policy, action, rule, and message.
