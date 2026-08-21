# Implementation Plan: SPEC-010 Tagged Installation & Self-Update

## Technical Context

| Item | Status |
|------|--------|
| **ChangeBudget Version** | 1.0.0 (`package.json.version`) |
| **Package Name** | `changebudget-cli` |
| **npm Compatibility** | Node 20+, npm >=8 <12 |
| **CLI Entry** | `dist/src/cli/index.js` (referenced by `bin` field) |
| **Runtime Guard** | `opencode-plugin/dist/opencode-plugin/src/index.js` |
| **Build** | `tsc && tsc -p opencode-plugin/tsconfig.json` |
| **`.gitignore`** | Excludes `/dist` |

---

## 1. Git-based npm Installation Mechanism

### Decision: `prepare` lifecycle hook + `files` whitelist

**Lifecycle Hook**: `prepare`

```json
"scripts": {
  "prepare": "tsc && tsc -p opencode-plugin/tsconfig.json"
}
```

**Why `prepare` is required**:
- npm runs `prepare` automatically during git-based installs, after dependencies are installed and before linking the package globally.
- This guarantees compiled CLI and Runtime Guard exist before the `changebudget` binary becomes available.
- Verified behavior: npm executes `prepare` for `npm install -g github:owner/repo#tag`.

**What it builds**:
1. `tsc` → compiles `src/**/*` → `dist/src/**/*`
2. `tsc -p opencode-plugin/tsconfig.json` → compiles `opencode-plugin/src/**/*` → `opencode-plugin/dist/**/*`

**devDependencies availability**:
- npm installs `devDependencies` during git-based global installs when `--include=dev` or in npm 7+ when the package is a local dependency.
- For **global installs** of git dependencies, npm follows the same rules: devDependencies are installed unless `--omit=dev` is passed.
- **Conclusion**: `typescript`, `@types/node` will be available during `prepare`.

**`files` whitelist** (chosen over `.npmignore`):

```json
"files": [
  "dist/src/**",
  "opencode-plugin/dist/**"
]
```

**Why `dist/src/**` not `dist/**`**:
- Root `tsconfig.json` emits both `dist/src/**` and `dist/tests/**`
- `dist/tests/**` must NOT be shipped (compiled test artifacts)
- `dist/src/**` contains all runtime modules transitively required by the CLI

**Excluded paths**:
- `dist/tests/**` — compiled test artifacts
- `tests/**` — development-only source
- `specs/**` — specification documents
- `src/**` — development-only source (not needed at runtime)

**No other `package.json` changes required**.

**Validation requirement**:
```bash
npm pack --dry-run --json
```

Must confirm presence of:
- `package.json` at root ✅ (npm auto-includes)
- `dist/src/cli/index.js` ✅ (via `files`)
- All transitively required runtime modules under `dist/src/**` ✅
- `opencode-plugin/dist/opencode-plugin/src/index.js` ✅ (via `files`)

Must confirm absence of:
- `dist/tests/**` ❌
- `tests/**` ❌
- `specs/**` ❌
- `src/**` ❌

---

## 2. Installed Version Source

### Decision: Shared module-relative `package.json` resolution helper

**Strategy**: Create dedicated helper `src/core/package-root.ts`:

```typescript
// src/core/package-root.ts
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

export function getChangeBudgetRoot(): string {
  // dist/src/core/package-root.js -> dist/src/core -> dist/src -> dist -> package root
  // FOUR dirname operations required to reach the package root
  return dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
}

export function getInstalledVersion(): string {
  const pkgJsonPath = resolve(getChangeBudgetRoot(), 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  return pkg.version;
}
```

**Compiled path**: `dist/src/core/package-root.js`
**Dirname traversal**: 4 calls from helper to root

**Works in all cases**:
| Scenario | Mechanism |
|----------|-----------|
| Repository local | `import.meta.url` → `/repo/dist/src/...` → `/repo` |
| Global Git install | → `/usr/local/lib/node_modules/changebudget-cli/` |
| No `.git` | Reads only `package.json` |
| Any cwd | Uses module location, never `process.cwd()` |
| Spaces in path | `fileURLToPath` + `resolve` handle quoting |

**Source of truth**: `package.json.version` (no duplication into `dist/`).

**Tests**:
- cwd is unrelated user project
- cwd changes during execution
- package path contains spaces
- no .git directory exists

---

## 3. Stable GitHub Tag Discovery

### Decision: GitHub REST API (unauthenticated) with pagination

**Endpoint**:
```
GET https://api.github.com/repos/Edulynch/Opencode-ChangeBudget/tags?per_page=100&page=N
```

**Pagination loop**:
- Fetch pages incrementing `page=N`.
- Stop when the response array is empty or HTTP status is not 200.

**Filtering**:
- Accept only tags matching `^v\d+\.\d+\.\d+$`
- Reject all others (branches, `latest`, prereleases, malformed).

**Sorting**:
- Numeric comparison: `major`, then `minor`, then `patch`.
- Example: `v1.10.0 > v1.2.0` (not lexicographic).

**Runtime dependencies added**: **NO** (`fetch` is a Node built-in since v18).

---

## 4. Candidate Integrity Validation

### Decision: Fetch `package.json` at tag ref via GitHub Contents API

**Endpoint**:
```
GET https://api.github.com/repos/Edulynch/Opencode-ChangeBudget/contents/package.json?ref=vX.Y.Z
```

**Process**:
1. Decode base64-encoded response content.
2. Parse JSON to extract `version`.
3. Validate `version === tag.replace(/^v/, '')`.
4. Reject mismatched tags immediately.

**When this happens**:
- During candidate evaluation, after tag discovery and filtering.
- Before considering any tag eligible for installation.
- Also before presenting a manual major-upgrade command.

**Avoids unnecessary downloads**: Only `package.json` is fetched (no `.tar.gz`).

---

## 5. Semantic Version Implementation

### Decision: Pure-local numeric parser (no `semver` dependency)

```typescript
interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

function parseSemVer(version: string): SemVer {
  const [major, minor, patch] = version.split('.').map(Number);
  return { major, minor, patch };
}

function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}
```

**Validation**:
- `v1.10.0 > v1.2.0`: parsed as `1.10.0` vs `1.2.0` → major tie, minor comparison `10 vs 2` → correct. ✅
- No prerelease support required. ❌

**Runtime dependencies added**: **NO**.

---

## 6. Self-Update Execution

### Decision: npm subprocess with explicit Git-tag spec

**Exact command**:
```bash
npm install -g github:Edulynch/Opencode-ChangeBudget#v1.2.0
```

**Algorithm**:
1. Resolve current version (via §2 method).
2. Discover tags (via §3 mechanism).
3. Select latest stable tag with same major as current.
4. Validate integrity (via §4 method). If mismatch, reject and continue to next candidate.
5. If latest stable == current → no-op, exit 0.
6. If latest same-major > current → execute `npm install -g ...#<tag>` (§7 strategy).
7. If latest tag's major != current major → refuse; report manual install command.
8. Capture npm stdout/stderr/exit code.

**Explicit-tag guarantee**:
- Only validated Git tag strings (`vX.Y.Z`) are interpolated into the npm command.
- No `master`/`main`/`latest` resolution occurs.

---

## 7. Cross-Platform Subprocess Execution

### macOS/Linux
```typescript
spawn('npm', ['install', '-g', spec], { stdio: 'pipe' });
```
- `npm` resolves via PATH to the npm shim.
- No shell required; arguments passed as structured array.

### Windows
```typescript
spawn(process.env.ComSpec || 'cmd.exe', ['/C', 'npm', 'install', '-g', spec], { stdio: 'pipe' });
```
- Uses `process.env.ComSpec` environment variable or falls back to `cmd.exe`
- Resolves `npm.cmd` via Windows command processor
- No shell concatenation; structured arguments
- Only validated tag string (`^v\d+\.\d+\.\d+$`) interpolated

**Path-with-spaces tests**: Covered in integration tests using temporary directory paths containing spaces.

---

## 8. Exit Code Behavior

| Scenario | Exit Code |
|----------|-----------|
| `changebudget --version` | 0 |
| `update --check` already current | 0 |
| `update --check` compatible update available | 0 |
| `update --check` newer major available | 0 |
| `update` successful | 0 |
| `update` already current / no-op | 0 |
| `update --check` invalid flag | 2 (INPUT_OR_USAGE) |
| Version undetermined | 4 (ENVIRONMENT) |
| GitHub/network failure | 4 |
| No valid stable tags | 4 |
| Candidate retrieval failure | 4 |
| npm unavailable | 4 |
| npm subprocess failure | 4 |
| Tag/package version mismatch (no usable candidate) | 4 |
| Unexpected internal error | 10 (UNKNOWN) |

An available update is never an error.

---

## 9. Project Mutation Boundary

**Architectural proof**:

- `update` and `update --check` call only:
  - `getInstalledVersion()` → reads package.json from install root
  - `discoverGitHubTags()` → reads from GitHub API
  - `spawn('npm|cmd.exe', ...)` → executes `npm install -g`

- They **never** call:
  - `changebudget init` / `changebudget start`
  - File system APIs against project root
  - Spec-Kit interfaces

**Integration test strategy**:
1. Snapshot `/tmp/test-project` tree before execution.
2. Run `changebudget update --check` and `changebudget update` from that directory.
3. Snapshot after. Assert `before === after` (byte-identical).

---

## 10. SPEC-009 Runtime Guard Compatibility

**Existing resolver** (`src/core/integration/opencode.ts`):
```typescript
// import.meta.url -> dist/src/core/integration/opencode.js
// dirname x4 -> dist/src/core -> dist/src -> dist -> <root>
const root = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const guardPath = join(root, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js');
```

**Post-installation path**:
- Install root: `/usr/local/lib/node_modules/changebudget-cli/` (Linux)
- Compiled file: `.../changebudget-cli/dist/src/core/integration/opencode.js`
- `dirname x4` → `.../changebudget-cli/`
- Guard: `.../changebudget-cli/opencode-plugin/dist/opencode-plugin/src/index.js` ✅

**Minimal change required**: none. The same relative layout is preserved inside the installed package.

**Validation**: `npm pack --dry-run --json` must confirm `opencode-plugin/dist/opencode-plugin/src/index.js` exists in the tarball.

---

## 11. Test Architecture

### Unit Tests
| Case | Approach |
|------|----------|
| Strict tag parser | Regex test: `^v\d+\.\d+\.\d+$` |
| Semantic ordering | `compareSemVer("1.10.0", "1.2.0") > 0` |
| Compatible selection | Filter by same major, pick max |
| Newer-major detection | `candidate.major !== current.major` |
| Malformed/prerelease rejection | Regex excludes `v1.2.3-beta`, `v1.2`, `latest` |
| Current-version handling | No-op if `current === latest` |

### Integration Tests
- **DI abstraction**: Wrap `fetch` and `spawn` behind interfaces for mocking.
- **Disposable npm prefix**: `mktemp -d` + `npm_config_prefix=<temp>` in env.
- **Local Git fixture**: Create repo, add commit, tag `v1.0.0`, pack with `git+file://`.
- **PATH isolation**: Override `PATH` in test env to use temp prefix.
- **Network-free**: Default suite mocks all external calls.

### Tagged-Install Acceptance Test
- Build local fixture repo with tag.
- `npm install -g git+file:///path/#v1.0.0` in temp prefix.
- Assert `changebudget --version` from temp prefix outputs `v1.0.0`.
- Assert Runtime Guard resolves at `opencode-plugin/dist/opencode-plugin/src/index.js`.
- The fixture uses a sentinel `prepare` hook and removes devDependencies, so this proves npm invokes the Git lifecycle and the built runtime works; the production TypeScript prepare command is validated separately by normal build/typecheck/install runs.

**Normal `npm test` requires network**: **NO**.

**GitHub smoke test**: Optional, manual only.

---

## 12. Generated Metrics

- Acceptance metrics regenerate to `specs/*/acceptance-metrics.md` during tests.
- SPEC-005–009 metrics must remain untouched.
- Restore regenerated SPEC-005–009 metrics before final diff evaluation; SPEC-010 evidence records the validated results.

---

## 13. Module Architecture

| File | Responsibility |
|------|----------------|
| `src/core/package-root.ts` | Install-root resolution (shared helper) |
| `src/core/update/version.ts` | Version parsing/comparison |
| `src/core/update/github.ts` | Tag discovery (paginated), integrity validation |
| `src/core/update/npm.ts` | Cross-platform npm subprocess adapter |
| `src/cli/commands/update.ts` | Command orchestration + user-facing output |
| `src/cli/index.ts` | Wire `--version` and `update` to existing parser |

No repositories, services, or factories introduced.

---

## Final Report

### Installation
- prepare: **YES** (declares build step for git installs)
- Exact install command: `npm install -g github:Edulynch/Opencode-ChangeBudget#v1.2.0`
- `package.json.files`: `["dist/src/**", "opencode-plugin/dist/**"]`
- Validation: `npm pack --dry-run --json`

### Version
- Resolves `<install-root>/package.json` via `import.meta.url` → `dirname` traversal (using shared helper at `src/core/package-root.ts`)

### npm Compatibility
- Supported range: npm >=8 <12
- npm 12 Git dependency and lifecycle policy changes are outside the validated range and require follow-up work.

### GitHub
- Discovery endpoint: `/repos/{owner}/{repo}/tags?per_page=100&page=N`
- Integrity endpoint: `/repos/{owner}/{repo}/contents/package.json?ref=vX.Y.Z`

### Windows
- Exact strategy: `spawn(process.env.ComSpec || 'cmd.exe', ['/C', 'npm', 'install', '-g', spec])`

### Testing
- Disposable npm prefix via `$TMPDIR` + `npm_config_prefix`
- Local tagged fixture via `git+file://` with controlled environment/PATH
- Normal `npm test` requires ZERO network access
- Added root-resolution test cases for various cwd/project scenarios
- Package-content validation via `npm pack --dry-run --json`

### SPEC-009
- Runtime Guard path `opencode-plugin/dist/opencode-plugin/src/index.js` packaged via `files`, resolved via shared helper (preserves existing behavior)

### Risks
- GitHub unauthenticated API rate limit (60/hr): documented operational limitation; failures remain actionable exit-4 errors
- npm 12 Git dependency and lifecycle policy changes: outside the validated release range; follow-up work required

---

## Readiness

**READY FOR TASKS**
