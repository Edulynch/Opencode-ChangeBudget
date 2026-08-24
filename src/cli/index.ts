#!/usr/bin/env node

import { stderr, stdout } from 'node:process';

import { runInit } from './commands/init.js';
import { runStart } from './commands/start.js';
import { runStatus, StatusResult } from './commands/status.js';
import { runCheck } from './commands/check.js';
import { runClose } from './commands/close.js';
import { runDiagnose } from './commands/diagnose.js';
import { runIntegrate, printIntegrationResult } from './commands/integrate.js';
import { runVersion } from './commands/version.js';
import { runUpdate, runUpdateCheck } from './commands/update.js';
import { printError, getExitCode, getDecisionExitCode } from './output.js';
import {
  isCommandHelpRequest,
  isSupportedCommand,
  printCommandHelp,
  printGlobalHelp,
} from './help.js';
import { InputValidationError } from '../models/errors.js';
import { BudgetCheckResult } from '../models/check-result.js';
import { DiagnosisResult } from '../models/diagnose.js';

function printDiagnoseResult(result: DiagnosisResult): void {
  const recommendation = result.recommendation === 'manual_review' ? 'manual review' : result.recommendation;
  stdout.write(`Recommendation: ${recommendation}\n`);
  stdout.write(`Source: ${result.source}\n`);

  stdout.write('Reasons:\n');
  for (const reason of result.reasons) {
    stdout.write(`  - ${reason.signal}: ${reason.value}\n`);
  }
}

function printDiagnoseResultJson(result: DiagnosisResult): void {
  const payload = {
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
  };

  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printCheckResult(result: BudgetCheckResult): void {
  stdout.write(`Decision: ${result.decision}\n`);
  stdout.write(`Contract source: ${result.contractSource}\n`);
  stdout.write(`Contract id: ${result.contractId ?? 'none'}\n`);
  stdout.write(`Base revision: ${result.baseRevision}\n`);
  stdout.write(`Status: ${result.status}\n`);
  stdout.write(`Changed files: ${result.changedFileCount}\n`);
  stdout.write(`Changed lines: ${result.changedLinesCount}\n`);
  stdout.write(`Binary changes: ${result.binaryChangeCount}\n`);
  stdout.write(`Added files: ${result.newFileCount}\n`);
  stdout.write(`Deleted files: ${result.deletedFileCount}\n`);
  stdout.write(`Renamed files: ${result.renamedFileCount}\n`);

  stdout.write('Limit results:\n');
  for (const limit of result.limitResults) {
    const expected = limit.expected === null ? 'unset' : limit.expected;
    stdout.write(`  - ${limit.limitName}: ${limit.status} (expected=${expected}, observed=${limit.observed})\n`);
  }

  stdout.write('Path policy results:\n');
  for (const pathRule of result.pathRuleResults) {
    stdout.write(`  - ${pathRule.path}: ${pathRule.status} allow=${pathRule.matchedAllow} deny=${pathRule.matchedDeny}\n`);
  }

   if (result.stackPolicySummary) {
     stdout.write(`Stack profile: ${result.stackPolicySummary.profile_id}\n`);
     stdout.write('Stack rule status:\n');
     for (const statusEntry of result.stackPolicySummary.statusByRuleId) {
       stdout.write(`  - ${statusEntry.ruleId}: ${statusEntry.status}\n`);
     }
   }

  if (result.violations.length > 0) {
    stdout.write('Violations:\n');
    for (const violation of result.violations) {
      const path = violation.path ?? 'n/a';
      const expected = violation.expected === undefined ? 'n/a' : violation.expected;
      const observed = violation.observed === undefined ? 'n/a' : violation.observed;
      const reasonCode = violation.reasonCode ?? 'n/a';
      const action = violation.action ?? 'review';

      stdout.write(
        `  - ${violation.rule}: ${violation.message} [path=${path}, expected=${expected}, observed=${observed}, reason_code=${reasonCode}, action=${action}]\n`,
      );
    }
  } else {
    stdout.write('Violations: none\n');
  }

  if (result.reasonCodes.length > 0) {
    stdout.write(`Reason codes: ${result.reasonCodes.join(', ')}\n`);
  } else {
    stdout.write('Reason codes: none\n');
  }

  stdout.write(`As of: ${result.asOf}\n`);
}

function printCheckResultJson(result: BudgetCheckResult): void {
  const payload = {
    comparisonMode: result.comparisonMode ?? 'legacy',
    baselineState: result.baselineState ?? 'legacy',
    decision: result.decision,
    reasonCodes: result.reasonCodes,
    excludedUnchangedCount: result.excludedUnchangedCount ?? 0,
    detectedDeltaCount: result.detectedDeltaCount ?? result.changedFileCount,
    ...(result.stagingTransitionCount ? { stagingTransitionCount: result.stagingTransitionCount } : {}),
  };

  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printStatusResultJson(result: StatusResult): void {
  if (result.budgetResult) {
    printCheckResultJson(result.budgetResult);
  }
}

function printStatusBudgetResult(result: BudgetCheckResult): void {
  stdout.write('Budget report for active contract:\n');
  stdout.write(`Decision: ${result.decision}\n`);
  stdout.write(`Contract source: ${result.contractSource}\n`);
  stdout.write(`Contract id: ${result.contractId ?? 'none'}\n`);
  stdout.write(`Base revision: ${result.baseRevision}\n`);
  stdout.write(`Status: ${result.status}\n`);
  stdout.write(`Changed files: ${result.changedFileCount}\n`);
  stdout.write(`Changed lines: ${result.changedLinesCount}\n`);
  stdout.write(`Binary changes: ${result.binaryChangeCount}\n`);
  stdout.write(`Added files: ${result.newFileCount}\n`);
  stdout.write(`Deleted files: ${result.deletedFileCount}\n`);
  stdout.write(`Renamed files: ${result.renamedFileCount}\n`);

  if (result.stackPolicySummary) {
    stdout.write(`Stack profile: ${result.stackPolicySummary.profile_id}\n`);
    stdout.write('Stack rule status:\n');
    for (const statusEntry of result.stackPolicySummary.statusByRuleId) {
      stdout.write(`  - ${statusEntry.ruleId}: ${statusEntry.status}\n`);
    }
  }

  if (result.reasonCodes.length > 0) {
    stdout.write(`Reason codes: ${result.reasonCodes.join(', ')}\n`);
  } else {
    stdout.write('Reason codes: none\n');
  }

  stdout.write(`As of: ${result.asOf}\n`);
}

interface ParsedJsonFlagArgs {
  json: boolean;
  args: string[];
}

function parseJsonArg(args: string[]): ParsedJsonFlagArgs {
  let json = false;
  const remaining: string[] = [];

  for (const token of args) {
    if (token === '--json') {
      json = true;
      continue;
    }

    if (token.startsWith('--json=')) {
      const value = token.slice('--json='.length).toLowerCase();
      if (value.length === 0) {
        throw new InputValidationError('Invalid value for --json', 'json');
      }

      if (value !== 'true' && value !== 'false') {
        throw new InputValidationError('Invalid value for --json', 'json', { value: token.slice('--json='.length) });
      }

      json = value === 'true';
      continue;
    }

    remaining.push(token);
  }

  return { json, args: remaining };
}

async function executeCommand(command: string, args: string[]): Promise<void> {
  switch (command) {
    case 'init': {
      const result = await runInit();
      const message = result.changed
        ? 'Initialized ChangeBudget repository.\n'
        : 'ChangeBudget already initialized.\n';
      stdout.write(message);
      break;
    }

    case 'start':
      await runStart(process.cwd(), args);
      stdout.write('Started new contract.\n');
      break;

    case 'status': {
      const result = await runStatus(process.cwd(), args);

      if (result.budgetRequested && result.budgetJson) {
        printStatusResultJson(result);
        process.exitCode = result.budgetResult
          ? getDecisionExitCode(result.budgetResult)
          : getDecisionExitCode(null);
        break;
      }

      if (!result.lifecycleState) {
        stdout.write('Lifecycle state: uninitialized\n');
        stdout.write('Active contract: none\n');

        if (result.budgetRequested) {
          if (result.budgetJson) {
            printStatusResultJson(result);
          } else if (result.budgetResult) {
            printStatusBudgetResult(result.budgetResult);
          }

          process.exitCode = result.budgetResult
            ? getDecisionExitCode(result.budgetResult)
            : getDecisionExitCode(null);
        }

        break;
      }

      stdout.write(`Lifecycle state: ${result.lifecycleState.lifecycle_state}\n`);
      if (result.activeContract) {
        stdout.write(`Active contract: ${result.activeContract.id}\n`);
        if (result.activeContract.task_id) {
          stdout.write(`Task: ${result.activeContract.task_id}\n`);
          stdout.write(`Source: ${result.activeContract.task_source_path}\n`);
        } else {
          stdout.write(`Task: ${result.activeContract.task_description}\n`);
        }
        stdout.write(`Status: ${result.activeContract.status}\n`);
        stdout.write(`Base revision: ${result.activeContract.base_revision}\n`);
        if (!result.budgetRequested) {
          break;
        }
      }

      stdout.write('Active contract: none\n');
      if (result.lastClosedContract) {
        stdout.write(`Last closed contract: ${result.lastClosedContract.id}\n`);
        if (result.lastClosedContract.task_id) {
          stdout.write(`Task: ${result.lastClosedContract.task_id}\n`);
          stdout.write(`Source: ${result.lastClosedContract.task_source_path}\n`);
        }
        if (result.lastClosedContract.close_reason) {
          stdout.write(`Last close reason: ${result.lastClosedContract.close_reason}\n`);
        }
        if (result.lastClosedContract.closed_by) {
          stdout.write(`Last closed by: ${result.lastClosedContract.closed_by}\n`);
        }
      }

      if (!result.budgetRequested) {
        break;
      }

      if (result.budgetResult) {
        printStatusBudgetResult(result.budgetResult);
        process.exitCode = getDecisionExitCode(result.budgetResult);
      }
      break;
    }

    case 'check':
      const parsedCheckArgs = parseJsonArg(args);
      const checkResult = await runCheck(process.cwd(), parsedCheckArgs.args);
      if (parsedCheckArgs.json) {
        printCheckResultJson(checkResult);
      } else {
        printCheckResult(checkResult);
      }

      process.exitCode = getDecisionExitCode(checkResult);

      break;

    case 'close': {
      const closeResult = await runClose(process.cwd(), args);
      stdout.write('Contract closed.\n');
      if (closeResult.contract.task_id) {
        stdout.write(`Task: ${closeResult.contract.task_id}\n`);
        stdout.write(`Source: ${closeResult.contract.task_source_path}\n`);
      }
      break;
    }

    case 'diagnose': {
      const diagnoseResult = await runDiagnose(process.cwd(), args);
      if (diagnoseResult.inputs.json) {
        printDiagnoseResultJson(diagnoseResult);
      } else {
        printDiagnoseResult(diagnoseResult);
      }
      break;
    }

    case 'integrate': {
      const result = await runIntegrate(process.cwd(), args);
      printIntegrationResult(result);
      // Dry-run is informational: CONFLICT / NEEDS_ATTENTION still exits 0.
      // Install/remove with NEEDS_ATTENTION exits 2 (input/usage class).
      if (result.readiness === 'NEEDS_ATTENTION' && result.operation !== 'dry-run') {
        process.exitCode = 2;
      }
      break;
    }

    case 'update': {
      if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
        throw new InputValidationError(
          'Unsupported update flag',
          'update',
          { args },
        );
      }

      process.exitCode = args[0] === '--check'
        ? await runUpdateCheck()
        : await runUpdate();
      break;
    }

    default:
      throw new Error(`Unhandled command: ${command}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    printGlobalHelp();
    return;
  }

  if (command === '--version' || command === '-v') {
    try {
      runVersion();
    } catch (error) {
      printError(error);
      process.exitCode = getExitCode(error);
    }
    return;
  }

  const args = process.argv.slice(3);

  if (command === 'help') {
    const topic = args[0];
    if (topic === undefined) {
      printGlobalHelp();
      return;
    }

    if (args.length === 1 && isSupportedCommand(topic)) {
      printCommandHelp(topic);
      return;
    }

    stderr.write(`Unknown help topic: ${topic}\n`);
    printGlobalHelp();
    process.exitCode = 2;
    return;
  }

  if (!isSupportedCommand(command)) {
    stderr.write(`Unknown command: ${command}\n`);
    printGlobalHelp();
    process.exitCode = 2;
    return;
  }

  if (isCommandHelpRequest(command, args)) {
    printCommandHelp(command);
    return;
  }

  try {
    await executeCommand(command, args);
  } catch (error) {
    printError(error);
    process.exitCode = getExitCode(error);
  }
}

void main();
