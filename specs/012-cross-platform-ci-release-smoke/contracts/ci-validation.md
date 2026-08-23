# CI Validation Contract

## Triggers and matrix

Normal CI runs for `pull_request` and pushes to `master`. Each run has required matrix jobs for exactly:

- `windows-latest`
- `ubuntu-latest`

Each job explicitly selects Node.js `24.18.0` and npm `11.16.0`, then runs root-level `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm pack --dry-run --json --ignore-scripts`, required/forbidden runtime tracking, runtime zero-drift validation, `npm run ci:release-gate`, and `git diff --check`.

The workflow is `.github/workflows/ci.yml`; its matrix uses `fail-fast: false`, a 20-minute job timeout, cancellation of superseded PR/branch runs, and no `continue-on-error`. Normal CI is **PENDING REMOTE CI EXECUTION** on both Windows and Ubuntu until GitHub Actions actually runs it.

## CI-safe release gate

The normal workflow invokes the named CI-safe release-gate mode. That mode skips only expected local/remote release-tag availability rejection. It does not skip package/package-lock consistency, tool compatibility, required runtime presence, tracking/ignore checks, build freshness, package contents, forbidden contents, contract consistency, or clean-tree checks.

The normal workflow validates the repository's actual package version. It does not synthesize a version or create a tag.

## Safety

Normal CI uses `permissions: contents: read`, no write-capable action, no custom secret, no GitHub CLI authentication, no SSH configuration, no tag operation, no release publication, and no real global ChangeBudget installation. Required matrix failures fail the workflow. Tagged smoke may separately expose only the ephemeral `GITHUB_TOKEN` with `contents: read` to its process-scoped Git HTTPS authentication boundary; it must not require PATs, custom secrets, SSH, or `gh`.

Normal CI does not claim a remote PASS from local evidence. It must never create/move/delete tags, push, bump versions, publish releases, or mutate repository content.
