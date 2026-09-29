# Guardian V2 Authority Foundation — Future Validation Quickstart

**Status**: Run after implementation tasks exist and provider stop gates are satisfied. This is a validation guide, not an implementation recipe. It does not claim commands or tests were run during Phase 0/1 planning.

## Preconditions

1. Review `plan.md`, `research.md`, `data-model.md`, and both contracts; receive independent security/correctness review before creating implementation tasks.
2. Confirm the tested platform/filesystem is explicitly supported by `PhysicalIdentityProvider` and registry lock/file/directory durability tests. Do not use OneDrive or another unvalidated cloud/reparse filesystem for HARD acceptance.
3. Confirm real `SubjectContextProvider` and explicit outside-governed-runtime `OperatorAdminContext` adapters. A fake test adapter proves only unit behavior, not runtime/human provenance.
4. Confirm `work_id` is generated from coherent active contract and activation context; `task_id`, session/agent, metadata, first-party executable and `--actor` are not authority sources.
5. Use disposable local repositories for filesystem identity tests. Do not run destructive copy/move/crash tests against a working repository.

## Build and focused authority tests

Future focused test owners are proposed under `tests/unit/authority-*.test.ts`, `tests/integration/authority-registry.test.ts`, and `tests/integration/authority-transport.test.ts`; actual names are set in reviewed implementation tasks. After implementation, compile and invoke the specific compiled test owners with Node's test runner, for example:

```powershell
npm run compile
node --test dist/tests/unit/authority-identity.test.js dist/tests/unit/authority-context.test.js dist/tests/unit/authority-grants.test.js dist/tests/unit/authority-registry.test.js
node --test dist/tests/integration/authority-registry.test.js dist/tests/integration/authority-transport.test.js
```

Run the identity/platform tests on their actual supported Windows and POSIX filesystems. A simulated provider is supplementary only. If a focused test file is named differently during reviewed task planning, use that exact owner path rather than skipping the matrix.

## Required order of acceptance checks

1. **Provider feasibility** — physical file identity/common-dir association, trusted subject, explicit human admin source, stable cross-process lock, file sync, atomic replacement and directory sync. Record platform/filesystem limits; any unsupported property must make HARD unavailable.
2. **Core authority matrix** — repo reference cannot confer authority; linked-worktree domain vs distinct work ID; exact/narrower path and independent permission tests; 18-under-60 preservation; contract/activation freshness vs HEAD movement; create/list/inspect/revoke; malformed/corrupt/expired/stale state; audit failure and read-only inspection.
3. **Replay/durability matrix** — multi-process one-shot race; crashes before commit, after replace-before-directory-sync, after durable consumption and before downstream completion, and after completion; restart assertions; no second successful use or resurrection.
4. **V2 boundary** — absent is exact Phase A pass-through; present-invalid blocks even if incoming host effect is `allow`/`ask`; valid preflight never changes Phase A action; metadata is only locator/request; hook does not write ChangeBudget state; demonstrate out-of-hook audit gate before any claim of audited transport verification. Keep host explicit deny semantics separate because the documented hook is not invoked for it.
5. **Phase A regression**:

   ```powershell
   npm run test:phase-a
   ```

   This existing script compiles then runs its fixed focused ownership list; it does not replace the Phase B matrix.

6. **Package/runtime checks** after compile, including the existing owners (and their future Phase B assertions):

   ```powershell
   node --test dist/tests/integration/package-contents.test.js dist/tests/integration/opencode-plugin-runtime-hook.spec.js
   ```

   Test the packed/installed plugin/runtime path rather than relying only on a workspace-linked source module. If those owners split during implementation, use the reviewed exact test paths.

7. **Full project gates**:

   ```powershell
   npm test
   npm run typecheck
   npm run compile
   git diff --check
   ```

   `npm test` already compiles before running the full Node suite; separate typecheck/compile remain explicit acceptance evidence. No package publication, beta release, or stable version bump is in scope.

8. **Independent security/correctness review** — reviewer traces all issuer/subject/work/physical identity paths, audit+consumption ordering, lock/crash behavior, denial precedence, packaging and test evidence. Keep implementation acceptance pending until findings are resolved.

## Expected negative results

The following must never produce successful HARD use: linked worktree with another `work_id` or subject; clone/copy/cross-machine transfer; same-path physical replacement; identity unavailable/reused/ambiguous; unvalidated OneDrive/reparse filesystem; contract/scope/activation/authority epoch mismatch; routine host/session/agent/task/metadata/CLI claims standing alone; first-party executable or `--actor` offered as human proof; wrong capability or path/prefix/new-file boundary; request above a ceiling; expired, revoked, consumed, replayed, malformed or unknown-version grant; corrupt/unavailable registry; lock contention or durability/audit failure; missing trusted subject/admin context; any present invalid transport reference even when generic host allow applies. No case may be converted into a prompt or generic ALLOW as fallback.

## Evidence record

For every future gate, record the exact OS/filesystem/runtime, test command, result, and failure-injection point. Distinguish an identity-provider test from actual platform proof, a clean file rename from durable data+directory persistence, a registry decision from a downstream operation commit, and an existing Phase A action from new grant authority. This planning artifact records no test output and no runtime conformance result.
