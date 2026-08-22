# Implementation Plan: Prebuilt Tagged Installation Reliability (SPEC-011)

**Branch**: `011-prebuilt-tagged-install` | **Date**: 2026-08-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-prebuilt-tagged-install/spec.md`

## Summary

SPEC-011 makes stable tagged installations self-contained: release commits track the compiled CLI and Runtime Guard runtime, package installation no longer depends on `prepare`, and both public installation and self-update use `npm install -g --ignore-scripts --allow-git=all` with an immutable stable tag. The implementation keeps the existing TypeScript build layout, intentionally tracks only package runtime output, narrows plugin packaging to the required Runtime Guard output, and adds a manual Node-based release gate that rebuilds and requires a zero diff in tracked artifacts.

## Technical Context

<!--
  Technical context is documented below.
  for the project. The structure here is presented in advisory capacity to guide
  the iteration process.
-->

**Language/Version**: TypeScript targeting ES2022, Node.js 20+, npm `>=11.9 <12` for SPEC-011 v1.1.1 installation/update validation

**Primary Dependencies**: Node.js built-ins, TypeScript, npm, Git; no new runtime dependencies

**Storage**: Git-tracked release artifacts and package metadata; no new persistent storage

**Testing**: `node:test`, `node:assert/strict`, disposable local Git/npm fixtures, `npm pack --dry-run --json`

**Target Platform**: Windows and Linux real validation; macOS POSIX-compatible path and subprocess coverage

**Project Type**: Local-first TypeScript CLI distributed from immutable Git tags

**Performance Goals**: No new runtime performance target; installation must execute the committed runtime without user-machine compilation

**Constraints**: No network in automated tests, no real global npm mutation, no CI/CD, no npmjs publication, no mutable refs, no install-time scripts, and no production behavior changes outside the packaging/update invocation boundary

**Scale/Scope**: One release packaging path, one self-update adapter, one tagged-install acceptance flow, one deterministic release gate; preserve SPEC-001 through SPEC-010 behavior

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

* **PASS**: Local-first and deterministic. The release gate and tests use local Git/filesystem state; public GitHub validation is a manual release evidence step, not a runtime dependency.
* **PASS**: Minimal architecture. The change removes an install lifecycle dependency, adjusts existing npm argv, and adds one dependency-free release gate rather than a service, cache, hash registry, or CI system.
* **PASS**: Scope is bounded. Only tracked runtime packaging, install lifecycle metadata, self-update argv, release validation, and related tests are included.
* **PASS**: Small workflow. Existing build/test commands and modules are reused; TypeScript output layout is not redesigned.
* **PASS**: Targeted validation. Unit tests cover argv and gate helpers; package-content and tagged-install acceptance tests cover the release boundary; full validation remains a release checkpoint.
* **PASS**: Git is the source of truth. Tracked/ignored/untracked status and clean-build diffs are the artifact correctness mechanism.
* **PASS**: Quality and governance. Behavior remains explicit, deterministic, strongly typed where production code changes, and no task expands into CI/CD or unrelated refactoring.

## Project Structure

### Documentation (this feature)

```text
specs/011-prebuilt-tagged-install/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)
<!--
  Concrete repository layout is documented below.
  for this feature. Delete unused options and expand the chosen structure with
  real paths (e.g., apps/admin, packages/something). The delivered plan must
  not include Option labels.
-->

```text
src/
├── cli/                         # existing CLI commands and entrypoint
├── core/update/npm.ts           # existing cross-platform npm adapter
└── core/                        # existing package root and update logic

tests/
├── acceptance/tagged-install.test.ts
├── integration/package-contents.test.ts
├── unit/core/update/npm.test.ts
├── unit/release-gate.test.ts
└── utils/git-fixture.ts

scripts/
└── validate-release.mjs         # dependency-free manual pre-tag gate

dist/src/                         # tracked root runtime JS and maps; not dist/tests
opencode-plugin/dist/opencode-plugin/ # tracked Runtime Guard JS and maps only
.gitignore
package.json
package-lock.json
```

**Structure Decision**: Keep the existing single TypeScript CLI and build layouts. Release runtime output is intentionally tracked in `dist/src/**` and `opencode-plugin/dist/opencode-plugin/**`; `dist/tests/**` and the observed duplicate `opencode-plugin/dist/src/**` output are excluded from release tracking and package contents. The existing `tsconfig.json` and `opencode-plugin/tsconfig.json` are not redesigned. The release gate is a development-only Node script and does not become a runtime import.

## Design Decisions

### Tracked artifact strategy

1. Replace the broad `.gitignore` `dist/` rule with explicit transient-output rules: ignore `dist/tests/**` and the unnecessary duplicate `opencode-plugin/dist/src/**`, while leaving `dist/src/**` and `opencode-plugin/dist/opencode-plugin/**` intentionally trackable.
2. Track generated `.js` and `.js.map` files in those required runtime paths. Do not track declarations, tests, source TypeScript, node modules, coverage, or unrelated generated directories.
3. Change `package.json.files` from the broad plugin `opencode-plugin/dist/**` allowance to the required `opencode-plugin/dist/opencode-plugin/**` subtree after package-content tests confirm no Runtime Guard import depends on the duplicate output.
4. Normal future `npm run build` executions regenerate the tracked runtime. A developer must review generated diffs as part of the same source change; no undocumented `git add -f` ritual is required.

### Build and lifecycle

1. Preserve both current TypeScript configs and `npm run build`, `npm run typecheck`, and `npm test`.
2. Remove `prepare` from `package.json`. It has no remaining legitimate user-install purpose after the tagged commit contains runtime output, and leaving it would imply that installation builds are supported.
3. The package `bin` already points directly at `dist/src/cli/index.js`; retain that entrypoint and verify it from an `--ignore-scripts` installation.

### Self-update adapter

`buildNpmArgs()` will return exactly:

```text
install -g --ignore-scripts --allow-git=all github:Edulynch/Opencode-ChangeBudget#vX.Y.Z
```

POSIX continues to call `spawn('npm', args, { shell: false })`. Windows continues to call the controlled `ComSpec` with `/C` and one internally generated command string containing only validated stable-tag data. Unit tests assert the exact argument order, shell settings, ComSpec behavior, failure mapping, and space-safe dispatch.

### Deterministic release gate

Add `scripts/validate-release.mjs`, invoked manually after the source plus generated artifacts are committed and before tagging. It will:

1. Read and strictly validate `package.json.version`, `package-lock.json` root/version metadata, and the expected tag `v<package version>`.
2. Refuse if the expected tag exists locally or `git ls-remote --exit-code --refs origin refs/tags/<tag>` reports it remotely; `v1.1.0` is never moved or rewritten.
3. Run the existing build, then require `git diff --exit-code -- dist/src opencode-plugin/dist/opencode-plugin` so stale tracked runtime artifacts fail deterministically.
4. Verify required runtime files exist, are tracked by Git, and are not ignored. Verify the duplicate plugin output is not part of the release allowlist.
5. Run package-content validation and reject `dist/tests/**`, `tests/**`, `specs/**`, `src/**/*.ts`, node_modules, and temporary content.
6. Require a clean final working tree after the build and checks. The release workflow therefore commits expected source/artifact changes first, then gates the final commit before creating the annotated tag.

The gate does not invent hashes, caches, release metadata, or CI automation. Its stale proof is deterministic regeneration plus zero diff.

### Acceptance fixture

Update `createGitFixture(sourceRoot)` to copy the already-built, intentionally trackable runtime, retain the package version, remove development-only dependencies, and commit without force-adding ignored output or injecting a prepare sentinel. The fixture creates `v<package.version>`, exposes the tag/version, and installs through the exact scripts-disabled options in a disposable prefix. T035 keeps its no-sourceRoot simple fixture behavior.

Update T037 to assert installed CLI execution, package version/tag consistency, help, Runtime Guard, init, integration, path-with-spaces behavior, project preservation, cleanup, and unchanged real global prefix. It must not assert a prepare marker or rely on a user-machine build.

## Implementation Phases

### Phase 1: Packaging and artifact tracking

- Narrow `.gitignore` to intentional release/runtime tracking and excluded test/duplicate output.
- Remove `prepare` while preserving build, typecheck, and test scripts.
- Narrow package files to the required root and Runtime Guard runtime subtrees.
- Build and review the generated tracked artifact set without changing TypeScript layout.

### Phase 2: Update and fixture behavior

- Add scripts-disabled Git allowance flags to the existing npm adapter for POSIX and Windows.
- Update exact argv and platform unit tests.
- Replace the synthetic T037 prepare fixture with a prebuilt tracked-tag fixture.
- Update package-content and infrastructure tests for tracked runtime and no prepare dependency.

### Phase 3: Release gate and validation

- Add the dependency-free release gate and unit tests for missing, ignored, untracked, stale, forbidden, version-mismatch, and existing-tag cases.
- Add or update the manual release workflow documentation and quickstart validation.
- Run targeted tests, typecheck, build, package dry-run, and full `npm test`.
- Perform real Windows and Ubuntu/WSL public-shape smoke tests before v1.1.1 release consideration; retain macOS POSIX coverage.

## Release Workflow

For a future release, including the intended `v1.1.1` hotfix but without creating it in this work:

1. Choose the version outside normal implementation and bump `package.json` and `package-lock.json` to the same strict version.
2. Run `npm run build` and review generated `dist/src/**` and `opencode-plugin/dist/opencode-plugin/**` changes.
3. Stage source, package metadata, documentation, and matching runtime artifacts with ordinary Git tracking.
4. Run the release gate against the staged candidate and require zero runtime drift, valid package contents, and read-only tag availability checks.
5. Commit the matching source, package metadata, documentation, and tracked runtime artifacts.
6. Rerun the gate on the committed candidate and verify the final release state is clean.
7. A maintainer creates an annotated immutable `vX.Y.Z` tag, then pushes the source branch/master and tag through the normal workflow.
8. Run the exact public command in isolated Windows and Ubuntu/WSL prefixes using supported npm `>=11.9 <12` and record the smoke evidence; macOS remains POSIX-compatible coverage unless physically validated.

No step moves the immutable `v1.1.0`, creates `v1.1.1` during implementation, or adds CI/CD automation.

## Complexity Tracking

No constitution violations. The release gate is a small local development script, generated runtime files are the explicitly required release artifact, and no runtime service or dependency is added.
