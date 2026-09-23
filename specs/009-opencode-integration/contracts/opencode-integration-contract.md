# Native OpenCode V2 Integration Contract

## CLI Surface

```text
changebudget integrate opencode [--dry-run] [--remove]
```

The command manages only `.opencode/plugins/changebudget.js`.

| Outcome | Exit code |
|---|---:|
| Install, update, dry-run, removal, or already-current | 0 |
| Conflict or missing compiled plugin | 2 |
| Filesystem write failure | 4 |

## Wrapper Contract

```js
// ChangeBudget-managed: do not edit. Re-run: changebudget integrate opencode
export { default } from "file:///absolute/path/opencode-plugin/dist/opencode-plugin/src/index.js";
```

The URL is generated with `pathToFileURL`. The wrapper is the only generated project file. `opencode.json`, instruction files, `AGENTS.md`, and unrelated plugins are preserved byte-for-byte.

## Native Plugin Contract

The compiled default export is defined with `Plugin.define({ id: 'changebudget', setup })` from `@opencode/plugin@2.0.12`. Setup registers exactly:

- `ctx.session.hook('context', callback)` for deterministic ChangeBudget workflow context;
- `ctx.permission.hook('evaluate', callback)` for runtime policy projection.

The implementation has no server callback, tool/command pre-execution adapters, fallback, or pseudo-handoff transport.

## Permission Contract

- Evaluate every resource in the V2 permission request.
- Combine effects restrictively: `deny > ask > allow`.
- Preserve an incoming `deny` effect.
- Internal `block` is emitted as V2 effect `deny`.
- Malformed state or evaluator failure denies potentially mutating work.
- A structured material decision is accepted only from explicit permission metadata and is evaluated by the existing execution-gate path.

## Install, Preview, and Remove

- `install`: preflight ownership and runtime target, then create/update the wrapper.
- `--dry-run`: report `CREATE`, `UPDATE`, `UNCHANGED`, or `CONFLICT`; write nothing.
- `--remove`: remove only a marked wrapper; refuse a conflict; clean only empty directories.
- No operation creates or edits `opencode.json`, instruction files, `AGENTS.md`, or `.changebudget/**`.

## Update Refresh

The updater recognizes only `ABSENT`, `MANAGED_CURRENT`, `MANAGED_STALE`, and `CONFLICT` for the native wrapper. Only `MANAGED_STALE` is refreshed automatically. There are no legacy, partial, unknown-profile, or version-detection integration states.
