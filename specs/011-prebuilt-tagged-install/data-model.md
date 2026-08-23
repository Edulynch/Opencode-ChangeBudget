# Data Model: Prebuilt Tagged Installation Reliability

SPEC-011 has no new runtime database or persisted application state. These are release and validation entities used by the implementation and manual workflow.

## ReleaseCommit

Represents the Git commit that is eligible for a stable release tag.

| Field | Type | Validation |
|---|---|---|
| `commit` | Git revision | Must be the candidate commit under validation. |
| `packageVersion` | strict version string | Must be `MAJOR.MINOR.PATCH` and match package-lock metadata. |
| `runtimePaths` | tracked path set | Must include root CLI runtime and Runtime Guard runtime. |
| `workingTree` | Git status | Must be clean after the final build/gate. |

## StableReleaseTag

Represents the immutable public reference used by installation and self-update.

| Field | Type | Validation |
|---|---|---|
| `name` | string | Exactly `v${packageVersion}`. |
| `targetCommit` | Git revision | Must point to the validated ReleaseCommit. |
| `localExists` | boolean | Must be false before tag creation. |
| `remoteExists` | boolean | Must be false before tag creation. |

`v1.1.0`, `v1.1.1`, and `v1.1.2` remain immutable and are never valid targets for movement or replacement. The intended corrective `v1.1.3` tag is not created by SPEC-011 planning.

## PackagedRuntime

Represents the compiled files available to a user after scripts-disabled installation.

| Field | Type | Validation |
|---|---|---|
| `cliEntrypoint` | path | `dist/src/cli/index.js` exists and is included in the package. |
| `cliRuntime` | path set | All required JavaScript and source maps under `dist/src/**`, excluding `dist/tests/**`. |
| `runtimeGuardEntrypoint` | path | `opencode-plugin/dist/opencode-plugin/src/index.js` exists and is included. |
| `runtimeGuard` | path set | Required JavaScript and source maps under the nested plugin runtime subtree. |
| `forbidden` | path set | Must not include tests, specs, TypeScript source, node_modules, or temporary files. |

## ReleaseValidationResult

The deterministic pass/fail result produced by the manual release gate.

| Field | Type | Validation |
|---|---|---|
| `versionValid` | boolean | Package and lockfile versions are valid and equal. |
| `tagValid` | boolean | Expected stable tag is derived from package version. |
| `tagAvailable` | boolean | Expected tag is absent locally and remotely. |
| `artifactsPresent` | boolean | Required runtime entrypoints and transitive outputs exist. |
| `artifactsTracked` | boolean | Required paths are tracked and not ignored. |
| `artifactsFresh` | boolean | Clean regeneration produces no required-path diff. |
| `packageContentsValid` | boolean | npm dry-run package contains required runtime and excludes forbidden content. |
| `workingTreeClean` | boolean | Final candidate state is clean. |

The release gate passes only when every field is true.

## UpdateInstallInvocation

The validated self-update subprocess request.

| Field | Value |
|---|---|
| `command` | `npm` on POSIX; controlled `ComSpec` on Windows |
| `args` | `install`, `-g`, `--ignore-scripts`, `--allow-git=all`, `--install-links=true`, validated package spec |
| `packageSpec` | `git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z` |
| `shell` | `false` for direct POSIX spawn and Windows `ComSpec` spawn |
