import { access, constants as fsConstants } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Resolve the ChangeBudget repository root from this compiled module's URL. */
export function resolveChangeBudgetRoot(): string {
  const modulePath = fileURLToPath(import.meta.url);
  return dirname(dirname(dirname(dirname(dirname(modulePath)))));
}

/** Absolute path to the compiled Runtime Guard entrypoint. */
export function resolveRuntimeGuardEntry(root: string): string {
  return join(root, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js');
}

/** `file://` URL for the compiled Runtime Guard entrypoint (Windows-safe). */
export function runtimeGuardFileUrl(root: string): string {
  return pathToFileURL(resolveRuntimeGuardEntry(root)).href;
}

/** Whether the compiled Runtime Guard entrypoint exists on disk. */
export async function runtimeGuardTargetExists(root: string): Promise<boolean> {
  try {
    await access(resolveRuntimeGuardEntry(root), fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}
