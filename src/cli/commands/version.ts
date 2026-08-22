import { stdout } from 'node:process';

import { getInstalledVersion } from '../../core/package-root.js';

/**
 * Run `changebudget --version`.
 *
 * Prints only the installed ChangeBudget version string and exits 0 on success.
 * The version is read exclusively from ChangeBudget's own package.json via
 * `getInstalledVersion()`, never from a user project's package.json.
 *
 * @throws InputValidationError when the version cannot be determined.
 */
export function runVersion(): void {
  const version = getInstalledVersion();
  stdout.write(`${version}\n`);
}