# Research: SPEC-007 — Diagnose & Budget Advisor

Phase 0 output. Sources: direct inspection of the SPEC-007 spec (FR-001..FR-015 and the committed decision table), the current ChangeBudget source tree (`src/`), the repo constitution, and prior SPEC-005/SPEC-006 implementations. No external libraries or services were used; all unknowns were resolvable from the codebase.

## Decision 1: Where the advisor logic lives

- **Decision**: A leaf module `src/core/diagnose/advisor.ts` (pure decision-table evaluation) plus `src/core/diagnose/collect.ts` (read-only signal collection) and `src/models/diagnose.ts` (types). Everything else extends existing modules in place (a parser, a command, wiring in `src/cli/index.ts`).
- **Rationale**: The spec requires no new subsystem (goal 5, principle II). The advisor is genuinely new logic but stays a small pure function over `ObservableSignals`; only signal collection touches IO (Git). Separating `advisor` (pure) from `collect` (IO) mirrors the existing `types in models/`, behavior in `core/`, dispatch in `cli/` convention and keeps the decision table trivially testable without fixtures (principle V, XIV).
- **Alternatives considered**: a full `src/core/diagnose/` sub-tree with a rule engine plugin system (over-engineering, principle XVII); embedding evaluation in the CLI command (mixes pure logic with IO, hurts table-driven tests); hosting result types inside a core module (deviates from `models/` convention).

## Decision 2: How tracked-file count (N) is computed

- **Decision**: `N` = count of tracked files under declared prefixes, computed with one read-only `git ls-files` subprocess, filtered by `compilePathPatterns`/`matchPathPattern` against the compiled declared patterns; computed only when declared paths exist (`P > 0`).
- **Rationale**: FR-006 defines `N` as "tracked repository files under the declared prefixes, computed read-only from Git". The repo already centralizes Git invocation in `runGit` (`src/core/git/repo.ts`) and pattern matching in `core/check/patterns.ts`; reusing them keeps determinism (index contents, not working-tree diff) and avoids inventing a second matcher. Restricting the subprocess to declared-paths-only keeps bare/prose-only runs also read-only but fast and free of flavor text (FR-009 manual-review path needs no Git).
- **Alternatives considered**: computing `N` from the working-tree diff (`collectChangedItems`) — explicitly rejected: that would make `diagnose` resemble `check` (spec: "Do not accidentally turn diagnose into another check"); globbing the filesystem directly (non-deterministic vs Git index; ignores ignored files); `git ls-files <prefix>` raw without our pattern compiler (loses `src/ui/**` style semantics reused by stack rules).

## Decision 3: How stack-policy evidence (C) is collected

- **Decision**: `C` = distinct SPEC-005 categories (dependencies, migrations, configuration, public_api, release_artifacts) triggered by declared paths under an explicitly supplied `--stack-profile`, using `getBuiltInStackProfileRules(profile)` + `matchPathPattern`. Builtin profile rules only; repository override files (`stack-policy-overrides.json`) are not consulted.
- **Rationale**: FR-006/FR-011 and plan reuse SPEC-005 classifications rather than duplicating policy definitions. `getBuiltInStackProfileRules` is exported, deterministic, and side-effect-free. Overrides are enforcement-scoped configuration managed at `resolveStackPolicy` time for contracts; `diagnose` is advisory, never touches contract resolution, and reading a second policy file would add IO and a second resolution path without spec justification. The spec explicitly requires automatic stack detection be avoided; using only the explicitly supplied profile keeps that guarantee.
- **Alternatives considered**: calling `resolveStackPolicy`/`getStackPolicyResolution` (reads override files, validates disabled rules — heavier than needed, couples advisory output to enforcement config); embedding category lists inside the advisor (violates "reuse SPEC-005 classifications"; would duplicate definitions); treating runtime category as sensitive (spec's C enumerates five categories; `runtime` is not part of the committed set).

## Decision 4: How the decision table is represented

- **Decision**: The committed rule list is implemented as an ordered pure function `evaluateRecommendation(signals)` with literal first-match semantics; each rule produces the outcome plus the specific reasons that fired. Thresholds (`P=0`, `N≤5&&P≤2`, `N≤50&&P≤3`, category sets) are constants in `src/models/diagnose.ts`.
- **Rationale**: FR-008 pins "evaluated in fixed order" and the spec's table is the single source of truth. A literal ordered `if` chain over a typed result is the smallest correct encoding (principles II, XVII) and is trivially table-driven in tests without hidden heuristics (SC-001). Reasons are built at the same place the rule fires, guaranteeing a 1:1 mapping between outcome and explanation (FR-008/IX).
- **Alternatives considered**: a scored point system (opaque, violates IX "no opaque scoring"); a generic rule engine (over-engineering); evaluating thresholds in a different order (would change documented outcomes and break SC-001).

## Decision 5: How explicit `[budget:...]` annotations are modeled

- **Decision**: A valid resolved task annotation is a first-class "configured source" in the result (`source: 'explicit'`), evaluated by rule 1 of the decision table and never overridden by inferred scope signals. An invalid annotation value is treated as absent (falls through to inferred rules) and is never recommended.
- **Rationale**: The spec requires "prefer explicit human/configured intent over inferred advice" and "do not silently contradict explicit configured budget metadata" (FR-007). Modeling the annotation as a distinct result source makes precedence explicit and auditable in both human and JSON output instead of being hidden in the outcome. Invalid values are ignored (not errors) because `diagnose` is advisory and does not create a contract (unlike `start`, where the same value is a hard pre-persistence error).
- **Alternatives considered**: folding the annotation into inferred evidence (loses traceability of "configuration won"); erroring on invalid annotations (wrong: `diagnose` is advisory and never persists; FR-007 edge case says ignore).

## Decision 6: How `manual review` is represented

- **Decision**: `'manual_review'` is a distinct string outcome in the type `'tiny' | 'normal' | 'free' | 'manual_review'`; it is never passed to `start`'s preset parser and is not added to `CONTRACT_PRESETS`. Successful diagnosis (including `manual review`) exits `0`.
- **Rationale**: FR-001 forbids new presets and requires exactly the four outcomes; `manual review` is an advisory outcome, not a budget preset, so it must not pollute `CONTRACT_PRESETS` (which `start` validates against). Reusing the existing preset strings for `tiny/normal/free` keeps ecosystem compatibility. Exit `0` on `manual review` makes it a normal, valid result rather than a failure (spec asks for a recommendation outcome, not an error).
- **Alternatives considered**: adding `manual_review` to `CONTRACT_PRESETS` (breaks `start` preset validation semantics and violates FR-001); exiting non-zero on `manual review` (would surprise scripts and overstate severity for an advisory recommendation).

## Decision 7: Working-tree and active-contract behavior

- **Decision**: Existing working-tree changes and any active contract are ignored as evidence (FR-011). `diagnose` neither reads `.changebudget/**` state nor blocks on lifecycle. `N` is an index count, not a diff count.
- **Rationale**: The spec says diagnosis targets choosing a budget BEFORE implementation, asks the plan to decide the working-tree policy, and explicitly warns "do not accidentally turn diagnose into another check". Computing the recommendation from declared scope (index-tracked files) while ignoring the diff honors the pre-implementation intent and keeps results stable regardless of uncommitted work (repeatable, deterministic). Reading lifecycle state would inject a dependency of an advisory command on contract state with no spec benefit.
- **Alternatives considered**: rejecting runs when working-tree changes exist (FR-011 says diagnose must not fail/block because changes exist — rejected); using working-tree changes as a size signal (that is `check`'s job — rejected); warning about active state (extra output, no requirement either way — rejected to keep output deterministic and spec-tight).

## Decision 8: JSON contract shape and ordering

- **Decision**: `diagnose --json` emits `{ recommendation, source, reasons, inputs }` in fixed key order; `reasons` is an ordered array of `{ signal, value }` pairs identical to human reasons; `inputs` echoes the deterministic explicit inputs. No timestamps, no random ordering.
- **Rationale**: FR-012 requires a structured result, ordered reasons, and human/JSON equivalence; SC-002 requires byte-identical repeated output, which precludes timestamps. The `inputs` echo makes the result auditable ("under what declared inputs was this produced?") while keeping pure-function properties. Key order is fixed to guarantee byte-stability and match human reading order.
- **Alternatives considered**: nesting reasons with severity metadata (spec only asks signal+value); including `asOf` timestamps (breaks byte-stability, SC-002); ordering reasons by computed weight (opaque, violates IX).

## Decision 9: Exit-code and error taxonomy

- **Decision**: `0` for any successful diagnosis (incl. `manual review`). Input problems (unknown/bad flags, unexpected positionals, unknown/ambiguous task IDs, invalid stack profile) use the existing `InputValidationError` → `2`. Git/environment failures (`git ls-files` unavailable or not a repo) use `GitEnvironmentError` → `4`. No decision/PASS/REPAIR/HUMAN_REVIEW codes are emitted.
- **Rationale**: The repo centralizes exit mapping in `src/cli/output.ts` (`getExitCode`); reusing it keeps conventions and avoids new codes. Advisory results are not enforcement decisions, so decision exit codes do not apply (FR-001/FR-002). Task resolution failures reuse SPEC-006 error behavior verbatim (FR-004).
- **Alternatives considered**: a dedicated exit code for `manual review` (adds a non-error code with no consumer; rejected); reusing decision codes (wrong semantics).

## Decision 10: Testing approach

- **Decision**: Node built-in test runner; pure unit tests for the advisor decision table and parser; temp-git-repo unit tests for signal collection; one integration suite for end-to-end byte-stability/read-only/compat; a SPEC-005/006-style acceptance metrics suite for SC-001..SC-006, all on disposable dummy repositories.
- **Rationale**: Mirrors SPEC-005/006 (metrics with generated `acceptance-metrics.md`, integration via git fixtures and the compiled CLI) and the constitution's proportional-validation principle (V). Table-driven coverage, not dozens of hand-written permutations — the spec explicitly permits table-driven coverage. The roadmap gate (real-project dogfooding) stays a later manual gate; automated acceptance uses disposable dummy repos only, per spec.
- **Alternatives considered**: jest/vitest (new dev dependency, breaks zero-dependency choice); acceptance against real personal/work repos (explicitly forbidden by the spec).