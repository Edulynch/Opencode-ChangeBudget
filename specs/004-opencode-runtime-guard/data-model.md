# Data Model: OpenCode V2 Runtime Guard

## Runtime Guard Context

Snapshot loaded for each V2 permission evaluation.

| Field | Type | Required | Source |
|---|---|---|---|
| `workspaceRoot` | string | yes | `ctx.location.directory` resolved to the Git root |
| `isInited` | boolean | yes | `.changebudget/state.json` |
| `contract` | `RuntimeContractSnapshot \| null` | yes | active local contract |
| `policyDecision` | `PASS \| REPAIR \| HUMAN_REVIEW` | yes | existing ChangeBudget check |

## Operation Context

| Field | Type | Required | Notes |
|---|---|---|---|
| `sessionID` | string | yes | native V2 permission event |
| `action` | string | yes | native V2 permission action |
| `resource` | string | no | one resource from the V2 request |
| `mutationIntent` | `mutate \| read-only` | yes | deterministic classification |
| `targetPath` | string \| null | yes | repository-relative path when resolvable |
| `metadata` | `Record<string, unknown>` | yes | explicit runtime metadata |

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

The native permission effect is `allow`, `ask`, or `deny`; internal `block` maps to `deny`. For multiple resources, the strict ordering is `deny > ask > allow`.

## Material Decisions

`metadata.materialDecision` is optional. If absent, evaluation receives `ABSENT`. If present, it must normalize to `VALID` or `INVALID` before reaching the existing execution-gate evaluator. No ordinary permission request creates a material proposal.

## Determinism and State

- Paths use repository-relative `/` separators.
- `.changebudget/**` is always protected for mutation.
- Permission evaluation performs no plugin-owned persistence.
- Equal state and equal V2 input produce equal policy, action, rule, and message.
