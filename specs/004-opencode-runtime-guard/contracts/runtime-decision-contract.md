# Contract: Runtime Decision Mapping

## Purpose

This contract defines the deterministic projection from existing policy evaluation into one OpenCode runtime action.

## Runtime Input and Output

### `RuntimeInput`

```ts
type PolicyDecision = 'PASS' | 'REPAIR' | 'HUMAN_REVIEW';

type RuntimeAction = 'allow' | 'ask' | 'block';

type MutationIntent = 'mutate' | 'read-only';

interface RuntimeInput {
  policyDecision: PolicyDecision;
  mutationIntent: MutationIntent;
  targetPath: string | null;
  isInited: boolean;
  isPathDenied: boolean;
  isPathNotAllowed: boolean;
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

### Rule Mapping

The mapping MUST evaluate exactly one rule path in deterministic order:

1. If `isInited === false`: `runtimeAction = 'allow'`, `rule = 'OCG-PASSIVE-MODE'`.
2. If `mutationIntent === 'read-only'`: `runtimeAction = 'allow'` unless the hook was explicitly unsafe.
3. If `policyDecision` is `REPAIR` and `mutationIntent` is `mutate`: `runtimeAction = 'block'`, `rule = 'OCG-REPAIR'`.
4. If `policyDecision` is `HUMAN_REVIEW` and `mutationIntent` is `mutate`:
   - If the target is deterministically safe read-only, allow (if represented explicitly by hook input).
   - Otherwise `runtimeAction = 'block'`, `rule = 'OCG-HUMAN-REVIEW'`.
5. If `isPathDenied`: `runtimeAction = 'block'`, `rule = 'OCG-PATH-DENY'`.
6. If `targetPath` starts with `.changebudget/`: `runtimeAction = 'block'`, `rule = 'OCG-CHANGEBUDGET-PROTECT'`.
7. If `isPathNotAllowed`: `runtimeAction = 'ask'`, `rule = 'OCG-PATH-OUT-SCOPE'`.
8. If any sensitive flag under `isSensitive` is `true`: `runtimeAction = 'ask'`, matching rule per category.
9. Default: `runtimeAction = 'allow'`, `rule = 'OCG-ALLOW'`.

## Contracted Reason Codes

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

## Output Contract Rules

- Every mutating operation in initialized repositories must emit one of `allow`, `ask`, `block`.
- `ask` does not alter any contract or state.
- `block` is default when deterministic classification cannot be made for a potentially mutating operation.
