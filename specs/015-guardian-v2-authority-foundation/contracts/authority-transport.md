# Structured OpenCode V2 Authority Reference Contract

**Status**: Provider-neutral transport design for review; not a claim about current ChangeBudget runtime behavior.
**Host contract source**: <https://opencode.ai/v2/docs/build/plugins> (V2 permission hook and plugin location reference; checked 2026-09-29).

## Native host boundary (factual fields only)

The documented V2 plugin boundary is `ctx.permission.hook("evaluate", callback)`. The documented evaluation event has `sessionID`, optional `agent`, `action`, `resources`, optional `metadata: Record<string, unknown>`, optional `source`, mutable `effect` (`allow | ask | deny`), and optional `message`. The documented plugin `ctx.location.project.canonical` describes the plugin instance's project location, not every session/event. A configured explicit `deny` is final and does not invoke the permission hook; hooks run for `allow` and `ask` and can update effect/message. The Phase A code already registers this permission hook and processes an optional application metadata record.

This contract introduces **no** native OpenCode event field. The namespaced object below is application data carried, if present, in the already-documented optional `metadata` record. It is not host-authenticated identity or authority. `sessionID`, optional `agent`, `source`, location/project values, permission effects, and saved host rules are not trusted subject/repository/work/admin proof.

## Application-owned reference envelope

Logical shape only; final serialization limits are an implementation detail to be fixed and validated before enablement:

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

Only the opaque existing grant locator and bounded requested-operation description are transported. Do **not** transport a trusted `subject_id`, `work_id`, `authority_id`, repository physical identity, contract/activation authority, issuer/provenance, grant body, validity state, success result, or admin context as a trusted claim. Those are resolved/verified locally. The operation/capabilities/paths/ceilings are untrusted request descriptors: validate strictly, bound collection/string/numeric sizes, canonicalize, and compare them with the actual intercepted `action`/`resources` and locally resolved operation before any authority decision. A request descriptor can narrow a check but cannot broaden observed operation facts or the grant.

Missing namespace means absent authority reference. Once the namespace/reference is present, malformed structure, unknown schema version, unknown reference, extra authority-bearing fields, invalid bounds, path normalization failure, provider failure, or a mismatch is an **invalid present reference**, never absence.

## Local resolution and decision table

The adapter computes the existing Phase A projection first and preserves any more restrictive incoming host result. It resolves the current physical repository binding, coherent `WorkContext`, authenticated `TrustedSubjectContext`, active authority revision, and grant record locally. It does not use the envelope, session/agent identifiers, `ctx.location`, first-party executable classification, actor arguments, or saved host permission rules as proofs.

| Reference state | V2 adapter outcome in this batch | Required behavior |
|---|---|---|
| Absent | `PASS_THROUGH` | Keep the Phase A decision exactly. Absence never grants authority, changes ASK/BLOCK, or upgrades to ALLOW. |
| Present, malformed/unknown/stale/revoked/consumed/replayed/mismatched/unresolvable | `BLOCK_INVALID_REFERENCE` | Set the invoked hook's effect to `deny`; do not treat it as absent or fall back to a generic host allow. Retain a stable failure reason. |
| Present and locally exact as a non-consuming preflight | `VALID_REFERENCE_NO_EFFECT` | Preserve the Phase A decision exactly. A valid reference does not change ASK/BLOCK, does not independently create ALLOW, and cannot enable managed START/AMEND/CLOSE. It is not an audited successful authority use. |
| Trusted context missing or ambiguous | `BLOCK_NO_TRUSTED_CONTEXT` | Fail closed for a present reference; never substitute transport claims. |
| Explicit configured host deny | Host final deny; hook not invoked | Do not claim Phase B can weaken or observe this decision. |

**Audit stop gate.** SPEC-015 requires retained verification/rejection evidence before authority success, while Phase A requires permission-hook evaluation to remain read-only. Therefore `VALID_REFERENCE_NO_EFFECT` is only a read-only preflight and cannot be reported as a grant verification/use event. The persistence-bearing core `authorizeUse` interface in `admin-api.md` must not be called from the permission hook unless independent review proves an out-of-hook ChangeBudget-owned audit path compatible with Phase A. Until such a path and trusted context adapters are proven, a V2 reference may not be relied on for authority and the formal audit/transport acceptance gate remains blocked. A present invalid reference still blocks immediately even while this gate is unresolved.

## Authority and ceiling rules

- The reference ID is only a registry lookup key. It does not create a registry entry, mint a grant, renew expiry, rebind repository/work/subject, change capabilities, consume an operation, or bypass a deny/protected-path rule.
- The local verifier compares repository physical binding, `authority_id`, generated `work_id`, exact subject, operation, capabilities, paths, independent permissions, numeric bounds, expiry, revocation/consumption, and current contract/activation/scope freshness.
- A request for 18 files under a maximum of 60 remains 18. The adapter never copies 60 into request context or turns a ceiling into a new requested budget.
- Resource paths are normalized once and checked against exact canonical grant scope plus contract deny/protected semantics. Existing path authority does not imply new-file permission; dependency, migration, configuration, and public-API permissions are independent.
- Generic OpenCode allow/always and `ask`/`once` are operational host permissions only. They neither create/expand a ChangeBudget grant nor satisfy human-admin provenance.
- Even an exact valid grant is not a Phase B lifecycle permission. No managed START/AMEND/CLOSE ALLOW or lifecycle behavior is introduced by this transport.

## Status and errors

The provider-neutral adapter returns one of `PASS_THROUGH`, `VALID_REFERENCE_NO_EFFECT`, `BLOCK_INVALID_REFERENCE`, or `BLOCK_NO_TRUSTED_CONTEXT`, with a stable reason code and bounded message. It does not return an OpenCode `allow` merely because a reference resolved. `BLOCK_*` maps to the native `deny` effect only when the hook is invoked; a preexisting configured deny remains final. Failures include `REFERENCE_MALFORMED`, `REFERENCE_UNKNOWN`, `SCHEMA_UNSUPPORTED`, `REGISTRY_CORRUPT`, `IDENTITY_UNAVAILABLE`, `WORK_CONTEXT_UNAVAILABLE`, `SUBJECT_CONTEXT_UNAVAILABLE`, `AUTHORITY_STALE`, `GRANT_EXPIRED`, `GRANT_REVOKED`, `GRANT_CONSUMED`, `GRANT_REPLAY`, `REQUEST_MISMATCH`, `SCOPE_DENIED`, `CAPABILITY_MISMATCH`, `CEILING_EXCEEDED`, `AUDIT_UNAVAILABLE`, and `STORAGE_UNAVAILABLE`.

No status/error is authority. Read-only hook behavior, audited use, and downstream operation outcome are distinct events. The adapter does not persist from the hook and does not claim universal OpenCode interception beyond the registered documented event.

## Contract test requirements

Test absent versus present-invalid (never conflate); valid exact reference preserves the prior Phase A action byte-for-byte; invalid references block even when incoming effect is generic allow/ask; more restrictive incoming decisions remain restrictive; host explicit deny is outside hook invocation; malformed/unknown/extra-key/oversized payloads reject; wrong repository/work/subject/authority/operation/capability/path/ceiling/revision, stale, revoked, consumed, replayed, corrupt, and unavailable registry cases fail closed; 18 remains 18 under 60; generic allow/always cannot bypass; no payload mints/widens/rebinds authority; no valid result creates managed lifecycle ALLOW; metadata/session/agent/location/first-party executable values never become trusted subject/admin proof; permission-hook evaluation has zero ChangeBudget writes. Separate core tests prove durable audit and atomic one-shot concurrency/restart without invoking the plugin hook.
