import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  INSTRUCTIONS_MARKER,
  INSTRUCTIONS_PROFILE_METADATA,
  INTEGRATION_PROFILES,
  MANAGED_RESOURCES,
  discoverManagedIntegration,
  generateInstructionsContent,
  generateMinimalConfigString,
  generateWrapperContent,
  getIntegrationProfile,
  resolveChangeBudgetRoot,
  runtimeGuardFileUrl,
} from '../../src/core/integration/opencode.js';
import { runIntegrate } from '../../src/cli/commands/integrate.js';
import { InputValidationError } from '../../src/models/errors.js';

async function createTempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function writeFileRecursive(root: string, relativePath: string, content: string): Promise<void> {
  const target = join(root, relativePath);
  await mkdir(join(root, relativePath, '..'), { recursive: true });
  await writeFile(target, content, 'utf8');
}

test('integration profiles expose only the exact OpenCode profile', () => {
  assert.deepEqual(INTEGRATION_PROFILES.map((profile) => profile.id), ['opencode']);
  assert.equal(getIntegrationProfile('opencode')?.id, 'opencode');
  assert.equal(getIntegrationProfile('opencode-gpt-ultra'), undefined);
});

test('integrate rejects an unregistered profile target', async () => {
  await assert.rejects(
    () => runIntegrate(process.cwd(), ['opencode-gpt-ultra']),
    (error: unknown) => error instanceof InputValidationError && error.field === 'target',
  );
});

test('managed discovery recognizes current OpenCode metadata and all managed resources', async () => {
  const root = await createTempRoot('cb-profile-current-');
  try {
    const changeBudgetRoot = resolveChangeBudgetRoot();
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, generateInstructionsContent());
    await writeFileRecursive(
      root,
      MANAGED_RESOURCES.pluginWrapper,
      generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
    );
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, generateMinimalConfigString());

    const discovery = await discoverManagedIntegration(root, changeBudgetRoot);

    assert.deepEqual(discovery, { state: 'MANAGED_CURRENT', profileId: 'opencode' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed discovery infers OpenCode from absent profile metadata only after all resources are managed', async () => {
  const root = await createTempRoot('cb-profile-legacy-');
  try {
    const changeBudgetRoot = resolveChangeBudgetRoot();
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, `${INSTRUCTIONS_MARKER}\n# legacy instructions\n`);
    await writeFileRecursive(
      root,
      MANAGED_RESOURCES.pluginWrapper,
      generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
    );
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, generateMinimalConfigString());

    const discovery = await discoverManagedIntegration(root, changeBudgetRoot);

    assert.deepEqual(discovery, { state: 'LEGACY_MANAGED', profileId: 'opencode' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed discovery treats body-only markers and arbitrary .opencode content as unmanaged conflicts', async () => {
  const root = await createTempRoot('cb-profile-ownership-');
  try {
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, `# user instructions\n${INSTRUCTIONS_MARKER}\n`);
    const conflict = await discoverManagedIntegration(root, resolveChangeBudgetRoot());
    assert.deepEqual(conflict, { state: 'CONFLICT' });

    await rm(join(root, '.opencode'), { recursive: true, force: true });
    await writeFileRecursive(root, '.opencode/instructions/user.md', '# user instructions\n');
    const absent = await discoverManagedIntegration(root, resolveChangeBudgetRoot());
    assert.deepEqual(absent, { state: 'ABSENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed discovery fails closed for unknown profile metadata', async () => {
  const root = await createTempRoot('cb-profile-unknown-');
  try {
    const changeBudgetRoot = resolveChangeBudgetRoot();
    await writeFileRecursive(
      root,
      MANAGED_RESOURCES.instructions,
      `${INSTRUCTIONS_MARKER}\n${INSTRUCTIONS_PROFILE_METADATA} opencode-gpt-ultra -->\n# managed instructions\n`,
    );
    await writeFileRecursive(
      root,
      MANAGED_RESOURCES.pluginWrapper,
      generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
    );
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, generateMinimalConfigString());

    const discovery = await discoverManagedIntegration(root, changeBudgetRoot);

    assert.deepEqual(discovery, { state: 'UNKNOWN_PROFILE', profileId: 'opencode-gpt-ultra' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed discovery fails closed for malformed profile metadata', async () => {
  const root = await createTempRoot('cb-profile-malformed-');
  try {
    const changeBudgetRoot = resolveChangeBudgetRoot();
    await writeFileRecursive(
      root,
      MANAGED_RESOURCES.instructions,
      `${INSTRUCTIONS_MARKER}\n${INSTRUCTIONS_PROFILE_METADATA} -->\n# managed instructions\n`,
    );
    await writeFileRecursive(
      root,
      MANAGED_RESOURCES.pluginWrapper,
      generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
    );
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, generateMinimalConfigString());

    const discovery = await discoverManagedIntegration(root, changeBudgetRoot);

    assert.deepEqual(discovery, { state: 'UNKNOWN_PROFILE', profileId: '' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed discovery prioritizes wrapper and config conflicts over legacy or partial states', async () => {
  const root = await createTempRoot('cb-profile-conflict-priority-');
  try {
    const changeBudgetRoot = resolveChangeBudgetRoot();
    await writeFileRecursive(root, MANAGED_RESOURCES.instructions, `${INSTRUCTIONS_MARKER}\n# legacy instructions\n`);
    await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, '// user-owned wrapper\n');
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, '{ invalid json');

    const discovery = await discoverManagedIntegration(root, changeBudgetRoot);

    assert.deepEqual(discovery, { state: 'CONFLICT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('managed discovery reports partial when instructions are missing but remaining resources are owned', async () => {
  const root = await createTempRoot('cb-profile-partial-');
  try {
    const changeBudgetRoot = resolveChangeBudgetRoot();
    await writeFileRecursive(
      root,
      MANAGED_RESOURCES.pluginWrapper,
      generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot)),
    );
    await writeFileRecursive(root, MANAGED_RESOURCES.opencodeConfig, generateMinimalConfigString());

    const discovery = await discoverManagedIntegration(root, changeBudgetRoot);

    assert.deepEqual(discovery, { state: 'PARTIAL', profileId: 'opencode' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
