# Research Notes: SPEC-004

## Sources Checked

- `.opencode/node_modules/@opencode-ai/plugin/dist/index.d.ts`
- `.opencode/node_modules/@opencode-ai/plugin/dist/tool.d.ts`
- `.opencode/node_modules/@opencode-ai/sdk/dist/v2/gen/types.gen.d.ts`
- Existing ChangeBudget modules: `src/core/**` and `src/models/check-result.ts`

## Decision Log

### Decision: primary OpenCode enforcement callback

- **Decision**: use `permission.ask` as the only callback that can deterministically emit
  a runtime action with one of `status: "allow" | "deny" | "ask"`.
- **Rationale**: this hook is typed with the exact output shape required by SPEC-004 and maps cleanly to the
  OpenCode runtime actions (`allow`, `ask`, `block` from ChangeBudget perspective).
- **Alternatives considered**: `command.execute.before` and `tool.execute.before` provide only `args` and `tool`
  fields and no direct action status. They are still useful for extracting deterministic operation context,
  but action control is enforced through `permission.ask`.

### Decision: context extraction strategy for deterministic decisioning

- **Decision**: evaluate concrete targets from deterministic OpenCode events (`permission.ask` +
  `tool.execute.before`), then route a projected decision to `permission.ask`.
- **Rationale**: keeps plugin behavior deterministic for known APIs while avoiding assumptions about unknown
  shell command intent.
- **Alternatives considered**: deriving control only from command text or only from tool name. Rejected because both
  can miss deterministic non-shell file operations while over/under-blocking.

### Decision: unknown mutation handling

- **Decision**: when repository is initialized and an intercepted operation is mutating but target context
  cannot be deterministically resolved, emit `block`.
- **Rationale**: aligns with fail-safe posture in FR-014 and avoids accidental bypass in ambiguous paths.
- **Alternatives considered**: `allow` unknowns to keep flow fast. Rejected to prevent silent policy gaps.

### Decision: repository state prerequisite

- **Decision**: resolve lifecycle and active contract from `.changebudget/state.json` + active contract file,
  then evaluate only in initialized/active contexts. Non-initialized repositories should produce `allow` in
  runtime for backwards compatibility.
- **Rationale**: preserves core CLI behavior while avoiding policy decisions for workspaces without ChangeBudget.
- **Alternatives considered**: strict hard-block for all non-initialized repos. Rejected because it would violate
  non-invasive integration FR-004 and FR-015.

### Decision: policy model reuse and extension

- **Decision**: reuse existing contract fields and path semantics from SPEC-001/002 (`allow_paths`, `deny_paths`,
  `allow_new_dependencies`, `allow_migrations`, `allow_config_changes`, `allow_public_api_changes`) and apply a
  deterministic projection to `runtimeAction`.
- **Rationale**: keeps SPEC-004 policy interpretation consistent with current CLI policy source.
- **Alternatives considered**: introducing stack-specific heuristics in this phase. Rejected to respect explicit
  out-of-scope constraints.

### Decision: `.changebudget` self-protection rule

- **Decision**: hard-deny every mutating operation touching `.changebudget/**` regardless of contract toggles,
  with a stable rule identifier.
- **Rationale**: prevents runtime self-modification and aligns with FR-010.
- **Alternatives considered**: only deny non-deterministic `.changebudget` writes. Rejected due to safety ambiguity.

### Decision: one-shot ask behavior

- **Decision**: `ask` is always one operation only and never persists state or updates contracts.
- **Rationale**: explicitly required by clarifications in `spec.md` and stable for deterministic repeatability.
- **Alternatives considered**: session-level cache of approvals for repeated paths. Rejected because spec requires
  explicit non-persistent runtime checks.

## Open Design Notes

- The exact shape of non-permission OpenCode tool events is only partially typed (`tool` string + `args: any` in
  `tool.execute.before`). The plugin should use conservative extraction and fail-safe on unresolved mutation context.
- `ToolContext.ask` exists, but it is tool-local and not the direct mechanism for global repository policy interception.
  It can be considered for explicit user prompts inside future custom tools.
- OpenCode permission request metadata is available via `Permission` fields (`id`, `type`, `pattern`, `metadata`), so
  plugin outputs should include deterministic `runtimeAction`, `rule`, and `reason_code` in `metadata`.

## Research Summary

- Confirmed hook signature supports deterministic runtime action return through `permission.ask(input, output)`.
- Confirmed no current local typing shows a prebuilt safe-write hook for file-level granularity; safe execution therefore
  requires deriving mutating target context from available tool/command inputs and defaulting to fail-safe behavior when
  unsupported.
- Confirmed OpenCode SDK type surface already includes `Permission` object and permissions action vocabulary
  (`allow`, `deny`, `ask`), allowing direct mapping to `allow`, `ask`, `block` projection logic.
