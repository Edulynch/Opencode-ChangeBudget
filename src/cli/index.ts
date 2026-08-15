#!/usr/bin/env node

import { stderr, stdout } from 'node:process';

import { runInit } from './commands/init.js';
import { runStart } from './commands/start.js';
import { runStatus } from './commands/status.js';
import { runCheck } from './commands/check.js';
import { runClose } from './commands/close.js';
import { printError, getExitCode } from './output.js';

const SUPPORTED_COMMANDS = ['init', 'start', 'status', 'check', 'close'] as const;

function printUsage(): void {
  stdout.write('Usage: changebudget <command> [args]\n');
  stdout.write('Commands: init, start, status, check, close\n');
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
      if (!result.lifecycleState) {
        stdout.write('Lifecycle state: uninitialized\n');
        stdout.write('Active contract: none\n');
        break;
      }

      stdout.write(`Lifecycle state: ${result.lifecycleState.lifecycle_state}\n`);
      if (result.activeContract) {
        stdout.write(`Active contract: ${result.activeContract.id}\n`);
        stdout.write(`Task: ${result.activeContract.task_description}\n`);
        stdout.write(`Status: ${result.activeContract.status}\n`);
        stdout.write(`Base revision: ${result.activeContract.base_revision}\n`);
        break;
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
      break;
    }

    case 'check':
      await runCheck(process.cwd(), args);
      stdout.write('Contract validation succeeded.\n');
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
