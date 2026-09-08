import { stdout } from 'node:process';
import { clearLine, cursorTo } from 'node:readline';

export type UpdateProgressResult = 'success' | 'failure';

interface OperationProgress {
  start(subject: string): void;
  stop(subject: string, result: UpdateProgressResult): void;
}

export interface NpmUpdateProgress extends OperationProgress {}

export interface IntegrationRefreshProgress extends OperationProgress {}

export interface UpdateProgressDependencies {
  readonly isTTY: boolean;
  readonly write: (message: string) => void;
  readonly clearLine: () => void;
  readonly cursorTo: () => void;
  readonly setInterval: (callback: () => void, milliseconds: number) => NodeJS.Timeout;
  readonly clearInterval: (timer: NodeJS.Timeout) => void;
}

const INTERVAL_MS = 100;
const SPINNER_FRAMES = ['-', '\\', '|', '/'] as const;

interface OperationMessages {
  readonly start: (subject: string) => string;
  readonly success: (subject: string) => string;
  readonly failure: (subject: string) => string;
}

function defaultDependencies(): UpdateProgressDependencies {
  return {
    isTTY: stdout.isTTY === true,
    write: (message) => { stdout.write(message); },
    clearLine: () => { clearLine(stdout, 0); },
    cursorTo: () => { cursorTo(stdout, 0); },
    setInterval,
    clearInterval,
  };
}

function createOperationProgress(
  messages: OperationMessages,
  dependencies: Partial<UpdateProgressDependencies>,
): OperationProgress {
  const resolved = { ...defaultDependencies(), ...dependencies };
  let timer: NodeJS.Timeout | undefined;
  let frameIndex = 0;
  let subject = '';
  const render = (): void => {
    resolved.clearLine();
    resolved.cursorTo();
    resolved.write(`${SPINNER_FRAMES[frameIndex]} ${messages.start(subject)}`);
    frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
  };

  return {
    start(nextSubject): void {
      subject = nextSubject;
      if (!resolved.isTTY) {
        resolved.write(`${messages.start(subject)}\n`);
        return;
      }
      render();
      timer = resolved.setInterval(render, INTERVAL_MS);
    },
    stop(nextSubject, result): void {
      subject = nextSubject;
      const message = result === 'success' ? messages.success(subject) : messages.failure(subject);
      if (!resolved.isTTY) {
        resolved.write(`${message}\n`);
        return;
      }
      if (timer !== undefined) {
        resolved.clearInterval(timer);
        timer = undefined;
      }
      resolved.clearLine();
      resolved.cursorTo();
      resolved.write(`${message}\n`);
    },
  };
}

export function createNpmUpdateProgress(
  dependencies: Partial<UpdateProgressDependencies> = {},
): NpmUpdateProgress {
  return createOperationProgress({
    start: (version) => `Installing and verifying changebudget@${version}...`,
    success: (version) => `Installed and verified changebudget@${version}.`,
    failure: (version) => `Failed to install and verify changebudget@${version}.`,
  }, dependencies);
}

export function createIntegrationRefreshProgress(
  dependencies: Partial<UpdateProgressDependencies> = {},
): IntegrationRefreshProgress {
  return createOperationProgress({
    start: (profileId) => `Refreshing managed integration: ${profileId}...`,
    success: (profileId) => `Integration refreshed: ${profileId}.`,
    failure: (profileId) => `Integration needs attention: ${profileId}.`,
  }, dependencies);
}
