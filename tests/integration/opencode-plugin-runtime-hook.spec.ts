import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { RUNTIME_RULES } from '../../opencode-plugin/src/projection.js';

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface PluginHooks {
  'tool.execute.before'?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: unknown },
  ) => Promise<void>;
  'command.execute.before'?: (input: { command: string; sessionID: string; arguments: string }) => Promise<void>;
  'permission.ask'?: (input: Record<string, unknown> & { sessionID: string }, output: { status: 'allow' | 'deny' | 'ask' }) => Promise<void>;
}

interface PermissionPlugin {
  server: (input: { directory: string; worktree: string }) => Promise<PluginHooks>;
}

function metadata(): Record<string, unknown> {
  return {};
}

function runGit(root: string, args: string[]): void {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
}

function runCliCommand(root: string, command: string, args: string[] = []): CliResult {
  const result = spawnSync(process.execPath, [join(process.cwd(), 'dist', 'src', 'cli', 'index.js'), command, ...args], {
    cwd: root,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

async function createRepositoryWithCommit(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'cb-opencode-plugin-'));

  runGit(root, ['init']);
  runGit(root, ['config', 'user.name', 'integration']);
  runGit(root, ['config', 'user.email', 'integration@test']);
  runGit(root, ['commit', '--allow-empty', '-m', 'seed']);

  return root;
}

async function loadHooks(repositoryRoot: string): Promise<PluginHooks> {
  const moduleUrl = pathToFileURL(join(process.cwd(), 'opencode-plugin/dist/opencode-plugin/src/index.js')).toString();
  const pluginModule = (await import(moduleUrl)) as { default: PermissionPlugin };
  const plugin = pluginModule.default;

  return plugin.server({
    directory: repositoryRoot,
    worktree: repositoryRoot,
  });
}

async function initAndStartContract(repositoryRoot: string, allowPaths: string[] = []): Promise<void> {
  assert.equal(runCliCommand(repositoryRoot, 'init').status, 0);

  const startArgs = [
    '--task',
    'runtime guard test',
    '--base-revision',
    'HEAD',
  ];

  if (allowPaths.length > 0) {
    startArgs.push('--allow-paths', allowPaths.join(','));
  }

  const startResult = runCliCommand(repositoryRoot, 'start', startArgs);
  assert.equal(startResult.status, 0);
}

test('permission.ask allows operations in uninitialized repositories', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const hooks = await loadHooks(root);
    assert.equal(typeof hooks['permission.ask'], 'function');

    const permission = {
      sessionID: 'session-uninitialized',
      callID: 'call-uninitialized',
      type: 'read',
      pattern: 'read from config file',
      metadata: metadata(),
    };
    const output = { status: 'deny' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'allow');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.PASSIVE_MODE);
    assert.equal(permission.metadata?.runtimeAction, 'allow');
    assert.equal(permission.metadata?.policyDecision, 'PASS');
    assert.equal(permission.metadata?.isTargetResolved, false);
    assert.equal(typeof permission.metadata?.operationId, 'string');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('permission.ask fails on mutating operations in initialized repositories without active contract', async () => {
  const root = await createRepositoryWithCommit();

  try {
    assert.equal(runCliCommand(root, 'init').status, 0);

    const hooks = await loadHooks(root);
    assert.equal(typeof hooks['permission.ask'], 'function');

    const permission = {
      sessionID: 'session-initialized-no-contract',
      callID: 'call-initialized-no-contract',
      type: 'write',
      pattern: 'tool.write',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'deny');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);
    assert.equal(permission.metadata?.runtimeAction, 'block');
    assert.equal(permission.metadata?.policyDecision, 'PASS');
    assert.equal(permission.metadata?.isTargetResolved, false);
    assert.equal(typeof permission.metadata?.operationId, 'string');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('initialized repository metadata can be written programmatically and still fail-safe', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const stateRoot = join(root, '.changebudget');
    await mkdir(stateRoot, { recursive: true });
    const statePayload = {
      schema_version: '1.0.0',
      lifecycle_state: 'initialized',
      active_contract_id: null,
      last_closed_contract_id: null,
      updated_at: new Date().toISOString(),
    };

    await writeFile(join(stateRoot, 'state.json'), JSON.stringify(statePayload, null, 2), 'utf8');

    const hooks = await loadHooks(root);
    assert.equal(typeof hooks['permission.ask'], 'function');

    const permission = {
      sessionID: 'session-init-state-manual',
      callID: 'call-init-state-manual',
      type: 'edit',
      pattern: 'edit file',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'deny');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);
    assert.equal(permission.metadata?.runtimeAction, 'block');
    assert.equal(permission.metadata?.isTargetResolved, false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tool context allows path within allow_paths', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root, ['src/**']);

    const hooks = await loadHooks(root);
    await hooks['tool.execute.before']!({
      tool: 'write',
      sessionID: 'session-tool-allow',
      callID: 'call-tool-allow',
    }, {
      args: { path: 'src/app.ts' },
    });

    const permission = {
      sessionID: 'session-tool-allow',
      callID: 'call-tool-allow',
      type: 'tool',
      pattern: 'write',
      metadata: metadata(),
    };
    const output = { status: 'deny' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'allow');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.ALLOW);
    assert.equal(permission.metadata?.runtimeAction, 'allow');
    assert.equal(permission.metadata?.targetPath, 'src/app.ts');
    assert.equal(permission.metadata?.mutationIntent, 'mutate');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tool context asks for out-of-scope targets', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root, ['src/**']);

    const hooks = await loadHooks(root);
    await hooks['tool.execute.before']!({
      tool: 'write',
      sessionID: 'session-tool-scope',
      callID: 'call-tool-scope',
    }, {
      args: { path: 'tests/contract.spec.ts' },
    });

    const permission = {
      sessionID: 'session-tool-scope',
      callID: 'call-tool-scope',
      type: 'tool',
      pattern: 'write',
      metadata: metadata(),
    };
    const output = { status: 'deny' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'ask');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.OUT_SCOPE);
    assert.equal(permission.metadata?.runtimeAction, 'ask');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('repeated asks are re-evaluated for the same target and session', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root, ['src/**']);

    const hooks = await loadHooks(root);
    await hooks['tool.execute.before']!({
      tool: 'edit',
      sessionID: 'session-tool-repeat',
      callID: 'call-tool-repeat-1',
    }, {
      args: { path: 'tests/contract.spec.ts' },
    });

    const permission1 = {
      sessionID: 'session-tool-repeat',
      callID: 'call-tool-repeat-1',
      type: 'tool',
      pattern: 'edit',
      metadata: metadata(),
    };
    const output1 = { status: 'allow' as const };

    await hooks['permission.ask']!(permission1, output1);

    assert.equal(output1.status, 'ask');
    assert.equal(permission1.metadata?.rule, RUNTIME_RULES.OUT_SCOPE);

    const firstOperationId = permission1.metadata?.operationId;

    await hooks['tool.execute.before']!({
      tool: 'edit',
      sessionID: 'session-tool-repeat',
      callID: 'call-tool-repeat-2',
    }, {
      args: { path: 'tests/contract.spec.ts' },
    });

    const permission2 = {
      sessionID: 'session-tool-repeat',
      callID: 'call-tool-repeat-2',
      type: 'tool',
      pattern: 'edit',
      metadata: metadata(),
    };
    const output2 = { status: 'allow' as const };

    await hooks['permission.ask']!(permission2, output2);

    assert.equal(output2.status, 'ask');
    assert.equal(permission2.metadata?.rule, RUNTIME_RULES.OUT_SCOPE);
    assert.equal(typeof firstOperationId, 'string');
    assert.notEqual(permission2.metadata?.operationId, firstOperationId);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tool context asks for config-sensitive targets when changes are disallowed', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root);

    const hooks = await loadHooks(root);
    await hooks['tool.execute.before']!({
      tool: 'edit',
      sessionID: 'session-tool-config',
      callID: 'call-tool-config',
    }, {
      args: { path: '.env' },
    });

    const permission = {
      sessionID: 'session-tool-config',
      callID: 'call-tool-config',
      type: 'tool',
      pattern: 'edit',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'ask');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.CONFIG);
    assert.equal(permission.metadata?.targetPath, '.env');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tool context asks for public API-sensitive targets when changes are disallowed', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root);

    const hooks = await loadHooks(root);
    await hooks['tool.execute.before']!({
      tool: 'edit',
      sessionID: 'session-tool-public-api',
      callID: 'call-tool-public-api',
    }, {
      args: { path: 'api/index.ts' },
    });

    const permission = {
      sessionID: 'session-tool-public-api',
      callID: 'call-tool-public-api',
      type: 'tool',
      pattern: 'edit',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'ask');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.PUBLIC_API);
    assert.equal(permission.metadata?.targetPath, 'api/index.ts');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tool context blocks unresolved mutations after activation', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root);

    const hooks = await loadHooks(root);
    await hooks['tool.execute.before']!({
      tool: 'write',
      sessionID: 'session-tool-unresolved',
      callID: 'call-tool-unresolved',
    }, {
      args: {},
    });

    const permission = {
      sessionID: 'session-tool-unresolved',
      callID: 'call-tool-unresolved',
      type: 'tool',
      pattern: 'write',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'deny');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);
    assert.equal(permission.metadata?.isTargetResolved, false);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

  test('command context asks for dependency updates when disallowed', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root);

    const hooks = await loadHooks(root);
    await hooks['command.execute.before']!({
      command: 'npm',
      sessionID: 'session-command-deps',
      arguments: 'install left-pad',
    });

    const permission = {
      sessionID: 'session-command-deps',
      type: 'command',
      pattern: 'command',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'ask');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.DEPENDENCIES);
    assert.equal(permission.metadata?.targetPath, 'package.json');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
    }
  });

  test('command context fails safely when mutating target is unresolved', async () => {
    const root = await createRepositoryWithCommit();

    try {
      await initAndStartContract(root);

      const hooks = await loadHooks(root);
      await hooks['command.execute.before']!({
        command: 'bash',
        sessionID: 'session-command-unresolved',
        arguments: '-c "echo hi > /tmp/never-in-repo"',
      });

      const permission = {
        sessionID: 'session-command-unresolved',
        type: 'command',
        pattern: 'command',
        metadata: metadata(),
      };
      const output = { status: 'allow' as const };

      await hooks['permission.ask']!(permission, output);

      assert.equal(output.status, 'deny');
      assert.equal(permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);
    } finally {
      if (existsSync(root)) {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  test('tool context blocks writes inside .changebudget', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root);

    const hooks = await loadHooks(root);
    await hooks['tool.execute.before']!({
      tool: 'edit',
      sessionID: 'session-tool-budget',
      callID: 'call-tool-budget',
    }, {
      args: { path: '.changebudget/state.json' },
    });

    const permission = {
      sessionID: 'session-tool-budget',
      callID: 'call-tool-budget',
      type: 'tool',
      pattern: 'edit',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'deny');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.CHANGEBUDGET);
    assert.equal(permission.metadata?.targetPath, '.changebudget/state.json');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

  test('T018: guard projection is identical with and without contract task fields', async () => {
  const taskTiedRoot = await createRepositoryWithCommit();

  try {
    await mkdir(join(taskTiedRoot, 'specs', '006-example-feature'), { recursive: true });
    await writeFile(
      join(taskTiedRoot, 'specs', '006-example-feature', 'tasks.md'),
      '- [ ] T031 Implement the task bridge\n',
    );
    runGit(taskTiedRoot, ['add', 'specs']);
    runGit(taskTiedRoot, ['commit', '-m', 'seed specs']);

    assert.equal(runCliCommand(taskTiedRoot, 'init').status, 0);
    assert.equal(
      runCliCommand(taskTiedRoot, 'start', ['T031', '--base-revision', 'HEAD', '--allow-paths', 'src/**']).status,
      0,
    );

    const hooks = await loadHooks(taskTiedRoot);
    await hooks['tool.execute.before']!({
      tool: 'write',
      sessionID: 'session-t018',
      callID: 'call-t018',
    }, {
      args: { path: 'src/app.ts' },
    });

    const taskTiedPermission = {
      sessionID: 'session-t018',
      callID: 'call-t018',
      type: 'tool',
      pattern: 'write',
      metadata: metadata(),
    };
    const taskTiedOutput = { status: 'deny' as const };
    await hooks['permission.ask']!(taskTiedPermission, taskTiedOutput);

    assert.equal(taskTiedOutput.status, 'allow');
    assert.equal(taskTiedPermission.metadata?.rule, RUNTIME_RULES.ALLOW);
    assert.equal(taskTiedPermission.metadata?.runtimeAction, 'allow');
    assert.equal(taskTiedPermission.metadata?.targetPath, 'src/app.ts');
    assert.equal(taskTiedPermission.metadata?.policyDecision, 'PASS');
    assert.equal('task_id' in (taskTiedPermission.metadata ?? {}), false);
    assert.equal('task_title' in (taskTiedPermission.metadata ?? {}), false);
    assert.equal('task_source_feature' in (taskTiedPermission.metadata ?? {}), false);
    assert.equal('task_source_path' in (taskTiedPermission.metadata ?? {}), false);
  } finally {
    if (existsSync(taskTiedRoot)) {
      await rm(taskTiedRoot, { recursive: true, force: true });
    }
  }
});
