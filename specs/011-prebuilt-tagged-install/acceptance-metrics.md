# SPEC-011 Acceptance Metrics

SPEC-011 is COMPLETE. Release `v1.1.3` is published as an immutable public tag at commit `2da26e004ea8e673baaca195a965180f2e49fe11`. Historical evidence is preserved: v1.1.0 was defective; v1.1.1 had prebuilt artifacts but missed `--install-links=true`; v1.1.2 Windows public smoke passed, Linux `github:` shorthand failed through SSH without credentials, and isolated Linux HTTPS A/B passed.

## Implementation Evidence

| Area | Status | Verified evidence |
| --- | --- | --- |
| Full regression | PASS | `npm test`: 526 passed, 0 failed, 0 skipped. |
| Focused HTTPS/update/release-gate tests | PASS | 31/31 tests passed. |
| Typecheck and build | PASS | `npm run typecheck` and `npm run build` completed successfully. |
| Tracked runtime | PASS | `dist/src/**`: 74 tracked files; `opencode-plugin/dist/opencode-plugin/**`: 6 tracked files. |
| Forbidden runtime | PASS | `dist/tests/**` and `opencode-plugin/dist/src/**` are not tracked. |
| Runtime freshness | PASS | Rebuild produced zero working-tree drift under both required runtime roots. |
| Package contents | PASS | `npm pack --dry-run --json --ignore-scripts` reported 82 files, contains the required CLI and Runtime Guard runtime, and excludes forbidden content. |
| Release gate positives | PASS | Disposable release fixtures pass version, package, tracking, freshness, and candidate-state validation. |
| Release gate negatives | PASS | Missing, stale, untracked, ignored, forbidden, version-mismatch, dirty, and existing-tag cases fail as designed. |
| Repository hygiene | PASS | `git diff --check` passed; release gate passed for the published release candidate. |
| Tagged installation | PASS | Local immutable tagged fixture installs with `--ignore-scripts --allow-git=all --install-links=true` in a disposable prefix with spaces and asserts the production HTTPS package-spec contract. |
| SPEC-009 compatibility | PASS | Installed Runtime Guard integration, idempotence, project preservation, and explicit stale-wrapper refresh pass. |
| SPEC-010 compatibility | PASS | Updater argv, same-major, major-only, already-current, failure codes, and project isolation pass. |
| Version/tag safety | PASS | Published `v1.1.3` is immutable at `2da26e004ea8e673baaca195a965180f2e49fe11`; historical `v1.1.0`, `v1.1.1`, and `v1.1.2` remain unchanged. |

## Release Smoke Evidence

| Platform | Status | Evidence requirement |
| --- | --- | --- |
| Windows public v1.1.2 HTTPS install | PASS | Public Windows smoke passed with the canonical flags and HTTPS package spec; CLI, Runtime Guard, integration, preservation, and real-prefix isolation passed. |
| Ubuntu/WSL public v1.1.2 `github:` install | FAIL | Clean Linux environment resolved `github:` shorthand through SSH and failed with `Permission denied (publickey)`. |
| Ubuntu/WSL isolated v1.1.2 HTTPS A/B | PASS | Clean isolated Linux environment with no SSH/GitHub credentials installed the HTTPS package spec successfully and cleaned up. |
| Windows public v1.1.3 HTTPS install | PASS | Windows, Node 24.18.0, npm 11.16.0: canonical public HTTPS install succeeded with scripts disabled; package/runtime, version, help, init, integration, wrapper/Runtime Guard reference, AGENTS.md, unrelated model/theme fields, real global prefix, and disposable-root cleanup all passed. |
| Ubuntu/WSL clean public v1.1.3 HTTPS install | PASS | Clean Linux environment with Node 24.18.0, npm 11.16.0, Git 2.43.0, temporary HOME, no SSH/GitHub configuration, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, and `GIT_TERMINAL_PROMPT=0`: install and all CLI, Runtime Guard, preservation, instruction-entry, cleanup, prefix-isolation, and exit-code checks passed. |
| Credential independence | PASS | The Ubuntu/WSL smoke passed without a GitHub account, `gh` CLI, SSH key, or Git credential helper. |
| macOS physical smoke | PENDING RELEASE SMOKE | POSIX-compatible automated coverage exists; no physical Mac validation is claimed. |

T038 PASS. SPEC-011 COMPLETE: the immutable public `v1.1.3` tag exists at release commit `2da26e004ea8e673baaca195a965180f2e49fe11`, Windows public HTTPS smoke PASS, Ubuntu/WSL clean public HTTPS smoke PASS, and credential independence is verified. Physical macOS validation was not performed; POSIX-compatible automated coverage remains documented separately.
