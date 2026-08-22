# Data Model: Cross-Platform CI and Release Smoke

SPEC-012 adds no runtime database, persisted application state, or public API data model. The following are validation records used to structure workflow and harness assertions.

## CIValidationRun

Represents one normal pull-request or `master` push matrix job.

| Field | Type | Validation |
|---|---|---|
| `trigger` | event/ref | Must be `pull_request` or push to `master`. |
| `revision` | Git revision | Must be the checked-out source revision. |
| `platform` | runner label | Exactly `windows-latest` or `ubuntu-latest`. |
| `nodeVersion` | strict version | Exactly `24.18.0`. |
| `npmVersion` | strict version | Exactly `11.16.0`. |
| `checks` | ordered check set | Dependency install, typecheck, build, test, package, CI-safe gate, and tracking/freshness checks all execute. |
| `outcome` | `PASS`/`FAIL` | Any required check failure produces `FAIL`. |

## ReleaseSmokeRun

Represents one tag-triggered private-repository installation job.

| Field | Type | Validation |
|---|---|---|
| `tag` | immutable tag | Derived from the event ref and matches `^vMAJOR.MINOR.PATCH$`. |
| `packageSpec` | HTTPS Git spec | Exactly the repository HTTPS URL plus `#${tag}`. |
| `platform` | runner label | Exactly `windows-latest` or `ubuntu-latest`. |
| `installedVersion` | strict version | Must equal `tag` without the leading `v`. |
| `packageRoot` | absolute path | Must resolve under the disposable global prefix, never the checkout. |
| `credentialIsolation` | platform result | Ubuntu and Windows must prove isolation from personal credentials and use only the ephemeral read-only workflow token at the process-scoped Git auth boundary. |
| `authEnvironment` | transient process environment | Exactly one Git runtime pair for `http.https://github.com/.extraheader`; absent after child exit and never persisted. |
| `projectPreservation` | assertion result | AGENTS.md bytes and unrelated config fields remain unchanged; expected instruction entry is added. |
| `cleanup` | assertion result | Disposable prefix, cache, config, and project are absent after finalization. |
| `outcome` | `PASS`/`FAIL` | Any install, assertion, isolation, or cleanup failure produces `FAIL`. |

## CanonicalInstallContract

The independently asserted remote installation boundary.

| Field | Value |
|---|---|
| `transport` | `git+https` |
| `repository` | `https://github.com/Edulynch/Opencode-ChangeBudget.git` |
| `tagPattern` | `^v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$` |
| `argv` | `install`, `-g`, `--ignore-scripts`, `--allow-git=all`, `--install-links=true`, package spec |
| `credentials` | Credential-free package spec; process-scoped Basic `http.extraHeader` from temporary read-only `GITHUB_TOKEN` only at Git auth boundary |

## DisposableSmokeEnvironment

Temporary resources used by one smoke job.

| Field | Type | Validation |
|---|---|---|
| `prefix` | absolute path | Isolated npm global prefix; absent after cleanup. |
| `cache` | absolute path | Isolated npm cache; absent after cleanup. |
| `userConfig` | absolute path | Isolated npm userconfig; absent after cleanup. |
| `project` | absolute path | Test project, including a path with spaces; absent after cleanup. |
| `realGlobalPrefixBefore/After` | absolute path | Values are equal. |
