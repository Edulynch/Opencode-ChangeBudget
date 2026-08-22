# Release Gate Contract

## Invocation

The release gate is a manual, dependency-free Node command. It is run against a release candidate before creating a stable tag and rerun after the matching release commit. It is not CI and does not create or mutate release refs.

## Manual Release Sequence

1. Choose the release version outside normal implementation work and update `package.json` and `package-lock.json` to the same strict version.
2. Run `npm run build` and review `dist/src/**` and `opencode-plugin/dist/opencode-plugin/**`.
3. Stage source, package metadata, documentation, and the required runtime with ordinary Git tracking. Never force-add generated output.
4. Run `node scripts/validate-release.mjs` against the staged candidate. The candidate must have no unstaged or untracked files, and the required runtime must be tracked and fresh.
5. Commit the matching source, metadata, documentation, and prebuilt runtime.
6. Rerun the gate on the committed candidate and verify the expected tag is absent locally and remotely through read-only checks.
7. A maintainer creates an annotated immutable `vX.Y.Z` tag and pushes the release branch/master through the normal workflow, then pushes the tag.
8. Run the exact public GitHub smoke test in isolated prefixes on Windows and Ubuntu/WSL and record evidence. macOS remains POSIX-coverage-only unless physically validated.

The implementation must not bump to `1.1.1`, create a tag, push a branch, or push a tag.

## Required checks

The gate fails unless all checks pass:

1. `package.json` and `package-lock.json` contain the same strict `MAJOR.MINOR.PATCH` version.
2. The expected tag is exactly `v<package version>`.
3. The expected tag is absent locally and, when an origin is configured, absent from the remote tag namespace.
4. A clean build succeeds.
5. Rebuilding produces no Git diff under `dist/src/**` or `opencode-plugin/dist/opencode-plugin/**`.
6. Required CLI and Runtime Guard entrypoints exist.
7. Required runtime files are tracked and not ignored; duplicate plugin output is excluded.
8. Package dry-run contents include required runtime and exclude tests, specs, TypeScript source, node_modules, and temporary files.
9. The final candidate state has no unstaged or untracked files; staged changes are allowed for the initial release-candidate gate and the committed candidate must be clean.

The gate does not create, move, force-update, or push tags. It does not create `v1.1.1` during planning or implementation. Automated remote-tag tests use disposable local remotes and do not contact GitHub.
