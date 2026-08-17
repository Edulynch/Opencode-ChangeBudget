#!/usr/bin/env node

import { stderr, stdout } from 'node:process';

import { runInit } from './commands/init.js';
import { runStart } from './commands/start.js';
import { runStatus, StatusResult } from './commands/status.js';
import { runCheck } from './commands/check.js';
import { runClose } from './commands/close.js';
import { printError, getExitCode, getDecisionExitCode } from './output.js';
import { InputValidationError } from '../models/errors.js';
import { BudgetCheckResult } from '../models/check-result.js';

const SUPPORTED_COMMANDS = ['init', 'start', 'status', 'check', 'close'] as const;

function printUsage(): void {
  stdout.write('Usage: changebudget <command> [args]\n');
  stdout.write('Commands: init, start, status, check, close\n');
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
  const violations = result.violations.map((violation) => ({
    ...violation,
    reason_code: violation.reasonCode,
    severity: violation.action,
  }));

  const payload = {
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
    violations,
    reasonCodes: result.reasonCodes,
    reason_codes: result.reasonCodes,
    asOf: result.asOf,
  };

  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function printStatusResultJson(result: StatusResult): void {
  const violations = result.budgetResult?.violations.map((violation) => ({
    ...violation,
    reason_code: violation.reasonCode,
    severity: violation.action,
  }));

  const payload = {
    lifecycleState: result.lifecycleState ? result.lifecycleState.lifecycle_state : 'uninitialized',
    activeContractId: result.activeContract?.id ?? null,
    lastClosedContractId: result.lastClosedContract?.id ?? null,
    budget: result.budgetResult
      ? {
          decision: result.budgetResult.decision,
          reasonCodes: result.budgetResult.reasonCodes,
          reason_codes: result.budgetResult.reasonCodes,
          contractSource: result.budgetResult.contractSource,
          contractId: result.budgetResult.contractId,
          baseRevision: result.budgetResult.baseRevision,
          status: result.budgetResult.status,
          changedFileCount: result.budgetResult.changedFileCount,
          changedLinesCount: result.budgetResult.changedLinesCount,
          binaryChangeCount: result.budgetResult.binaryChangeCount,
          newFileCount: result.budgetResult.newFileCount,
          deletedFileCount: result.budgetResult.deletedFileCount,
          renamedFileCount: result.budgetResult.renamedFileCount,
          limitResults: result.budgetResult.limitResults,
          pathRuleResults: result.budgetResult.pathRuleResults,
          violations,
          asOf: result.budgetResult.asOf,
        }
      : null,
  };

  stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
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
        stdout.write(`Task: ${result.activeContract.task_description}\n`);
        stdout.write(`Status: ${result.activeContract.status}\n`);
        stdout.write(`Base revision: ${result.activeContract.base_revision}\n`);
        if (!result.budgetRequested) {
          break;
        }
      }

      stdout.write('Active contract: none\n');
      if (result.lastClosedContract) {
        stdout.write(`Last closed contract: ${result.lastClosedContract.id}\n`);
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

    case 'close':
      await runClose(process.cwd(), args);
      stdout.write('Contract closed.\n');
      break;

    default:
      throw new Error(`Unhandled command: ${command}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];

  if (!command || command === '--help' || command === '-h') {
    printUsage();
    return;
  }

  if (!SUPPORTED_COMMANDS.includes(command as (typeof SUPPORTED_COMMANDS)[number])) {
    stderr.write(`Unknown command: ${command}\n`);
    printUsage();
    process.exitCode = 2;
    return;
  }

  try {
    const args = process.argv.slice(3);
    await executeCommand(command, args);
  } catch (error) {
    printError(error);
    process.exitCode = getExitCode(error);
  }
}

void main();
