# ChangeBudget Quick Start

Install a stable tagged version, then connect ChangeBudget to OpenCode:

```text
npm install -g github:Edulynch/Opencode-ChangeBudget#vX.Y.Z
changebudget init
changebudget integrate opencode
opencode
```

Replace `vX.Y.Z` with the stable tag you intend to install. No separate build
step is required.

SPEC-010 is validated with npm >=8 <12. npm 12 Git dependency and lifecycle
policy changes are outside this release's validated compatibility range.

After integration, describe your coding work normally. OpenCode reads the
ChangeBudget instructions automatically and follows the project's change
contract while you work.

To refresh an existing integration after a compatible update, run this
explicitly from the project directory:

```text
changebudget integrate opencode
```

ChangeBudget does not modify project integration files during self-update.

Useful commands after installation:

```text
changebudget --version
changebudget update --check
changebudget update
```

The update command only installs a newer validated stable tag within the
current major version. A newer major is reported for manual installation.
