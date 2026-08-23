# Tagged Smoke Contract

The repository is private for now. Tagged smoke uses only the ephemeral GitHub Actions-provided `GITHUB_TOKEN` with `contents: read` at a temporary Git HTTPS authentication boundary. It must not require a PAT, custom secret, personal token, SSH key, or `gh` authentication.

## Trigger and checkout boundary

The workflow is `.github/workflows/release-smoke.yml`. It runs on pushes of tags matching `v*`, with required Windows and Ubuntu jobs, Node.js `24.18.0`, npm `11.16.0`, `fail-fast: false`, and a 15-minute timeout. It checks out the exact triggering tag with `actions/checkout@v7` and `persist-credentials: false` only to obtain the versioned smoke harness and documentation. The checkout is never the package installation source and its CLI is never executed for acceptance.

## Private installation

For an event tag `${TAG}`, the harness independently constructs:

```text
git+https://github.com/Edulynch/Opencode-ChangeBudget.git#${TAG}
```

and the exact npm arguments:

```text
install -g --ignore-scripts --allow-git=all --install-links=true <packageSpec>
```

The tag must match a strict `vMAJOR.MINOR.PATCH` form. The installed package version must equal the tag without `v`.

Git authentication is prepared separately from package-spec construction. The workflow exposes `GITHUB_TOKEN` only to the harness invocation step. The harness derives a Basic authorization header and passes it through process-scoped Git runtime configuration: `GIT_CONFIG_COUNT=1`, `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`, and `GIT_CONFIG_VALUE_0=Authorization: Basic ...`. No credential file, npmrc, Git config mutation, tokenized URL, or persistent helper is allowed. The environment ends with the npm child; the raw and encoded token must never appear in package spec, npm argv, command output, logs, errors, or generated files.

## Required installed assertions

The harness runs the installed absolute CLI from an isolated disposable prefix and verifies package metadata, `dist/src/cli/index.js`, the packaged Runtime Guard, `--version`, `--help`, `init`, `integrate opencode`, wrapper linkage, and expected instruction integration. It verifies byte-preserved `AGENTS.md`, unrelated `opencode.json` fields, and unchanged real global npm prefix.

## Isolation and cleanup

Ubuntu uses temporary HOME, isolated npm userconfig/cache/prefix, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_TERMINAL_PROMPT=0`, no personal SSH configuration, no GitHub CLI configuration, no inherited personal/global Git credentials, and only the workflow-provided read-only token in the process-scoped auth environment. Windows uses disposable prefix/cache/userconfig, a project path containing spaces, absolute `changebudget.cmd` execution, no personal `gh`/SSH dependency, and the same workflow-token-only process-scoped auth model. Both platforms must test Node -> npm -> Git environment propagation without network in unit tests.

The harness always attempts cleanup and then asserts that disposable prefix, cache, userconfig, and project paths are absent. Cleanup or isolation failure fails the job.

## Release semantics

The workflow does not create, move, delete, repair, or push tags and does not publish GitHub Releases. A platform failure leaves the immutable tag unchanged and requires a new patch release. Final SPEC-012 acceptance requires a future real tag event in this private repository to pass both platform jobs. Windows and Ubuntu real-tag smoke are currently **PENDING REMOTE CI EXECUTION**. “Public tag” means a real repository tag pushed to GitHub, not a public repository. Existing manual v1.1.3 evidence does not satisfy T032. If the repository becomes public later, authentication can be removed without changing the canonical package spec, npm argv, or smoke assertions.
