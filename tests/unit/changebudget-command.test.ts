import * as assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

import {
  classifyChangeBudgetCommand,
  resolveKnownChangeBudgetExecutables,
} from '../../opencode-plugin/src/changebudget-command.js';

test('ChangeBudget read-only CLI grammar is classified explicitly', () => {
  const commands = [
    ['changebudget', '--version'],
    ['changebudget.cmd', '--help'],
    ['changebudget.exe', 'help'],
    ['changebudget', 'help', 'status'],
    ['changebudget', 'status'],
    ['changebudget', 'status', '--budget'],
    ['changebudget', 'status', '--budget', '--json'],
    ['changebudget', 'status', '--budget', '--json=TRUE'],
    ['changebudget', 'diagnose', '--allow-path', 'src/example.ts', '--json'],
    ['changebudget', 'diagnose', 'T104', '--json'],
    ['changebudget', 'check'],
    ['changebudget', 'check', '--json'],
    ['changebudget', 'update', '--check'],
    ['changebudget', 'integrate', 'opencode', '--dry-run'],
    ['changebudget', 'init', '--help'],
    ['changebudget', 'integrate', 'opencode', '--help'],
  ];

  for (const command of commands) {
    assert.equal(classifyChangeBudgetCommand(command), 'read-only', command.join(' '));
  }
});

test('ChangeBudget managed and approval-required operations remain mutations', () => {
  const managedCommands = [
    ['changebudget', 'init'],
    ['changebudget', 'start', '--task', 'Runtime guard lifecycle test', '--allow-path', 'src/example.ts'],
    ['changebudget', 'start', '--task', 'Runtime guard lifecycle test', '--execution-envelope-json', '{}'],
    ['changebudget', 'amend', '--max-files', '3'],
    ['changebudget', 'amend', '--allow-path', 'src/new.ts', '--reason', 'approved scope'],
    ['changebudget', 'close'],
    ['changebudget', 'integrate', 'opencode'],
    ['changebudget', 'integrate', 'opencode', '--remove'],
    ['changebudget', 'check', '--satisfaction-evidence-json', '{"satisfied":[{"criterion_ref":"AC-1","evidence":["verified"]}]}'],
  ];
  for (const command of managedCommands) {
    assert.equal(classifyChangeBudgetCommand(command), 'managed-mutation', command.join(' '));
  }

  assert.equal(
    classifyChangeBudgetCommand(['changebudget', 'close', '--force', '--reason', 'developer-authorized recovery']),
    'force-close',
  );
  assert.equal(classifyChangeBudgetCommand(['changebudget', 'update']), 'external-mutation');
  assert.equal(classifyChangeBudgetCommand(['changebudget', 'check', '--satisfaction-evidence-json']), 'unsupported');
  assert.equal(classifyChangeBudgetCommand(['changebudget', 'check', '--satisfaction-evidence-json', '{bad json']), 'unsupported');
  assert.equal(classifyChangeBudgetCommand(['changebudget', 'check', '--satisfaction-evidence-json', '{"satisfied":[]}']), 'unsupported');
  assert.equal(classifyChangeBudgetCommand(['changebudget', 'close', '--force']), 'unsupported');
});

test('unknown, malformed, and shell-like ChangeBudget commands fail closed', () => {
  const commands = [
    ['changebudget', 'unknown-command'],
    ['changebudget', 'status', '--unknown'],
    ['changebudget', 'status', '--json'],
    ['changebudget', 'start', '--task'],
    ['changebudget', 'start', '--task', 'task', '--unknown', 'value'],
    ['changebudget', 'start', '--task', 'task', '--execution-envelope-json', 'invalid'],
    ['changebudget', 'start', '--task', 'task', '--execution-envelope-json', '{}', '--execution-envelope-json', '{}'],
    ['changebudget', 'amend', '--max-files', '-1'],
    ['changebudget', 'amend', '--allow-path', '../outside.ts', '--reason', 'approved scope'],
    ['changebudget', 'amend', '--allow-path', '.changebudget/state.json', '--reason', 'approved scope'],
    ['changebudget', 'amend', '--allow-path', 'src/file.ts,src//file.ts', '--reason', 'approved scope'],
    ['changebudget', 'integrate', 'wrong-target'],
    ['changebudget', 'integrate', 'opencode', '--dry-run', '--remove'],
    ['changebudget', 'update', '--unknown'],
    ['changebudget', 'help', 'unknown-command'],
  ];
  for (const command of commands) {
    assert.equal(classifyChangeBudgetCommand(command), 'unsupported', command.join(' '));
  }

  assert.equal(classifyChangeBudgetCommand(['changebudget', 'status', '&&', 'git', 'add']), 'unsupported');
  assert.equal(classifyChangeBudgetCommand(['C:\\tools\\my-changebudget-wrapper.exe', 'status']), null);
  assert.equal(
    classifyChangeBudgetCommand(['C:\\tools\\changebudget.exe', 'status'], ['C:\\tools\\changebudget.exe']),
    'read-only',
  );
  assert.equal(
    classifyChangeBudgetCommand(['C:\\untrusted\\changebudget.exe', 'status'], ['C:\\trusted\\changebudget.exe']),
    null,
  );
});

test('absolute executable discovery verifies the shim target is this ChangeBudget package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cb-cli-shim-'));
  try {
    const packageRoot = join(root, 'node_modules', 'changebudget');
    const cliEntry = join(packageRoot, 'dist', 'src', 'cli', 'index.js');
    await mkdir(join(packageRoot, 'dist', 'src', 'cli'), { recursive: true });
    await writeFile(cliEntry, '#!/usr/bin/env node\n', 'utf8');

    let expectedExecutable: string;
    if (process.platform === 'win32') {
      expectedExecutable = join(root, 'changebudget.cmd');
      await writeFile(
        expectedExecutable,
        '@ECHO off\r\n"%dp0%\\node_modules\\changebudget\\dist\\src\\cli\\index.js" %*\r\n',
        'utf8',
      );
    } else {
      const binDirectory = join(root, 'bin');
      await mkdir(binDirectory, { recursive: true });
      expectedExecutable = join(binDirectory, 'changebudget');
      await symlink(cliEntry, expectedExecutable);
    }

    const found = resolveKnownChangeBudgetExecutables(packageRoot, dirname(expectedExecutable));
    assert.ok(found.some((candidate) => resolve(candidate) === resolve(expectedExecutable)));
    assert.equal(
      classifyChangeBudgetCommand([expectedExecutable, 'status'], found),
      'read-only',
    );

    const decoyDirectory = join(root, 'decoys');
    await mkdir(decoyDirectory, { recursive: true });
    const decoy = join(decoyDirectory, 'my-changebudget-wrapper.exe');
    await writeFile(decoy, 'not the installed ChangeBudget CLI', 'utf8');
    assert.equal(
      classifyChangeBudgetCommand([decoy, 'status'], found),
      null,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
