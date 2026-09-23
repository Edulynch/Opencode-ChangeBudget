import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { RUNTIME_RULES, projectRuntimeDecision } from '../../opencode-plugin/src/projection.js';
import { installIntegration, MANAGED_RESOURCES, resolveChangeBudgetRoot } from '../../src/core/integration/opencode.js';

type Hook = (event: any) => Promise<void> | void;

interface PluginModule {
  readonly default: {
    readonly id: string;
    readonly setup: (context: unknown) => Promise<unknown>;
  };
}

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function cli(root: string, args: string[]): void {
  const result = spawnSync(
    process.execPath,
    [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), ...args],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
}

async function repository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-v2-plugin-'));
  git(root, ['init']);
  git(root, ['config', 'user.name', 'plugin test']);
  git(root, ['config', 'user.email', 'plugin@test']);
  git(root, ['commit', '--allow-empty', '-m', 'seed']);
  return root;
}

async function loadEvaluateHook(root: string): Promise<{ plugin: PluginModule['default']; hook: Hook }> {
  const url = pathToFileURL(join(root, MANAGED_RESOURCES.pluginWrapper)).href;
  const module = (await import(url)) as PluginModule;
  let hook: Hook | undefined;
  await module.default.setup({
    location: { directory: root },
    session: {
      hook: async (_name: string, _callback: Hook) => ({ dispose: async () => undefined }),
    },
    permission: {
      hook: async (_name: string, callback: Hook) => {
        hook = callback;
        return { dispose: async () => undefined };
      },
    },
  });
  assert.ok(hook);
  return { plugin: module.default, hook: hook! };
}

test('V2 plugin exports the native id and no legacy hook adapter', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { plugin } = await loadEvaluateHook(root);
    assert.equal(plugin.id, 'changebudget');
    assert.equal('server' in plugin, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('V2 permission evaluation accepts normal metadata without inventing a decision', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    const { hook } = await loadEvaluateHook(root);
    const event = {
      sessionID: 'ordinary',
      action: 'edit',
      resources: ['src/app.ts'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(event);
    assert.equal(event.effect, 'allow');
    assert.equal(event.message, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('V2 permission evaluation rejects malformed material-decision metadata safely', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    await mkdir(join(root, '.changebudget'), { recursive: true });
    await writeFile(
      join(root, '.changebudget', 'state.json'),
      JSON.stringify({
        schema_version: '1',
        lifecycle_state: 'initialized',
        active_contract_id: null,
        last_closed_contract_id: null,
        updated_at: new Date().toISOString(),
      }),
      'utf8',
    );
    const { hook } = await loadEvaluateHook(root);
    const event = {
      sessionID: 'malformed-proposal',
      action: 'edit',
      resources: ['src/app.ts'],
      effect: 'allow' as const,
      metadata: { materialDecision: { kind: 'scope_expansion' } },
      message: undefined as string | undefined,
    };
    await hook(event);
    assert.equal(event.effect, 'deny');
    assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('projection keeps V2 permission status mapping explicit', () => {
  const result = projectRuntimeDecision({
    policyDecision: 'PASS',
    mutationIntent: 'mutate',
    targetPath: null,
    isInited: true,
    isPathDenied: false,
    isPathNotAllowed: false,
    isSensitive: { dependencies: false, migrations: false, config: false, publicApi: false },
    newFileDenied: false,
    targetInChangeBudget: false,
    isTargetResolved: false,
  });
  assert.equal(result.runtimeAction, 'block');
  assert.equal(result.reasonCode, RUNTIME_RULES.UNRESOLVED_MUTATION);
});

test('V2 permission evaluation classifies Git inspection, mutation, and wrapped commands safely', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    const { hook } = await loadEvaluateHook(root);

    const readOnlyCommands = [
      'git status',
      'git status --short',
      'git status --porcelain=v1',
      'git status --untracked-files=all',
      'git status --short --untracked-files=all .opencode opencode.jsonc',
      'git status --short --ignored=matching --untracked-files=all .opencode opencode.jsonc',
      'git ls-files',
      'git ls-files .opencode',
      'git ls-files --others --exclude-standard',
      'git check-ignore .opencode/foo',
      'git check-ignore -v .opencode/foo',
      'git check-ignore --stdin',
      'git diff',
      'git diff --name-only',
      'git diff -- .opencode/foo',
      'git show HEAD:file',
      'git log --oneline -- path',
      'git rev-parse HEAD',
      'git branch --show-current',
      'git remote -v',
      'git fetch',
      'git -C . status --short',
      'git --no-pager status --short',
      'sh -c "git status --short .opencode"',
      'bash -lc "git check-ignore -v .opencode/foo"',
    ];
    for (const command of readOnlyCommands) {
      const event = {
        sessionID: `readonly-${command}`,
        action: 'shell',
        resources: [command],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'allow', command);
      assert.equal(event.message, undefined, command);
    }

    const mutatingCommands = [
      'git add .changebudget/state.json',
      'git commit -m change',
      'git rm .changebudget/state.json',
      'git mv .changebudget/state.json .changebudget/state-copy.json',
      'git restore .changebudget/state.json',
      'git restore --staged .changebudget/state.json',
      'git checkout -- .changebudget/state.json',
      'git reset --hard',
      'git clean -fd',
      'git merge feature',
      'git rebase feature',
      'git cherry-pick HEAD',
      'git revert HEAD',
      'git switch feature',
      'git push origin HEAD',
      'git tag v2.0.0-test',
      'git update-ref refs/heads/test HEAD',
      'git unknown-subcommand',
      'git ls-files .opencode && git commit -am change',
      'git check-ignore -v .opencode/plugins/changebudget.js > ignored.txt',
    ];
    for (const command of mutatingCommands) {
      const event = {
        sessionID: `mutation-${command}`,
        action: 'shell',
        resources: [command],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', command);
      assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, command);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('initialized repositories without a contract block unresolved V2 mutations', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    const { hook } = await loadEvaluateHook(root);
    const event = {
      sessionID: 'unresolved',
      action: 'shell',
      resources: ['git commit -am change'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(event);
    assert.equal(event.effect, 'deny');
    assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
