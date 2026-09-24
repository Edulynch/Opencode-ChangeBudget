# Contract: Runtime Decision Mapping

> Status: Draft — **NEEDS_CLARIFICATION**. The decision sequence below is conditional planning, not a verified permission-hook projection. Authenticated human issuer, local repository binding, and installed-host evaluation/effect semantics remain unverified. Direct-state protection is normative but not fully implemented in the current source. No new public schema is defined.

## Purpose

This draft records existing runtime input/output vocabulary and product constraints for a future deterministic projection. Product decisions are resolved; implementation planning must map existing inputs without changing those constraints. It does **not** define the final mapping from policy evaluation, requested outcome, and authority context into one OpenCode runtime action. Do not treat the legacy mapping below as current acceptance criteria.

## Runtime Input and Output

### `RuntimeInput`

```ts
type PolicyDecision = 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';

type RuntimeAction = 'allow' | 'ask' | 'block';

type MutationIntent = 'mutate' | 'read-only';

interface RuntimeInput {
  policyDecision: PolicyDecision;
  executionGateResult?: ExecutionGateResult;
  mutationIntent: MutationIntent;
  operationClass?: 'read-only' | 'repository-mutation' | 'changebudget-managed-mutation' |
    'changebudget-force-close' | 'changebudget-external-mutation' | 'changebudget-unsupported' |
    'unresolved-mutation';
  targetPath: string | null;
  isInited: boolean;
  isPathDenied: boolean;
  isPathNotAllowed: boolean;
  newFileDenied: boolean;
  isTargetResolved: boolean;
  isSensitive: {
    dependencies: boolean;
    migrations: boolean;
    config: boolean;
    publicApi: boolean;
  };
  targetInChangeBudget: boolean;
}
```

### `RuntimeOutput`

```ts
interface RuntimeOutput {
  runtimeAction: RuntimeAction;
  rule: string;
  reasonCode: string;
  message: string;
}
```

### Guardian V2 product direction (normative; final projection not prescribed)

The conceptual product directions are:

| Situation | Product/workflow direction | Runtime action |
|---|---|---|
| Work is within the exact explicit human premise and current valid authority | CONTINUE without replacing the requested outcome | Product direction; exact hook projection is an implementation choice |
| Mechanically implied minimum concrete delta is needed | Use that minimum delta | Minimality is authority delta, not an architectural-necessity proof |
| Necessary expansion is already covered by valid human grant | Use minimum concrete delta, AMEND, continue | A valid grant may be reused in one bounded lifecycle |
| A separately verifiable signal establishes optional/oversized work | REFOCUS that proposal to the original task before escalation | “Reject the oversized solution, not the task.” No `REFOCUS` command/exit code/runtime action/enum/state/API/schema; an unverified optionality hint is not sufficient |
| Genuine material new authority is required | ASK only for the uncovered minimum delta | No repeated consent for already granted authority; ask representation is not prescribed here |
| Authorization/state is invalid or work unsafe, protected, an actual force operation is attempted without fresh approval, or unknown | BLOCK | Invalid grants block rather than trigger another ask; protected direct state always blocks; force preflight is separately handled below |

The direct explicit human premise authorizes pursuing the exact requested outcome (for example, Docker + Redis Cluster + three instances). Never reduce or replace that outcome to minimize implementation delta; do not add optional tests/refactors/infrastructure. Soft planner/agent expected file/line values are advisory drift estimates; overrun alone is not ASK/BLOCK. `max_files`/`max_changed_lines` are hard only when human/policy provenance supports them; exceeding a qualified hard ceiling requires new authority. SPEC-002 FR-009/FR-010/FR-021 and SPEC-003 FR-002/FR-003/FR-004/FR-007 now express that distinction and deterministic legacy rule: an exact authorized ceiling is HARD, an unadopted verifiable recommendation is SOFT, and unknown/ambiguous provenance is UNRESOLVED and HUMAN_REVIEW when necessary. SPEC-002 FR-011 allow-list and FR-012 hard-deny semantics remain with that owner. This does not permit silently reinterpreting a legacy value or weakening path authority.

Minimal authority delta examples: current 18 with a ceiling of 60 and one additional required file means 18→19, not 18→60. If the valid grant needs `src/foo.ts`, do not request `src/**`. Minimality is authority delta, not an architectural-necessity proof.

Authority is distinct across trusted human intent, a ChangeBudget-canonical structured grant, and a verified human authorization event. Human prose conveys intent but is not unlimited structured authority; the orchestrator consumes/references, never issues, a grant. EvoSpec or other transport can carry/reference previously granted authority but cannot issue or expand it. Prefer a grant id/reference without inventing its shape. Bind deterministically to repository identity, work/task identity, authority/schema version, and lifecycle status. Malformed, forged, cross-repository, cross-task, revoked, expired, consumed, or stale authority BLOCKS, not ASK. A grant reported consumed blocks when presented; permitted stage-to-stage reuse within one active bounded START→AMEND→REPAIR→CLOSE lifecycle is not consumed replay. Successful CLOSE prevents unrelated future replay.

Sequence the responses: preserve premise → CONTINUE within authority → mechanically implied minimum concrete delta → valid-grant-covered minimum concrete delta → REFOCUS only on a separately verified optional/oversized proposal → ASK minimum material new authority → BLOCK actually invalid/unsafe/protected/unknown authority or target. `REPAIR` alone is not a stop: current-authority repair can continue, grant-covered minimum AMEND continues, verified optional work refocuses, genuine new authority asks, invalid/unsafe work blocks. **An untrusted or absent optionality signal only prevents REFOCUS; it does not turn an already covered operation into an authority failure. CONTINUE when that operation is within current valid authority.** If a concrete uncovered minimum is independently established, ASK only when a verified fresh human channel is available; without one, do not execute or mint authority and surface the approval path as unavailable. BLOCK only when the target or authority actually relied on is unknown/unsafe. Do not infer optionality, necessity, or unknown authority from numeric drift or untrusted metadata, and do not use an LLM compliance judgment. `HUMAN_REVIEW` reasons distinguish optional expansion/REFOCUS, new authority/ASK, and invalid/unsafe authorization or state/BLOCK. A sensitive category explicitly named in the human premise does not trigger redundant ask solely due to category; novel expansion is authority-evaluated, and protected/force gates remain separate.

Lifecycle product conditions: clean first-time CLI `init` may be autonomous for an eligible repository with no conflicting ChangeBudget state or protected/pre-existing overwrite conflict when either an authenticated direct setup request or an existing verified parent premise for the bounded work covers the necessary initialization; no separate exact-init request is required. A raw CLI invocation alone is not authorization. Direct `.changebudget/**` file/edit/shell/Git writes block in every state. `start` is autonomous where premise/valid grant suffices and creates narrow requested contract values, never max-grant ceilings. Minimal grant-covered `amend` continues. Normal `close` after PASS and required completion conditions is autonomous. Force close/bypass uses a two-stage rule: preflight may ASK for the exact fresh force-close approval only through a verified human channel, and the pending operation must not execute before that event is validated and retained; an actual force execution attempt without approval, after rejection/stale approval, or with an unsupported channel BLOCKS/is unavailable. A generic host `ask` reply or saved `always` rule is not authenticated approval. After fresh exact approval, proceed only with that one force operation subject to independent gates; it never authorizes direct protected writes. `integrate opencode --dry-run`, `update --check`, and proven-owned wrapper refresh are autonomous; first real integration needs an explicit human setup/integration request; real package update needs an explicit user update request and is not background coding.

For every autonomous authority-consuming operation, ChangeBudget-owned lifecycle handling retains structured evidence of requested operation, current authority, grant/premise coverage, minimal delta, subset/boundary checks, no-prompt rationale, and any REFOCUS/ASK/BLOCK decision and reason. This supersedes the historical no-audit clarification for MVP, but does not prescribe a store or make permission-hook evaluation persist evidence. No implementation conformance is claimed.

MVP covers provenance distinction, covered START, canonical grants, minimum numeric/exact-path AMEND, within-authority REPAIR, REFOCUS, normal CLOSE, all-state direct protection, repository/work binding, replay/staleness, and evidence. Defer cloud/distributed authorization, arbitrary third-party issuers, organization grants, cryptographic federation, and LLM compliance as enforcement authority.

### Historical mapping (OBSOLETE — REQUIRES REVISION; NOT NORMATIVE)

The prior numbered mapping is retired as a Guardian V2 acceptance rule. It required every `REPAIR` and `HUMAN_REVIEW` mutation to block, every out-of-scope or disabled-sensitive operation to ask, and every recognized managed/external/force-close CLI mutation to ask (including `init`, `start`, `amend`, `close`, non-dry-run `integrate`, satisfaction-evidence `check`, `update`, and force close). These blanket mappings conflict with current product direction and are **OBSOLETE — REQUIRES REVISION**. The previous rule that unknown/malformed/unsafe or unrecognized attempted CLI invocations fail closed remains in force; direct `.changebudget/**` protection in every state also remains in force.

The historical recognized read-only CLI examples were `status`, `diagnose`, help/version, `check` without satisfaction evidence, `update --check`, and `integrate opencode --dry-run`. #36/beta.6 Git source/test evidence covers only `git ls-files`, `git check-ignore`, and supported `git status` pathspec/split-resource forms; sibling resources must be evaluated separately. Neither is evidence of universal host behavior. The beta.7 `status` discrepancy remains UNKNOWN.

### Planning details not fixed by this draft

- Plan a deterministic mapping from SPEC-002 FR-021 legacy classifications and SPEC-003 HUMAN_REVIEW precedence to supported provenance evidence and existing result/reason surfaces; retain the no-new-field/schema/reason-code constraint. The normative owner semantics are aligned, but this contract does not claim implementation evidence.
- Plan how existing grant references, verified-human evidence, execution-gate results, and contract path/sensitivity signals implement the resolved authority sequence while preserving owner-spec semantics and explicit gate blocks. Do not invent final fields/schema.
- Determine the specific supported host feedback for setup/permission-hook registration failure; do not confuse unavailable interception with registered-hook evaluation failure.
- Plan regression/evidence work for all-state direct protection, unsafe targets/wrappers, and existing source divergences. Product direction does not claim those technical gaps are resolved.
- Reproduce the beta.7 host discrepancy using only the failed host's action/resources needed to identify the request. Root cause remains UNKNOWN; do not assume caching.

### Current Source Conformance Note

`opencode-plugin/src/projection.ts` currently implements the legacy mapping described above, including broad policy/path/sensitivity projection and static CLI asks. It checks unsupported CLI class, then returns passive allow for uninitialized ordinary operations before checking `targetInChangeBudget` or unresolved mutation. Its direct-state rule is therefore not reached for some pre-initialization direct mutations; some malformed/unrecognized wrapper forms may also avoid fail-closed handling before initialization unless recognized as unsupported ChangeBudget syntax. The all-state direct-state and unknown-operation requirements remain normative, but these source gaps are PENDING. Source behavior is not proof that the obsolete policy mapping is current or that Guardian V2 is implemented.

## Conditional Lifecycle Authority Matrix (16 required operation classes)

This matrix states the minimum evidence and conceptual outcome for each operation. It is not a final `allow`/`ask`/`deny` mapping and does not assert that the host can currently enact the outcome. “No authority” means no verified premise covering the operation and no current valid grant. “Valid human intent” means the exact relevant request is attributable to a verified human event; prose, CLI values, and a saved host permission do not satisfy that verification gate. A structured grant must be ChangeBudget-owned and bound to the current repo/work/version/lifecycle. Every consuming lifecycle operation records its operation, complete target set, evidence reference, subset/minimality check, rationale/result, and deterministic retry identity in the ChangeBudget-owned lifecycle transaction; failed write means no commit.

| Operation | No authority | Valid human intent | Valid structured grant | Minimum consumption / audit | ASK / BLOCK / special rule |
|---|---|---|---|---|---|
| `status` | Read-only inspection needs no grant if completely recognized | No additional authority | No grant consumed | Read only; no lifecycle event | Preserve incoming deny; beta.7 host allow/block discrepancy is unresolved |
| `diagnose` | Read-only inspection needs no grant if completely recognized | No additional authority | No grant consumed | Read only; no lifecycle event | Unknown/malformed command is not converted into read-only |
| Clean first-time `init` | Without a verifiable setup premise/request, do not infer authority from the raw CLI invocation | An authenticated direct setup request **or** an existing verified parent premise for the bounded work may cover necessary clean initialization; no separate exact-init request is required | A matching grant may cover only the repo/work and necessary init; it cannot authorize direct state edits | One initialization transition, matching repo binding, evidence of the covering premise/request, and no added authority | Block on conflicting/pre-existing/protected overwrite or absent/unverifiable premise; CLI init never authorizes direct `.changebudget/**` mutation |
| `start` | Do not activate a new work contract; request the minimum missing authority only if verified approval is available | Preserve exact outcome; create a ChangeBudget draft ID and retain exact verified event before activation | Reuse only a matching draft/work/repo grant; never copy maximum ceilings as requested values | Bind pre-start evidence, narrow requested contract, activate once; audit atomically | `task_id` is correlation only; no active contract may be presumed before this step |
| Numeric `amend` | No numeric widening | Exact verified ceiling intent can establish only its exact value/delta | Require HARD provenance and matching numeric scope; current 18 with ceiling 60 and one necessary file means 18→19, not 18→60 | Increase only by the mechanically concrete minimum; preserve provenance and audit | Soft estimate overrun is drift only; unresolved legacy value yields HUMAN_REVIEW at check and runtime BLOCK when relied on |
| Exact-path `amend` | No path widening | Exact verified request can cover only the specific intended path/scope | Match exact path against current authorized union; do not turn `src/foo.ts` into `src/**` | Add only the exact required path and retain subset evidence | Deny/protected path always BLOCKS; ASK only for proven uncovered minimum delta |
| `REPAIR` | No new scope from the `REPAIR` label | Continue only for directly covered work | Continue with minimum delta inside valid grant | Record deterministic check/repair operation and coverage | `REPAIR` alone is not a stop or authorization; verified optional proposal may REFOCUS; unknown basis BLOCKS |
| Normal `close` | No unrelated work can use a closed contract | Close may follow the exact task after PASS and required completion conditions | Matching active lifecycle may close without renewed consent | One terminal close transition plus completion/audit evidence | No developer-agreement re-prompt if conditions are met; failed conditions do not become force authority |
| Force close / bypass | Preflight may ASK for the exact force-close approval only through a verified supported human channel; an actual force execution attempt without approval BLOCKS | Fresh exact approval through that channel may cover one force operation only; do not execute while approval is pending | Ordinary/reused grant never substitutes for fresh approval; a saved host `always` never counts | Retain fresh event, reason, exact force operation, one-operation boundary, and terminal result before execution | Rejection, stale approval, or unavailable/unverified channel means BLOCK/unavailable; after approval, all independent gates still apply; never permits protected direct writes |
| `integrate opencode --dry-run` | Read-only recognized dry-run needs no lifecycle grant | No additional authority | No grant consumed | No mutation; no authority event | Must prove exact dry-run grammar; unknown siblings do not inherit read-only status |
| First real integration | No background integration | Exact verified setup/integration request may cover this integration only | Use only a grant bound to this integration/repo | Minimum integration side effect and lifecycle evidence if authority-consuming | ASK minimum if new authorization is proven and trustworthy approval exists; otherwise BLOCK/unavailable |
| Proven-owned wrapper refresh | No refresh unless ownership and exact target are proven | Direct request is not a substitute for ownership proof | Grant does not make an unowned target “owned” | Refresh only the proven-owned wrapper target; retain ownership/result evidence | If ownership is uncertain or targets escape the repo, BLOCK; no broad refresh |
| `update --check` | Read-only check needs no grant | No additional authority | No grant consumed | No package mutation | Preserve incoming deny; exact read-only form required |
| Real package `update` | Do not update in background | Requires an explicit verified user update request | A matching bounded grant may cover the exact requested update | Minimum requested package/update operation; retain evidence | ASK minimum if new scope and trusted prompt supported; never infer from coding task |
| Direct `.changebudget/**` mutation (file/edit/shell/Git) | BLOCK in every state | Human intent does not override protection | No grant overrides protection | No state change and no authorization consumption | Always BLOCK, including before init; recognized CLI lifecycle is distinct from direct writes |
| Unknown/malformed managed operation or attempted ChangeBudget wrapper | BLOCK/fail closed | User-looking text cannot make unknown grammar trusted | Grant cannot authorize unrecognized command form | No operation; record safe denial if lifecycle/audit path is available | Always BLOCK, including before init; unknown/out-of-root resources fail closed |

Incoming restrictive effects and owner hard-deny/protected rules take precedence over the table. For multiple resources, all resources are independently classified and combined `deny > ask > allow`; partial resource coverage never authorizes a mixed operation. Explicitly requested sensitive categories do not trigger a redundant category-only ask, but novel expansion is evaluated against the exact premise/grant. If a concrete pending operation or deterministic Git set does not establish a required uncovered delta, do not invent one. Guardian does not decide architecture necessity. The independent executor/orchestrator owns semantic intent/optionality; REFOCUS is available only for a separately verifiable optional proposal signal within trusted bounded work. **If that signal is untrusted or absent, do not REFOCUS; continue a concrete operation already covered by current valid authority.** Lack of optionality proof alone is not an ASK or BLOCK trigger. ASK requires a proven uncovered minimum and a verified channel; absent a channel, do not execute or mint authority and surface approval as unavailable. BLOCK requires the target or authority actually relied on to be unknown/unsafe. Numeric drift or untrusted metadata alone cannot prove optionality or authority failure.

REFOCUS is a workflow outcome, not an effect: deny only that optional proposed mutation with structured reason/feedback, and optionally provide advisory session-context text for a later request. It adds no paths/capabilities and does not resume or approve the operation. ASK is only for the uncovered minimum delta and only when a fresh verified human event can be captured. OpenCode `always` permission saves a project rule and is never that event. If the issuer or host cannot be verified, fail conservatively rather than converting an ordinary permission reply into a ChangeBudget grant.

## Existing Reason-Code Inventory (not a final mapping)

The following are existing source-level constants. Their presence is historical inventory only; it does not make the obsolete broad mapping normative or introduce new codes.

- `OCG-ALLOW`
- `OCG-PASSIVE-MODE`
- `OCG-REPAIR`
- `OCG-HUMAN-REVIEW`
- `OCG-PATH-DENY`
- `OCG-PATH-OUT-SCOPE`
- `OCG-CHANGEBUDGET-PROTECT`
- `OCG-SENSITIVE-DEPENDENCIES`
- `OCG-SENSITIVE-MIGRATIONS`
- `OCG-SENSITIVE-CONFIG`
- `OCG-SENSITIVE-PUBLIC-API`
- `OCG-UNRESOLVED-MUTATION`
- `OCG-CHANGEBUDGET-MANAGED-MUTATION`
- `OCG-CHANGEBUDGET-FORCE-CLOSE`
- `OCG-CHANGEBUDGET-EXTERNAL-MUTATION`
- `OCG-NEW-FILE-NOT-ALLOWED`

## Output Contract Rules

- If the installed-host gate proves that an operation is intercepted/classified, its projection emits one of `allow`, `ask`, `block` (or preserves a more restrictive incoming effect); this is not an interception guarantee.
- `ask` does not alter any contract or state.
- If the resolved mapping selects `ask`, it applies to one operation and does not alter contract or state; it is separate from direct `.changebudget/**` mutation, which is blocked in every state. This does not restore the obsolete universal ask triggers.
- Unsafe, protected, forged, unknown, and unrecognized attempted CLI work remains gated/fail-closed. Ordinary non-ChangeBudget operations before initialization retain FR-004 passive behavior except direct `.changebudget/**` mutations and unsafe/unknown attempted ChangeBudget invocations. Apply the ordered authority sequence above; no blanket REPAIR/HUMAN_REVIEW or path/sensitivity/CLI ask/block mapping is current policy.
