# SPEC-012 Validation Guide

This guide describes the implemented validation sequence. It does not create tags, publish releases, or replace the private-repository tagged smoke with a local fixture.

## Local prerequisites

- Node.js `24.18.0`
- npm `11.16.0`
- Git
- A clean checkout with tracked `dist/src/**` and `opencode-plugin/dist/opencode-plugin/**`

## Normal CI checks

`.github/workflows/ci.yml` runs on `pull_request` and pushes to `master`, using `windows-latest` and `ubuntu-latest`, Node.js `24.18.0`, npm `11.16.0`, `fail-fast: false`, a 20-minute timeout, read-only contents permissions, and cancellation of superseded PR/branch runs. Each matrix job runs from the repository root:

```text
npm ci
npm run typecheck
npm run build
npm test
npm pack --dry-run --json --ignore-scripts
node scripts/validate-release.mjs --ci-safe
git diff --check
```

The CI-safe gate uses the actual package version and skips only existing-tag availability rejection. It must still reject version mismatch, missing or ignored runtime, stale runtime, forbidden package contents, contract drift, and dirty/untracked release state.

The workflow additionally verifies required tracked runtime paths, rejects forbidden generated runtime paths, checks runtime zero-drift, and invokes the named `npm run ci:release-gate` entrypoint. The latest verified normal CI run is green on both Windows and Ubuntu.

## Tagged smoke lifecycle

After a maintainer creates an immutable `v*` tag in the private repository, `.github/workflows/release-smoke.yml` triggers on the tag, derives `${TAG}` from the event ref, runs a Windows/Ubuntu matrix with Node.js `24.18.0`, npm `11.16.0`, `fail-fast: false`, and a 15-minute timeout, and checks out that exact tag only for the versioned harness with `persist-credentials: false`. It prepares process-scoped Git HTTPS authentication using only the workflow-provided read-only `GITHUB_TOKEN`, and installs the actual remote package with:

```text
npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#${TAG}
```

The token is never embedded in this package spec or npm argv. The harness passes a derived Basic authorization header through `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`, and `GIT_CONFIG_VALUE_0=Authorization: Basic ...` only to npm and its Git children. It writes no credential file or Git config and the environment disappears when installation exits. Raw and encoded tokens must be absent from diagnostics.

The harness executes the installed CLI from disposable prefix resources, never the checkout. It verifies version/tag equality, package and Runtime Guard files, CLI commands, integration preservation, wrapper linkage, real-prefix preservation, isolation, and cleanup on both Windows and Ubuntu.

## Release sequence

1. Pull-request or `master` push CI passes on Windows and Ubuntu.
2. A maintainer prepares the release commit and runs the normal release gate.
3. A maintainer creates the immutable tag.
4. Tagged smoke passes on Windows and Ubuntu.
5. The maintainer manually publishes the GitHub Release as Latest.

If either tag-smoke job fails, the tag remains unchanged and no release should be published or recommended. The legitimate immutable `v1.1.4` tag failed tagged smoke on both platforms because the disposable Git baseline and Windows `.cmd` process boundary were defective; those harness fixes are recorded in commit `1f74735`, and normal CI for the fix is green. `v1.1.5` is the next legitimate release candidate. SPEC-012 final acceptance remains pending until a future real tag event in this private repository passes both jobs; “public tag” means a real repository tag pushed to GitHub, not a public repository. Existing v1.1.4 failure evidence and manual v1.1.3 evidence do not count. T032 remains unchecked.

## Verified Local Evidence

The current local acceptance boundary is verified with full serial suite **565/565 PASS**, typecheck, build, package dry-run, runtime zero-drift, workflow/static security contracts, harness auth/redaction tests, and `git diff --check`. The latest normal CI run for harness-fix commit `1f74735` is green on Windows and Ubuntu; Windows and Ubuntu real-tag smoke for the next legitimate candidate remain **PENDING REMOTE CI EXECUTION**.

## Operational decisions

Normal CI may use lockfile-keyed npm caching through the official setup action. Tagged smoke uses a fresh disposable npm cache and isolates developer credentials on both platforms. Ubuntu must not inherit personal SSH, GitHub CLI, or Git credential configuration; Windows must not depend on personal `gh`/SSH state. Both may use only the ephemeral read-only `GITHUB_TOKEN` at the Git auth boundary. Normal CI superseded PR/branch runs are cancelled; tag runs are not cancelled. Normal jobs have a 20-minute timeout and tagged-smoke jobs have a 15-minute timeout. Initial diagnostics remain command output and explicit failure messages; no artifact upload is required.
