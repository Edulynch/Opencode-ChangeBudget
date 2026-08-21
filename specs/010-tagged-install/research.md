# Technical Research: SPEC-010 Tagged Installation & Self-Update

## 1. Git-based npm Installation Mechanism

### Decision: npm `prepare` lifecycle script with explicit files whitelist

**Chosen**: Add `prepare` script and `files` array to `package.json`

**Rationale**:
- npm requires explicit lifecycle hook for git installs
- Build output must be explicitly declared via `files` field
- Current `.gitignore` excludes `dist/` necessitating explicit inclusion
- Supported and validated range: npm >=8 <12. npm 12 Git dependency and lifecycle policy changes are outside this release.

**Implementation**:
```json
{
  "name": "changebudget-cli",
  "scripts": {
    "prepare": "tsc && tsc -p opencode-plugin/tsconfig.json"
  },
  "files": [
    "dist/src/**",
    "opencode-plugin/dist/**"
  ]
}
```

**Evidence**:
- npm documentation confirms `prepare` runs post-git-clone/pre-link
- Manual testing shows `npm pack` respects `files` whitelist
- Runtime Guard and CLI both require explicit inclusion

**Notes**:
- `prepare` runs before package becomes globally available
- `files` ensures compiled outputs are included in Git-based install
- No npmjs publication required

---

## 2. Package Contents for Git-tag Installation

### Decision: Explicit files whitelist for runtime output

**Chosen**: Whitelist `dist/src/**` and `opencode-plugin/dist/**` via `package.json.files`

**Rationale**:
- Repository `.gitignore` excludes `dist/`
- Installed package must contain ALL compiled JavaScript for CLI and Runtime Guard
- `bin` field references `dist/src/cli/index.js`
- Runtime Guard path: `opencode-plugin/dist/opencode-plugin/src/index.js`

**Package Structure Validation**:
```
package.json
dist/
  src/
    cli/
      index.js  ← CLI entry
opencode-plugin/
  dist/
    opencode-plugin/
      src/
        index.js  ← Runtime Guard entry
```

**Runtime Guard Resolution**:
- `resolveChangeBudgetRoot()` climbs from compiled file location
- Post-install path: `global-prefix/node_modules/changebudget-cli/dist/...`
- Works identically to local development

---

## 3. Version Discovery Mechanism

### Decision: GitHub HTTP API with pagination and integrity validation

**Chosen**: GitHub REST API (`/repos/{owner}/{repo}/tags`) with pagination

**Rationale**:
- No Git binary required (local-first constraint)
- HTTP requests work everywhere (Windows/macOS/Linux)
- API response is JSON-parsable, no external dependencies needed

**Implementation**:
```typescript
async function fetchAllTags(): Promise<GitTag[]> {
  const tags: GitTag[] = [];
  let page = 1;

  while (true) {
    const response = await fetch(
      `https://api.github.com/repos/Edulynch/Opencode-ChangeBudget/tags?per_page=100&page=${page}`
    );
    if (!response.ok) break;

    const pageTags = await response.json();
    if (pageTags.length === 0) break;

    tags.push(
      ...pageTags
        .filter(t => /^v\d+\.\d+\.\d+$/.test(t.name))
        .map(t => ({
          name: t.name,
          version: t.name.slice(1),
          commit_sha: t.commit.sha,
          isPrerelease: false
        }))
    );

    page++;
  }

  return tags
    .sort((a, b) => {
      const [aMaj, aMin, aPat] = a.version.split('.').map(Number);
      const [bMaj, bMin, bPat] = b.version.split('.').map(Number);
      return bMaj - aMaj || bMin - aMin || bPat - aPat;
    });
}
```

**Integrity Validation**:
```typescript
async function validateTagIntegrity(tag: GitTag): Promise<boolean> {
  const response = await fetch(
    `https://api.github.com/repos/Edulynch/Opencode-ChangeBudget/contents/package.json?ref=${tag.name}`
  );

  if (!response.ok) return false;

  const content = await response.json();
  const decoded = Buffer.from(content.content, 'base64').toString('utf-8');
  const pkgJson = JSON.parse(decoded);

  return pkgJson.version === tag.version;
}
```

**Tag Format Validation**:
- PRERELEASE IGNORED: v1.3.0-beta.1, v1.2.0-rc.1, v1.0.0-alpha.1
- MALFORMED IGNORED: v1.3 (no patch), v1 (no minors), release-1.3.0 (wrong prefix)
- MAJOR MINOR: v1.2.0, v1.3.0, v1.10.0 (all valid)

**Package Version Integrity**:
- Each candidate tag validated against fetched package.json
- Tag v1.2.3 requires package.json "version": "1.2.3"
- Mismatched tags rejected before installation attempt

---

## 4. Self-Update Architecture

### Decision: Platform-adaptive npm invocation with strict validation

**macOS/Linux**:
```typescript
spawn('npm', ['install', '-g', spec], { stdio: 'pipe' });
```

**Windows**:
```typescript
spawn(process.env.ComSpec || 'cmd.exe', ['/C', 'npm', 'install', '-g', spec], {
  stdio: 'pipe',
  windowsHide: true
});
```
- Uses `ComSpec` environment variable or falls back to `cmd.exe`
- Resolves `npm.cmd` via Windows command processor
- Explicit `/C` flag for one-shot execution
- No shell concatenation; structured arguments
- Only validated tag string (`^v\d+\.\d+\.\d+$`) interpolated

**Rationale**:
- npm own mechanism for package replacement (no custom backup/restore)
- Windows requires cmd.exe since `spawn('npm.cmd', ...)` fails with ENOENT on some systems
- Avoids shell injection risks; only validated tag string interpolated
- `windowsHide: true` prevents console flashing on Windows

**No Automatic Major Upgrade**:
- Compare major versions during candidate selection
- Major updates require explicit manual command:
  `npm install -g github:Edulynch/Opencode-ChangeBudget#vX.Y.Z`
- Both `update --check` and `update` report major-only availability and exit 0;
  only `update` additionally reports that automatic major installation is refused.

---

## 5. Process Execution & Failure Handling

### Decision: Defensive execution with environment-aware error mapping

**Failure Mode Handling**:
| Failure Mode | Handling |
|--------------|----------|
| npm unavailable | Exit 4: "npm not found in PATH or as npm.cmd" |
| GitHub API blocked | Exit 4: "Cannot reach GitHub for tag discovery" |
| Network timeout | Exit 4: "Network timeout during GitHub API request" |
| Invalid tag metadata | Skip invalid tags, continue discovery |
| package/tag version mismatch | Tag rejected as invalid; try next candidate |
| npm update subprocess failure | Exit 4: npm stderr + exit code |
| Interrupted update | Exit 4: "Update process interrupted" |
| Current version undetermined | Exit 4: "Cannot determine ChangeBudget installation root" |
| No valid stable tags | Exit 4: "No stable releases available" |
| Current newer than tags | Exit 0: "Already at latest version" |
| Integrity validation failure | Exit 4: "Tag/package version mismatch" |

---

## 6. Exit Code Semantics

### Decision: Map to existing ChangeBudget conventions

| Scenario | Exit Code | Message |
|----------|-----------|---------|
| `changebudget --version` | 0 | Current version |
| `update --check` already current | 0 | "Already current: vX.Y.Z" |
| `update --check` compatible update | 0 | "Update available: vX.Y.Z (run: changebudget update)" |
| `update --check` newer major available | 0 | "New major version available (manual install required)" |
| `update` success | 0 | "Updated to vX.Y.Z" |
| `update` already current / no-op | 0 | "Already current: vX.Y.Z" |
| Version undetermined | 4 | "Cannot determine ChangeBudget version" |
| Discovery/network failure | 4 | "Update check failed: {specific reason}" |
| npm subprocess failure | 4 | "Update failed: {npm error}" |
| Integrity validation failure | 4 | "Tag version mismatch: expected X.Y.Z, found A.B.C" |
| Invalid CLI usage | 2 | "Unsupported update flag: {flag}" |
| Unexpected/internal errors | 10 | "Internal error: {description}" |

---

## 7. SPEC-009 Runtime Guard Resolution Preservation

### Key Insight: Relative path resolution works post-installation

**Current Resolution Flow**:
1. `import.meta.url` in compiled CLI code
2. `fileURLToPath()` → absolute path to `dist/src/.../opencode.js`
3. `dirname()` x4 traverses to package root (SPEC-009 unchanged)
4. Runtime Guard path: `{root}/opencode-plugin/dist/.../index.js`

**After Tagged Installation**:
- Global npm location: `{global-prefix}/node_modules/changebudget-cli/`
- Same relative structure preserved
- `import.meta.url` → `.../changebudget-cli/dist/src/.../opencode.js`
- 4 dirname() calls → `.../changebudget-cli/` (package root)
- Runtime Guard: `.../changebudget-cli/opencode-plugin/dist/.../index.js`
- PATH with spaces handled by Node's built-in path resolution

**Validation Requirement**:
- `npm pack --dry-run` must include Runtime Guard at expected path
- Packed package contains: `opencode-plugin/dist/opencode-plugin/src/index.js`

---

## 8. Testing Isolation Strategy

### Decision: Disposable npm prefix + local Git fixtures

**Test Isolation Techniques**:

1. **Unit Tests**:
   - Mock `spawn` for npm calls
   - Mock `fetch` for GitHub API
   - Pure functions for version parsing/semver

2. **Integration Tests**:
   ```bash
   # Create isolated environment
   TEMP_DIR=$(mktemp -d)
   NPM_PREFIX="$TEMP_DIR/npm-global"
   PATH="$NPM_PREFIX/bin:$PATH"
   npm_config_prefix="$NPM_PREFIX"

   # Local tagged Git fixture
   GIT_REPO="$TEMP_DIR/changebudget-local"
   git init "$GIT_REPO"
   # ... create local tag v1.0.0 ...

   # Install from local file:// URL
   npm install -g "git+file://$GIT_REPO#v1.0.0"
   changebudget --version  # Should report v1.0.0
   ```

3. **GitHub API Mocking** (for unit tests only):
   ```typescript
   import { mock } from 'node:test';
   mock.globalThis.fetch = async (url) => {
     if (url.includes('/tags')) {
       return { ok: true, json: () => [{ name: 'v1.0.0', commit: { sha: 'abc' } }] };
     }
     if (url.includes('/contents/package.json')) {
       return { ok: true, json: () => ({ content: Buffer.from('{"version":"1.0.0"}').toString('base64') }) };
     }
     return { ok: false };
   };
   ```

4. **PATH Isolation**: Controlled test environment, automatic cleanup

5. **No Real Global npm Mutation**: All tests use disposable prefixes

**Acceptance Test Strategy**:
- Local `git+file://` tagged-install validation
- Normal `npm test` requires ZERO network access
- GitHub-dependent tests marked as optional/manual only

---

## 9. Unresolved Technical Risks

1. **npm prepare Script Reliability**:
    - Risk: npm lifecycle behavior may differ outside the supported npm range
   - Mitigation: Defined disposable experiment using local git tag
   - Verification: `npm pack` + local install confirms dist inclusion

2. **Windows Network Restrictions**:
   - Corporate environments may block GitHub API
    - Mitigation: Documented as an actionable discovery failure; no Git fallback is implemented

3. **Tag/Package Version Mismatch**:
   - Risk: Release process tags version but forgets package.json update
   - Mitigation: Integrity validation prevents installation of mismatched tags
    - Automated tests enforce the behavior through mocked API responses

4. **GitHub API Rate Limiting**:
   - Risk: Unauthenticated API calls limited to 60/hr
    - Mitigation: Documented as an acceptable operational limitation
    - Product impact: The user receives an actionable exit-4 error when the API is unavailable
