# Quickstart: SPEC-009 OpenCode Integration Validation

**Branch**: `009-opencode-integration` | **Date**: 2026-08-18 | **Spec**: [spec.md](spec.md) | **Contracts**: [contracts/opencode-integration-contract.md](contracts/opencode-integration-contract.md)

## Prerequisites

```bash
npm install
npm run build
```

## Scenario 1 — Clean install (no existing opencode.json)
```bash
TMP=$(mktemp -d) && cd "$TMP" && git init -q && git commit --allow-empty -m seed
changebudget integrate opencode
```
**Expected**: 3 resources created. READY. Baseline warning emitted.

## Scenario 2 — Coexist with existing opencode.json
```bash
echo '{"$schema":"...","instructions":["docs/existing.md"],"model":"gpt-4"}' > opencode.json
changebudget integrate opencode
```
**Expected**: model preserved, existing instruction preserved, CB entry appended. AGENTS.md untouched.

## Scenario 3 — Idempotent re-run
```bash
changebudget integrate opencode && changebudget integrate opencode
```
**Expected**: second run UNCHANGED, zero writes.

## Scenario 4 — Dry-run
```bash
changebudget integrate opencode --dry-run
```
**Expected**: reports planned actions, zero mutations, byte-identical tree.

## Scenario 5 — Stale wrapper repair
```bash
changebudget integrate opencode  # repairs stale path
```
**Expected**: wrapper UPDATE, others UNCHANGED.

## Scenario 6 — Ownership conflict
```bash
echo 'alert("user")' > .opencode/plugins/changebudget.js
changebudget integrate opencode
```
**Expected**: CONFLICT, zero writes, exit 2.

## Scenario 7 — Safe removal
```bash
changebudget integrate opencode && changebudget integrate opencode --remove
```
**Expected**: managed files deleted, entry removed, other config preserved.

## Scenario 8 — Removal conflict
```bash
echo '# user' > .opencode/instructions/changebudget.md
changebudget integrate opencode --remove
```
**Expected**: refused, exit 2.

## Scenario 9 — Missing build
```bash
changebudget integrate opencode
```
**Expected**: actionable error, zero writes, exit 2.

## Scenario 10 — Invalid opencode.json
```bash
echo '{invalid' > opencode.json
changebudget integrate opencode
```
**Expected**: parse error, no modification, exit 2.

## Scenario 11 — Full workflow
```bash
changebudget integrate opencode
git add -A && git commit -m "baseline"
changebudget start --task "test" --base-revision HEAD --allow-path "src/**" --tiny
echo 'export const x=1;' > src/app.ts
changebudget check  # PASS
changebudget close
```

## Scenario 12 — AGENTS.md byte-identity
```bash
sha256sum AGENTS.md > before.txt
changebudget integrate opencode
changebudget integrate opencode --dry-run
changebudget integrate opencode --remove
sha256sum AGENTS.md > after.txt
diff before.txt after.txt  # identical
```

## Final gate
```bash
npm run build && npm run typecheck && npm test
```