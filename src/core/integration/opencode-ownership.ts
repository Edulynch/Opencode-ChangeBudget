import { readFile } from 'node:fs/promises';

import type { OwnershipState } from './opencode-types.js';

/** Classify a file's ownership state from its exact first line and content. */
export async function detectOwnership(
  filePath: string,
  expectedMarker: string,
  expectedContent: string,
): Promise<OwnershipState> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'MISSING';
    }
    throw error;
  }

  const firstLine = content.split('\n', 1)[0] ?? '';
  if (firstLine !== expectedMarker) {
    return 'CONFLICT';
  }

  return content === expectedContent ? 'MANAGED_CURRENT' : 'MANAGED_STALE';
}

/** Classify a file's ownership state for removal using its exact first line. */
export async function detectOwnershipForRemoval(
  filePath: string,
  expectedMarker: string,
): Promise<OwnershipState> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return 'MISSING';
    }
    throw error;
  }

  const firstLine = content.split('\n', 1)[0] ?? '';
  return firstLine === expectedMarker ? 'MANAGED_CURRENT' : 'CONFLICT';
}
