# Reliability Guarantees Contract — SPEC-008

**Branch**: `008-dogfood-reliability` | **Date**: 2026-08-18 | **Spec**: [../spec.md](../spec.md) | **Model**: [../data-model.md](../data-model.md)

Stable, externally observable guarantees that SPEC-008 must satisfy. Consumers (scripts, the OpenCode plugin, humans) may rely on these. Everything here is a correction only where a FINDING documented incorrect behavior; the rest is a formal restatement of existing behavior.

## 1. Error classification is deterministic and consistent

- The same fault produces the same error type and the same exit code from every command that can observe it (F-M02, FR-005).
- Missing file vs corrupt file are distinguished by the actual errno identifier, never by rendered error text (F-M04, FR-006).
- Missing or corrupt state referenced by `last_closed_contract_id` is surfaced, never silently ignored (F-M03, FR-007).
- Malformed-but-parseable Git output produces a typed, actionable error with an excerpt — records are never silently dropped (F-M06, FR-009).
- A stack profile without built-in rules produces a deterministic input error, never an internal crash (F-M12, FR-017).

Exit codes remain unchanged and per-command (existing mapping): OK `0`; decisionable `check`/`status --budget` `PASS 0 / REPAIR 1 / HUMAN_REVIEW 2`; input/usage `2`; state conflict `3`; corruption/environment `4`; unknown `10`. The numeric collision between decisionable `HUMAN_REVIEW` and input/usage (`2`) remains an ACCEPTED_LIMITATION (A-01): within a given command the meaning is unambiguous and documented.

## 2. State integrity guarantees

- A failed lifecycle write NEVER destroys a previously-valid state or contract file (F-B01, FR-001). Replacement is effective only via an atomic temp+rename; on repeated transient lock errors the write fails cleanly and the previous file survives.
- Failed `start` leaves no orphaned unreferenced active contract; the next `start` proceeds cleanly (F-M01, FR-002).
- A contract file marked `closed` while state says `active` is reported as an actionable corruption error telling the user to re-run `changebudget close`; re-running `close` reconciles deterministically (F-M01, FR-003).
- Any corruption that survives a failure surfaces as a deterministic actionable error, never silent success (FR-004). No auto-repair, no silent reversion (Constitution VIII).

## 3. Budget correctness guarantees

- Changed-line totals equal a single diff against the base revision — a partially staged file is counted once (F-M05, FR-008).
- Change records use NUL-delimited Git output; filenames (including newlines/tabs) are handled without record splitting; non-UTF-8 byte sequences remain lossy (A-02) but never silently drop the file.
- Renames are classified deterministically with old/new paths; directory renames and literal ` => ` in names produce no phantom paths or mis-splits (F-M07, FR-010).
- Untracked binary detection works on Windows and is not disabled by stderr/locale noise (F-M08, FR-011).
- Ordering of changed files, violations, and feature discovery is byte-stable across machines, locales, and Node builds (F-M09, FR-012).

## 4. Read-only guarantees

`status`, `check`, `diagnose`, and the OpenCode plugin never modify `.changebudget/**`, project files, Spec-Kit tasks, Git index content, refs, or commits (FR-014; SC-002). Porcelain Git reads may refresh the index stat-cache (A-04 — standard Git behavior, no content change).

## 5. OpenCode plugin guarantees

- The plugin never throws out of a hook: any evaluation error (missing/malformed state, unresolvable target, check failure) resolves to a documented deterministic decision (missing state → passive; other errors → the existing `HUMAN_REVIEW`-projected degraded decision) (F-M10, FR-015).
- Context bookkeeping is memory-bounded across a long-lived session (F-M11, FR-016).
- Core CLI availability never depends on plugin success; no expansion to other coding agents.

## 6. Compatibility guarantees

- CLI commands, flags, presets, human/JSON output schemas, reason-code namespaces, and documented exit codes are unchanged except for the committed FINDING corrections above.
- The complete existing SPEC-001..007 suite remains green (SC-007).
- Zero new runtime dependencies (FR-021).

## 7. v1.0 readiness gate

SC-001..SC-008 pass with recorded evidence, BLOCKER count = 0, MUST_FIX count = 0, all accepted limitations documented (see [../spec.md](../spec.md) A-01..A-10), and no material MEDIUM issue blocks normal personal use.