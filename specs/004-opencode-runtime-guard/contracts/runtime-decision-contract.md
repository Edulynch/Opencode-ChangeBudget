# Contract: Runtime Decision Mapping

> Status: **READY_FOR_TASKS — planning only**. Guardian V2 product decisions are final, but the projection is not implementation evidence. Physical-identity/filesystem behavior and installed-host interception remain unvalidated; direct-state protection has a known source gap. No new public schema is defined.

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

The exact direct human premise (including Docker + Redis Cluster + three instances) remains the requested outcome. Never reduce or replace it to minimize implementation delta; do not add optional tests/refactors/infrastructure. Prose is trusted intent, not unlimited structured authority. Soft expected file/line values are drift estimates; overrun alone is not ASK/BLOCK. `max_files`/`max_changed_lines` are HARD only with qualifying human/policy provenance. SPEC-002 FR-021 and SPEC-003 FR-002/FR-003/FR-004/FR-007 retain the existing HARD/SOFT/UNRESOLVED check semantics; SPEC-002 FR-011/FR-012 retain allow-list and hard-deny ownership.

| Situation | Product/workflow direction | Runtime authority meaning |
|---|---|---|
| Work is within exact premise and current valid authority | CONTINUE without replacing the requested outcome | Projection must not invent a redundant authorization trigger. |
| Mechanically implied minimum or minimum already covered by valid grant | Use the minimum delta; continue | Minimality is authority delta, not an architectural-necessity proof. |
| Separately verified optional/oversized work | REFOCUS to the requested task before escalation | Workflow concept, not a runtime action/command/exit code/enum/state/API/schema. Untrusted/absent optionality does not stop covered work. |
| New material HARD authority is required | Present the minimum concrete proposal and user-facing instructions; BLOCK the governed operation pending separate native ChangeBudget action | This request/proposal is not `ask`. Agent, orchestrator, model, or transport does not issue the grant. |
| ChangeBudget administration creates, expands, revokes, or rebinds authority through guarded agent execution | BLOCK, regardless of saved OpenCode `always`/allow | A human performs the ChangeBudget-owned administrative action outside governed agent execution. Selected model: **CHANGEBUDGET_NATIVE_APPROVAL_REQUIRED**. |
| Ordinary OpenCode operational permission | Existing host `ask` may still apply where normal permission rules require it | `ask`/`once`/`always` is operational only; never canonical HARD authority, a grant, or a native authorization event. |
| Invalid, stale, unknown, unsafe, denied, or protected authority/target | BLOCK | A path mismatch, category label, `REPAIR`, or `HUMAN_REVIEW` alone does not determine the result. |

The canonical ChangeBudget grant has a ChangeBudget-owned identifier/reference bound to exact paths, capabilities, ceilings, repository/work, authority/schema version, provenance, and lifecycle. Only the orchestrator receives that identifier; agents receive exact bounded work instructions. A grant reported consumed blocks when presented, except valid stage-to-stage reuse within one active bounded START→AMEND→REPAIR→CLOSE lifecycle. Successful CLOSE prevents unrelated replay. Do not infer grant or ceiling authority from prompt prose, CLI input, task IDs, permission metadata, execution-envelope JSON, or host saved rules.

Repository authority uses a user-owned registry outside the repository, a repo-local public reference, and a physical ChangeBudget anchor associated with the Git common directory. Linked worktrees sharing the common directory share a local repository authority domain, but grants remain work-bound. HARD binding fails closed if genuine physical identity is unavailable or unreliable; routine operations not relying on HARD authority may continue. There is no path, remote, or copied-UUID fallback. Unchanged common-dir instance means same repository instance despite changed working contents; Git baseline/contract rules govern content. Same-path replacement is a new instance only when the Git common-directory instance changes. Moves preserve HARD authority only with verified physical identity; clones, full copies, and cross-machine transfers do not inherit it. Rebind is an explicit human admin action, audited with old/new binding, and does not silently migrate grants. Physical-ID/platform proof is implementation validation, not a planning blocker.

The local threat boundary excludes a malicious unrestricted same-user OS actor able to tamper with external/repository/anchor/admin paths. No cryptographic federation or OS sandbox is claimed. Routine autonomy covers clean eligible `init`, narrow premise/grant-covered `start`, localized requested task-surface edits and relevant tests/mechanical changes, within-authority repair, minimum covered `amend`, and `close` after `PASS` plus required completion. It never silently authorizes protected or unrequested paths, dependencies, migrations, configuration, public API, force, unrelated roots, or administration.

### Lifecycle authority matrix

| Operation | Product condition | ASK / BLOCK rule |
|---|---|---|
| Read-only recognized inspection | No ChangeBudget grant needed if fully recognized and not denied by incoming effect | Preserve incoming deny; beta.7 observations are historical and under SEPARATE_RUNTIME_INVESTIGATION. |
| Clean first-time `init` | Eligible repo, no conflicting state or protected/pre-existing overwrite, and covered by direct setup request or verified parent premise | Raw CLI invocation alone is not authorization; direct `.changebudget/**` writes always BLOCK. |
| `start` | Preserve exact outcome; use narrow requested values and matching work identity | Continue only with covered authority; new HARD authority proposal BLOCKS pending native action. |
| Numeric/path `amend` | Apply only the minimum exact covered delta | No widening; a genuinely new HARD scope is proposed then BLOCKED pending native action. |
| `REPAIR` / ordinary localized edit | Continue when exact operation is within current authority and task surface | REPAIR is neither blanket stop nor grant. Unauthorized/unrequested/protected expansion BLOCKS. |
| Normal `close` | Autonomous after PASS and required completion | No redundant consent when conditions are met; close is terminal for unrelated grant reuse. |
| Force close/bypass | Requires separate verified fresh native authorization for that exact force operation | Agent-path execution without it MUST BLOCK. Host `ask`/`once`/`always` is not fresh native authorization. |
| Agent-path create/expand/revoke/rebind | Never administer canonical authority from governed agent execution | MUST BLOCK regardless of saved allow/always. Human performs native ChangeBudget action externally; rebind audits old/new binding. |
| Direct `.changebudget/**` mutation | Protected in every repository state | Always BLOCK, including before initialization; CLI recognition never authorizes direct state writes. |
| Unknown/malformed CLI or unrepresentable/out-of-repo resource | Not safely classifiable | BLOCK/fail closed; no blanket ASK or passive-mode bypass. |

For multiple resources, evaluate all independently and preserve `deny > ask > allow`; partial resource coverage cannot authorize a mixed operation. An incoming deny is never weakened. REFOCUS rejects only the verified optional proposal and gives feedback for a later request; it adds no authority. For unresolved material numeric provenance, retain SPEC-002/003 completed `HUMAN_REVIEW` check semantics when prerequisites pass, while BLOCKING a Guardian operation that relies on unresolved authority. Fatal check prerequisites remain fatal; do not rewrite their result surface.

ChangeBudget-owned lifecycle handling retains structured evidence for autonomous authority-consuming operations and every native grant administration action (create/expand/revoke/rebind): operation, grant/premise and provenance, exact scope, work/repository/version/lifecycle, minimum delta, subset/boundary result, rationale, old/new binding where applicable, and outcome. The registry is local user-owned state, not a cloud/global database. Permission-hook evaluation does not persist evidence; audit-write failure must prevent the consuming/admin operation from committing. No final store/schema is selected.

### Implementation validation status (not a task-generation gate)

The product order and response meanings are final; exact input-to-effect projection remains an implementation matter. Future validation must prove native admin BLOCK despite host allow/always, platform physical identity/rebind semantics, installed-hook interception and deny behavior, and honest unavailable feedback. POSIX/Windows file-ID reuse/OneDrive, multi-target, out-of-repository, pre-init, and historical beta.7 cases remain implementation validation. No host ASK trace, physical identity proof, runtime conformance, or test result is claimed. No live once/reject ASK probe is needed for task generation. If registration fails before a hook exists, report integration unavailable, not successful block.

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

- For a proven intercepted/classified operation, the existing projection vocabulary is `allow`, `ask`, `block` (or a preserved more restrictive incoming effect); documenting the vocabulary is not an interception guarantee.
- An OpenCode `ask` is operational permission for that host operation only and does not alter contract or state. It never establishes ChangeBudget-native approval, creates/expands a canonical grant, or supplies HARD authority.
- New material HARD authority or agent-path ChangeBudget administration uses a minimum user-facing proposal plus runtime BLOCK pending a separate native ChangeBudget action, not runtime `ask`. Direct `.changebudget/**` mutation remains blocked in every state; no obsolete blanket ASK trigger is restored.
- Unsafe, protected, forged, unknown, and unrecognized attempted CLI work remains gated/fail-closed. Ordinary non-ChangeBudget operations before initialization retain FR-004 passive behavior except direct `.changebudget/**` mutations and unsafe/unknown attempted ChangeBudget invocations. Apply the ordered authority sequence above; no blanket REPAIR/HUMAN_REVIEW or path/sensitivity/CLI ask/block mapping is current policy.
