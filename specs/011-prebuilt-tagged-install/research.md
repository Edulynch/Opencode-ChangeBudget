# Research: Prebuilt Tagged Installation Reliability

## Decision: Track release runtime artifacts intentionally

**Decision**: Remove the broad generated `dist/` ignore rule and explicitly ignore only `dist/tests/**` and the unnecessary duplicate `opencode-plugin/dist/src/**` output. Track JavaScript and source maps under `dist/src/**` and `opencode-plugin/dist/opencode-plugin/**`.

**Rationale**: The tagged commit must contain the runtime without relying on ignored local files or `git add -f`. The root TypeScript build emits both runtime and tests; the runtime subtree is the smallest root artifact set. The Runtime Guard is consumed from the nested plugin output path already established by SPEC-009.

The incident context is that the v1.1.1 immutable direct Git installation exposed a runtime-artifact lifecycle/install reliability defect. SPEC-011 fixes the release model by placing the prebuilt runtime in the tagged commit and correcting the install contract. `v1.1.2` is the planned corrective release, but it is not created during implementation.

**Alternatives considered**:
- Keep `dist/` ignored and force-add release files: rejected because release content would depend on an undocumented ritual and would be harder to review.
- Track all `dist/**`: rejected because it includes `dist/tests/**` and expands the package/release surface unnecessarily.
- Redesign TypeScript `rootDir`/`outDir`: rejected because the hotfix does not need a repository-wide build-layout change.

## Decision: Preserve build layout and exclude duplicate plugin output

**Decision**: Do not change either TypeScript configuration. Verify the plugin build's Runtime Guard output and package only `opencode-plugin/dist/opencode-plugin/**`; exclude observed duplicate `opencode-plugin/dist/src/**` output from tracking and packaging.

**Rationale**: SPEC-009 resolves `opencode-plugin/dist/opencode-plugin/src/index.js`. No existing runtime contract references the duplicate root plugin subtree. Narrowing the release allowlist removes unnecessary output without changing compilation behavior.

**Alternatives considered**:
- Change plugin `rootDir` or output layout: rejected as broader than the installation defect and likely to affect existing Runtime Guard paths.
- Package all plugin output: rejected because it preserves duplicate/unnecessary generated content.

## Decision: Remove `prepare`

**Decision**: Remove the package `prepare` script while preserving `build`, `typecheck`, and `test`.

**Rationale**: The package must work with `--ignore-scripts`; after tracked prebuilt artifacts are present, `prepare` is neither required nor a useful user-facing fallback. Keeping it would make lifecycle compilation appear to be part of installation correctness.

**Alternatives considered**:
- Retain `prepare` as a developer convenience: rejected because npm may still invoke it in other installation contexts and it obscures the release guarantee.
- Replace it with a different install lifecycle: rejected because every lifecycle-based build violates the hotfix boundary.

## Decision: Use exact scripts-disabled npm argv

**Decision**: Add `--ignore-scripts --allow-git=all --install-links=true` after `-g` and before the validated GitHub package spec for both POSIX and Windows update paths.

**Rationale**: This exactly matches the public command, makes the Git dependency policy explicit, and proves that installation does not depend on lifecycle execution. npm `>=11.9 <12` is the validated SPEC-011 range; npm 12 remains outside the hotfix.

**Alternatives considered**:
- Rely on npm defaults: rejected because the defect is at the Git installation boundary and the desired policy must be explicit.
- Use a mutable branch or npmjs: rejected by SPEC-011.

## Decision: Detect stale artifacts by clean regeneration

**Decision**: Build the candidate and require zero Git diff in the required tracked runtime paths after regeneration. Separately verify presence, tracked state, ignore state, package contents, package-lock consistency, and tag availability.

**Rationale**: This is deterministic, reviewable, dependency-free, and directly proves that the committed runtime corresponds to current source. Hash registries and caches would add state without improving the release guarantee.

The manual workflow has three states: development may contain uncommitted source/runtime work; a release candidate stages the required runtime and must have no unstaged or untracked files; the final pre-tag candidate is committed, clean, tag-available, and ready for an annotated immutable tag. No CI job performs these checks.

**Alternatives considered**:
- Store artifact hashes: rejected as unnecessary parallel state.
- Compare timestamps: rejected as non-deterministic and weak across platforms.
- Rely only on `npm pack`: rejected because package packing alone does not prove the release commit contains the same artifacts.

## Decision: Use a prebuilt local Git fixture for automated acceptance

**Decision**: Build before creating the fixture commit, copy trackable runtime artifacts, create the matching version tag, and install with the same scripts-disabled flags in a disposable prefix. Keep the fixture network-free and retain T035's simple no-sourceRoot mode.

**Rationale**: A local Git fixture tests the public installation shape without network flakiness while ensuring npm consumes a tagged commit containing the runtime. The acceptance test executes the installed binary and does not use a prepare sentinel.

Public Windows and Ubuntu/WSL smoke evidence remains pending until the planned `v1.1.2` GitHub tag exists. macOS has POSIX-compatible automated coverage only unless a physical Mac validation is recorded.

**Alternatives considered**:
- Test only `npm pack`: rejected because the production failure was direct Git global installation.
- Use a synthetic prepare sentinel: rejected because it proves lifecycle execution rather than prebuilt release correctness.
- Use the public GitHub tag in the normal suite: rejected because automated tests must remain network-free and deterministic.
