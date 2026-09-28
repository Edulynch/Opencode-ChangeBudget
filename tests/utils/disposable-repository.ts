import { rm } from 'node:fs/promises';

export async function removeTestRepository(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
