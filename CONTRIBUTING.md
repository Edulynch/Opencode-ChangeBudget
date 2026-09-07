# Contributing to ChangeBudget

Thanks for helping improve ChangeBudget. Keep changes focused on the stated
problem and consistent with the project's local-first, deterministic design.

## Before You Start

1. Read the [README](README.md) and the [roadmap](ChangeBudget_Roadmap.md).
2. For security concerns, follow [SECURITY.md](SECURITY.md) instead of opening
   a public issue with sensitive details.
3. Check existing issues and pull requests before starting duplicate work.

## Development Setup

Requirements are Node.js 20 or newer, Git, and npm.

```bash
npm install
npm run build
npm run typecheck
npm test
```

Run the relevant checks after each focused change. Keep generated files and
unrelated cleanup out of the pull request.

## Pull Requests

Describe the problem, the approach, and the validation you ran. Include
examples or reproduction steps when they clarify behavior. Keep the pull
request small enough to review, and update documentation when user-visible
behavior changes.

Before requesting review, confirm that:

- the change stays within its stated scope;
- tests and type checks pass;
- the README or other documentation is updated when needed;
- no secrets, credentials, or unrelated files are included.

## Code of Conduct

Participation in this project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
