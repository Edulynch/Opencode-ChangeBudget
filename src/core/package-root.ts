import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InputValidationError } from '../models/errors.js';

/**
 * Resolve the ChangeBudget package root relative to this module's own
 * `import.meta.url`.
 *
 * Exactly four `dirname()` calls from the compiled module's path lead to the
 * repository root. Uses `import.meta.url` (never `process.cwd()`), requires
 * no `.git`, and works with installation paths containing spaces.
 *
 * @returns Absolute path to the ChangeBudget package root.
 */
export function getChangeBudgetRoot(): string {
  const modulePath = fileURLToPath(import.meta.url);
  // Compiled at dist/src/core/package-root.js, exact 4 dirname moves to package root
  return dirname(dirname(dirname(dirname(modulePath))));
}

/**
 * Absolute path to ChangeBudget's own `package.json`, resolved from the package root.
 *
 * @returns Absolute path to `<package-root>/package.json`.
 */
export function getPackageJsonPath(): string {
  return `${getChangeBudgetRoot()}/package.json`;
}

/**
 * Read ChangeBudget's installed version from its own `package.json`.
 *
 * Reads exclusively from ChangeBudget's package root, never from a user project's
 * `package.json` that happens to be the current working directory.
 *
 * @returns The `version` string from ChangeBudget's `package.json`.
 * @throws InputValidationError when package.json cannot be read or the `version`
 *   field is missing or not a usable string.
 */
/**
 * Internal helper to read version from a given package root.
 * Exported for testing purposes only; do **not** use in production code.
 *
 * @internal
 * @param packageRoot - Absolute path to the package root containing package.json.
 * @returns The `version` string from `<packageRoot>/package.json`.
 * @throws InputValidationError on any read/parse/validation failure.
 */
export function readPackageMetadata(packageRoot: string): string {
  const pkgJsonPath = `${packageRoot}/package.json`;

  let content: string;
  try {
    content = readFileSync(pkgJsonPath, 'utf8');
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    throw new InputValidationError(
      `Failed to read package.json at ${pkgJsonPath}: ${nodeError.message}`,
      'INPUT_VALIDATION',
      { path: pkgJsonPath, code: nodeError.code, cause: nodeError.message },
    );
  }

  let pkg: unknown;
  try {
    pkg = JSON.parse(content);
  } catch (error) {
    const parseError = error as Error;
    throw new InputValidationError(
      `ChangeBudget package.json is not valid JSON: ${parseError.message}`,
      'INPUT_VALIDATION',
      { path: pkgJsonPath, cause: parseError.message },
    );
  }

  if (
    pkg === null ||
    typeof pkg !== 'object' ||
    Array.isArray(pkg) ||
    !('version' in pkg)
  ) {
    throw new InputValidationError(
      `ChangeBudget package.json has a missing or invalid "version" field`,
      'INPUT_VALIDATION',
      { path: pkgJsonPath },
    );
  }

  const version = (pkg as { version: unknown }).version;
  if (typeof version !== 'string' || version.trim() === '') {
    throw new InputValidationError(
      `ChangeBudget package.json has a missing or invalid "version" field`,
      'INPUT_VALIDATION',
      { path: pkgJsonPath },
    );
  }

  return version;
}

/**
 * Read ChangeBudget's installed version from its own `package.json`.
 *
 * Reads exclusively from ChangeBudget's package root, never from a user project's
 * `package.json` that happens to be the current working directory.
 *
 * @returns The `version` string from ChangeBudget's `package.json`.
 * @throws InputValidationError when package.json cannot be read or the `version`
 *   field is missing or not a usable string.
 */
export function getInstalledVersion(): string {
  return readPackageMetadata(getChangeBudgetRoot());
}