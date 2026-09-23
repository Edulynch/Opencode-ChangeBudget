import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  MANAGED_RESOURCES,
  WRAPPER_MARKER,
  dryRunIntegration,
  generateWrapperContent,
  installIntegration,
  removeIntegration,
  resolveChangeBudgetRoot,
  resolveRuntimeGuardEntry,
  runtimeGuardFileUrl,
} from '../../src/core/integration/opencode.js';

const changeBudgetRoot = resolveChangeBudgetRoot();
const expectedWrapper = generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot));

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function disposableRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-v2-integration-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'integration test']);
  git(root, ['config', 'user.email', 'integration@test']);
  git(root, ['commit', '--allow-empty', '-m', 'seed']);
  return root;
}

async function writeRelative(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

function cli(root: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), 'integrate', 'opencode', ...args],
    { cwd: root, encoding: 'utf8' },
  );
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('install creates only the managed V2 wrapper and preserves user OpenCode files', async () => {
  const root = await disposableRepo();
  try {
    const userConfig = '{\n  "theme": "dark"\n}\n';
    await writeRelative(root, 'opencode.json', userConfig);
    const result = await installIntegration(root, changeBudgetRoot);

    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.pluginWrapper.action, 'CREATE');
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), expectedWrapper);
    assert.equal(await readFile(join(root, 'opencode.json'), 'utf8'), userConfig);
    assert.equal(existsSync(join(root, '.opencode', 'instructions', 'changebudget.md')), false);
  } finally {
    await cleanup(root);
  }
});

test('install is idempotent and updates only a stale marked wrapper', async () => {
  const root = await disposableRepo();
  try {
    await installIntegration(root, changeBudgetRoot);
    const config = '{"permissions": []}\n';
    await writeRelative(root, 'opencode.json', config);
    const second = await installIntegration(root, changeBudgetRoot);
    assert.equal(second.resources.pluginWrapper.action, 'UNCHANGED');
    assert.equal(await readFile(join(root, 'opencode.json'), 'utf8'), config);

    await writeFile(
      join(root, MANAGED_RESOURCES.pluginWrapper),
      `${WRAPPER_MARKER}\nexport { default } from "file:///old/runtime.js";\n`,
      'utf8',
    );
    const repaired = await installIntegration(root, changeBudgetRoot);
    assert.equal(repaired.resources.pluginWrapper.action, 'UPDATE');
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), expectedWrapper);
    assert.equal(await readFile(join(root, 'opencode.json'), 'utf8'), config);
  } finally {
    await cleanup(root);
  }
});

test('install refuses a user-owned wrapper without changing it', async () => {
  const root = await disposableRepo();
  try {
    const userContent = '// user-owned plugin\n';
    await writeRelative(root, MANAGED_RESOURCES.pluginWrapper, userContent);
    const result = await installIntegration(root, changeBudgetRoot);
    assert.equal(result.readiness, 'NEEDS_ATTENTION');
    assert.equal(result.resources.pluginWrapper.action, 'CONFLICT');
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), userContent);
  } finally {
    await cleanup(root);
  }
});

test('dry-run reports the wrapper action and writes nothing', async () => {
  const root = await disposableRepo();
  try {
    const result = await dryRunIntegration(root, changeBudgetRoot);
    assert.equal(result.operation, 'dry-run');
    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.pluginWrapper.action, 'CREATE');
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), false);
  } finally {
    await cleanup(root);
  }
});

test('remove deletes only the managed wrapper and preserves unrelated files', async () => {
  const root = await disposableRepo();
  try {
    await installIntegration(root, changeBudgetRoot);
    const userConfig = '{"theme":"light"}\n';
    await writeRelative(root, 'opencode.json', userConfig);
    const result = await removeIntegration(root);
    assert.equal(result.readiness, 'READY');
    assert.equal(result.resources.pluginWrapper.action, 'REMOVE');
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), false);
    assert.equal(await readFile(join(root, 'opencode.json'), 'utf8'), userConfig);

    const second = await removeIntegration(root);
    assert.equal(second.resources.pluginWrapper.action, 'ABSENT');
  } finally {
    await cleanup(root);
  }
});

test('remove refuses a user-owned wrapper', async () => {
  const root = await disposableRepo();
  try {
    const userContent = '// user-owned plugin\n';
    await writeRelative(root, MANAGED_RESOURCES.pluginWrapper, userContent);
    const result = await removeIntegration(root);
    assert.equal(result.readiness, 'NEEDS_ATTENTION');
    assert.equal(result.resources.pluginWrapper.action, 'CONFLICT');
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), userContent);
  } finally {
    await cleanup(root);
  }
});

test('install reports the missing compiled plugin without writing', async () => {
  const root = await disposableRepo();
  try {
    const result = await installIntegration(root, join(tmpdir(), 'cb-v2-no-runtime'));
    assert.equal(result.readiness, 'NEEDS_ATTENTION');
    assert.equal(result.runtimeGuardTargetExists, false);
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), false);
  } finally {
    await cleanup(root);
  }
});

test('git baseline warning appears for an untracked wrapper and disappears after commit', async () => {
  const root = await disposableRepo();
  try {
    const first = await installIntegration(root, changeBudgetRoot);
    assert.ok(first.baselineWarning?.includes('Commit/baseline'));
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline wrapper']);
    const second = await installIntegration(root, changeBudgetRoot);
    assert.equal(second.baselineWarning, null);
  } finally {
    await cleanup(root);
  }
});

test('CLI renders the native V2 wrapper resource and rejects mixed flags', async () => {
  const root = await disposableRepo();
  try {
    const install = cli(root, []);
    assert.equal(install.status, 0, install.stderr);
    assert.match(install.stdout, /Plugin wrapper: CREATE \.opencode\/plugins\/changebudget\.js/);
    assert.doesNotMatch(install.stdout, /Instructions|OpenCode config/);

    const mixed = cli(root, ['--dry-run', '--remove']);
    assert.equal(mixed.status, 2);
    assert.match(mixed.stderr, /cannot be combined/);
  } finally {
    await cleanup(root);
  }
});

test('generated wrapper URL resolves to the compiled V2 plugin entry', async () => {
  const root = await disposableRepo();
  try {
    await installIntegration(root, changeBudgetRoot);
    const wrapper = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const url = wrapper.match(/from\s+"([^"]+)"/)?.[1];
    assert.ok(url?.startsWith('file://'));
    assert.equal(fileURLToPath(url!), resolveRuntimeGuardEntry(changeBudgetRoot));
  } finally {
    await cleanup(root);
  }
});

test('AGENTS.md remains byte-identical across install, dry-run, and remove', async () => {
  const root = await disposableRepo();
  try {
    const content = '# User-owned guidance\n';
    await writeRelative(root, 'AGENTS.md', content);
    const before = await readFile(join(root, 'AGENTS.md'), 'utf8');
    await installIntegration(root, changeBudgetRoot);
    await dryRunIntegration(root, changeBudgetRoot);
    await removeIntegration(root);
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), before);
  } finally {
    await cleanup(root);
  }
});
