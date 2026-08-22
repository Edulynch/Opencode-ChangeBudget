# Installation Contract

## Public command

For a validated immutable stable tag, the intended corrective release `v1.1.3` command is:

```text
npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z
```

Compatibility is Node.js 20+ and npm `>=11.9 <12`. npm versions before 11.9 are outside the validated contract because `--allow-git` is unavailable. npm 12 is unverified and outside SPEC-011 until separately validated.

The `v1.1.0` defective release, the v1.1.1 missing-`--install-links=true` incident, and the v1.1.2 HTTPS smoke evidence remain immutable historical context. The v1.1.3 corrective release is intended but is not created as part of implementation.

The tag must match `vMAJOR.MINOR.PATCH`, and the tag's package version must match the tag without `v`.

The command is the complete installation contract. It must succeed with scripts disabled; no `prepare`, `install`, `postinstall`, TypeScript compiler, or development dependency may be required on the user's machine.

## Required installed behavior

With lifecycle scripts disabled, the installed package must:

- execute `changebudget --version` and report the package version;
- execute `changebudget --help`;
- contain `dist/src/cli/index.js` and its required runtime modules;
- contain `opencode-plugin/dist/opencode-plugin/src/index.js` and required Runtime Guard modules;
- execute `changebudget init`; and
- execute `changebudget integrate opencode` without a separate Runtime Guard installation.

The command must not require TypeScript, devDependencies, `prepare`, or any user-machine build.

## Self-update equivalence

For a validated compatible target, `changebudget update` must delegate the equivalent argv:

```text
npm install -g --ignore-scripts --allow-git=all --install-links=true git+https://github.com/Edulynch/Opencode-ChangeBudget.git#vX.Y.Z
```

Same-major selection, major informational behavior, exit codes, project immutability, and platform process rules remain those defined by SPEC-010.

The update command does not automatically run `integrate opencode` and does not mutate `.changebudget/**`, `.opencode/**`, `opencode.json`, `AGENTS.md`, `specs/**`, project source, or Git state.
