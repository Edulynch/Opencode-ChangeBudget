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

    const unknownChangeBudget = {
      sessionID: 'unknown-changebudget-before-init',
      action: 'shell',
      resources: ['changebudget unknown-command'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(unknownChangeBudget);
    assert.equal(unknownChangeBudget.effect, 'deny');
    assert.match(unknownChangeBudget.message ?? '', /OCG-UNRESOLVED-MUTATION/);

    const updateBeforeInit = {
      sessionID: 'update-changebudget-before-init',
      action: 'shell',
      resources: ['changebudget update'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(updateBeforeInit);
    assert.equal(updateBeforeInit.effect, 'ask');
    assert.match(updateBeforeInit.message ?? '', /OCG-CHANGEBUDGET-EXTERNAL-MUTATION/);
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
      'changebudget --version',
      'changebudget --help',
      'changebudget help',
      'changebudget help status',
      'changebudget status',
      'changebudget status --budget',
      'changebudget status --budget --json',
      'changebudget status --json=false',
      'sh -c "changebudget status"',
      "bash -lc 'changebudget status'",
      'changebudget diagnose --allow-path src/example.ts --json',
      'changebudget check',
      'changebudget check --json',
      'changebudget check --draft .changebudget/draft.json',
      'changebudget update --check',
      'changebudget integrate opencode --dry-run',
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

    const managedChangeBudgetCommands = [
      'changebudget init',
      'changebudget start --task "Runtime guard lifecycle test" --allow-path src/example.ts',
      'changebudget amend --max-files 2',
      'changebudget close',
      'changebudget integrate opencode',
      'changebudget integrate opencode --remove',
      "changebudget check --satisfaction-evidence-json '{\"satisfied\":[{\"criterion_ref\":\"AC-1\",\"evidence\":[\"verified\"]}]}'",
    ];
    for (const command of managedChangeBudgetCommands) {
      const event = {
        sessionID: `managed-changebudget-${command}`,
        action: 'shell',
        resources: [command],
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'ask', command);
      assert.match(event.message ?? '', /OCG-CHANGEBUDGET-MANAGED-MUTATION/, command);
    }

    const forceCloseEvent = {
      sessionID: 'managed-changebudget-force-close',
      action: 'shell',
      resources: ['changebudget close --force --reason "developer-authorized recovery"'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(forceCloseEvent);
    assert.equal(forceCloseEvent.effect, 'ask');
    assert.match(forceCloseEvent.message ?? '', /OCG-CHANGEBUDGET-FORCE-CLOSE/);

    const updateEvent = {
      sessionID: 'managed-changebudget-update',
      action: 'shell',
      resources: ['changebudget update'],
      effect: 'allow' as const,
      metadata: {},
      message: undefined as string | undefined,
    };
    await hook(updateEvent);
    assert.equal(updateEvent.effect, 'ask');
    assert.match(updateEvent.message ?? '', /OCG-CHANGEBUDGET-EXTERNAL-MUTATION/);

    const scannerSplitReadOnlyResources = [
      ['git status --short --untracked-files', '.opencode opencode.jsonc'],
      ['git status --short --ignored', '.opencode opencode.jsonc'],
      ['git status --short --untracked-files', '.opencode/plugins/changebudget.js'],
    ];
    for (const resources of scannerSplitReadOnlyResources) {
      const event = {
        sessionID: `readonly-scanner-split-${resources.join('-')}`,
        action: 'shell',
        resources,
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'allow', resources.join(' | '));
      assert.equal(event.message, undefined, resources.join(' | '));
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
      'changebudget unknown-command',
      'changebudget status --unknown',
      'changebudget status --json',
      'changebudget start --task',
      'changebudget close --force',
      'changebudget check --satisfaction-evidence-json',
      'changebudget integrate wrong-target',
      'changebudget update --unknown',
      'changebudget status && git add .changebudget/state.json',
      'echo corrupt > .changebudget/state.json',
      'rm .changebudget/state.json',
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

    const scannerSplitMutatingResources = [
      ['git status --short --untracked-files', 'git add .changebudget/state.json'],
      ['git status --short --untracked-files', './scripts/mutate.ps1'],
      ['git status --short --untracked-files', '.opencode > status.txt'],
      ['git status --short --untracked-files', 'git unknown-subcommand'],
    ];
    for (const resources of scannerSplitMutatingResources) {
      const event = {
        sessionID: `mutation-scanner-split-${resources.join('-')}`,
        action: 'shell',
        resources,
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', resources.join(' | '));
      assert.match(event.message ?? '', /OCG-UNRESOLVED-MUTATION/, resources.join(' | '));
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

test('ChangeBudget-owned state stays protected from direct V2 shell and file mutations', async () => {
  const root = await repository();
  try {
    await installIntegration(root, resolveChangeBudgetRoot());
    git(root, ['add', MANAGED_RESOURCES.pluginWrapper]);
    git(root, ['commit', '-m', 'baseline plugin']);
    cli(root, ['init']);
    cli(root, ['start', '--task', 'protect ChangeBudget state', '--base-revision', 'HEAD']);
    const { hook } = await loadEvaluateHook(root);

    const directMutations = [
      { action: 'shell', resources: ['echo corrupt > .changebudget/state.json'] },
      { action: 'shell', resources: ['git add .changebudget/state.json'] },
      { action: 'shell', resources: ['rm .changebudget/state.json'] },
      { action: 'edit', resources: ['.changebudget/state.json'] },
    ];
    for (const [index, mutation] of directMutations.entries()) {
      const event = {
        sessionID: `direct-changebudget-mutation-${index}`,
        ...mutation,
        effect: 'allow' as const,
        metadata: {},
        message: undefined as string | undefined,
      };
      await hook(event);
      assert.equal(event.effect, 'deny', JSON.stringify(mutation));
      assert.match(event.message ?? '', /OCG-CHANGEBUDGET-PROTECT/, JSON.stringify(mutation));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
