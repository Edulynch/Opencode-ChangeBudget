import { stdout } from 'node:process';
import { clearLine, cursorTo } from 'node:readline';
const INTERVAL_MS = 100;
const SPINNER_FRAMES = ['-', '\\', '|', '/'];
function defaultDependencies() {
    return {
        isTTY: stdout.isTTY === true,
        write: (message) => { stdout.write(message); },
        clearLine: () => { clearLine(stdout, 0); },
        cursorTo: () => { cursorTo(stdout, 0); },
        setInterval,
        clearInterval,
    };
}
function createOperationProgress(messages, dependencies) {
    const resolved = { ...defaultDependencies(), ...dependencies };
    let timer;
    let frameIndex = 0;
    let subject = '';
    const render = () => {
        resolved.clearLine();
        resolved.cursorTo();
        resolved.write(`${SPINNER_FRAMES[frameIndex]} ${messages.start(subject)}`);
        frameIndex = (frameIndex + 1) % SPINNER_FRAMES.length;
    };
    return {
        start(nextSubject) {
            subject = nextSubject;
            if (!resolved.isTTY) {
                resolved.write(`${messages.start(subject)}\n`);
                return;
            }
            render();
            timer = resolved.setInterval(render, INTERVAL_MS);
        },
        stop(nextSubject, result) {
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
export function createNpmUpdateProgress(dependencies = {}) {
    return createOperationProgress({
        start: (version) => `Installing and verifying changebudget@${version}...`,
        success: (version) => `Installed and verified changebudget@${version}.`,
        failure: (version) => `Failed to install and verify changebudget@${version}.`,
    }, dependencies);
}
export function createIntegrationRefreshProgress(dependencies = {}) {
    return createOperationProgress({
        start: (profileId) => `Refreshing managed integration: ${profileId}...`,
        success: (profileId) => `Integration refreshed: ${profileId}.`,
        failure: (profileId) => `Integration needs attention: ${profileId}.`,
    }, dependencies);
}
//# sourceMappingURL=progress.js.map