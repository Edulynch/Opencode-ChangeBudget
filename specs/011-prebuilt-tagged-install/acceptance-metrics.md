# SPEC-011 Acceptance Metrics

SPEC-011 remains authoritative because T038 is incomplete. Historical evidence: v1.1.0 was defective; v1.1.1 had prebuilt artifacts but missed `--install-links=true`; v1.1.2 Windows public smoke passed, Linux `github:` shorthand failed through SSH without credentials, and isolated Linux HTTPS A/B passed. The intended corrective release is v1.1.3.

## Implementation Evidence

| Area | Status | Verified evidence |
| --- | --- | --- |
| Full regression | BASELINE PASS; CURRENT RERUN HAS UNRELATED CLEANUP FAILURE | Existing baseline: `npm test` had 524 tests passed, 0 failed, 0 skipped. Current rerun reached 524 passes and 1 unrelated `ENOTEMPTY` cleanup race in `start-command.test.ts`; updater, tagged-install, and release-gate focused tests passed. |
| Typecheck and build | PASS | `npm run typecheck` and `npm run build` completed successfully. |
| Tracked runtime | PASS | `dist/src/**`: 74 tracked files; `opencode-plugin/dist/opencode-plugin/**`: 6 tracked files. |
| Forbidden runtime | PASS | `dist/tests/**` and `opencode-plugin/dist/src/**` are not tracked. |
| Runtime freshness | PASS | Rebuild produced zero working-tree drift under both required runtime roots. |
| Package contents | PASS | `npm pack --dry-run --json --ignore-scripts` contains the required CLI and Runtime Guard runtime and excludes forbidden content. |
| Release gate positives | PASS | Disposable release fixtures pass version, package, tracking, freshness, and candidate-state validation. |
| Release gate negatives | PASS | Missing, stale, untracked, ignored, forbidden, version-mismatch, dirty, and existing-tag cases fail as designed. |
| Tagged installation | PASS | Local immutable tagged fixture installs with `--ignore-scripts --allow-git=all --install-links=true` in a disposable prefix with spaces and asserts the production HTTPS package-spec contract. |
| SPEC-009 compatibility | PASS | Installed Runtime Guard integration, idempotence, project preservation, and explicit stale-wrapper refresh pass. |
| SPEC-010 compatibility | PASS | Updater argv, same-major, major-only, already-current, failure codes, and project isolation pass. |
| Version/tag safety | PASS | `v1.1.0`, `v1.1.1`, and `v1.1.2` remain unchanged; no `v1.1.3` tag was created. |

## Release Smoke Evidence

| Platform | Status | Evidence requirement |
| --- | --- | --- |
| Windows public v1.1.2 HTTPS install | PASS | Public Windows smoke passed with the canonical flags and HTTPS package spec; CLI, Runtime Guard, integration, preservation, and real-prefix isolation passed. |
| Ubuntu/WSL public v1.1.2 `github:` install | FAIL | Clean Linux environment resolved `github:` shorthand through SSH and failed with `Permission denied (publickey)`. |
| Ubuntu/WSL isolated v1.1.2 HTTPS A/B | PASS | Clean isolated Linux environment with no SSH/GitHub credentials installed the HTTPS package spec successfully and cleaned up. |
| Windows public v1.1.3 HTTPS install | PENDING RELEASE SMOKE | Run after a maintainer publishes immutable `v1.1.3`. |
| Ubuntu/WSL public v1.1.3 HTTPS install | PENDING RELEASE SMOKE | Run after a maintainer publishes immutable `v1.1.3`. |
| macOS physical smoke | PENDING RELEASE SMOKE | POSIX-compatible automated coverage exists; no physical Mac validation is claimed. |

SPEC-011 implementation is complete when T038 records the required v1.1.3 HTTPS smoke evidence. No v1.1.3 public smoke has been run and no v1.1.3 tag exists.
