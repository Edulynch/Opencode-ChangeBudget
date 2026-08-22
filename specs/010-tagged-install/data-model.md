# Data Model: SPEC-010 Tagged Installation & Self-Update

## Concepts & Entities

### 1. ChangeBudgetVersion

Represents a parsed semantic version of the ChangeBudget CLI.

| Field | Type | Description |
|-------|------|-------------|
| `major` | number | Major version (X in X.Y.Z) |
| `minor` | number | Minor version (Y in X.Y.Z) |
| `patch` | number | Patch version (Z in X.Y.Z) |
| `raw` | string | Original version string (e.g., "1.2.3") |

```typescript
interface ChangeBudgetVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}
```

### 2. GitTag

Represents a GitHub tag with metadata.

| Field | Type | Validation | Description |
|-------|------|------------|-------------|
| `name` | string | regex: `/^v\d+\.\d+\.\d+$/` | Tag name including 'v' prefix |
| `version` | ChangeBudgetVersion | derived from name | Version without 'v' prefix |
| `commit_sha` | string | 40 hex chars | SHA of the commit the tag points to |
| `isPrerelease` | boolean | computed | true if `rc`, `beta`, `alpha`, or `pre` in name |

```typescript
interface GitTag {
  name: string;
  version: ChangeBudgetVersion;
  commit_sha: string;
  isPrerelease: boolean;
}
```

### 3. UpdateCheckResult

Result of checking for updates against GitHub tags.

| Field | Type | Description |
|-------|------|-------------|
| `current` | ChangeBudgetVersion | Currently installed version |
| `latest` | GitTag \| null | Latest stable tag |
| `latestMajor` | GitTag \| null | Latest tag of same major version |
| `hasUpdate` | boolean | true if `latest` > `current` (semver) |
| `isMajorUpdate` | boolean | true if `latestMajor` !== `latest` |
| `manualInstallCmd` | string \| null | Required if `isMajorUpdate` |

```typescript
interface UpdateCheckResult {
  current: ChangeBudgetVersion;
  latest: GitTag | null;
  latestMajor: GitTag | null;
  hasUpdate: boolean;
  isMajorUpdate: boolean;
  manualInstallCmd: string | null;
}
```

### 4. UpdateResult

Result of an attempted update operation.

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether update succeeded |
| `version` | string \| null | New version if successful |
| `error` | string \| null | Error message if failed |
| `npmExitCode` | number \| null | npm process exit code if attempted |

```typescript
interface UpdateResult {
  success: boolean;
  version: string | null;
  error: string | null;
  npmExitCode: number | null;
}
```

---

## Relationships & Constraints

```text
┌─────────────────┐     ┌───────────────┐
│ ChangeBudget    │───▶ | GitTag        │
│ Version         │     │               │
└─────────────────┘     └───────────────┘
      │                      │
      │                      │
      ▼                      ▼
┌─────────────────┐     ┌──────────────────┐
│ UpdateCheck   │     │ UpdateResult     │
│ Result          │────▶                   │
└─────────────────┘     └────────────────┘
```

**Constraints**:
1. `ChangeBudgetVersion.raw` MUST equal `${major}.${minor}.${patch}`
2. `GitTag.name` MUST start with 'v'
3. `GitTag.isPrerelease` MUST be false for valid stable tags used in update checks
4. `UpdateCheckResult.latest` MUST have `isPrerelease === false`
5. `UpdateCheckResult.latestMajor` MUST have same `major` as `current`
6. If `UpdateCheckResult.isMajorUpdate === true`, `UpdateCheckResult.manualInstallCmd` MUST be provided

---

---

## External Interfaces

### GitHub API Response

```typescript
// GET /repos/Edulynch/Opencode-ChangeBudget/tags?per_page=100
type GitHubTagResponse = Array<{
  name: string;           // "v1.2.3"
  commit: { sha: string; };  // "abc123..."
  // prerelease fields ignored (API doesn't expose pre-release for tags)
}>;
```

### npm CLI Output (capture for validation)

```typescript
type NpmUpdateOutput = {
  stdout: string;
  stderr: string;
  exitCode: number;
};
```

---

## State Machine: Update Flow

```text
┌──────────────┐
│  Start       │
└──────┬───────┘
       │
       ▼
┌──────────────┐  fetch tags
│ Discover     │───────────▼──────────┐
│ Tags         │                    │
└──────┬───────┘                    │
       │                            │
       ▼                            │
┌──────────────┐  filter stable &   │
│ Validate     │────valid──────────▼│
│ & Sort       │                    │
└──────┬───────┘                    │
       │                            │
       ▼                            │
┌──────────────┐                    │
│ Compare      │                    │
│ Versions     │──────────────►     │
└──────┬───────┘                    │
       │                            │
       ▼                            │
┌──────────────┐                    │
│ Build Result │────────────────────┘
│ (UpdateCheck │
│ Result)      │
└──────────────┘
```

---

## Type Definitions (TypeScript)

```typescript
// src/types/update.ts
export interface ChangeBudgetVersion {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export interface GitTag {
  name: string;
  version: ChangeBudgetVersion;
  commit_sha: string;
  isPrerelease: boolean;
}

export interface UpdateCheckResult {
  current: ChangeBudgetVersion;
  latest: GitTag | null;
  latestMajor: GitTag | null;
  hasUpdate: boolean;
  isMajorUpdate: boolean;
  manualInstallCmd: string | null;
}

export interface UpdateResult {
  success: boolean;
  version: string | null;
  error: string | null;
  npmExitCode: number | null;
}

// Helper functions
export function parseVersion(raw: string): ChangeBudgetVersion;
export function isValidStableTag(name: string): boolean;
export function compareVersions(a: string, b: string): number;
export function discoverTags(): Promise<GitTag[]>;
export function checkForUpdate(current: ChangeBudgetVersion): Promise<UpdateCheckResult>;
export function performUpdate(target: string): Promise<UpdateResult>;
```
