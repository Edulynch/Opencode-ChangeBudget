import * as assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

import { RUNTIME_RULES } from '../../opencode-plugin/src/projection.js';
import { installIntegration, MANAGED_RESOURCES } from '../../src/core/integration/opencode.js';

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

interface ToolWriteRequest {
  readonly sessionID: string;
  readonly callID: string;
  readonly path: string;
}

interface ToolWriteResult {
  readonly permission: Record<string, unknown> & {
    readonly sessionID: string;
    readonly callID: string;
    readonly metadata: Record<string, unknown>;
  };
  readonly output: { status: 'allow' | 'deny' | 'ask' };
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

async function initAndStartContract(
  repositoryRoot: string,
  allowPaths: string[] = [],
  denyPaths: string[] = [],
  allowNewFiles = false,
): Promise<void> {
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
  if (denyPaths.length > 0) {
    startArgs.push('--deny-paths', denyPaths.join(','));
  }
  if (allowNewFiles) {
    startArgs.push('--allow-new-files');
  }

  const startResult = runCliCommand(repositoryRoot, 'start', startArgs);
  assert.equal(startResult.status, 0);
}

async function requestToolWrite(hooks: PluginHooks, request: ToolWriteRequest): Promise<ToolWriteResult> {
  const beforeHook = hooks['tool.execute.before'];
  const permissionHook = hooks['permission.ask'];
  if (beforeHook === undefined || permissionHook === undefined) {
    throw new Error('Runtime Guard write hooks are unavailable');
  }

  await beforeHook({
    tool: 'write',
    sessionID: request.sessionID,
    callID: request.callID,
  }, {
    args: { path: request.path },
  });
  const permission = {
    sessionID: request.sessionID,
    callID: request.callID,
    type: 'tool',
    pattern: 'write',
    metadata: metadata(),
  };
  const output: { status: 'allow' | 'deny' | 'ask' } = { status: 'deny' };
  await permissionHook(permission, output);
  return { permission, output };
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

test('T025: explicit integration loads the Runtime Guard from the packaged runtime root', async () => {
  const projectRoot = await createRepositoryWithCommit();
  const packageRoot = await mkdtemp(join(tmpdir(), 'cb-installed-package-'));
  const packagedRuntime = join(
    packageRoot,
    'opencode-plugin',
    'dist',
    'opencode-plugin',
  );
  const developmentRuntime = join(
    process.cwd(),
    'opencode-plugin',
    'dist',
    'opencode-plugin',
  );

  try {
    await cp(
      join(process.cwd(), 'dist', 'src'),
      join(packageRoot, 'dist', 'src'),
      { recursive: true },
    );
    await cp(
      developmentRuntime,
      packagedRuntime,
      { recursive: true },
    );
    const result = await installIntegration(projectRoot, packageRoot);
    assert.equal(result.runtimeGuardTargetExists, true);

    const wrapperPath = join(projectRoot, MANAGED_RESOURCES.pluginWrapper);
    const wrapper = await readFile(wrapperPath, 'utf8');
    assert.match(wrapper, new RegExp(pathToFileURL(packagedRuntime).href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(wrapper, new RegExp(pathToFileURL(developmentRuntime).href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const wrapperModule = (await import(`${pathToFileURL(wrapperPath).href}?t025`)) as {
      default: PermissionPlugin;
    };
    const hooks = await wrapperModule.default.server({
      directory: projectRoot,
      worktree: projectRoot,
    });
    assert.equal(typeof hooks['permission.ask'], 'function');
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(packageRoot, { recursive: true, force: true });
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
    await mkdir(join(root, 'src'), { recursive: true });
    await initAndStartContract(root, ['src/**'], [], true);

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

test('runtime guard applies unrooted globstar allow paths to nested targets', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await mkdir(join(root, 'generated', 'nested'), { recursive: true });
    await initAndStartContract(root, ['generated/**/artifact?.[jt]s'], [], true);

    const result = await requestToolWrite(await loadHooks(root), {
      sessionID: 'globstar-runtime-allow',
      callID: 'globstar-runtime-allow',
      path: 'generated/nested/artifact1.ts',
    });

    assert.equal(result.output.status, 'allow');
    assert.equal(result.permission.metadata?.rule, RUNTIME_RULES.ALLOW);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tool context blocks new files when allow_new_files is false and permits them when true', async () => {
  const deniedRoot = await createRepositoryWithCommit();
  const allowedRoot = await createRepositoryWithCommit();

  try {
    await mkdir(join(deniedRoot, 'src'), { recursive: true });
    await writeFile(join(deniedRoot, 'src', 'existing.ts'), 'export const existing = true;\n', 'utf8');
    runGit(deniedRoot, ['add', 'src/existing.ts']);
    runGit(deniedRoot, ['commit', '-m', 'existing target']);
    await initAndStartContract(deniedRoot, ['src/**']);
    const deniedHooks = await loadHooks(deniedRoot);
    const existing = await requestToolWrite(deniedHooks, {
      sessionID: 'existing-file-allowed',
      callID: 'existing-file-allowed',
      path: 'src/existing.ts',
    });
    const denied = await requestToolWrite(deniedHooks, {
      sessionID: 'new-file-denied',
      callID: 'new-file-denied',
      path: 'src/new.ts',
    });

    assert.equal(existing.output.status, 'allow');
    assert.equal(existing.permission.metadata?.rule, RUNTIME_RULES.ALLOW);
    assert.equal(denied.output.status, 'deny');
    assert.equal(denied.permission.metadata?.rule, RUNTIME_RULES.NEW_FILE_NOT_ALLOWED);

    await mkdir(join(allowedRoot, 'src'), { recursive: true });
    await initAndStartContract(allowedRoot, ['src/**'], [], true);
    const allowedHooks = await loadHooks(allowedRoot);
    const allowed = await requestToolWrite(allowedHooks, {
      sessionID: 'new-file-allowed',
      callID: 'new-file-allowed',
      path: 'src\\new.ts',
    });

    assert.equal(allowed.output.status, 'allow');
    assert.equal(allowed.permission.metadata?.rule, RUNTIME_RULES.ALLOW);
    assert.equal(allowed.permission.metadata?.targetPath, 'src/new.ts');
  } finally {
    await rm(deniedRoot, { recursive: true, force: true });
    await rm(allowedRoot, { recursive: true, force: true });
  }
});

test('tool context fails closed for missing parents and symlinked paths outside the repository', async () => {
  const root = await createRepositoryWithCommit();
  const externalRoot = await mkdtemp(join(tmpdir(), 'cb-runtime-guard-external-'));

  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await initAndStartContract(root, ['src/**'], [], true);
    const hooks = await loadHooks(root);

    await hooks['tool.execute.before']!({
      tool: 'copy',
      sessionID: 'ambiguous-destination',
      callID: 'ambiguous-destination',
    }, {
      args: { destination: 'src/one.ts', target: 'src/two.ts' },
    });
    const ambiguousPermission = {
      sessionID: 'ambiguous-destination',
      callID: 'ambiguous-destination',
      type: 'tool',
      pattern: 'copy',
      metadata: metadata(),
    };
    const ambiguousOutput = { status: 'allow' as const };
    await hooks['permission.ask']!(ambiguousPermission, ambiguousOutput);
    assert.equal(ambiguousOutput.status, 'deny');
    assert.equal(ambiguousPermission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);

    const missingParent = await requestToolWrite(hooks, {
      sessionID: 'new-file-missing-parent',
      callID: 'new-file-missing-parent',
      path: 'src/missing/nested.ts',
    });
    assert.equal(missingParent.output.status, 'deny');
    assert.equal(missingParent.permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);

    await mkdir(join(root, 'src', 'directory'), { recursive: true });
    const directoryTarget = await requestToolWrite(hooks, {
      sessionID: 'directory-target',
      callID: 'directory-target',
      path: 'src/directory',
    });
    assert.equal(directoryTarget.output.status, 'deny');
    assert.equal(directoryTarget.permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);

    await symlink(join(root, 'missing-target'), join(root, 'src', 'dangling'), 'file');
    const danglingLink = await requestToolWrite(hooks, {
      sessionID: 'dangling-link',
      callID: 'dangling-link',
      path: 'src/dangling',
    });
    assert.equal(danglingLink.output.status, 'deny');
    assert.equal(danglingLink.permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);

    await symlink(externalRoot, join(root, 'src', 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    const escapingLink = await requestToolWrite(hooks, {
      sessionID: 'new-file-escaping-link',
      callID: 'new-file-escaping-link',
      path: 'src/escape/new.ts',
    });
    assert.equal(escapingLink.output.status, 'deny');
    assert.equal(escapingLink.permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
});

test('tool context evaluates lexical and effective symlink paths conservatively', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await mkdir(join(root, 'private'), { recursive: true });
    await mkdir(join(root, 'real'), { recursive: true });
    await writeFile(join(root, 'private', 'secret.ts'), 'export const secret = true;\n', 'utf8');
    await writeFile(join(root, 'package.json'), '{}\n', 'utf8');
    await symlink(join(root, 'private', 'secret.ts'), join(root, 'alias-secret.ts'), 'file');
    await symlink(join(root, 'package.json'), join(root, 'alias-package.json'), 'file');
    await symlink(join(root, '.changebudget', 'state.json'), join(root, 'alias-budget.json'), 'file');
    await symlink(join(root, 'real'), join(root, 'alias-real'), process.platform === 'win32' ? 'junction' : 'dir');
    runGit(root, [
      'add',
      'private/secret.ts',
      'package.json',
      'alias-secret.ts',
      'alias-package.json',
      'alias-budget.json',
      'alias-real',
    ]);
    runGit(root, ['commit', '-m', 'seed symlink fixtures']);
    await initAndStartContract(
      root,
      ['alias-secret.ts', 'alias-package.json', 'package.json', 'alias-budget.json', 'alias-real/**', 'real/**'],
      ['private/**'],
      true,
    );
    const hooks = await loadHooks(root);

    const denied = await requestToolWrite(hooks, {
      sessionID: 'symlink-denied', callID: 'symlink-denied', path: 'alias-secret.ts',
    });
    const sensitive = await requestToolWrite(hooks, {
      sessionID: 'symlink-sensitive', callID: 'symlink-sensitive', path: 'alias-package.json',
    });
    const protectedTarget = await requestToolWrite(hooks, {
      sessionID: 'symlink-protected', callID: 'symlink-protected', path: 'alias-budget.json',
    });
    const newTarget = await requestToolWrite(hooks, {
      sessionID: 'symlink-new-target', callID: 'symlink-new-target', path: 'alias-real/new.ts',
    });

    assert.equal(denied.output.status, 'deny');
    assert.equal(denied.permission.metadata?.rule, RUNTIME_RULES.PATH_DENY);
    assert.equal(sensitive.output.status, 'ask');
    assert.equal(sensitive.permission.metadata?.rule, RUNTIME_RULES.DEPENDENCIES);
    assert.equal(protectedTarget.output.status, 'deny');
    assert.equal(protectedTarget.permission.metadata?.rule, RUNTIME_RULES.CHANGEBUDGET);
    assert.equal(newTarget.output.status, 'allow');
    assert.equal(newTarget.permission.metadata?.rule, RUNTIME_RULES.ALLOW);
    assert.equal(newTarget.permission.metadata?.targetPath, 'alias-real/new.ts');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tool context requires both symlink paths to match allow_paths unless scope is unrestricted', async () => {
  const scopedRoot = await createRepositoryWithCommit();
  const unrestrictedRoot = await createRepositoryWithCommit();

  try {
    for (const root of [scopedRoot, unrestrictedRoot]) {
      await mkdir(join(root, 'real'), { recursive: true });
      await writeFile(join(root, 'real', 'existing.ts'), 'export const existing = true;\n', 'utf8');
      await symlink(join(root, 'real'), join(root, 'alias-real'), process.platform === 'win32' ? 'junction' : 'dir');
      runGit(root, ['add', 'real/existing.ts', 'alias-real']);
      runGit(root, ['commit', '-m', 'seed effective target and alias']);
    }
    await initAndStartContract(scopedRoot, ['alias-real/**']);
    await initAndStartContract(unrestrictedRoot);

    const scoped = await requestToolWrite(await loadHooks(scopedRoot), {
      sessionID: 'symlink-scoped', callID: 'symlink-scoped', path: 'alias-real/existing.ts',
    });
    const unrestricted = await requestToolWrite(await loadHooks(unrestrictedRoot), {
      sessionID: 'symlink-unrestricted', callID: 'symlink-unrestricted', path: 'alias-real/existing.ts',
    });

    assert.equal(scoped.output.status, 'ask');
    assert.equal(scoped.permission.metadata?.rule, RUNTIME_RULES.OUT_SCOPE);
    assert.equal(unrestricted.output.status, 'allow');
    assert.equal(unrestricted.permission.metadata?.rule, RUNTIME_RULES.ALLOW);
  } finally {
    if (existsSync(scopedRoot)) {
      await rm(scopedRoot, { recursive: true, force: true });
    }
    if (existsSync(unrestrictedRoot)) {
      await rm(unrestrictedRoot, { recursive: true, force: true });
    }
  }
});

test('tool context asks for out-of-scope targets', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'tests', 'contract.spec.ts'), 'export {};\n', 'utf8');
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

test('permission decisions re-evaluate scope amendments without weakening protected rules', async () => {
  const root = await createRepositoryWithCommit();
  try {
    await mkdir(join(root, 'tests'), { recursive: true });
    await mkdir(join(root, 'private'), { recursive: true });
    await writeFile(join(root, 'private', 'secret.ts'), 'export const secret = true;\n', 'utf8');
    await writeFile(join(root, 'package.json'), '{}\n', 'utf8');
    await initAndStartContract(root, ['src/**', 'package.json', 'private/**'], ['private/**']);
    const hooks = await loadHooks(root);

    const beforeScope = await requestToolWrite(hooks, {
      sessionID: 'scope-amendment',
      callID: 'before-exact',
      path: 'tests/exact.ts',
    });
    const protectedBefore = await requestToolWrite(hooks, {
      sessionID: 'scope-amendment',
      callID: 'before-protected',
      path: '.changebudget/state.json',
    });
    const deniedBefore = await requestToolWrite(hooks, {
      sessionID: 'scope-amendment',
      callID: 'before-denied',
      path: 'private/secret.ts',
    });
    const sensitiveBefore = await requestToolWrite(hooks, {
      sessionID: 'scope-amendment',
      callID: 'before-sensitive',
      path: 'package.json',
    });

    assert.equal(beforeScope.output.status, 'deny');
    assert.equal(beforeScope.permission.metadata?.rule, RUNTIME_RULES.NEW_FILE_NOT_ALLOWED);
    assert.equal(protectedBefore.output.status, 'deny');
    assert.equal(protectedBefore.permission.metadata?.rule, RUNTIME_RULES.CHANGEBUDGET);
    assert.equal(deniedBefore.output.status, 'deny');
    assert.equal(deniedBefore.permission.metadata?.rule, RUNTIME_RULES.PATH_DENY);
    assert.equal(sensitiveBefore.output.status, 'ask');
    assert.equal(sensitiveBefore.permission.metadata?.rule, RUNTIME_RULES.DEPENDENCIES);

    const amendment = runCliCommand(root, 'amend', [
      '--allow-path', 'tests/exact.ts',
      '--reason', 'Authorize the exact test target',
    ]);
    assert.equal(amendment.status, 0, amendment.stderr);

    const afterScope = await requestToolWrite(hooks, {
      sessionID: 'scope-amendment',
      callID: 'after-exact',
      path: 'tests/exact.ts',
    });
    const protectedAfter = await requestToolWrite(hooks, {
      sessionID: 'scope-amendment',
      callID: 'after-protected',
      path: '.changebudget/state.json',
    });
    const deniedAfter = await requestToolWrite(hooks, {
      sessionID: 'scope-amendment',
      callID: 'after-denied',
      path: 'private/secret.ts',
    });
    const sensitiveAfter = await requestToolWrite(hooks, {
      sessionID: 'scope-amendment',
      callID: 'after-sensitive',
      path: 'package.json',
    });

    assert.equal(afterScope.output.status, 'deny');
    assert.equal(afterScope.permission.metadata?.rule, RUNTIME_RULES.NEW_FILE_NOT_ALLOWED);
    assert.equal(protectedAfter.output.status, protectedBefore.output.status);
    assert.equal(protectedAfter.permission.metadata?.rule, protectedBefore.permission.metadata?.rule);
    assert.equal(deniedAfter.output.status, deniedBefore.output.status);
    assert.equal(deniedAfter.permission.metadata?.rule, deniedBefore.permission.metadata?.rule);
    assert.equal(sensitiveAfter.output.status, sensitiveBefore.output.status);
    assert.equal(sensitiveAfter.permission.metadata?.rule, sensitiveBefore.permission.metadata?.rule);
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('repeated asks are re-evaluated for the same target and session', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'tests', 'contract.spec.ts'), 'export {};\n', 'utf8');
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

test('tool context asks for .env and .env.local config-sensitive targets when changes are disallowed', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await writeFile(join(root, '.env'), 'TOKEN=value\n', 'utf8');
    await writeFile(join(root, '.env.local'), 'TOKEN=value\n', 'utf8');
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

    await hooks['tool.execute.before']!({
      tool: 'edit',
      sessionID: 'session-tool-config-local',
      callID: 'call-tool-config-local',
    }, {
      args: { path: '.env.local' },
    });
    const localPermission = {
      sessionID: 'session-tool-config-local',
      callID: 'call-tool-config-local',
      type: 'tool',
      pattern: 'edit',
      metadata: metadata(),
    };
    const localOutput = { status: 'allow' as const };

    await hooks['permission.ask']!(localPermission, localOutput);

    assert.equal(localOutput.status, 'ask');
    assert.equal(localPermission.metadata?.rule, RUNTIME_RULES.CONFIG);
    assert.equal(localPermission.metadata?.targetPath, '.env.local');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('tool context asks for public API-sensitive targets when changes are disallowed', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await mkdir(join(root, 'api'), { recursive: true });
    await writeFile(join(root, 'api', 'index.ts'), 'export {};\n', 'utf8');
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
    await writeFile(join(root, 'package.json'), '{}\n', 'utf8');
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
    await writeFile(join(root, 'package.json'), '{}\n', 'utf8');
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
    await mkdir(join(taskTiedRoot, 'src'), { recursive: true });

    assert.equal(runCliCommand(taskTiedRoot, 'init').status, 0);
    assert.equal(
      runCliCommand(taskTiedRoot, 'start', ['T031', '--base-revision', 'HEAD', '--allow-paths', 'src/**', '--allow-new-files']).status,
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

test('T013: malformed state.json never throws out of permission.ask and degrades to a documented decision', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const stateRoot = join(root, '.changebudget');
    await mkdir(stateRoot, { recursive: true });
    await writeFile(join(stateRoot, 'state.json'), '{ this is not valid json', 'utf8');

    const hooks = await loadHooks(root);
    assert.equal(typeof hooks['permission.ask'], 'function');

    const permission = {
      sessionID: 'session-malformed-state',
      callID: 'call-malformed-state',
      type: 'write',
      pattern: 'tool.write',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'deny');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);
    assert.equal(permission.metadata?.runtimeAction, 'block');
    assert.equal(permission.metadata?.policyDecision, 'HUMAN_REVIEW');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T013: contract missing while state says active never throws and degrades to a documented decision', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const stateRoot = join(root, '.changebudget');
    await mkdir(stateRoot, { recursive: true });
    const statePayload = {
      schema_version: '1.0.0',
      lifecycle_state: 'active',
      active_contract_id: 'contract-missing-phantom',
      last_closed_contract_id: null,
      updated_at: new Date().toISOString(),
    };
    await writeFile(join(stateRoot, 'state.json'), JSON.stringify(statePayload, null, 2), 'utf8');

    const hooks = await loadHooks(root);
    assert.equal(typeof hooks['permission.ask'], 'function');

    const permission = {
      sessionID: 'session-contract-missing',
      callID: 'call-contract-missing',
      type: 'write',
      pattern: 'tool.write',
      metadata: metadata(),
    };
    const output = { status: 'allow' as const };

    await hooks['permission.ask']!(permission, output);

    assert.equal(output.status, 'deny');
    assert.equal(permission.metadata?.rule, RUNTIME_RULES.UNRESOLVED_MUTATION);
    assert.equal(permission.metadata?.runtimeAction, 'block');
    assert.equal(permission.metadata?.policyDecision, 'HUMAN_REVIEW');
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T013: unresolvable mutation target in an active contract never throws and blocks deterministically', async () => {
  const root = await createRepositoryWithCommit();

  try {
    await initAndStartContract(root, ['src/**']);

    const hooks = await loadHooks(root);

    // Store a tool context with no resolvable target path, then ask with the matching callID.
    await hooks['tool.execute.before']!({
      tool: 'write',
      sessionID: 'session-unresolvable-target',
      callID: 'call-unresolvable-target',
    }, {
      args: {},
    });

    const permission = {
      sessionID: 'session-unresolvable-target',
      callID: 'call-unresolvable-target',
      type: 'tool',
      pattern: 'write',
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

test('T014: retained context maps stay bounded across many sessions with FIFO eviction', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const pluginModuleUrl = pathToFileURL(join(process.cwd(), 'opencode-plugin/dist/opencode-plugin/src/index.js')).toString();
    const pluginModule = (await import(pluginModuleUrl)) as {
      default: PermissionPlugin;
      __testResetContextMaps: () => void;
      __testContextSessionCounts: () => { toolSessions: number; commandSessions: number };
      __testContextSessionIds: () => { toolSessionIds: string[]; commandSessionIds: string[] };
    };

    pluginModule.__testResetContextMaps();

    const hooks = await loadHooks(root);

    const totalSessions = 64;

    for (let index = 0; index < totalSessions; index += 1) {
      const sessionID = `session-bounded-${index}`;
      const callID = `call-bounded-${index}`;

      await hooks['tool.execute.before']!({
        tool: 'write',
        sessionID,
        callID,
      }, {
        args: { path: 'src/app.ts' },
      });

      await hooks['command.execute.before']!({
        command: 'npm',
        sessionID,
        arguments: 'install left-pad',
      });

      const permission = {
        sessionID,
        callID,
        type: 'tool',
        pattern: 'write',
        metadata: metadata(),
      };
      const output = { status: 'deny' as const };
      await hooks['permission.ask']!(permission, output);
    }

    const counts = pluginModule.__testContextSessionCounts();
    assert.ok(counts.toolSessions <= 32, `toolSessions bounded: ${counts.toolSessions}`);
    assert.ok(counts.commandSessions <= 32, `commandSessions bounded: ${counts.commandSessions}`);

    const ids = pluginModule.__testContextSessionIds();
    const lastToolSession = ids.toolSessionIds[ids.toolSessionIds.length - 1];
    assert.equal(lastToolSession, `session-bounded-${totalSessions - 1}`);
    assert.ok(!ids.toolSessionIds.includes('session-bounded-0'));

    pluginModule.__testResetContextMaps();
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('T014: repeated bounded runs produce the same retained session set and order', async () => {
  const root = await createRepositoryWithCommit();

  try {
    const pluginModuleUrl = pathToFileURL(join(process.cwd(), 'opencode-plugin/dist/opencode-plugin/src/index.js')).toString();
    const pluginModule = (await import(pluginModuleUrl)) as {
      default: PermissionPlugin;
      __testResetContextMaps: () => void;
      __testContextSessionIds: () => { toolSessionIds: string[]; commandSessionIds: string[] };
    };

    async function runBoundedCycle(): Promise<{ toolSessionIds: string[]; commandSessionIds: string[] }> {
      pluginModule.__testResetContextMaps();
      const hooks = await loadHooks(root);

      for (let index = 0; index < 40; index += 1) {
        const sessionID = `session-repeat-${index}`;
        const callID = `call-repeat-${index}`;
        await hooks['tool.execute.before']!({ tool: 'write', sessionID, callID }, { args: { path: 'src/app.ts' } });
        await hooks['command.execute.before']!({ command: 'npm', sessionID, arguments: 'install x' });
        const permission = { sessionID, callID, type: 'tool', pattern: 'write', metadata: metadata() };
        const output = { status: 'deny' as const };
        await hooks['permission.ask']!(permission, output);
      }

      return pluginModule.__testContextSessionIds();
    }

    const first = await runBoundedCycle();
    const second = await runBoundedCycle();

    assert.deepEqual(first.toolSessionIds, second.toolSessionIds);
    assert.deepEqual(first.commandSessionIds, second.commandSessionIds);
    assert.equal(first.toolSessionIds.length, 32);

    pluginModule.__testResetContextMaps();
  } finally {
    if (existsSync(root)) {
      await rm(root, { recursive: true, force: true });
    }
  }
});
