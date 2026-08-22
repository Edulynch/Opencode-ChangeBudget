# SPEC-011 Acceptance Metrics

## Implementation Evidence

| Area | Status | Verified evidence |
| --- | --- | --- |
| Full regression | PASS | `npm test`: 524 tests passed, 0 failed, 0 skipped. |
| Typecheck and build | PASS | `npm run typecheck` and `npm run build` completed successfully. |
| Tracked runtime | PASS | `dist/src/**`: 74 tracked files; `opencode-plugin/dist/opencode-plugin/**`: 6 tracked files. |
| Forbidden runtime | PASS | `dist/tests/**` and `opencode-plugin/dist/src/**` are not tracked. |
| Runtime freshness | PASS | Rebuild produced zero working-tree drift under both required runtime roots. |
| Package contents | PASS | `npm pack --dry-run --json --ignore-scripts` contains the required CLI and Runtime Guard runtime and excludes forbidden content. |
| Release gate positives | PASS | Disposable release fixtures pass version, package, tracking, freshness, and candidate-state validation. |
| Release gate negatives | PASS | Missing, stale, untracked, ignored, forbidden, version-mismatch, dirty, and existing-tag cases fail as designed. |
| Tagged installation | PASS | Local immutable tagged fixture installs with `--ignore-scripts --allow-git=all` in a disposable prefix with spaces. |
| SPEC-009 compatibility | PASS | Installed Runtime Guard integration, idempotence, project preservation, and explicit stale-wrapper refresh pass. |
| SPEC-010 compatibility | PASS | Updater argv, same-major, major-only, already-current, failure codes, and project isolation pass. |
| Version/tag safety | PASS | `v1.1.0` remains unchanged; no `v1.1.1` tag was created. |

## Release Smoke Evidence

| Platform | Status | Evidence requirement |
| --- | --- | --- |
| Windows public GitHub install | PENDING RELEASE SMOKE | Run after a maintainer publishes immutable `v1.1.1`; verify scripts-disabled install, CLI, Runtime Guard, integration, preservation, and real-prefix isolation. |
| Ubuntu/WSL public GitHub install | PENDING RELEASE SMOKE | Run after a maintainer publishes immutable `v1.1.1`; verify the same behavior using the POSIX global layout. |
| macOS physical smoke | PENDING RELEASE SMOKE | POSIX-compatible automated coverage exists; no physical Mac validation is claimed. |

SPEC-011 implementation is complete when the documented release smoke is later performed. This evidence does not claim that `v1.1.1` exists or that the public GitHub smoke has passed.
