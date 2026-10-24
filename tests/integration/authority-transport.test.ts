import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import type { SessionMessageInfo } from '@opencode/client';

import {
  buildAuthorityUseRequest,
  findCurrentEditInput,
  mapGrantVerificationResult,
  parseAuthorityReference,
  projectActualEdit,
} from '../../opencode-plugin/src/authority-reference.js';
import { countChangedTextLines, collectChangedItems } from '../../src/core/check/diff.js';
import { canonicalizeLiteralPath } from '../../src/core/check/literal-path.js';
import { normalizeAuthorityUseRequest } from '../../src/core/authority/grants.js';
import { createAuthorityService } from '../../src/core/authority/authority-service.js';
import type { GrantPermissions } from '../../src/core/authority/grants.js';
import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runCheck } from '../../src/cli/commands/check.js';
import { installIntegration, MANAGED_RESOURCES, resolveChangeBudgetRoot } from '../../src/core/integration/opencode.js';
import { readContract, writeContract } from '../../src/core/state/contracts.js';
import { createTestFixtureDirectory, removeTestRepository } from '../utils/disposable-repository.js';

const EMPTY_PERMISSIONS = {
  allow_new_files: false,
  allow_dependencies: false,
  allow_migrations: false,
  allow_configuration: false,
  allow_public_api: false,
} as const satisfies GrantPermissions;

function approvedTempBase(): string {
  return process.env.SPEC015_TEST_TEMP_ROOT
    ? process.env.SPEC015_TEST_TEMP_ROOT
    : process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, 'Temp', 'opencode')
      : process.env.TEMP ?? process.env.TMP ?? process.cwd();
}

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function createRepository(prefix: string): Promise<string> {
  const root = await createTestFixtureDirectory(approvedTempBase(), prefix);
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'authority transport fixture']);
  git(root, ['config', 'user.email', 'authority-transport@test.invalid']);
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'README.md'), 'transport fixture\n', 'utf8');
  await writeFile(join(root, 'src', 'edit.ts'), 'const value = 1;\n', 'utf8');
  git(root, ['add', 'README.md', 'src/edit.ts']);
  git(root, ['commit', '--quiet', '-m', 'seed']);
  await installIntegration(root, resolveChangeBudgetRoot());
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'baseline installed plugin']);
  await runInit(root);
  await runStart(root, [
    '--task', 'bounded non-authorizing transport fixture',
    '--base-revision', 'HEAD',
    '--allow-path', 'src/**',
    '--max-files', '60',
    '--max-changed-lines', '60',
  ]);
  return root;
}

function reference(referenceId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changebudgetAuthority: {
      schema_version: 1,
      reference_id: referenceId,
      request: {
        operation: 'file.write',
        capabilities: ['source.edit'],
        paths: ['src/edit.ts'],
        ceilings: { max_files: 1, max_changed_lines: 2 },
        ...overrides,
      },
    },
  };
}

function editInput(root: string): { readonly path: string; readonly oldString: string; readonly newString: string } {
  return {
    path: join(root, 'src', 'edit.ts'),
    oldString: 'const value = 1;\n',
    newString: 'const value = 2;\n',
  };
}

function assistantEditContext(messageID: string, toolID: string, input: ReturnType<typeof editInput>): SessionMessageInfo[] {
  return [{
    id: messageID,
    time: { created: 1 },
    type: 'assistant',
    agent: 'build',
    model: { id: 'fixture-model', providerID: 'fixture-provider' },
    content: [{
      type: 'tool',
      id: toolID,
      name: 'edit',
      state: { status: 'running', input, metadata: {} },
      time: { created: 1 },
    }],
  }];
}

interface G5ReadProbeOptions {
  readonly zeroTargetIdentity?: boolean;
  readonly markTargetAsSymlink?: boolean;
  readonly replaceParentBeforeOpen?: () => Promise<void>;
  readonly replaceLeafBeforeOpen?: () => Promise<void>;
  readonly substituteTargetOpen?: string;
  readonly changeTargetContentsBeforeRead?: () => Promise<void>;
  readonly changeTargetContentsAfterRead?: () => Promise<void>;
  readonly alterTargetHandleStatsAfterRead?: boolean;
  readonly growTargetHandleAfterRead?: boolean;
  readonly replaceTargetHandleIdentityAfterRead?: boolean;
}

async function withG5ReadProbe<T>(
  targetPath: string,
  operation: () => Promise<T>,
  options: G5ReadProbeOptions = {},
): Promise<{
  readonly value?: T;
  readonly error?: unknown;
  readonly contentBytesRead: number;
  readonly readFileCalls: number;
  readonly targetOpenPaths: readonly string[];
  readonly allocations: readonly number[];
  readonly attemptedWrites: readonly string[];
  readonly fixtureMutationError?: unknown;
}> {
  const require = createRequire(import.meta.url);
  const fsPromises = require('node:fs/promises') as Record<string, (...args: any[]) => any>;
  const originalOpen = fsPromises.open!;
  const originalLstat = fsPromises.lstat!;
  const originalReadFile = fsPromises.readFile!;
  const originalAlloc = Buffer.alloc;
  const normalizedTarget = resolve(targetPath);
  const targetParent = resolve(dirname(targetPath));
  const samePath = (left: string, right: string): boolean => process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
  let contentBytesRead = 0;
  let readFileCalls = 0;
  const targetOpenPaths: string[] = [];
  const allocations: number[] = [];
  const attemptedWrites: string[] = [];
  let fixtureMutationError: unknown;
  let changedTargetContents = false;
  let allowedFixtureMutation = false;
  const writeOperations = ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rename', 'unlink', 'rm', 'copyFile', 'truncate'];
  const patched = new Map<string, (...args: any[]) => any>([
    ['open', originalOpen],
    ['lstat', originalLstat],
    ['readFile', originalReadFile],
    ...writeOperations.map((name) => [name, fsPromises[name]!] as [string, (...args: any[]) => any]),
  ]);
  const runFixtureMutation = async <T>(callback: () => Promise<T>): Promise<T> => {
    allowedFixtureMutation = true;
    try {
      return await callback();
    } finally {
      allowedFixtureMutation = false;
    }
  };

  fsPromises.lstat = async (path: unknown, ...args: unknown[]) => {
    const stats = await originalLstat(path, ...args);
    if ((!options.zeroTargetIdentity && !options.markTargetAsSymlink)
      || typeof path !== 'string' || !samePath(path, normalizedTarget)) return stats;
    return new Proxy(stats, {
      get(target, property, receiver) {
        if (property === 'isSymbolicLink' && options.markTargetAsSymlink) return () => true;
        if (property === 'ino' && options.zeroTargetIdentity) return typeof target.ino === 'bigint' ? 0n : 0;
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  fsPromises.readFile = async (path: unknown, ...args: unknown[]) => {
    const result = await originalReadFile(path, ...args);
    if (typeof path === 'string' && samePath(path, normalizedTarget)) {
      readFileCalls += 1;
      contentBytesRead += Buffer.isBuffer(result) ? result.byteLength : Buffer.byteLength(result);
    }
    return result;
  };
  fsPromises.open = async (path: unknown, flags: unknown, ...args: unknown[]) => {
    if (typeof path === 'string' && samePath(path, targetParent) && options.replaceParentBeforeOpen) {
      const replace = options.replaceParentBeforeOpen;
      options = { ...options, replaceParentBeforeOpen: undefined };
      await runFixtureMutation(replace);
    }
    const targetOpen = typeof path === 'string' && samePath(path, normalizedTarget);
    if (targetOpen && options.replaceLeafBeforeOpen) {
      const replace = options.replaceLeafBeforeOpen;
      options = { ...options, replaceLeafBeforeOpen: undefined };
      await runFixtureMutation(replace);
    }
    const writes = (typeof flags === 'string' && /[wax+]/u.test(flags))
      || (typeof flags === 'number' && (flags & 3) !== 0);
    if (writes && !allowedFixtureMutation) {
      attemptedWrites.push(`open:${String(path)}`);
      throw Object.assign(new Error('G5 edit observation write denied by fixture guard'), { code: 'EPERM' });
    }
    const openPath = targetOpen ? options.substituteTargetOpen ?? path : path;
    const handle = await originalOpen(openPath, flags, ...args);
    if (!targetOpen) return handle;
    targetOpenPaths.push(String(openPath));
    return new Proxy(handle, {
      get(target, property, receiver) {
        if (property === 'read') {
          return async (...readArgs: unknown[]) => {
            if (!changedTargetContents && options.changeTargetContentsBeforeRead) {
              changedTargetContents = true;
              try {
                await runFixtureMutation(options.changeTargetContentsBeforeRead);
              } catch (error) {
                fixtureMutationError = error;
              }
            }
            const result = await target.read(...readArgs);
            contentBytesRead += result.bytesRead;
            if (!changedTargetContents && result.bytesRead > 0 && options.changeTargetContentsAfterRead) {
              changedTargetContents = true;
              try {
                await runFixtureMutation(options.changeTargetContentsAfterRead);
              } catch (error) {
                fixtureMutationError = error;
              }
            }
            return result;
          };
        }
        if (property === 'stat') {
          return async (...statArgs: unknown[]) => {
            const stats = await target.stat(...statArgs);
            if ((!options.alterTargetHandleStatsAfterRead && !options.growTargetHandleAfterRead
              && !options.replaceTargetHandleIdentityAfterRead) || contentBytesRead === 0) return stats;
            return new Proxy(stats, {
              get(statTarget, statProperty, statReceiver) {
                if ((statProperty === 'ctimeNs' || statProperty === 'mtimeNs')
                  && options.alterTargetHandleStatsAfterRead) {
                  const value = Reflect.get(statTarget, statProperty, statReceiver);
                  return typeof value === 'bigint' ? value + 1n : value;
                }
                if (statProperty === 'size' && options.growTargetHandleAfterRead) {
                  const value = Reflect.get(statTarget, statProperty, statReceiver);
                  return typeof value === 'bigint' ? value + 1n : value;
                }
                if ((statProperty === 'ino' || statProperty === 'birthtimeNs')
                  && options.replaceTargetHandleIdentityAfterRead) {
                  const value = Reflect.get(statTarget, statProperty, statReceiver);
                  return typeof value === 'bigint' ? value + 1n : value;
                }
                const value = Reflect.get(statTarget, statProperty, statReceiver);
                return typeof value === 'function' ? value.bind(statTarget) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  };
  for (const name of writeOperations) {
    fsPromises[name] = async (path: unknown, ...args: unknown[]) => {
      if (!allowedFixtureMutation) {
        attemptedWrites.push(`${name}:${String(path)}`);
        throw Object.assign(new Error(`G5 edit observation ${name} denied by fixture guard`), { code: 'EPERM' });
      }
      return patched.get(name)!(path, ...args);
    };
  }
  (Buffer as unknown as { alloc: typeof Buffer.alloc }).alloc = ((size: number, ...args: unknown[]) => {
    allocations.push(size);
    return originalAlloc(size, ...(args as Parameters<typeof Buffer.alloc> extends [number, ...infer R] ? R : never));
  }) as typeof Buffer.alloc;
  syncBuiltinESMExports();
  let value: T | undefined;
  let error: unknown;
  try {
    value = await operation();
  } catch (caught) {
    error = caught;
  } finally {
    for (const [name, original] of patched) fsPromises[name] = original;
    (Buffer as unknown as { alloc: typeof Buffer.alloc }).alloc = originalAlloc;
    syncBuiltinESMExports();
  }
  return {
    value,
    error,
    contentBytesRead,
    readFileCalls,
    targetOpenPaths,
    allocations,
    attemptedWrites,
    fixtureMutationError,
  };
}

interface Hook {
  (event: Record<string, any>): Promise<void> | void;
}

async function loadHook(
  root: string,
  returnedSessionId?: string,
  returnedSessionDirectory = root,
): Promise<{ readonly hook: Hook; readonly dispose: () => Promise<void> }> {
  const pluginUrl = pathToFileURL(join(root, MANAGED_RESOURCES.pluginWrapper)).href;
  const plugin = (await import(pluginUrl)) as {
    readonly default: { setup(context: unknown): Promise<unknown> };
  };
  let permissionHook: Hook | undefined;
  const dispose = await plugin.default.setup({
    location: { directory: root },
    session: {
      hook: async () => ({ dispose: async () => undefined }),
      get: async ({ sessionID }: { readonly sessionID: string }) => ({
        id: returnedSessionId ?? sessionID,
        location: { directory: returnedSessionDirectory },
      }),
      context: async ({ sessionID }: { readonly sessionID: string }) => {
        assert.equal(sessionID, 'g5-session', 'public Session.context receives the event public sessionID');
        return assistantEditContext('g5-assistant-message', 'g5-current-tool', editInput(root));
      },
    },
    permission: {
      hook: async (_name: string, callback: Hook) => {
        permissionHook = callback;
        return { dispose: async () => undefined };
      },
    },
  });
  assert.ok(permissionHook);
  return {
    hook: permissionHook!,
    dispose: async () => {
      if (typeof dispose === 'function') await dispose();
    },
  };
}

function editEvent(metadata: unknown, effect: 'allow' | 'ask' | 'deny' = 'allow'): Record<string, any> {
  return {
    sessionID: 'g5-session',
    source: { type: 'tool', messageID: 'g5-assistant-message', id: 'g5-current-tool' },
    action: 'edit',
    resources: [join(process.env.SPEC015_TEST_REPOSITORY ?? '', 'src', 'edit.ts')],
    effect,
    metadata,
    message: undefined,
  };
}

function g5Envelope(referenceId: string, root: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changebudgetAuthority: {
      schema_version: 1,
      reference_id: referenceId,
      request: {
        operation: 'file.write',
        capabilities: ['source.edit'],
        paths: ['src/edit.ts'],
        ceilings: { max_files: 1, max_changed_lines: 2 },
        ...extra,
      },
    },
  };
}

function grantDraft(mode: 'REUSABLE' | 'ONE_SHOT' = 'REUSABLE', window: {
  readonly validFrom?: string;
  readonly expiresAt?: string;
} = {}): Record<string, unknown> {
  return {
    operations: ['file.write'],
    capabilities: ['source.edit'],
    path_scope: ['/src/**'],
    ceilings: { max_files: 60, max_changed_lines: 60 },
    permissions: { ...EMPTY_PERMISSIONS },
    mode,
    valid_from: window.validFrom ?? new Date(Date.now() - 60_000).toISOString(),
    expires_at: window.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString(),
  };
}

function actualSourceEdit(root: string) {
  return {
    action: 'edit',
    resources: [join(root, 'src', 'edit.ts')],
    input: editInput(root),
  };
}

test('G5 parser distinguishes absent, null, unknown, extra-field, and oversized references', () => {
  assert.deepEqual(parseAuthorityReference({}), { status: 'NO_REFERENCE' });
  assert.deepEqual(parseAuthorityReference(undefined), { status: 'NO_REFERENCE' });
  const accessorReference = {};
  Object.defineProperty(accessorReference, 'changebudgetAuthority', {
    enumerable: true,
    get: () => reference(randomUUID()).changebudgetAuthority,
  });
  assert.equal(parseAuthorityReference(accessorReference).status, 'MALFORMED',
    'an own accessor is present but cannot carry a trusted reference');
  const accessorMetadata = { changebudgetAuthority: reference(randomUUID()).changebudgetAuthority };
  Object.defineProperty(accessorMetadata, 'untrusted', { enumerable: true, get: () => 'ignored' });
  assert.equal(parseAuthorityReference(accessorMetadata).status, 'MALFORMED',
    'a present reference in a non-data metadata record must not degrade to absence');
  for (const metadata of [
    { changebudgetAuthority: null },
    { changebudgetAuthority: undefined },
    { changebudgetAuthority: { schema_version: 2, reference_id: randomUUID(), request: {} } },
    { changebudgetAuthority: { ...reference(randomUUID()).changebudgetAuthority as object, subject_id: 'forbidden' } },
    { changebudgetAuthority: {
      schema_version: 1,
      reference_id: randomUUID(),
      request: {
        operation: 'file.write',
        capabilities: Array.from({ length: 8 }, () => 'x'.repeat(512)),
        paths: ['src/edit.ts'],
        ceilings: { max_files: 1, max_changed_lines: 2 },
      },
    } },
  ]) {
    assert.equal(parseAuthorityReference(metadata).status, 'MALFORMED');
  }
  assert.deepEqual(parseAuthorityReference(reference(randomUUID())).status, 'PRESENT');
});

test('G5 source correlation requires the unique running builtin edit in the actual assistant context', () => {
  const messages: SessionMessageInfo[] = [{
    id: 'message-1',
    time: { created: 1 },
    type: 'assistant',
    agent: 'build',
    model: { id: 'fixture-model', providerID: 'fixture-provider' },
    content: [{
      type: 'tool',
      id: 'tool-1',
      name: 'edit',
      state: { status: 'running', input: { path: 'src/a.ts' }, metadata: {} },
      time: { created: 1 },
    }],
  }];
  const assistant = messages[0] as Extract<SessionMessageInfo, { readonly type: 'assistant' }>;
  const actualSource = { type: 'tool', messageID: 'message-1', id: 'tool-1' } as const;
  assert.deepEqual(findCurrentEditInput(messages, actualSource), {
    path: 'src/a.ts',
  });
  assert.equal(findCurrentEditInput(messages, { ...actualSource, messageID: 'forged' }), null);
  assert.equal(findCurrentEditInput(messages, { ...actualSource, type: 'client' }), null);
  assert.equal(findCurrentEditInput([{
    ...assistant,
    content: [...assistant.content, ...assistant.content],
  }], actualSource), null, 'duplicate matching tool parts are ambiguous');
  assert.equal(findCurrentEditInput([{
    ...assistant,
    content: [{
      type: 'tool',
      id: 'tool-1',
      name: 'edit',
      state: { status: 'completed', input: {}, content: [{ type: 'text', text: 'done' }] },
      time: { created: 1 },
    }],
  }], actualSource), null, 'completed tools are not current running inputs');
  assert.equal(findCurrentEditInput([{
    role: 'assistant',
    id: 'message-1',
    tools: [{ id: 'tool-1', name: 'edit', state: { status: 'running', input: { path: 'src/a.ts' } } }],
  } as unknown as SessionMessageInfo], actualSource), null, 'the obsolete role/tools mock shape is rejected');
});

test('G5 maps only bounded G4 verification reasons and preserves a narrower 18-line request', async () => {
  assert.equal(mapGrantVerificationResult({ status: 'VERIFIED', match: true }), 'VERIFIED');
  assert.equal(mapGrantVerificationResult({ status: 'REJECTED', match: false, reasons: ['NOT_FOUND'] }), 'UNKNOWN');
  assert.equal(mapGrantVerificationResult({ status: 'REJECTED', match: false, reasons: ['REVOKED'] }), 'REVOKED');
  assert.equal(mapGrantVerificationResult({ status: 'REJECTED', match: false, reasons: ['EXPIRED'] }), 'EXPIRED');
  assert.equal(mapGrantVerificationResult({ status: 'REJECTED', match: false, reasons: ['STALE_AUTHORITY'] }), 'STALE');
  assert.equal(mapGrantVerificationResult({ status: 'REJECTED', match: false, reasons: ['REPLAY'] }), 'REPLAYED');
  assert.equal(mapGrantVerificationResult({ status: 'REJECTED', match: false, reasons: ['UNTRUSTED_FAKE_REASON'] }), 'INVALID');
  for (const reason of [
    'REPOSITORY_MISMATCH', 'WORK_MISMATCH', 'SUBJECT_MISMATCH', 'OPERATION_MISMATCH',
    'CAPABILITY_MISMATCH', 'PATH_MISMATCH', 'CEILING_EXCEEDED', 'NOT_YET_VALID',
    'CORRUPT_STATE', 'UNSUPPORTED_SCHEMA', 'WORK_CONTEXT_UNAVAILABLE',
  ]) {
    assert.equal(mapGrantVerificationResult({ status: 'REJECTED', match: false, reasons: [reason] }), 'INVALID', reason);
  }

  const request = await buildAuthorityUseRequest({
    referenceId: randomUUID(),
    operation: 'file.write',
    capabilities: ['source.edit'],
    paths: ['src/eighteen.ts'],
    ceilings: { max_files: 1, max_changed_lines: 18 },
  }, {
    path: 'src/eighteen.ts',
    maxFiles: 1,
    maxChangedLines: 18,
    permissions: { ...EMPTY_PERMISSIONS },
  }, normalizeAuthorityUseRequest);
  assert.equal(request?.requested_ceilings.max_changed_lines, 18);
  const widenedDescriptor = {
    referenceId: randomUUID(),
    operation: 'file.write',
    capabilities: ['source.edit'],
    paths: ['src/eighteen.ts'],
    ceilings: { max_files: 1, max_changed_lines: 60 },
  };
  assert.equal(await buildAuthorityUseRequest(widenedDescriptor, {
    path: 'src/eighteen.ts',
    maxFiles: 1,
    maxChangedLines: 18,
    permissions: { ...EMPTY_PERMISSIONS },
  }, normalizeAuthorityUseRequest), null, 'grant ceilings are not substituted for the actual request');
  for (const unsupported of [
    { ...widenedDescriptor, operation: 'file.delete' },
    { ...widenedDescriptor, capabilities: ['source.read'] },
    { ...widenedDescriptor, paths: ['src/eighteen.ts', 'src/another.ts'] },
    { ...widenedDescriptor, ceilings: { max_files: 2, max_changed_lines: 18 } },
    { ...widenedDescriptor, ceilings: { max_files: 1, max_changed_lines: 19 } },
  ]) {
    assert.equal(await buildAuthorityUseRequest(unsupported, {
      path: 'src/eighteen.ts',
      maxFiles: 1,
      maxChangedLines: 18,
      permissions: { ...EMPTY_PERMISSIONS },
    }, normalizeAuthorityUseRequest), null);
  }
});

test('G5 actual builtin edit projection is literal, bounded, path-bound, and uses independent raw flags', async () => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-g5-edit-projection-');
  const target = join(root, 'src', 'edit.ts');
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(target, 'const value = 1;\nconst keep = true;\n', 'utf8');
    const sensitive = (path: string) => ({
      dependencies: path.endsWith('package.json'),
      migrations: false,
      config: false,
      publicApi: false,
    });
    const facts = await projectActualEdit({
      path: target,
      oldString: 'const value = 1;\n',
      newString: 'const value = 2;\n',
      replaceAll: false,
    }, [target], root, canonicalizeLiteralPath, countChangedTextLines, sensitive);
    assert.deepEqual(facts, {
      path: 'src/edit.ts',
      maxFiles: 1,
      maxChangedLines: 2,
      permissions: { ...EMPTY_PERMISSIONS },
    });
    const rawFlagFacts = await projectActualEdit({
      path: target,
      oldString: 'const value = 1;\n',
      newString: 'const value = 2;\n',
    }, [target], root, canonicalizeLiteralPath, countChangedTextLines, () => ({
      dependencies: true,
      migrations: true,
      config: true,
      publicApi: true,
    }));
    assert.deepEqual(rawFlagFacts?.permissions, {
      allow_new_files: false,
      allow_dependencies: true,
      allow_migrations: true,
      allow_configuration: true,
      allow_public_api: true,
    }, 'actual edit facts preserve the raw independent path flags and existing-file route');

    const unsupportedInputs = [
      { path: target, oldString: 'const value = 1;\n', newString: 'const value = 2;\n', replaceAll: true },
      { path: target, oldString: 'missing', newString: 'replacement' },
      { path: target, oldString: 'const value = 1;\n', newString: 'const value = 1;\n' },
      { path: target, oldString: 'const value = 1; \n', newString: 'const value = 2; \n' },
      { path: target, oldString: 'const value = 1;\r\n', newString: 'const value = 2;\r\n' },
      { path: target, oldString: 'const value = 1;\n', newString: 'const value = 2;\n', extra: true },
    ];
    for (const input of unsupportedInputs) {
      assert.equal(await projectActualEdit(input, [target], root, canonicalizeLiteralPath,
        countChangedTextLines, sensitive), null);
    }
    assert.equal(await projectActualEdit({
      path: join(root, 'src', 'new.ts'),
      oldString: 'before',
      newString: 'after',
    }, [join(root, 'src', 'new.ts')], root, canonicalizeLiteralPath, countChangedTextLines, sensitive), null,
    'new-file writes are outside the exact existing-file subset');
    assert.equal(await projectActualEdit({
      path: target,
      oldString: 'x'.repeat(64 * 1024 + 1),
      newString: 'replacement',
    }, [target], root, canonicalizeLiteralPath, countChangedTextLines, sensitive), null,
    'oversized native edit arguments fail closed');
    await writeFile(target, Buffer.from([0xc3, 0x28]));
    assert.equal(await projectActualEdit({
      path: target,
      oldString: 'before',
      newString: 'after',
    }, [target], root, canonicalizeLiteralPath, countChangedTextLines, sensitive), null,
    'invalid UTF-8 in the current file is unsupported');
    assert.equal(await projectActualEdit({
      path: target,
      oldString: 'const value = 1;\n',
      newString: 'const value = 2;\n',
    }, [join(root, 'src', 'other.ts')], root, canonicalizeLiteralPath, countChangedTextLines, sensitive), null);
    assert.equal(await projectActualEdit({
      path: target,
      oldString: 'const value = 1;\n',
      newString: 'const value = 2;\n',
    }, [target, target], root, canonicalizeLiteralPath, countChangedTextLines, sensitive), null);
  } finally {
    await removeTestRepository(root);
  }
});

test('G5 file observation reads only a bounded, identity-pinned regular fixture', async (t) => {
  const root = await createTestFixtureDirectory(approvedTempBase(), 'cb-g5-pinned-read-');
  const outsideRoot = join(dirname(root), `${basename(root)}-outside`);
  const target = join(root, 'src', 'edit.ts');
  const input = {
    path: target,
    oldString: 'const value = 1;\n',
    newString: 'const value = 2;\n',
  };
  const classify = () => ({ dependencies: false, migrations: false, config: false, publicApi: false });
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    const stableBytes = Buffer.from('const value = 1;\n', 'utf8');
    await writeFile(target, stableBytes);
    await writeFile(target, Buffer.alloc(256 * 1024 + 1, 0x61));
    const oversized = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ));
    assert.equal(oversized.value, null);
    assert.equal(oversized.contentBytesRead, 0, 'known oversized files are rejected before any content read');
    assert.equal(oversized.readFileCalls, 0);
    assert.deepEqual(oversized.allocations, [], 'an oversized stat cannot drive a content-sized allocation');
    assert.deepEqual(oversized.attemptedWrites, []);

    await writeFile(target, stableBytes);
    const missingIdentity = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { zeroTargetIdentity: true });
    assert.equal(missingIdentity.value, null, 'unusable physical leaf identity fails closed');
    assert.equal(missingIdentity.contentBytesRead, 0, 'content is not read without qualified identity');
    assert.deepEqual(missingIdentity.attemptedWrites, []);

    await mkdir(outsideRoot, { recursive: true });
    const outsideSynthetic = join(outsideRoot, 'outside.txt');
    await writeFile(outsideSynthetic, stableBytes);
    const escaped = await withG5ReadProbe(outsideSynthetic, () => projectActualEdit(
      { ...input, path: outsideSynthetic }, [outsideSynthetic], root,
      canonicalizeLiteralPath, countChangedTextLines, classify,
    ));
    assert.equal(escaped.value, null, 'an out-of-repository synthetic file is rejected');
    assert.equal(escaped.contentBytesRead, 0);
    assert.deepEqual(escaped.attemptedWrites, []);

    const linkedPath = join(root, 'src', 'outside-link.ts');
    let symlinkCreated = false;
    try {
      await symlink(outsideSynthetic, linkedPath, 'file');
      symlinkCreated = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EACCES') throw error;
      t.diagnostic(`Synthetic symlink fixture unavailable (${code}); no symlink-race behavior is claimed.`);
    }
    if (symlinkCreated) {
      const linked = await withG5ReadProbe(linkedPath, () => projectActualEdit(
        { ...input, path: linkedPath }, [linkedPath], root,
        canonicalizeLiteralPath, countChangedTextLines, classify,
      ));
      assert.equal(linked.value, null, 'a static symlink to outside synthetic data is rejected');
      assert.equal(linked.contentBytesRead, 0);
    } else {
      await writeFile(linkedPath, stableBytes);
      const mockedLink = await withG5ReadProbe(linkedPath, () => projectActualEdit(
        { ...input, path: linkedPath }, [linkedPath], root,
        canonicalizeLiteralPath, countChangedTextLines, classify,
      ), { markTargetAsSymlink: true });
      assert.equal(mockedLink.value, null, 'the existing read-only stat seam proves symlink rejection when Windows denies fixture creation');
      assert.equal(mockedLink.contentBytesRead, 0);
      assert.deepEqual(mockedLink.attemptedWrites, []);
    }

    let parentReplaced = false;
    let replacementError: unknown;
    const replaceParent = async (): Promise<void> => {
      try {
        await rename(join(root, 'src'), join(root, 'src-original'));
        await mkdir(join(root, 'src'));
        await writeFile(target, stableBytes);
        parentReplaced = true;
      } catch (error) {
        replacementError = error;
        throw error;
      }
    };
    const replacedParent = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { replaceParentBeforeOpen: replaceParent });
    if (!parentReplaced && (replacementError as NodeJS.ErrnoException | undefined)?.code === 'EPERM') {
      t.diagnostic('Windows denied replacement of the synthetic fixture parent with EPERM; this parent-race case is not claimed as passed.');
    } else {
      assert.equal(parentReplaced, true, `synthetic fixture parent replacement succeeded: ${String(replacementError ?? '')}`);
      assert.equal(replacedParent.value, null, 'parent incarnation replacement fails before edit projection');
      assert.equal(replacedParent.contentBytesRead, 0, 'no leaf content is read after the parent identity changes');
      assert.deepEqual(replacedParent.attemptedWrites, []);
    }

    await writeFile(target, stableBytes);
    let leafReplaced = false;
    let leafReplacementError: unknown;
    const replaceLeaf = async (): Promise<void> => {
      try {
        await rename(target, join(root, 'src', 'edit-original.ts'));
        await writeFile(target, stableBytes);
        leafReplaced = true;
      } catch (error) {
        leafReplacementError = error;
        throw error;
      }
    };
    const replacedLeaf = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { replaceLeafBeforeOpen: replaceLeaf });
    if (!leafReplaced && (leafReplacementError as NodeJS.ErrnoException | undefined)?.code === 'EPERM') {
      t.diagnostic('Windows denied replacement of the synthetic fixture leaf with EPERM; this leaf-race case is not claimed as passed.');
    } else {
      assert.equal(leafReplaced, true, `synthetic fixture leaf replacement succeeded: ${String(leafReplacementError ?? '')}`);
      assert.equal(replacedLeaf.value, null, 'leaf incarnation replacement fails before edit projection');
      assert.equal(replacedLeaf.contentBytesRead, 0, 'the replacement leaf is rejected before content is read');
      assert.deepEqual(replacedLeaf.attemptedWrites, []);
    }

    await writeFile(target, stableBytes);
    const externalSynthetic = join(root, 'outside-synthetic.txt');
    await writeFile(externalSynthetic, stableBytes);
    const substitutedLeaf = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { substituteTargetOpen: externalSynthetic });
    assert.equal(substitutedLeaf.value, null, 'a synthetic out-of-repository leaf handle is not accepted');
    assert.equal(substitutedLeaf.contentBytesRead, 0, 'the mismatched opened leaf is rejected before content read');
    assert.equal(substitutedLeaf.targetOpenPaths[0], resolve(externalSynthetic));
    assert.deepEqual(substitutedLeaf.attemptedWrites, []);

    const changedAfterRead = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { alterTargetHandleStatsAfterRead: true });
    assert.equal(changedAfterRead.value, null, 'post-read ctime/mtime drift discards the projection');
    assert.ok(changedAfterRead.contentBytesRead <= 256 * 1024, 'all content reads remain within the aggregate byte bound');
    assert.deepEqual(changedAfterRead.attemptedWrites, []);

    const contentChangedAfterRead = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { changeTargetContentsAfterRead: async () => writeFile(target, 'const value = 3;\n', 'utf8') });
    if ((contentChangedAfterRead.fixtureMutationError as NodeJS.ErrnoException | undefined)?.code === 'EPERM') {
      t.diagnostic('Windows denied the fixture-only post-read content mutation with EPERM; mocked ctime/mtime drift is the executed fallback.');
    } else {
      assert.equal(contentChangedAfterRead.fixtureMutationError, undefined);
      assert.equal(contentChangedAfterRead.value, null, 'an actual fixture content change after the read invalidates the projection');
      assert.ok(contentChangedAfterRead.contentBytesRead <= 256 * 1024);
    }
    assert.deepEqual(contentChangedAfterRead.attemptedWrites, []);
    await writeFile(target, stableBytes);

    const eofAfterOpen = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { changeTargetContentsBeforeRead: async () => writeFile(target, Buffer.alloc(0)) });
    if ((eofAfterOpen.fixtureMutationError as NodeJS.ErrnoException | undefined)?.code === 'EPERM') {
      t.diagnostic('Windows denied the fixture-only truncation with EPERM; unexpected-EOF behavior is not claimed by this run.');
    } else {
      assert.equal(eofAfterOpen.fixtureMutationError, undefined);
      assert.equal(eofAfterOpen.value, null, 'an unexpected EOF after the verified initial size discards the projection');
      assert.equal(eofAfterOpen.contentBytesRead, 0);
      assert.ok(eofAfterOpen.allocations.reduce((total, size) => total + size, 0) <= 256 * 1024);
    }
    assert.deepEqual(eofAfterOpen.attemptedWrites, []);
    await writeFile(target, stableBytes);

    const actualGrowthAfterRead = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { changeTargetContentsAfterRead: async () => appendFile(target, 'growth\n', 'utf8') });
    if ((actualGrowthAfterRead.fixtureMutationError as NodeJS.ErrnoException | undefined)?.code === 'EPERM') {
      t.diagnostic('Windows denied fixture-only append during the open read with EPERM; mocked post-read size drift remains the executed growth fallback.');
    } else {
      assert.equal(actualGrowthAfterRead.fixtureMutationError, undefined);
      assert.equal(actualGrowthAfterRead.value, null, 'actual growth during the pinned read invalidates the projection');
      assert.ok(actualGrowthAfterRead.contentBytesRead <= 256 * 1024, 'actual growth never expands the original bounded read');
    }
    assert.deepEqual(actualGrowthAfterRead.attemptedWrites, []);
    await writeFile(target, stableBytes);

    const grewAfterRead = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { growTargetHandleAfterRead: true });
    assert.equal(grewAfterRead.value, null, 'post-read size growth discards the projection');
    assert.ok(grewAfterRead.contentBytesRead <= 256 * 1024, 'growth never triggers a second or unbounded content read');
    assert.deepEqual(grewAfterRead.attemptedWrites, []);

    const replacedAfterRead = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ), { replaceTargetHandleIdentityAfterRead: true });
    assert.equal(replacedAfterRead.value, null, 'post-read leaf identity drift discards the projection');
    assert.ok(replacedAfterRead.contentBytesRead <= 256 * 1024);
    assert.deepEqual(replacedAfterRead.attemptedWrites, []);

    await writeFile(target, stableBytes);
    const stable = await withG5ReadProbe(target, () => projectActualEdit(
      input, [target], root, canonicalizeLiteralPath, countChangedTextLines, classify,
    ));
    assert.equal(stable.error, undefined);
    assert.equal(stable.value?.path, 'src/edit.ts', 'a stable, identified fixture remains supported');
    assert.equal(stable.contentBytesRead, stableBytes.byteLength, 'the pinned file contents are read once within their size');
    assert.equal(stable.readFileCalls, 0, 'the unsafe path-based whole-file API is not used');
    assert.ok(stable.allocations.every((size) => size <= 256 * 1024));
    assert.ok(stable.allocations.reduce((total, size) => total + size, 0) <= 256 * 1024);
    assert.deepEqual(stable.attemptedWrites, [], 'a positive stable observation performs no filesystem mutations');
  } finally {
    await removeTestRepository(root);
    await removeTestRepository(outsideRoot);
  }
});

test('read-only changed-line projection matches Git numstat for an ordinary text edit', async () => {
  const root = await createRepository('cb-g5-diff-parity-');
  try {
    const before = 'one\ntwo\nthree\n';
    const after = 'one\nchanged\nthree\nextra\n';
    await writeFile(join(root, 'src', 'edit.ts'), before, 'utf8');
    git(root, ['add', 'src/edit.ts']);
    git(root, ['commit', '--quiet', '-m', 'baseline diff parity']);
    await writeFile(join(root, 'src', 'edit.ts'), after, 'utf8');
    const counted = countChangedTextLines(before, after);
    const item = (await collectChangedItems(root, 'HEAD')).find((change) => change.path === 'src/edit.ts');
    assert.ok(item);
    assert.deepEqual(counted, { addedLines: item.addedLines, removedLines: item.removedLines });
    assert.equal(counted?.addedLines + counted?.removedLines, 3);
  } finally {
    await removeTestRepository(root);
  }
});

test('G5 full plugin path preserves absent/verified Phase A output and fails closed on invalid references', {
  skip: process.platform === 'darwin' ? 'no isolated default registry override on macOS' : false,
}, async () => {
  const root = await createRepository('cb-g5-transport-runtime-');
  const envName = process.platform === 'win32' ? 'LOCALAPPDATA' : 'XDG_STATE_HOME';
  const priorRegistryHome = process.env[envName];
  const isolatedRegistryHome = join(dirname(root), `${basename(root)}-local-data`);
  const registryPath = process.platform === 'win32'
    ? join(isolatedRegistryHome, 'ChangeBudget-Authority', 'registry-v1.json')
    : join(isolatedRegistryHome, 'ChangeBudget-Authority', 'registry-v1.json');
  try {
    await mkdir(isolatedRegistryHome, { recursive: true });
    process.env[envName] = isolatedRegistryHome;

    const service = createAuthorityService({ registryPath });
    const reusable = await service.createGrant(root, grantDraft());
    const revoked = await service.createGrant(root, grantDraft());
    await service.revokeGrant(root, revoked.grant_id, revoked.grant_digest);
    const consumed = await service.createGrant(root, grantDraft('ONE_SHOT'));
    const consumedRequest = normalizeAuthorityUseRequest({
      grant_reference_id: consumed.grant_id,
      requested_operation: 'file.write',
      requested_capabilities: ['source.edit'],
      requested_paths: ['src/edit.ts'],
      requested_ceilings: { max_files: 1, max_changed_lines: 2 },
      requested_permissions: { ...EMPTY_PERMISSIONS },
    });
    assert.equal((await service.authorizeUse(root, consumedRequest)).status, 'USE_ACCEPTED');
    const oldNow = new Date('2025-01-01T00:00:00.000Z');
    const expiredService = createAuthorityService({ registryPath, now: () => new Date(oldNow) });
    const expired = await expiredService.createGrant(root, grantDraft('REUSABLE', {
      validFrom: '2024-12-31T00:00:00.000Z',
      expiresAt: '2025-01-02T00:00:00.000Z',
    }));

    const { hook, dispose } = await loadHook(root);
    try {
      process.env.SPEC015_TEST_REPOSITORY = root;
      const checkResult = await runCheck(root);
      assert.equal(checkResult.decision, 'PASS', `fixture must begin with an accepted Phase A check: ${JSON.stringify(checkResult)}`);
      const absent = editEvent({}, 'allow');
      await hook(absent);
      const beforeBytes = await readFile(registryPath);
      const valid = editEvent(g5Envelope(reusable.grant_id, root), 'allow');
      await hook(valid);
      assert.equal(valid.effect, 'allow', `the bounded reusable reference verifies: ${valid.message ?? '(no message)'}`);
      assert.equal(valid.effect, absent.effect, 'a verified reference must preserve Phase A effect');
      assert.equal(valid.message, absent.message, 'a verified reference must preserve Phase A message');

      const mismatchedSession = editEvent(g5Envelope(reusable.grant_id, root), 'allow');
      const mismatchedSessionHook = await loadHook(root, 'different-session-id');
      try {
        await mismatchedSessionHook.hook(mismatchedSession);
      } finally {
        await mismatchedSessionHook.dispose();
      }
      assert.equal(mismatchedSession.effect, 'deny', 'public session info must identify the requested session');

      const mismatchedSessionDirectory = `${root}-other-session`;
      await mkdir(mismatchedSessionDirectory, { recursive: true });
      const mismatchedRootEvent = editEvent(g5Envelope(reusable.grant_id, root), 'allow');
      const mismatchedRootHook = await loadHook(root, undefined, mismatchedSessionDirectory);
      try {
        await mismatchedRootHook.hook(mismatchedRootEvent);
      } finally {
        await mismatchedRootHook.dispose();
        await removeTestRepository(mismatchedSessionDirectory);
      }
      assert.equal(mismatchedRootEvent.effect, 'deny', 'session location must resolve to the plugin repository');

      const repeated = editEvent(g5Envelope(reusable.grant_id, root), 'ask');
      await hook(repeated);
      assert.equal(repeated.effect, 'ask', 'incoming ask is never upgraded');
      const afterBytes = await readFile(registryPath);
      assert.deepEqual(afterBytes, beforeBytes, 'verification from the hook is strictly read-only, including repeats');

      const cases: readonly [string, Record<string, unknown>, 'allow' | 'ask'][] = [
        ['unknown', g5Envelope(randomUUID(), root), 'allow'],
        ['revoked', g5Envelope(revoked.grant_id, root), 'allow'],
        ['expired', g5Envelope(expired.grant_id, root), 'allow'],
        ['replayed', g5Envelope(consumed.grant_id, root), 'allow'],
        ['wrong-operation', g5Envelope(reusable.grant_id, root, { operation: 'file.delete' }), 'allow'],
        ['wrong-capability', g5Envelope(reusable.grant_id, root, { capabilities: ['source.read'] }), 'allow'],
        ['overstated-ceiling', g5Envelope(reusable.grant_id, root, {
          ceilings: { max_files: 1, max_changed_lines: 60 },
        }), 'allow'],
        ['wrong-path', g5Envelope(reusable.grant_id, root, { paths: ['src/other.ts'] }), 'allow'],
        ['extra-authority-field', {
          changebudgetAuthority: {
            ...(g5Envelope(reusable.grant_id, root).changebudgetAuthority as Record<string, unknown>),
            work_id: randomUUID(),
          },
        }, 'allow'],
        ['invalid-under-generic-ask', { changebudgetAuthority: null }, 'ask'],
      ];
      for (const [name, metadata, incoming] of cases) {
        const event = editEvent(metadata, incoming);
        await hook(event);
        assert.equal(event.effect, 'deny', `${name}: present invalid reference blocks`);
        assert.match(event.message ?? '', /OCG-AUTHORITY-REFERENCE/);
      }

      const mismatchedResource = editEvent(g5Envelope(reusable.grant_id, root), 'allow');
      mismatchedResource.resources = [join(root, 'src', 'other.ts')];
      await hook(mismatchedResource);
      assert.equal(mismatchedResource.effect, 'deny', 'the host resource must match the current edit input path');

      const lifecycleReference = editEvent(g5Envelope(reusable.grant_id, root), 'allow');
      lifecycleReference.action = 'shell';
      lifecycleReference.resources = ['changebudget close'];
      await hook(lifecycleReference);
      assert.equal(lifecycleReference.effect, 'deny', 'a file-write reference cannot allow lifecycle commands');

      const noSource = editEvent(g5Envelope(reusable.grant_id, root), 'allow');
      noSource.source = undefined;
      await hook(noSource);
      assert.equal(noSource.effect, 'deny', 'session/tool IDs must correlate to the actual running builtin edit');

      const hostDeny = editEvent(g5Envelope(reusable.grant_id, root), 'deny');
      await hook(hostDeny);
      assert.equal(hostDeny.effect, 'deny', 'a stricter incoming deny remains deny');

      const contractState = JSON.parse(await readFile(join(root, '.changebudget', 'state.json'), 'utf8')) as {
        active_contract_id: string | null;
      };
      assert.ok(contractState.active_contract_id);
      const contract = await readContract(root, contractState.active_contract_id);
      assert.ok(contract.max_changed_lines !== null);
      await writeContract(root, { ...contract, max_changed_lines: contract.max_changed_lines - 1 });
      const stale = editEvent(g5Envelope(reusable.grant_id, root), 'allow');
      await hook(stale);
      assert.equal(stale.effect, 'deny');
      assert.match(stale.message ?? '', /AUTHORITY_STALE/);
    } finally {
      delete process.env.SPEC015_TEST_REPOSITORY;
      await dispose();
    }
  } finally {
    if (priorRegistryHome === undefined) delete process.env[envName];
    else process.env[envName] = priorRegistryHome;
    await removeTestRepository(root);
    await removeTestRepository(isolatedRegistryHome);
  }
});
