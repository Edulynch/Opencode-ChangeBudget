import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createIntegrationRefreshProgress, createNpmUpdateProgress } from '../../../../src/core/update/progress.js';

describe('npm update progress', () => {
  it('prints stable non-TTY start and success messages without a timer', () => {
    const output: string[] = [];
    let intervalCalls = 0;
    const progress = createNpmUpdateProgress({
      isTTY: false,
      write: (message) => output.push(message),
      setInterval: () => {
        intervalCalls += 1;
        return setInterval(() => undefined, 1_000);
      },
      clearInterval,
    });

    progress.start('1.2.4');
    progress.stop('1.2.4', 'success');

    assert.deepEqual(output, [
      'Installing and verifying changebudget@1.2.4...\n',
      'Installed and verified changebudget@1.2.4.\n',
    ]);
    assert.equal(output.some((message) => message.includes('\r')), false);
    assert.equal(intervalCalls, 0);
  });

  it('redraws one TTY line and clears its interval after failure', () => {
    const events: string[] = [];
    let tick: (() => void) | undefined;
    let cleared = 0;
    const progress = createNpmUpdateProgress({
      isTTY: true,
      write: (message) => events.push(`write:${message}`),
      clearLine: () => events.push('clear'),
      cursorTo: () => events.push('cursor'),
      setInterval: (callback: () => void) => {
        tick = callback;
        return setInterval(() => undefined, 1_000);
      },
      clearInterval: (timer: NodeJS.Timeout) => {
        clearInterval(timer);
        cleared += 1;
      },
    });

    progress.start('1.2.4');
    tick?.();
    progress.stop('1.2.4', 'failure');

    assert.equal(cleared, 1);
    assert.deepEqual(events, [
      'clear', 'cursor', 'write:- Installing and verifying changebudget@1.2.4...',
      'clear', 'cursor', 'write:\\ Installing and verifying changebudget@1.2.4...',
      'clear', 'cursor', 'write:Failed to install and verify changebudget@1.2.4.\n',
    ]);
  });

  it('prints refresh progress only through explicit start and stop calls', () => {
    const output: string[] = [];
    const progress = createIntegrationRefreshProgress({
      isTTY: false,
      write: (message) => output.push(message),
    });

    progress.start('opencode');
    progress.stop('opencode', 'failure');

    assert.deepEqual(output, [
      'Refreshing managed integration: opencode...\n',
      'Integration needs attention: opencode.\n',
    ]);
  });
});
