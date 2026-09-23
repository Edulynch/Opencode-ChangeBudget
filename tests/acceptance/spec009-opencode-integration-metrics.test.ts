import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

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

interface AcceptanceMetric {
  criterion: string;
  requirement: string;
  observed: string;
  result: 'PASS' | 'FAIL';
  evidence: string;
}

const metricsPath = join(process.cwd(), 'specs', '009-opencode-integration', 'acceptance-metrics.md');
const changeBudgetRoot = resolveChangeBudgetRoot();
const expectedWrapper = generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot));
const metrics: AcceptanceMetric[] = [];

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-spec009-v2-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'acceptance test']);
  git(root, ['config', 'user.email', 'acceptance@test']);
  await writeFile(join(root, 'AGENTS.md'), 'user-owned\n');
  await writeFile(join(root, 'opencode.json'), '{"theme":"dark"}\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'seed']);
  return root;
}

async function writeRelative(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

function pass(criterion: string, requirement: string, observed: string, evidence: string): void {
  metrics.push({ criterion, requirement, observed, result: 'PASS', evidence });
}

function markdown(): string {
  const lines = [
    '# SPEC-009 Acceptance Metrics',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| SC | Requirement | Observed | Result | Evidence |',
    '| --- | --- | --- | --- | --- |',
    ...metrics.map((metric) => `| ${metric.criterion} | ${metric.requirement} | ${metric.observed} | ${metric.result} | ${metric.evidence} |`),
  ];
  return `${lines.join('\n')}\n`;
}

after(async () => {
  if (process.env.UPDATE_ACCEPTANCE_METRICS === '1') await writeFile(metricsPath, markdown(), 'utf8');
});

test('SPEC-009 prereq: compiled V2 plugin entry exists', () => {
  assert.equal(existsSync(resolveRuntimeGuardEntry(changeBudgetRoot)), true);
});

test('SC-001: repeated integration is byte-identical and reports UNCHANGED', async () => {
  const root = await repo();
  try {
    const first = await installIntegration(root, changeBudgetRoot);
    const before = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const second = await installIntegration(root, changeBudgetRoot);
    const after = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    assert.equal(first.resources.pluginWrapper.action, 'CREATE');
    assert.equal(second.resources.pluginWrapper.action, 'UNCHANGED');
    assert.equal(after, before);
    pass('SC-001', 'The native V2 integration is idempotent.', 'CREATE then UNCHANGED', 'The single wrapper remained byte-identical.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SC-002: install preserves unrelated project OpenCode and guidance files', async () => {
  const root = await repo();
  try {
    const config = await readFile(join(root, 'opencode.json'), 'utf8');
    const agents = await readFile(join(root, 'AGENTS.md'), 'utf8');
    await installIntegration(root, changeBudgetRoot);
    assert.equal(await readFile(join(root, 'opencode.json'), 'utf8'), config);
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), agents);
    assert.equal(existsSync(join(root, '.opencode', 'instructions')), false);
    pass('SC-002', 'Only the managed V2 plugin loader is written.', 'Unrelated files unchanged', 'No instruction file or config entry was created.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SC-003: ownership conflict performs zero writes', async () => {
  const root = await repo();
  try {
    const userWrapper = '// user-owned\n';
    await writeRelative(root, MANAGED_RESOURCES.pluginWrapper, userWrapper);
    const result = await installIntegration(root, changeBudgetRoot);
    assert.equal(result.readiness, 'NEEDS_ATTENTION');
    assert.equal(result.resources.pluginWrapper.action, 'CONFLICT');
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), userWrapper);
    pass('SC-003', 'User-owned wrapper content is never overwritten.', 'CONFLICT', 'The wrapper bytes were unchanged.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SC-004: dry-run reports CREATE without mutating the repository', async () => {
  const root = await repo();
  try {
    const result = await dryRunIntegration(root, changeBudgetRoot);
    assert.equal(result.resources.pluginWrapper.action, 'CREATE');
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), false);
    pass('SC-004', 'Dry-run is non-mutating.', 'CREATE, zero files', 'The planned wrapper was not written.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SC-005: stale wrapper repair updates only the wrapper URL', async () => {
  const root = await repo();
  try {
    await writeRelative(root, MANAGED_RESOURCES.pluginWrapper, `${WRAPPER_MARKER}\nexport { default } from "file:///old.js";\n`);
    const beforeConfig = await readFile(join(root, 'opencode.json'), 'utf8');
    const result = await installIntegration(root, changeBudgetRoot);
    assert.equal(result.resources.pluginWrapper.action, 'UPDATE');
    assert.equal(await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8'), expectedWrapper);
    assert.equal(await readFile(join(root, 'opencode.json'), 'utf8'), beforeConfig);
    pass('SC-005', 'Stale V2 loader URLs are repaired.', 'UPDATE', 'Only the wrapper received the current file URL.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SC-006: removal deletes only owned resources and is idempotent', async () => {
  const root = await repo();
  try {
    await installIntegration(root, changeBudgetRoot);
    const first = await removeIntegration(root);
    const second = await removeIntegration(root);
    assert.equal(first.resources.pluginWrapper.action, 'REMOVE');
    assert.equal(second.resources.pluginWrapper.action, 'ABSENT');
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), false);
    assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), 'user-owned\n');
    pass('SC-006', 'Removal is ownership-safe and idempotent.', 'REMOVE then ABSENT', 'User guidance remained unchanged.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('SC-007: generated file URL resolves to the compiled V2 entry', async () => {
  const root = await repo();
  try {
    await installIntegration(root, changeBudgetRoot);
    const content = await readFile(join(root, MANAGED_RESOURCES.pluginWrapper), 'utf8');
    const url = content.match(/from\s+"([^"]+)"/)?.[1];
    assert.ok(url?.startsWith('file://'));
    assert.equal(fileURLToPath(url!), resolveRuntimeGuardEntry(changeBudgetRoot));
    pass('SC-007', 'The generated loader URL is platform-safe.', 'file URL round-trip', 'Node decoded the wrapper URL to the compiled entry.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
