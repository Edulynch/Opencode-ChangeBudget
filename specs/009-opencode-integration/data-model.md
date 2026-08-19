# Data Model: SPEC-009 OpenCode Integration

**Branch**: `009-opencode-integration` | **Date**: 2026-08-18 | **Spec**: [spec.md](spec.md)

## Ownership States

```typescript
type OwnershipState = 'MISSING' | 'MANAGED_CURRENT' | 'MANAGED_STALE' | 'CONFLICT';
```

| State | Condition | Action |
|---|---|---|
| MISSING | File does not exist | CREATE |
| MANAGED_CURRENT | Exists, first line has `ChangeBudget-managed`, content byte-identical to expected | UNCHANGED |
| MANAGED_STALE | Exists, first line has `ChangeBudget-managed`, content differs | UPDATE |
| CONFLICT | Exists, first line lacks `ChangeBudget-managed` | zero writes, error |

## Resource Actions

```typescript
type ResourceAction = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'REMOVE' | 'CONFLICT' | 'ABSENT';
```

## Managed Resources

```typescript
const MANAGED_RESOURCES = {
  pluginWrapper: '.opencode/plugins/changebudget.js',
  instructions: '.opencode/instructions/changebudget.md',
  opencodeConfig: 'opencode.json',
} as const;
const INSTRUCTION_ENTRY = '.opencode/instructions/changebudget.md';
```

## Integration Resource Status

```typescript
interface IntegrationResourceStatus {
  path: string;
  action: ResourceAction;
  detail?: string;
}
```

## Integration Result

```typescript
interface IntegrationResult {
  operation: 'install' | 'remove' | 'dry-run';
  resources: {
    pluginWrapper: IntegrationResourceStatus;
    instructions: IntegrationResourceStatus;
    opencodeConfig: IntegrationResourceStatus;
  };
  runtimeGuardTargetExists: boolean;
  baselineWarning: string | null;
  readiness: 'READY' | 'NEEDS_ATTENTION';
}
```

**Readiness**: READY = no CONFLICT + Runtime Guard exists. NEEDS_ATTENTION = any CONFLICT or Runtime Guard missing.

## Pre-flight Plan

```typescript
interface PreflightPlan {
  runtimeGuardTargetExists: boolean;
  pluginWrapper: OwnershipState;
  instructions: OwnershipState;
  opencodeConfig: {
    exists: boolean;
    valid: boolean;
    parseError?: string;
    hasInstructionsField: boolean;
    instructionsIsArray: boolean;
    entryPresent: boolean;
  };
  conflicts: string[];
  readyToWrite: boolean;
}
```

## Generated Content Functions

```typescript
function generateWrapperContent(runtimeGuardFileUrl: string): string;  // 2 lines + newline
function generateInstructionsContent(): string;  // fixed markdown, byte-identical
```

## opencode.json Config

```typescript
interface OpenCodeConfig { [key: string]: unknown; instructions?: string[]; }
function mergeInstructionEntry(config: OpenCodeConfig, entry: string): OpenCodeConfig;
function serializeConfig(config: OpenCodeConfig): string;  // JSON.stringify(obj, null, 2) + '\n'
```

**Minimal config (file absent)**: `{"$schema":"https://opencode.ai/config.json","instructions":[".opencode/instructions/changebudget.md"]}`

## State Transitions

### Install/Update: MISSING→CREATE→MANAGED_CURRENT, STALE→UPDATE→CURRENT, CURRENT→UNCHANGED, CONFLICT→zero writes

### Remove: MANAGED→REMOVE→MISSING, MISSING→ABSENT, CONFLICT→zero deletes

### Dry-run: all states unchanged

## Error Types

| Error | Condition | Exit code |
|---|---|---|
| InputValidationError | CONFLICT, invalid JSON, non-array instructions, missing build, unknown target | 2 |
| IOStateError | Filesystem write failure | 4 |

No new error types — existing InputValidationError and IOStateError cover all cases.