import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

export async function createTestFixtureDirectory(base: string, prefix: string): Promise<string> {
  await mkdir(base, { recursive: true });
  return mkdtemp(join(base, prefix));
}

export async function removeTestRepository(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
