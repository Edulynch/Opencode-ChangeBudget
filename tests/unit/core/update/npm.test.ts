import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { spawn } from 'node:child_process';

import {
  buildNpmArgs,
  buildPackageSpec,
  runSelfUpdate,
  runSelfUpdateUnix,
  runSelfUpdateWindows,
  type SpawnProcess,
} from '../../../../src/core/update/npm.js';
import { parseSemVer, type SemVer } from '../../../../src/core/update/version.js';

type SpawnRecord = {
  command: string;
  args: string[];
  shell: boolean | string | undefined;
};

function makeVersion(tag: string): SemVer {
  const parsed = parseSemVer(tag);
  if (parsed === null) throw new Error(`Invalid test version: ${tag}`);
  return parsed;
}

function fakeSpawn(
  records: SpawnRecord[],
  finish: (child: ReturnType<typeof spawn>) => void,
): SpawnProcess {
  return (command, args, options) => {
    records.push({ command, args, shell: options.shell });
    const child = new EventEmitter() as unknown as ReturnType<typeof spawn>;
    Object.assign(child, {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    queueMicrotask(() => finish(child));
    return child;
  };
}

describe('core/update/npm', () => {
  it('builds the explicit validated GitHub package spec and argv', () => {
    assert.equal(
      buildPackageSpec(makeVersion('v1.2.3')),
      'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
    );
    assert.deepEqual(buildNpmArgs('github:Edulynch/Opencode-ChangeBudget#v1.2.3'), [
      'install',
      '-g',
      '--ignore-scripts',
      '--allow-git=all',
      'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
    ]);
  });

  it('uses npm, structured argv, and no shell on Unix/macOS', async () => {
    const records: SpawnRecord[] = [];
    const result = await runSelfUpdateUnix(
      'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
      fakeSpawn(records, (child) => child.emit('exit', 0, null)),
    );
    assert.equal(result.success, true);
    assert.deepEqual(records[0], {
      command: 'npm',
      args: [
        'install',
        '-g',
        '--ignore-scripts',
        '--allow-git=all',
        'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
      ],
      shell: false,
    });
  });

  it('uses ComSpec and preserves spaces on Windows', async () => {
    const previous = process.env.ComSpec;
    process.env.ComSpec = 'C:\\Program Files\\cmd.exe';
    try {
      const records: SpawnRecord[] = [];
      await runSelfUpdateWindows(
        'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
        fakeSpawn(records, (child) => child.emit('exit', 0, null)),
      );
      assert.equal(records[0].command, 'C:\\Program Files\\cmd.exe');
      assert.deepEqual(records[0].args, [
        '/C',
        'npm install -g --ignore-scripts --allow-git=all github:Edulynch/Opencode-ChangeBudget#v1.2.3',
      ]);
      assert.equal(records[0].shell, false);
    } finally {
      if (previous === undefined) delete process.env.ComSpec;
      else process.env.ComSpec = previous;
    }
  });

  it('falls back to cmd.exe and dispatches by platform', async () => {
    const previous = process.env.ComSpec;
    delete process.env.ComSpec;
    try {
      const records: SpawnRecord[] = [];
      await runSelfUpdate(
        makeVersion('v1.2.3'),
        fakeSpawn(records, (child) => child.emit('exit', 0, null)),
        'win32',
      );
      assert.equal(records[0].command, 'cmd.exe');
    } finally {
      if (previous !== undefined) process.env.ComSpec = previous;
    }
  });

  it('classifies non-zero exit and interruption', async () => {
    const records: SpawnRecord[] = [];
    const failed = await runSelfUpdateUnix(
      'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
      fakeSpawn(records, (child) => child.emit('exit', 7, null)),
    );
    assert.equal(failed.success, false);
    assert.equal(failed.exitCode, 7);
    assert.deepEqual(records[0].args, [
      'install',
      '-g',
      '--ignore-scripts',
      '--allow-git=all',
      'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
    ]);

    const interrupted = await runSelfUpdateUnix(
      'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
      fakeSpawn([], (child) => child.emit('exit', null, 'SIGTERM')),
    );
    assert.equal(interrupted.interrupted, true);
    assert.equal(interrupted.signal, 'SIGTERM');
  });

  it('classifies an unavailable executable without launching npm', async () => {
    const result = await runSelfUpdateUnix(
      'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
      fakeSpawn([], (child) => child.emit('error', new Error('ENOENT'))),
    );
    assert.equal(result.success, false);
    assert.equal(result.exitCode, null);
    assert.equal(result.errorMessage, 'ENOENT');
  });

  it('captures output and never performs a real installation', async () => {
    const result = await runSelfUpdateUnix(
      'github:Edulynch/Opencode-ChangeBudget#v1.2.3',
      fakeSpawn([], (child) => {
        child.stdout?.emit('data', Buffer.from('out'));
        child.stderr?.emit('data', Buffer.from('err'));
        child.emit('exit', 0, null);
      }),
    );
    assert.equal(result.stdout, 'out');
    assert.equal(result.stderr, 'err');
  });
});
