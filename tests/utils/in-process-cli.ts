import { runInit } from '../../src/cli/commands/init.js';
import { runStart } from '../../src/cli/commands/start.js';
import { runCheck } from '../../src/cli/commands/check.js';
import { runClose } from '../../src/cli/commands/close.js';
import { runStatus } from '../../src/cli/commands/status.js';
import { runDiagnose } from '../../src/cli/commands/diagnose.js';
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

  return `${JSON.stringify(
    {
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
    },
    null,
    2,
  )}\n`;
}

function closeOutput(result: Awaited<ReturnType<typeof runClose>>): string {
  let output = 'Contract closed.\n';
  if (result.contract.task_id) {
    output += `Task: ${result.contract.task_id}\nSource: ${result.contract.task_source_path}\n`;
  }
  return output;
}

function statusOutput(result: Awaited<ReturnType<typeof runStatus>>): string {
  if (!result.lifecycleState) {
    return 'Lifecycle state: uninitialized\nActive contract: none\n';
  }

  let output = `Lifecycle state: ${result.lifecycleState.lifecycle_state}\n`;
  if (result.activeContract) {
    output += `Active contract: ${result.activeContract.id}\n`;
    if (result.activeContract.task_id) {
      output += `Task: ${result.activeContract.task_id}\n`;
      output += `Source: ${result.activeContract.task_source_path}\n`;
    } else {
      output += `Task: ${result.activeContract.task_description}\n`;
    }
    output += `Status: ${result.activeContract.status}\n`;
    output += `Base revision: ${result.activeContract.base_revision}\n`;
    if (!result.budgetRequested) {
      return output;
    }
  }

  output += 'Active contract: none\n';
  if (result.lastClosedContract) {
    output += `Last closed contract: ${result.lastClosedContract.id}\n`;
    if (result.lastClosedContract.task_id) {
      output += `Task: ${result.lastClosedContract.task_id}\n`;
      output += `Source: ${result.lastClosedContract.task_source_path}\n`;
    }
    if (result.lastClosedContract.close_reason) {
      output += `Last close reason: ${result.lastClosedContract.close_reason}\n`;
    }
    if (result.lastClosedContract.closed_by) {
      output += `Last closed by: ${result.lastClosedContract.closed_by}\n`;
    }
  }
  return output;
}

function diagnoseOutput(result: Awaited<ReturnType<typeof runDiagnose>>): string {
  const recommendation = result.recommendation === 'manual_review' ? 'manual review' : result.recommendation;
  let output = `Recommendation: ${recommendation}\nSource: ${result.source}\nReasons:\n`;
  for (const reason of result.reasons) {
    output += `  - ${reason.signal}: ${reason.value}\n`;
  }
  return output;
}

function diagnoseJsonOutput(result: Awaited<ReturnType<typeof runDiagnose>>): string {
  return `${JSON.stringify(
    {
      recommendation: result.recommendation,
      source: result.source,
      reasons: result.reasons.map((reason) => ({ signal: reason.signal, value: reason.value })),
      inputs: {
        task_id: result.inputs.task_id,
        task_description: result.inputs.task_description,
        allow_paths: result.inputs.allow_paths,
        deny_paths: result.inputs.deny_paths,
        stack_profile: result.inputs.stack_profile,
      },
    },
    null,
    2,
  )}\n`;
}

/** Execute the production command implementations without creating a child process. */
export async function runInProcessCliCommand(repositoryRoot: string, command: string, args: string[] = []): Promise<InProcessCliResult> {
  try {
    switch (command) {
      case 'init': {
        const result = await runInit(repositoryRoot);
        return {
          status: 0,
          stdout: result.changed ? 'Initialized ChangeBudget repository.\n' : 'ChangeBudget already initialized.\n',
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
      case 'status': {
        const result = await runStatus(repositoryRoot, args);
        return {
          status: 0,
          stdout: statusOutput(result),
          stderr: '',
        };
      }
      case 'diagnose': {
        const result = await runDiagnose(repositoryRoot, args);
        return {
          status: 0,
          stdout: result.inputs.json ? diagnoseJsonOutput(result) : diagnoseOutput(result),
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
