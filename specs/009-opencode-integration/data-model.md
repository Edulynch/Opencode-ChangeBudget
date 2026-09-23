# Data Model: Native OpenCode V2 Integration

## Managed Resource

```ts
const MANAGED_RESOURCES = {
  pluginWrapper: '.opencode/plugins/changebudget.js',
} as const;
```

The integration has no instruction-file resource and no `opencode.json` resource.

## Ownership States

```ts
type OwnershipState = 'MISSING' | 'MANAGED_CURRENT' | 'MANAGED_STALE' | 'CONFLICT';
```

| State | Condition | Install action | Remove action |
|---|---|---|---|
| `MISSING` | File does not exist | `CREATE` | `ABSENT` |
| `MANAGED_CURRENT` | Marker and exact content match | `UNCHANGED` | `REMOVE` |
| `MANAGED_STALE` | Marker matches, content differs | `UPDATE` | `REMOVE` |
| `CONFLICT` | Existing first line is not the marker | `CONFLICT` | `CONFLICT` |

## Results

```ts
type ResourceAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'REMOVE' | 'CONFLICT' | 'ABSENT';

interface IntegrationResult {
  operation: 'install' | 'remove' | 'dry-run';
  resources: {
    pluginWrapper: {
      path: string;
      action: ResourceAction;
      detail?: string;
    };
  };
  runtimeGuardTargetExists: boolean;
  baselineWarning: string | null;
  readiness: 'READY' | 'NEEDS_ATTENTION';
}
```

## Runtime Plugin Contract

```ts
interface NativePlugin {
  id: 'changebudget';
  setup(ctx: Plugin.Context): Promise<(() => Promise<void>) | void>;
}
```

`setup` registers `session.context` and `permission.evaluate`. The permission event has `sessionID`, `action`, `resources`, `metadata`, mutable `effect`, and optional `message`.

## Permission Projection

```ts
type RuntimeAction = 'allow' | 'ask' | 'block';
type PermissionEffect = 'allow' | 'ask' | 'deny';
```

Every resource is projected independently. The final V2 effect is the most restrictive of the incoming effect and all projections: `deny > ask > allow`. Internal `block` maps to V2 `deny`.

## Material Decisions

Material decisions remain explicit structured values. When permission metadata contains `materialDecision`, the V2 wrapper normalizes it to `ABSENT`, `VALID`, or `INVALID` before calling the existing evaluator. Ordinary requests use `ABSENT`; no decision is fabricated and no compatibility transport is introduced.

## State Transitions

```text
MISSING -> CREATE -> MANAGED_CURRENT
MANAGED_STALE -> UPDATE -> MANAGED_CURRENT
MANAGED_CURRENT -> UNCHANGED
CONFLICT -> zero writes
MANAGED_* -> REMOVE -> MISSING
MISSING -> ABSENT
```
