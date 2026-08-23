import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runCheck } from '../../src/cli/commands/check.js';
import { runClose } from '../../src/cli/commands/close.js';
import { formatError, getDecisionExitCode, getExitCode } from '../../src/cli/output.js';

export interface InProcessCliResult {
  status: number;
  stdout: string;
  stderr: string;
}

function checkJsonOutput(result: Awaited<ReturnType<typeof runCheck>>): string {
  const violations = result.violations.map((violation) => ({
    ...violation,
    reason_code: violation.reasonCode,
    severity: violation.action,
  }));

  return `${JSON.stringify({
    contractSource: result.contractSource,
    contractId: result.contractId,
    baseRevision: result.baseRevision,
    decision: result.decision,
    status: result.status,
    changedFileCount: result.changedFileCount,
    changedLinesCount: result.changedLinesCount,
    binaryChangeCount: result.binaryChangeCount,
    newFileCount: result.newFileCount,
    deletedFileCount: result.deletedFileCount,
    renamedFileCount: result.renamedFileCount,
    limitResults: result.limitResults,
    pathRuleResults: result.pathRuleResults,
    stackPolicySummary: result.stackPolicySummary ?? null,
    violations,
    reasonCodes: result.reasonCodes,
    reason_codes: result.reasonCodes,
    ...(result.task ? { task: result.task } : {}),
    asOf: result.asOf,
  }, null, 2)}\n`;
}

function closeOutput(result: Awaited<ReturnType<typeof runClose>>): string {
  let output = 'Contract closed.\n';
  if (result.contract.task_id) {
    output += `Task: ${result.contract.task_id}\nSource: ${result.contract.task_source_path}\n`;
  }
  return output;
}

/** Execute the production command implementations without creating a child process. */
export async function runInProcessCliCommand(
  repositoryRoot: string,
  command: string,
  args: string[] = [],
): Promise<InProcessCliResult> {
  try {
    switch (command) {
      case 'init': {
        const result = await runInit(repositoryRoot);
        return {
          status: 0,
          stdout: result.changed
            ? 'Initialized ChangeBudget repository.\n'
            : 'ChangeBudget already initialized.\n',
          stderr: '',
        };
      }
      case 'start':
        await runStart(repositoryRoot, args);
        return { status: 0, stdout: 'Started new contract.\n', stderr: '' };
      case 'check': {
        const json = args.includes('--json');
        const commandArgs = args.filter((arg) => arg !== '--json');
        const result = await runCheck(repositoryRoot, commandArgs);
        return {
          status: getDecisionExitCode(result),
          stdout: json ? checkJsonOutput(result) : '',
          stderr: '',
        };
      }
      case 'close': {
        const result = await runClose(repositoryRoot, args);
        return { status: 0, stdout: closeOutput(result), stderr: '' };
      }
      default:
        throw new Error(`Unsupported in-process SPEC-005 command: ${command}`);
    }
  } catch (error) {
    return { status: getExitCode(error), stdout: '', stderr: `${formatError(error)}\n` };
  }
}
