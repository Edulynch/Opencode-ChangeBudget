# SPEC-011 Validation Quickstart

This guide validates the prebuilt tagged installation model without changing the real global npm installation or creating a release tag.

## Prerequisites

- Node.js 20+
- npm `>=11.9 <12` for the intended v1.1.3 validation contract
- Git
- A release candidate with the required runtime staged/tracked when running the release gate

npm 12 is outside this corrective release until the final flow is separately validated.

## Release States

### Development state

Source, documentation, and generated runtime changes may be uncommitted while developing. Do not create, move, or recreate `v1.1.0`, `v1.1.1`, or `v1.1.2`, or create the intended `v1.1.3` tag during implementation.

### Release candidate state

Before the first release commit, build the source and stage the candidate with ordinary Git commands:

```text
npm run build
git add <source-and-documentation-changes> dist/src/** opencode-plugin/dist/opencode-plugin/**
node scripts/validate-release.mjs
```

The gate treats the index as the release candidate baseline. Required runtime must be present, tracked, not ignored, packageable, and have zero working-tree drift after rebuilding. Do not stage `dist/tests/**` or `opencode-plugin/dist/src/**`.

### Final pre-tag state

Commit the matching source, package metadata, documentation, and prebuilt runtime after the candidate gate passes. Rerun the gate on the committed candidate, confirm the final release state is clean, verify the expected local and remote tag is absent, and only then have the maintainer create an annotated immutable tag.

## Local Tagged Acceptance

The canonical public installation contract is:

```text
npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z
```

The supported range is Node.js 20+ with npm `>=11.9 <12`. Installation uses no lifecycle scripts, does not require `prepare`, TypeScript, or devDependencies on the user's machine, and relies on the prebuilt runtime already present in the immutable tag. npm 12 remains outside this corrective release.

The automated local fixture flow should:

1. Run the normal build before creating a local Git fixture commit.
2. Confirm the fixture commit contains the tracked runtime and tag `v<package.json.version>`.
3. Create a disposable npm prefix and disposable cache with paths containing spaces.
4. Install the local tagged source using the exact scripts-disabled options:

   ```text
   npm install -g --ignore-scripts --allow-git=all --install-links=true <local-tagged-source>
   ```

5. Verify `changebudget --version`, `changebudget --help`, `dist/src/cli/index.js`, and `opencode-plugin/dist/opencode-plugin/src/index.js` from the installed package.
6. Run `changebudget init` and `changebudget integrate opencode` in a disposable project, then run integration a second time to verify idempotence.
7. Verify the wrapper resolves the Runtime Guard from the installed package, not the development repository.
8. Verify unrelated project fields and `AGENTS.md` are unchanged, the real global npm prefix is unchanged, and all temporary directories are removed.

The acceptance test must execute the installed executable and must not inject or inspect a prepare sentinel.

## Self-Update Equivalence

For a validated compatible target, `changebudget update` delegates the same immutable-tag installation shape:

```text
npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z
```

Automatic updates remain same-major only. A newer major is informational/manual, already-current and major-only paths exit 0, and update never integrates OpenCode or mutates project files.

## Release Gate Validation

After bumping package metadata outside normal implementation and staging matching generated artifacts:

```text
node scripts/validate-release.mjs
```

The expected result is a clean pass for a candidate whose expected tag is available. A stale-artifact failure is proven by changing source, rebuilding without updating the candidate runtime, and observing the required-path drift failure. Missing, ignored, untracked, forbidden, version-mismatched, dirty-candidate, or existing-tag cases must fail before tagging. The current immutable `v1.1.0` tag is expected to be refused when the package version is `1.1.0`.

The gate is a manual repository-local check; SPEC-011 adds no release CI.

## Public GitHub Smoke Test

The immutable `v1.1.3` corrective release is published. Run the exact public HTTPS command in a disposable prefix on Windows and Ubuntu/WSL:

```text
npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z
```

### Windows evidence

Record the tag, npm version, disposable prefix, and command output. Verify installation succeeds with `--ignore-scripts`, then verify `changebudget --version`, `changebudget --help`, the installed Runtime Guard, `changebudget init`, and `changebudget integrate opencode`. Confirm unrelated `opencode.json` fields, `AGENTS.md`, and the real global npm prefix are unchanged. Remove the disposable prefix after the test.

### Ubuntu/WSL evidence

Repeat the same exact command and functional checks using the POSIX global layout. Confirm the installed CLI and Runtime Guard execute from the disposable prefix, project files remain unchanged, the real global npm prefix is unchanged, and the disposable prefix is removed.

### macOS scope

The automated POSIX subprocess coverage applies to macOS-compatible behavior. Do not claim physical macOS validation unless a real Mac smoke test is performed.

Public smoke status is **COMPLETE** for immutable `v1.1.3`: Windows public HTTPS smoke and Ubuntu/WSL clean public HTTPS smoke passed. Physical macOS validation was not performed; POSIX-compatible automated coverage remains the applicable macOS evidence.

## Regression validation

Run the targeted npm adapter, package-content, fixture, release-gate, SPEC-009 integration, and update regression tests, followed by:

```text
npm run typecheck
npm run build
npm test
npm pack --dry-run --json --ignore-scripts
```
