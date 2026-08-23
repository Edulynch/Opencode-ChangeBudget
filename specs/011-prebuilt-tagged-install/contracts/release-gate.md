# Release Gate Contract

## Invocation

The release gate is a manual, dependency-free Node command. It is run against a release candidate before creating a stable tag and rerun after the matching release commit. Normal SPEC-012 CI invokes the named `npm run ci:release-gate` / `node scripts/validate-release.mjs --ci-safe` mode, which skips only expected existing-tag availability rejection while retaining the other release checks. Neither mode creates or mutates release refs.

Normal release-gate mode retains the existing-tag rejection. Only the explicitly named CI-safe mode skips that availability check; it is not a general validation bypass.

## Manual Release Sequence

1. Pull-request or `master` push CI passes on Windows and Ubuntu.
2. A maintainer prepares the release commit, updates matching package metadata, and runs `node scripts/validate-release.mjs` manually.
3. Commit the matching source, metadata, documentation, and prebuilt runtime, then rerun the normal release gate.
4. A maintainer creates an immutable `vX.Y.Z` tag manually and pushes it.
5. SPEC-012 tagged smoke installs the actual private remote tag on Windows and Ubuntu using ephemeral read-only workflow authentication.
6. Only after both tagged-smoke jobs pass does the maintainer manually publish the GitHub Release as Latest.

If tagged smoke fails, the immutable tag remains unchanged and no release should be published; a new patch tag is required. macOS remains out of scope for SPEC-012.

The implementation must not bump the real package version, create a tag, push a branch, or push a tag.

The canonical HTTPS installation command is:

```text
npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z
```

The `github:` shorthand is rejected because npm may resolve it through SSH. The package spec and npm argv contain no credentials. The private tagged workflow is independent of personal/developer credentials, but uses the ephemeral built-in `GITHUB_TOKEN` with `contents: read` through process-scoped `GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, and `GIT_CONFIG_VALUE_0`; it does not require a PAT, custom secret, SSH, `gh`, or a personal Git credential helper.

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
10. Current SPEC-011 source and documentation use the HTTPS package spec and all canonical npm flags; stale `github:` shorthand is rejected.

The gate does not create, move, force-update, or push tags. It does not create `v1.1.3` during planning or implementation. Automated remote-tag tests use disposable local remotes and do not contact GitHub. SPEC-012 owns normal Windows/Linux CI and real private tagged smoke; its remote results remain pending until GitHub Actions executes them.
