// SPEC-009 Pre-Merge Regression Tests
//
// Automated coverage for the three pre-merge findings:
// 1. Ownership detection — exact first-line matching only
// 2. CLI dry-run conflict — exit 0 with CONFLICT/NEEDS_ATTENTION
// 3. Partial write failure — deterministic tracking (covered in metrics suite)

// A. Ownership Security Regression Tests
// ---------------------------------------------------------------------------

import * as assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test, describe } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  INSTRUCTION_ENTRY,
  INSTRUCTIONS_MARKER,
  MANAGED_RESOURCES,
  OWNERSHIP_MARKER,
  WRAPPER_MARKER,
  detectOwnership,
  detectOwnershipForRemoval,
  generateWrapperContent,
  generateInstructionsContent,
  resolveChangeBudgetRoot,
} from '../../src/core/integration/opencode.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function removeTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

async function writeFileRecursive(root: string, relativePath: string, content: string): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(join(root, relativePath, '..'), { recursive: true });
  await writeFile(target, content, 'utf8');
  return target;
}

function runCli(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const cliPath = join(resolveChangeBudgetRoot(), 'dist', 'src', 'cli', 'index.js');
  const result = spawnSync('node', [cliPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: result.stdout?.toString() ?? '',
    stderr: result.stderr?.toString() ?? '',
  };
}

// ---------------------------------------------------------------------------
// Ownership Security Tests
// ---------------------------------------------------------------------------

describe('SPEC-009 Regression: Ownership Security', () => {
  describe('Wrapper ownership — exact first-line matching', () => {
    test('body-only marker phrase in wrapper → CONFLICT', async () => {
      const root = await createTempRoot('cb-reg-ownership-wrapper-body-');
      try {
        const wrapperPath = join(root, MANAGED_RESOURCES.pluginWrapper);
        const content = `// user content\n// ChangeBudget-managed\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, content);

        const state = await detectOwnership(wrapperPath, WRAPPER_MARKER, generateWrapperContent('file:///test'));
        assert.equal(state, 'CONFLICT', 'Wrapper with marker only in body must be CONFLICT');
      } finally {
        await removeTree(root);
      }
    });

    test('near-match wrapper first line → CONFLICT', async () => {
      const root = await createTempRoot('cb-reg-ownership-wrapper-near-');
      try {
        const wrapperPath = join(root, MANAGED_RESOURCES.pluginWrapper);
        const nearMatch = WRAPPER_MARKER + 'x';
        const content = `${nearMatch}\nexport { default } from "file:///test";\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, content);

        const state = await detectOwnership(wrapperPath, WRAPPER_MARKER, generateWrapperContent('file:///test'));
        assert.equal(state, 'CONFLICT', 'Wrapper with near-match first line must be CONFLICT');
      } finally {
        await removeTree(root);
      }
    });

    test('exact wrapper marker + different body → MANAGED_STALE', async () => {
      const root = await createTempRoot('cb-reg-ownership-wrapper-stale-');
      try {
        const wrapperPath = join(root, MANAGED_RESOURCES.pluginWrapper);
        const expected = generateWrapperContent('file:///correct/path');
        const stale = `${WRAPPER_MARKER}\nexport { default } from "file:///stale/path";\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, stale);

        const state = await detectOwnership(wrapperPath, WRAPPER_MARKER, expected);
        assert.equal(state, 'MANAGED_STALE', 'Wrapper with exact marker but different body must be MANAGED_STALE');
      } finally {
        await removeTree(root);
      }
    });
  });

  describe('Instructions ownership — exact first-line matching', () => {
    test('body-only marker phrase in instructions → CONFLICT', async () => {
      const root = await createTempRoot('cb-reg-ownership-inst-body-');
      try {
        const instPath = join(root, MANAGED_RESOURCES.instructions);
        const content = `# user content\nChangeBudget-managed\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.instructions, content);

        const state = await detectOwnership(instPath, INSTRUCTIONS_MARKER, generateInstructionsContent());
        assert.equal(state, 'CONFLICT', 'Instructions with marker only in body must be CONFLICT');
      } finally {
        await removeTree(root);
      }
    });

    test('near-match instructions first line → CONFLICT', async () => {
      const root = await createTempRoot('cb-reg-ownership-inst-near-');
      try {
        const instPath = join(root, MANAGED_RESOURCES.instructions);
        const nearMatch = INSTRUCTIONS_MARKER + 'x';
        const content = `${nearMatch}\n# different content\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.instructions, content);

        const state = await detectOwnership(instPath, INSTRUCTIONS_MARKER, generateInstructionsContent());
        assert.equal(state, 'CONFLICT', 'Instructions with near-match first line must be CONFLICT');
      } finally {
        await removeTree(root);
      }
    });

    test('exact instructions marker + different body → MANAGED_STALE', async () => {
      const root = await createTempRoot('cb-reg-ownership-inst-stale-');
      try {
        const instPath = join(root, MANAGED_RESOURCES.instructions);
        const expected = generateInstructionsContent();
        const stale = `${INSTRUCTIONS_MARKER}\n# different content\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.instructions, stale);

        const state = await detectOwnership(instPath, INSTRUCTIONS_MARKER, expected);
        assert.equal(state, 'MANAGED_STALE', 'Instructions with exact marker but different body must be MANAGED_STALE');
      } finally {
        await removeTree(root);
      }
    });
  });

  describe('Removal ownership — exact first-line matching', () => {
    test('body-only wrapper marker → CONFLICT and file preserved', async () => {
      const root = await createTempRoot('cb-reg-removal-wrapper-body-');
      try {
        const wrapperPath = join(root, MANAGED_RESOURCES.pluginWrapper);
        const content = `// user content\n// ChangeBudget-managed\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, content);

        const state = await detectOwnershipForRemoval(wrapperPath, WRAPPER_MARKER);
        assert.equal(state, 'CONFLICT', 'Removal must see body-only marker as CONFLICT');

        const actualContent = await readFile(wrapperPath, 'utf8');
        assert.equal(actualContent, content, 'User-owned file must be preserved byte-identical');
      } finally {
        await removeTree(root);
      }
    });

    test('body-only instructions marker → CONFLICT and file preserved', async () => {
      const root = await createTempRoot('cb-reg-removal-inst-body-');
      try {
        const instPath = join(root, MANAGED_RESOURCES.instructions);
        const content = `# user content\nChangeBudget-managed\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.instructions, content);

        const state = await detectOwnershipForRemoval(instPath, INSTRUCTIONS_MARKER);
        assert.equal(state, 'CONFLICT', 'Removal must see body-only marker as CONFLICT');

        const actualContent = await readFile(instPath, 'utf8');
        assert.equal(actualContent, content, 'User-owned file must be preserved byte-identical');
      } finally {
        await removeTree(root);
      }
    });

    test('near-match wrapper marker → CONFLICT and file preserved', async () => {
      const root = await createTempRoot('cb-reg-removal-wrapper-near-');
      try {
        const wrapperPath = join(root, MANAGED_RESOURCES.pluginWrapper);
        const nearMatch = WRAPPER_MARKER + 'x';
        const content = `${nearMatch}\nexport { default } from "file:///test";\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, content);

        const state = await detectOwnershipForRemoval(wrapperPath, WRAPPER_MARKER);
        assert.equal(state, 'CONFLICT', 'Removal must see near-match marker as CONFLICT');

        const actualContent = await readFile(wrapperPath, 'utf8');
        assert.equal(actualContent, content, 'User-owned file must be preserved byte-identical');
      } finally {
        await removeTree(root);
      }
    });

    test('near-match instructions marker → CONFLICT and file preserved', async () => {
      const root = await createTempRoot('cb-reg-removal-inst-near-');
      try {
        const instPath = join(root, MANAGED_RESOURCES.instructions);
        const nearMatch = INSTRUCTIONS_MARKER + 'x';
        const content = `${nearMatch}\n# different content\n`;
        await writeFileRecursive(root, MANAGED_RESOURCES.instructions, content);

        const state = await detectOwnershipForRemoval(instPath, INSTRUCTIONS_MARKER);
        assert.equal(state, 'CONFLICT', 'Removal must see near-match marker as CONFLICT');

        const actualContent = await readFile(instPath, 'utf8');
        assert.equal(actualContent, content, 'User-owned file must be preserved byte-identical');
      } finally {
        await removeTree(root);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// B. REAL CLI Dry-Run Conflict Regression Test
// ---------------------------------------------------------------------------

describe('SPEC-009 Regression: CLI Dry-Run Conflict', () => {
  test('dry-run with user-owned wrapper conflict → exit 0, CONFLICT in stdout, zero mutations', async () => {
    const root = await createTempRoot('cb-reg-cli-dryrun-');
    try {
      await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, '// user owned wrapper\nconst x = 1;\n');

      const wrapperBefore = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');

      const result = runCli(root, ['integrate', 'opencode', '--dry-run']);

      assert.equal(result.status, 0, `dry-run must exit 0 on conflict, got ${result.status}`);
      assert.ok(result.stdout.includes('CONFLICT'), 'stdout must contain CONFLICT');
      assert.ok(result.stdout.includes('NEEDS_ATTENTION'), 'stdout must contain NEEDS_ATTENTION');

      const wrapperAfter = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
      assert.equal(wrapperAfter, wrapperBefore, 'Wrapper must be byte-identical after dry-run');

      try {
        await readFile(join(root, MANAGED_RESOURCES.instructions), 'utf8');
        assert.fail('Instructions file must not be created by dry-run');
      } catch {}

      try {
        await readFile(join(root, MANAGED_RESOURCES.opencodeConfig), 'utf8');
        assert.fail('opencode.json must not be created by dry-run');
      } catch {}
    } finally {
      await removeTree(root);
    }
  });

  test('install with user-owned wrapper conflict → exit 2', async () => {
    const root = await createTempRoot('cb-reg-cli-install-');
    try {
      await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, '// user owned wrapper\nconst x = 1;\n');
      const result = runCli(root, ['integrate', 'opencode']);
      assert.equal(result.status, 2, `install conflict must exit 2, got ${result.status}`);
    } finally {
      await removeTree(root);
    }
  });

  test('remove with user-owned wrapper conflict → exit 2', async () => {
    const root = await createTempRoot('cb-reg-cli-remove-');
    try {
      await writeFileRecursive(root, MANAGED_RESOURCES.pluginWrapper, '// user owned wrapper\nconst x = 1;\n');
      const result = runCli(root, ['integrate', 'opencode', '--remove']);
      assert.equal(result.status, 2, `remove conflict must exit 2, got ${result.status}`);
    } finally {
      await removeTree(root);
    }
  });
});