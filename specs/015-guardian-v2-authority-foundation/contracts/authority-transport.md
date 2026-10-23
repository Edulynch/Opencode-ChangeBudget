# Structured OpenCode V2 Authority Reference Contract

**Status (current 2026-10-21)**: The provider-neutral transport design and bounded non-authorizing G5 implementation remain as described below. T001–T016/G1–G3 remain complete/reviewed; offline G4 T018–T020 remains narrowly accepted on the previously G1/G2-qualified C: NTFS volume only. Independent offline G5 validation is Nox 91/91 PASS and final independent Vera review is PASS, but formal G5 acceptance remains BLOCKED, not native/HARD acceptance. Privacy-barrier/schema/legacy-13-row proof review is PASS only, not complete functional/current-run coverage or Block A readiness. The actual isolated 2.1.2 filtered case failed before host startup, pin receipt, or permission controls on a producer/schema mismatch; it is a prehost/harness failure, not a product denial-case failure, and no unsafe data persisted. Native controls were NOT RUN; G0 FINAL/T017 remains UNVERIFIED (0/24 pass, 0 case failures, 24 unverified); CHK016 is pending, T021–T023 unchecked, and T024–T027 untouched. The closing `latest` query observed 2.1.2, but the isolated install is not host-certified. Preserve non-enabling G5; do not rely on a valid-looking reference as HARD authority. `HARD_AUTHORITY_ENABLED:NO`, G6 blocked/not started, and no lifecycle ALLOW is enabled. See `dist/spec015-batch-20261021/final-closeout.md`.

**Earlier runner-only correction (2026-10-20; chronology)**: The offline harness treated `Agent.List` as discovery evidence and required public Session.Create/Get receipts before saved-rule setup/assertions. The later terminal proof below passed the session-selection gate. This remains runner selection evidence, not ChangeBudget human identity, authority, or native permission certification.

The offline Rule 60 projector retains documented V2 core action labels including `execute` and `subagent`, masks unknown/legacy action labels, and uses tri-state whole-value `*`/`?` applicability. Source `UNKNOWN` is not promoted to fixture/host provenance. Saved-always setup proposes bounded fixture resources, not a global shell wildcard. These are offline harness properties; actual native save/match behavior is governed by the terminal outcome below.
**Host contract source**: <https://opencode.ai/v2/docs/build/plugins> (V2 permission hook and plugin location reference; checked 2026-09-29).

## Native host boundary (factual fields only)

The documented V2 plugin boundary is `ctx.permission.hook("evaluate", callback)`. The documented evaluation event has `sessionID`, optional `agent`, `action`, `resources`, optional `metadata: Record<string, unknown>`, optional `source`, mutable `effect` (`allow | ask | deny`), and optional `message`. The documented plugin `ctx.location.project.canonical` describes the plugin instance's project location, not every session/event. A configured explicit `deny` is final and does not invoke the permission hook; hooks run for `allow` and `ask` and can update effect/message. The Phase A code already registers this permission hook and processes an optional application metadata record.

This contract introduces **no** native OpenCode event field. The namespaced object below is application data carried, if present, in the already-documented optional `metadata` record. It is not host-authenticated identity or authority. `sessionID`, optional `agent`, `source`, location/project values, permission effects, saved host rules, TTY/interactivity, process ancestry, environment, and first-party executable identity are not trusted human-identity, subject, repository, work, or admin proof. Direct execution outside the supported governed Runtime Guard path is an explicit administrative trust premise; ChangeBudget does not prove who initiated it. Executable identity is only an operation-classification input. Unsupported routes and malicious same-user OS bypass are outside the protection claim.

## Governed-path administrative deny

The supported governed Runtime Guard path MUST block before execution every attempt to create or revoke a grant, or invoke reserved rebind, even when the command carries a known grant ID or the incoming host effect is `allow`/saved `always`. The required supported invocation forms are verified ChangeBudget shim, canonical Node invocation, `npm exec -- changebudget ...`, and `npx changebudget ...`. SPEC-015 extends the existing Phase A argument classifier and tests each form; current first-party identity logic proves only executable identity and does not itself implement grant-admin classification or authenticate an operator. Ambiguous routes within the supported governed boundary fail closed. Unsupported routes outside that boundary and malicious same-user OS bypass are not claimed as protected. These denials do not mediate direct execution outside the governed path. Read-only list/inspect may be exempted only when the classifier and read-only state behavior are separately proven.

## Application-owned reference envelope

The current bounded implementation accepts this exact JSON data shape; it is application metadata, not an OpenCode authority field:

```json
{
  "changebudgetAuthority": {
    "schema_version": 1,
    "reference_id": "opaque-existing-grant-reference",
    "request": {
      "operation": "bounded-operation-name",
      "capabilities": ["explicit-capability-name"],
      "paths": ["repo/relative/path"],
      "ceilings": {
        "max_files": 18,
        "max_changed_lines": 240
      }
    }
  }
}
```

Current parser bounds are 4 KiB serialized JSON, 128 characters for the opaque reference ID, 64 for the operation, 512 per path/capability string, 1–8 entries per array, and nonnegative safe-integer ceilings. The envelope/request/ceilings have exact field sets and data-property records; unknown fields, accessors, non-plain records, unsupported versions, or oversized values are present-invalid. Although the parser bounds arrays to eight entries, the only implemented profile is exactly `file.write`, exactly one `source.edit` capability, exactly one canonical path, and exact ceilings derived from the proposed edit (not grant maxima). The current edit projection is limited to a unique nonempty literal `oldString`, `replaceAll` absent or false, a regular existing in-repository file without a symlink/reparse component, and bounded valid UTF-8 text; it rejects unsupported newline, trailing-whitespace, fallback, duplicate-match, no-op, and new-file semantics. It derives independent sensitive-path flags from the raw path classifier and fixes `allow_new_files` false. This narrow implementation profile is not a promise that all documented OpenCode edit forms are supported.

Only the opaque existing grant locator and bounded requested-operation description are transported. Do **not** transport a trusted `subject_id`, `work_id`, `authority_id`, repository physical identity, contract revision, work-activation freshness, issuer/provenance, grant body, validity state, success result, or admin identity claim. Those are resolved/verified locally. The operation/capabilities/paths/ceilings are untrusted request descriptors: validate strictly, bound collection/string/numeric sizes, canonicalize, and compare them with the actual intercepted `action`/`resources` and locally resolved operation before any authority decision. A request descriptor can narrow a check but cannot broaden observed operation facts or the grant.

Missing namespace means absent authority reference. Once the namespace/reference is present, malformed structure, unknown schema version, unknown reference, extra authority-bearing fields, invalid bounds, path normalization failure, provider failure, or a mismatch is an **invalid present reference**, never absence.

## Local resolution and decision table

The adapter computes the existing Phase A projection first and preserves any more restrictive incoming host result. It resolves the current physical repository binding, coherent `WorkContext`, current ChangeBudget-owned subject binding from the G2 registry, active authority revision, and grant record locally. G1 context feasibility does not imply a persisted binding; missing canonical G2 state blocks. A present reference may use only strictly read-only `verifyGrant` preflight; it never calls persistence-bearing `authorizeUse`, creates bindings, or returns `USE_ACCEPTED`. The adapter never accepts a subject label or agent prose as a canonical identifier. It does not use the envelope, session/agent identifiers, `ctx.location`, first-party executable classification, actor arguments, or saved host permission rules as proof of identity or authority.

| Reference state | V2 adapter outcome in this batch | Required behavior |
|---|---|---|
| Absent | `PASS_THROUGH` | Keep the Phase A decision exactly. Absence never grants authority, changes ASK/BLOCK, or upgrades to ALLOW. |
| Present, malformed/unknown/stale/revoked/consumed/replayed/mismatched/unresolvable | `BLOCK_INVALID_REFERENCE` | Set the invoked hook's effect to `deny`; do not treat it as absent or fall back to a generic host allow. Retain a stable failure reason. |
| Present and locally exact as a non-consuming preflight | `VALID_REFERENCE_NO_EFFECT` | Preserve the Phase A decision exactly. A valid reference does not change ASK/BLOCK, does not independently create ALLOW, and cannot enable managed START/AMEND/CLOSE. It is not an audited successful authority use. |
| Trusted context missing or ambiguous | `BLOCK_NO_TRUSTED_CONTEXT` | Fail closed for a present reference; never substitute transport claims. |
| Explicit configured host deny | Host final deny; hook not invoked | Do not claim Phase B can weaken or observe this decision. |

**Audit stop gate.** SPEC-015 requires retained evidence for authority use, while Phase A requires permission-hook evaluation to remain read-only. `VALID_REFERENCE_NO_EFFECT` is only the strictly read-only `verifyGrant` preflight; it is not an audited use and cannot return `USE_ACCEPTED`. The internal persistence-bearing `authorizeUse` operation in `admin-api.md` must never run from the permission hook. Until G0 FINAL, G4, trusted local context, and an independently reviewed out-of-hook audit/use path are all proven, a V2 reference may not be relied on for authority and the formal audit/transport acceptance gate remains blocked. A present invalid reference still blocks immediately while this gate is unresolved.

**Integration gate clarification**: Offline G4 acceptance is not V2/native adapter acceptance. Any later real OpenCode HARD integration requires both G0 FINAL and accepted G4, plus trusted local context and an independently reviewed out-of-hook audit/use path. The permission hook remains strictly read-only; it may perform only `verifyGrant` preflight, never persistence-bearing `authorizeUse` or `USE_ACCEPTED`.

## Authority and ceiling rules

- The reference ID is only a registry lookup key. It does not create a registry entry or repository/work/subject binding, mint a grant, renew expiry, rebind repository/work/subject, change capabilities, consume an operation, or bypass a deny/protected-path rule. Descriptive subject labels and request prose cannot mint canonical identity; only the direct administrative path may create a binding, and its only persistence is the G2 registry transaction.
- The local verifier compares repository physical binding, `authority_id`, generated `work_id`, exact subject, operation, capabilities, paths, independent permissions, numeric bounds, expiry, revocation/consumption, and current contract/work-activation/scope freshness.
- A request for 18 files under a maximum of 60 remains 18. The adapter never copies 60 into request context or turns a ceiling into a new requested budget.
- Resource paths are normalized once and checked against exact canonical grant scope plus contract deny/protected semantics. Existing path authority does not imply new-file permission; dependency, migration, configuration, and public-API permissions are independent.
- Generic OpenCode allow/always and `ask`/`once` are operational host permissions only. They neither create/expand a ChangeBudget grant nor establish operator identity or authority.
- Even an exact valid grant is not a Phase B lifecycle permission. No managed START/AMEND/CLOSE ALLOW or lifecycle behavior is introduced by this transport.

## Status and errors

The provider-neutral adapter returns one of `PASS_THROUGH`, `VALID_REFERENCE_NO_EFFECT`, `BLOCK_INVALID_REFERENCE`, or `BLOCK_NO_TRUSTED_CONTEXT`, with a stable reason code and bounded message. It does not return an OpenCode `allow` merely because a reference resolved. `BLOCK_*` maps to the native `deny` effect only when the hook is invoked; a preexisting configured deny remains final. Failures include `REFERENCE_MALFORMED`, `REFERENCE_UNKNOWN`, `SCHEMA_UNSUPPORTED`, `REGISTRY_CORRUPT`, `IDENTITY_UNAVAILABLE`, `WORK_CONTEXT_UNAVAILABLE`, `SUBJECT_CONTEXT_UNAVAILABLE`, `AUTHORITY_STALE`, `GRANT_EXPIRED`, `GRANT_REVOKED`, `GRANT_CONSUMED`, `GRANT_REPLAY`, `REQUEST_MISMATCH`, `SCOPE_DENIED`, `CAPABILITY_MISMATCH`, `CEILING_EXCEEDED`, `AUDIT_UNAVAILABLE`, and `STORAGE_UNAVAILABLE`.

No status/error is authority. Read-only hook behavior, audited use, and downstream operation outcome are distinct events. The adapter does not persist from the hook and does not claim universal OpenCode interception beyond the registered documented event.

## Historical certification checkpoint — global OpenCode 2.0.32 preflight (2026-10-20; superseded)

At this earlier checkpoint, the global executable reported `opencode v2.0.32` rather than the required 2.0.29 and the runner did not launch. This is retained as history, not the current blocker: the later isolated 2.0.29 attempt passed pin verification but stopped before session creation. Neither checkpoint supplies native certification. The service-owned `authorizeUse` durable-audit contract boundary is independently reviewed PASS, but does not evidence invocation from a native event. Keep T021–T023 pending and do not rely on a valid-looking reference as HARD authority.

## Earlier terminal certification closeout — isolated OpenCode 2.0.29 attempt (2026-10-20)

This earlier record predates the subsequent session proof and native attempt below. Its pre-session identity blocker is not the current effective-session status.

## Terminal documentation/evidence closeout — effective session and privacy gate (2026-10-20)

Public POST/GET receipts passed effective selected-session-agent proof for canonical `spec015-conformance`, the same session/project/location, nonblank IDs, current configuration, and supported permission overrides. Same-phase List/Get both matched the target; the earlier difference cause remains **UNKNOWN**, not proven filtering. This is non-authorizing session-selection proof only.

The isolated native test formally **FAILED** before the second host spawn because the restart receipt was undefined. It is a harness failure, not a ChangeBudget denial-case failure. Thirteen real ASK/reply/saved-rule rows survived reload as preparation only, without a registered ChangeBudget hook; no hook-correlated benign ASK control passed. Native ASK, saved-always and admin-denial behavior remain unverified; post-restart saved-rule use and admin hook-reason/no-effect controls were not run. Matrix **NOT STARTED** (0/24 pass, 0 case failures, 24 unverified); G0 FINAL remains **UNVERIFIED**. Rule 60 is a projected ordinal: action `OTHER` is lossy and exact action unknown, effect deny, resource kind universal string, 27 local shell-literal projections nonmatching, source unknown with zero unique source matches, and native match not executed. No origin or per-rule native applicability pass is established.

The original result remains formally **FAILED** with recorded status/outcomes and original SHA-256 `033af658d8be10e86e34212a42861d075d0a1aec4c664b1d1b45d2367ab2c69f`. The separate authorized derivative is `dist/spec015-evidence/2b7ce480d3f6419a8e26c905b17adf43.json`, SHA-256 `2c96fbf0a311b3db6270d86374b03274d82e01ab19742a1a5437ee5a2d47bf0c`; correction2 redaction metadata reports `APPLIED_AFTER_CAPTURE`, `native_result_preserved: true`, and 523 changed field paths. Only 8/13 resource-bearing preparation rows (indices 1, 2, 4, 5, 7, 8, 10, 11) are shown changed. Indices 0, 3, 6, 9, 12 are not shown changed or validated raw-free. Privacy review is **BLOCKING / CHANGES_REQUIRED** pending full derivative validation before any new native attempt. Do not claim full sanitization/acceptance or that original bytes were rewritten; no actual secret exposure or exfiltration is asserted.

The offline restart-receipt source correction is complete, caller-passing and verified-pin reviewed, but not natively retested. Latest supplied offline results: focused 5/5; full runner 17 passed, 0 failed, 2 skipped; gated redaction 1 passed; typecheck/compile/diff check exit 0; 168 production hashes unchanged. These results do not clear privacy or certify G0. Earlier 14-pass/1-skip and gate 4-pass results are chronology only; no fresh Phase A/package/G4 run occurred, and earlier 350/52/69 counts are not new batch totals.

PID 28940 received SIGTERM; port closed, PID absent, and OS listeners absent for old/reserved restart ports. Failure preceded the second spawn. An auxiliary PowerShell `ConnectAsync` to the old port timed out after two seconds and disposed its client, but shell output had no exit/PID/task settlement. `AUX_PROBE_EXECUTION` is **UNKNOWN**, not proof of running or finished; no further probe was made, and no global no-process claim is justified.

T017, CHK016, and T021–T023 remain pending; T024–T027 remain untouched; no task IDs or markers changed. Preserve accepted G4 and non-enabling G5. G6 is not started, `HARD_AUTHORITY_ENABLED:NO`, and no lifecycle ALLOW/G0 acceptance/HARD reliance is claimed. Next state is **BLOCKED** on full derivative privacy validation and independent review. No source/native retry/Git/policy/runtime/cleanup change occurred.

## Terminal conditional batch closeout — 2026-10-21

The privacy-barrier/schema/legacy-13-row proof review is **PASS only**; it does not establish complete functional coverage, current-run native coverage, or Block A readiness. Independent offline G5 Nox validation is 91/91 and Vera review PASS; formal G5 remains BLOCKED on G0 FINAL, trusted-context, and out-of-hook audit/use evidence. The isolated 2.1.2 case failed before host startup/pin receipt/permission controls because initial producer value `saved_always_diagnostic.authority_state_before_fixture_initialization='NOT_CAPTURED'` is incompatible with the object-only schema, which rejects non-record values. Validation occurs before mkdir/fixture initialization; later object capture does not cure the initial-state mismatch. No unsafe data persisted, and the case is not a product denial-case failure. Native controls were NOT RUN; G0 remains UNVERIFIED (0/24 pass, 0 case failures, 24 unverified); T017/CHK016 remain pending, T021–T023 unchecked, and T024–T027 untouched. The latest public-registry query at close observed 2.1.2, but the isolated install is not host-certified. No code correction or native retry was authorized or performed by this documentation closeout.

## Contract test requirements

Test governed grant create/revoke/reserved-rebind denial before execution across verified shim, canonical Node, `npm exec`, and `npx`; include known grant IDs and incoming generic allow/saved always, plus ambiguous supported routes failing closed. Unsupported routes and malicious same-user OS bypass remain outside the protection claim. Also test that administration does not enter transport or create grant authority. Test absent versus present-invalid (never conflate); valid exact reference preserves the prior Phase A action byte-for-byte; invalid references block even when incoming effect is generic allow/ask; more restrictive incoming decisions remain restrictive; host explicit deny is outside hook invocation; malformed/unknown/extra-key/oversized payloads reject; wrong repository/work/subject/authority/operation/capability/path/ceiling/revision, stale, revoked, consumed, replayed, corrupt, and unavailable registry cases fail closed; 18 remains 18 under 60; generic allow/always cannot bypass; no payload, label, or agent prose mints/widens/rebinds authority or creates a binding; no valid result creates managed lifecycle ALLOW; metadata/session/agent/location/TTY/environment/process ancestry/first-party executable values never become trusted subject/operator proof; permission-hook evaluation has zero ChangeBudget writes. Separate core tests prove durable audit and atomic one-shot grant concurrency/restart without invoking the plugin hook.
