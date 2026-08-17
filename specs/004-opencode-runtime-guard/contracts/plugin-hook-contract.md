# Contract: OpenCode Plugin Hooks

## Purpose

This contract defines how the SPEC-004 plugin integrates with OpenCode hook points and how runtime actions are returned.

## Scope

- Primary interception path: `permission.ask`
- Supplemental context extraction: `command.execute.before`, `tool.execute.before`
- Deterministic scope: only decisions described by SPEC-004 mapping table

## Public Hook Surface

### `permission.ask`

- **Signature**: `(input: Permission, output: { status: "ask" | "deny" | "allow" }) => Promise<void>`
- **Type source**: `@opencode-ai/plugin` hook declaration and `Permission` from `@opencode-ai/sdk`
- **Expected behavior**:
  - `output.status = "allow"` => operation continues.
  - `output.status = "deny"` => operation is blocked for this attempt.
  - `output.status = "ask"` => OpenCode asks user once for this operation and then returns to action flow.

### `tool.execute.before`

- **Signature**: `(input: { tool: string; sessionID: string; callID: string; }, output: { args: any }) => Promise<void>`
- Used to derive deterministic operation metadata (`tool`, path-like args, mutation intent).

### `command.execute.before`

- **Signature**: `(input: { command: string; sessionID: string; arguments: string; }, output: { parts: Part[] }) => Promise<void>`
- Used to classify command operations when command tool paths are deterministically parseable.
- If command intent cannot be safely resolved, it is treated as non-deterministic mutation and follows fail-safe mode.

## Metadata Contract

The plugin MUST write deterministic context into `Permission.metadata` fields through `output.metadata` values or by
passing through to `permission.ask` metadata where available:

- `rule`: stable rule code (for example `OCG-REPAIR`, `OCG-DENY-PATH`, `OCG-OUT-OF-SCOPE`)
- `runtimeAction`: one of `allow`, `ask`, `block`
- `policyDecision`: `PASS` / `REPAIR` / `HUMAN_REVIEW`
- `reason`: concise user-facing reason string
- `operationId`: stable identity for this intercept attempt
- `contractId`: active contract id when available

## Determinism and Stability

- For the same OpenCode input + same workspace snapshot + same active contract, the emitted status and metadata must be
  unchanged.
- No additional side effects (no writes, no audit trail, no contract mutation).

## Failure and Error Posture

- Any evaluator failure before status computation MUST default to fail-safe behavior for mutating operations in initialized
  repositories.
- Non-mutating operations are not denied solely due to metadata extraction failures.
