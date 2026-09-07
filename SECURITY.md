# Security Policy

## Supported Release Line

The currently supported release line is `v1.2.x`.

## Reporting a Vulnerability

Until GitHub Private Vulnerability Reporting is enabled for this repository,
use an appropriate GitHub-supported private channel if one is available. This
policy does not publish a personal email address. Do not include secrets,
exploit details, or other sensitive information in a public issue.

Please provide the affected version or commit, the impact, reproduction steps,
and any details needed to validate the report. Reports are reviewed as soon as
practical, and follow-up may request additional information.

## Scope

Security reports should focus on vulnerabilities in ChangeBudget itself,
including its CLI, Git inspection, local state handling, and OpenCode
integration. Relevant examples include:

- protected or denied path bypass;
- Runtime Guard escape or bypass;
- command or process injection;
- credential leakage;
- unintended destructive file operations;
- update or tag integrity bypass;
- unsafe repository mutation.

Avoid reporting expected behavior or vulnerabilities in unrelated third-party
services through this process.
