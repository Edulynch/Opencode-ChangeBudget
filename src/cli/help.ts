import { stdout } from 'node:process';

export const SUPPORTED_COMMANDS = [
  'init',
  'start',
  'status',
  'check',
  'close',
  'amend',
  'diagnose',
  'integrate',
  'update',
] as const;

export type SupportedCommand = (typeof SUPPORTED_COMMANDS)[number];

const GLOBAL_HELP = `Usage: changebudget <command> [args]

Commands:
  init       Initialize ChangeBudget state in the current Git repository.
  start      Start a change contract.
  status     Show lifecycle and optional budget status.
  check      Evaluate changes against a contract.
  close      Close the active contract.
  amend      Amend active numeric contract budgets.
  diagnose   Recommend a read-only advisory budget.
  integrate  Manage project integration resources.
  update     Check for or install a compatible update.
  help       Show global or command-specific help.

Options:
  -h, --help     Show help.
  -v, --version  Show the installed version.

Usage: changebudget help [command]
Update: changebudget update [--check]
`;

const COMMAND_HELP: Readonly<Record<SupportedCommand, string>> = {
  init: `Usage: changebudget init [options]

Initialize ChangeBudget state in the current Git repository.

Options:
  -h, --help  Show help.
`,
  start: `Usage: changebudget start [Txxx] [options]

Start a change contract for a Spec-Kit task or task description.

Options:
  --task <text>, --task-description <text>  Set the task description.
  --base-revision <revision>                Set the Git base revision.
  --allow-path <path>, --allow-paths <paths>
  --deny-path <path>, --deny-paths <paths>  Add allowed or denied paths.
  --max-files <count>                       Set the changed-file limit.
  --max-changed-lines <count>               Set the changed-line limit.
  --allow-new-files[=true|false]
  --no-allow-new-files
  --allow-new-dependencies[=true|false]
  --no-allow-new-dependencies
  --allow-migrations[=true|false]
  --no-allow-migrations
  --allow-config-changes[=true|false]
  --no-allow-config-changes
  --allow-public-api-changes[=true|false]
  --no-allow-public-api-changes             Control boolean contract permissions.
  --tiny, --normal, --free                  Select a preset shorthand.
  --preset <tiny|normal|free|custom>         Select a contract preset.
  --stack-profile <android|flutter|spring-boot|node-ts>
  --disable-stack-rule <id>, --disable-stack-rules <ids>
  -h, --help                                 Show help.

Examples:
  changebudget start T031 --tiny
  changebudget start --task "Add pagination" --allow-path "src/**"
`,
  status: `Usage: changebudget status [options]

Show lifecycle state and optionally evaluate the active budget.

Options:
  --budget              Include a budget evaluation.
  --json[=true|false]   Emit JSON; requires --budget.
  -h, --help            Show help.
`,
  check: `Usage: changebudget check [options]

Evaluate repository changes against the active or a draft contract.

Options:
  --draft <path>        Evaluate a draft contract file.
  --json[=true|false]   Emit JSON output.
  -h, --help            Show help.
`,
  close: `Usage: changebudget close [options]

Close the active change contract.

Options:
  --actor <name>    Record who closed the contract.
  --reason <text>   Record why the contract was closed.
  -h, --help        Show help.
`,
  amend: `Usage: changebudget amend (--max-files <count> | --max-changed-lines <count>) [options]

Amend only numeric budgets on the active contract and append an audit record.

Options:
  --max-files <count>           Set the changed-file limit.
  --max-changed-lines <count>   Set the changed-line limit.
  --reason <text>               Record why the budget changed.
  -h, --help                    Show help.

Example:
  changebudget amend --max-files 5 --max-changed-lines 150 --reason "Additional targeted tests"
`,
  diagnose: `Usage: changebudget diagnose [Txxx] [options]

Recommend a read-only advisory budget without creating or modifying a contract.

Options:
  --task <text>, --task-description <text>  Set the task description.
  --allow-path <path>, --allow-paths <path>  Add an allowed path.
  --deny-path <path>, --deny-paths <path>    Add a denied path.
  --stack-profile <android|flutter|spring-boot|node-ts>
  --json[=true|false]                        Emit JSON output.
  -h, --help                                 Show help.

Example:
  changebudget diagnose T031 --json
`,
  integrate: `Usage: changebudget integrate opencode [options]

Install, inspect, or remove the project-local OpenCode integration.

Options:
  --dry-run     Preview integration changes.
  --remove      Remove managed integration resources.
  -h, --help    Show help.

--dry-run and --remove cannot be combined.
`,
  update: `Usage: changebudget update [options]

Install the latest compatible update, or check availability without installing.

Options:
  --check       Check for an update without installing it.
  -h, --help    Show help.
`,
};

export function isSupportedCommand(command: string): command is SupportedCommand {
  return SUPPORTED_COMMANDS.some((candidate) => candidate === command);
}

export function isCommandHelpRequest(command: SupportedCommand, args: readonly string[]): boolean {
  if (args.length === 1) {
    return args[0] === '--help' || args[0] === '-h';
  }

  return command === 'integrate'
    && args.length === 2
    && args[0] === 'opencode'
    && (args[1] === '--help' || args[1] === '-h');
}

export function printGlobalHelp(): void {
  stdout.write(GLOBAL_HELP);
}

export function printCommandHelp(command: SupportedCommand): void {
  stdout.write(COMMAND_HELP[command]);
}
