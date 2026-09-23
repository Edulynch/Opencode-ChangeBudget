import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import {
  MANAGED_RESOURCES,
  installIntegration,
  resolveChangeBudgetRoot,
} from '../../src/core/integration/opencode.js';
import { RUNTIME_RULES } from '../../opencode-plugin/src/projection.js';

type Hook = (event: any) => Promise<void> | void;

interface HookContext {
  readonly contextHook: Hook;
  readonly permissionHook: Hook;
}

interface V2Plugin {
  readonly id: string;
  readonly setup: (context: unknown) => Promise<(() => Promise<void> | void) | void>;
}

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function cli(root: string, args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), ...args],
    { cwd: root, encoding: 'utf8' },
  );
  return { status: result.status, stderr: result.stderr ?? '' };
}

async function repo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-v2-runtime-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'runtime test']);
  git(root, ['config', 'user.email', 'runtime@test']);
  git(root, ['commit', '--allow-empty', '-m', 'seed']);
  return root;
}

async function loadInstalledPlugin(root: string): Promise<{ plugin: V2Plugin; hooks: HookContext }> {
  const moduleUrl = pathToFileURL(join(root, MANAGED_RESOURCES.pluginWrapper)).href;
  const module = (await import(moduleUrl)) as { default: V2Plugin };
  let contextHook: Hook | undefined;
  let permissionHook: Hook | undefined;
  const context = {
    location: { directory: root },
    session: {
      hook: async (name: string, callback: Hook) => {
        assert.equal(name, 'context');
        contextHook = callback;
        return { dispose: async () => undefined };
      },
    },
    permission: {
      hook: async (name: string, callback: Hook) => {
        assert.equal(name, 'evaluate');
        permissionHook = callback;
        return { dispose: async () => undefined };
      },
    },
  };
  await module.default.setup(context);
  assert.ok(contextHook);
  assert.ok(permissionHook);
  return { plugin: module.default, hooks: { contextHook: contextHook!, permissionHook: permissionHook! } };
}

async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

test('the installed wrapper loads a native V2 plugin with the expected hook registrations', async () => {
  const root = await repo();
  try {
    const result = await installIntegration(root, resolveChangeBudgetRoot());
    assert.equal(result.readiness, 'READY');
    assert.equal(existsSync(join(root, MANAGED_RESOURCES.pluginWrapper)), true);
    const loaded = await loadInstalledPlugin(root);
    assert.equal(loaded.plugin.id, 'changebudget');
  } finally {
    await cleanup(root);
  }
});

test('session.context injects ChangeBudget instructions once per model request', async () => {
  const root = await repo();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { hooks } = await loadInstalledPlugin(root);
    const event = { system: [] as Array<{ type: string; text: string }> };
    await hooks.contextHook(event);
    await hooks.contextHook(event);
    assert.equal(event.system.length, 1);
    assert.match(event.system[0]!.text, /ChangeBudget is the scope authority/);
    assert.match(event.system[0]!.text, /changebudget check/);
  } finally {
    await cleanup(root);
  }
});

test('permission.evaluate allows an edit in passive mode', async () => {
  const root = await repo();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { hooks } = await loadInstalledPlugin(root);
    const event = {
      sessionID: 'session-passive',
      action: 'edit',
      resources: ['src/app.ts'],
      effect: 'allow' as const,
      metadata: {},
    };
    await hooks.permissionHook(event);
    assert.equal(event.effect, 'allow');
  } finally {
    await cleanup(root);
  }
});

test('permission.evaluate aggregates every V2 shell resource restrictively', async () => {
  const root = await repo();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    assert.equal(cli(root, ['init']).status, 0);
    const { hooks } = await loadInstalledPlugin(root);
    const event = {
      sessionID: 'session-resources',
      action: 'shell',
      resources: ['git status', 'git commit -am change'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hooks.permissionHook(event);
    assert.equal(event.effect, 'deny');
    assert.match(event.message ?? '', new RegExp(RUNTIME_RULES.UNRESOLVED_MUTATION));
  } finally {
    await cleanup(root);
  }
});

test('permission.evaluate never weakens an existing deny effect', async () => {
  const root = await repo();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { hooks } = await loadInstalledPlugin(root);
    const event = {
      sessionID: 'session-deny',
      action: 'read',
      resources: ['README.md'],
      effect: 'deny' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hooks.permissionHook(event);
    assert.equal(event.effect, 'deny');
  } finally {
    await cleanup(root);
  }
});

test('permission.evaluate degrades malformed lifecycle state to a safe denial', async () => {
  const root = await repo();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    await mkdir(join(root, '.changebudget'), { recursive: true });
    await writeFile(join(root, '.changebudget', 'state.json'), '{ invalid state', 'utf8');
    const { hooks } = await loadInstalledPlugin(root);
    const event = {
      sessionID: 'session-corrupt',
      action: 'edit',
      resources: ['src/app.ts'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hooks.permissionHook(event);
    assert.equal(event.effect, 'deny');
    assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/);
  } finally {
    await cleanup(root);
  }
});
