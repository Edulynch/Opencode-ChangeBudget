import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface CommandHelpCase {
  readonly command: string;
  readonly markers: readonly string[];
}

const CLI_PATH = resolve(process.cwd(), 'dist', 'src', 'cli', 'index.js');
const HELP_FLAGS = ['--help', '-h'] as const;
const REGRESSION_ERROR = /InputValidationError: Unknown option --(?:help|h)\b/;
const COMMAND_HELP_CASES: readonly CommandHelpCase[] = [
  { command: 'init', markers: [] },
  { command: 'start', markers: ['--base-revision', '--allow-path'] },
  { command: 'status', markers: ['--budget'] },
  { command: 'check', markers: ['--draft', '--json'] },
  { command: 'close', markers: ['--actor', '--reason'] },
  { command: 'diagnose', markers: ['--json', 'changebudget diagnose T031'] },
  { command: 'integrate', markers: ['changebudget integrate opencode', '--dry-run', '--remove'] },
  { command: 'update', markers: ['--check'] },
] as const;
const SIDE_EFFECT_COMMANDS = ['init', 'start', 'close', 'integrate', 'update'] as const;

function runCli(cwd: string, args: readonly string[]): CliResult {
  const result = spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
  });

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function initializeRepository(root: string): void {
  const gitResult = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  assert.equal(gitResult.status, 0, gitResult.stderr);

  const initResult = runCli(root, ['init']);
  assert.equal(initResult.status, 0, initResult.stderr);
}

function assertSuccessfulHelp(result: CliResult, usageCommand: string, markers: readonly string[]): void {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Usage:/);
  assert.equal(result.stdout.includes(`changebudget ${usageCommand}`), true);
  for (const marker of markers) {
    assert.equal(result.stdout.includes(marker), true, `expected help output to include ${marker}`);
  }
  assert.doesNotMatch(result.stderr, REGRESSION_ERROR);
}

test('global help succeeds for both aliases', async (context) => {
  for (const helpFlag of HELP_FLAGS) {
    await context.test(helpFlag, () => {
      // Given the compiled CLI and a global help alias
      const args = [helpFlag] as const;

      // When global help is requested
      const result = runCli(process.cwd(), args);

      // Then the CLI prints global usage without an error
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.match(result.stdout, /Usage:/);
      assert.equal(result.stdout.includes('changebudget <command>'), true);
      assert.equal(result.stdout.includes('changebudget update [--check]'), true);
    });
  }
});

test('every command prints command-specific help for both aliases', async (context) => {
  for (const helpCase of COMMAND_HELP_CASES) {
    for (const helpFlag of HELP_FLAGS) {
      await context.test(`${helpCase.command} ${helpFlag}`, async () => {
        // Given an empty non-Git working directory and a command help alias
        const root = await mkdtemp(join(tmpdir(), 'changebudget-help-'));

        try {
          // When command help is requested from the compiled CLI
          const result = runCli(root, [helpCase.command, helpFlag]);

          // Then command-specific usage is returned without reaching its handler or parser
          assertSuccessfulHelp(result, helpCase.command, helpCase.markers);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      });
    }
  }
});

test('integrate help is recognized after its target for both aliases', async (context) => {
  for (const helpFlag of HELP_FLAGS) {
    await context.test(`opencode ${helpFlag}`, async () => {
      // Given an empty non-Git working directory and the integrate target
      const root = await mkdtemp(join(tmpdir(), 'changebudget-integrate-help-'));

      try {
        const before = (await readdir(root, { recursive: true })).sort();

        // When help appears after the target
        const result = runCli(root, ['integrate', 'opencode', helpFlag]);
        const after = (await readdir(root, { recursive: true })).sort();

        // Then integrate help is printed without installing project resources
        assertSuccessfulHelp(result, 'integrate', ['changebudget integrate opencode', '--dry-run', '--remove']);
        assert.deepEqual(before, []);
        assert.deepEqual(after, before);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('help command prints global and selected command help', async (context) => {
  const helpCases = [
    { args: ['help'], usageCommand: '<command>', markers: [] },
    { args: ['help', 'start'], usageCommand: 'start', markers: ['--base-revision', '--allow-path'] },
    { args: ['help', 'diagnose'], usageCommand: 'diagnose', markers: ['--json', 'changebudget diagnose T031'] },
  ] as const;

  for (const helpCase of helpCases) {
    await context.test(helpCase.args.join(' '), async () => {
      // Given an empty non-Git working directory and a help topic
      const root = await mkdtemp(join(tmpdir(), 'changebudget-help-command-'));

      try {
        // When the help command is invoked
        const result = runCli(root, helpCase.args);

        // Then global or selected command help is printed successfully
        assertSuccessfulHelp(result, helpCase.usageCommand, helpCase.markers);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('help command rejects an unsupported topic as a usage error', async () => {
  // Given an empty non-Git working directory and an unsupported help topic
  const root = await mkdtemp(join(tmpdir(), 'changebudget-help-topic-'));

  try {
    // When command help is requested for an unsupported topic
    const result = runCli(root, ['help', 'not-a-command']);

    // Then the CLI returns a usage error without executing a handler
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Unknown help topic: not-a-command/);
    assert.match(result.stdout, /Usage:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('representative command help invocations leave disposable working directories empty', async (context) => {
  for (const command of SIDE_EFFECT_COMMANDS) {
    await context.test(command, async () => {
      // Given a fresh, empty disposable working directory
      const root = await mkdtemp(join(tmpdir(), 'changebudget-help-safety-'));

      try {
        const before = (await readdir(root, { recursive: true })).sort();

        // When representative command help is requested
        const result = runCli(root, [command, '--help']);
        const after = (await readdir(root, { recursive: true })).sort();

        // Then help succeeds and the complete directory entry set remains empty
        const helpCase = COMMAND_HELP_CASES.find((candidate) => candidate.command === command);
        assert.ok(helpCase);
        assert.deepEqual(before, []);
        assert.deepEqual(after, before);
        assert.deepEqual(after, []);
        assertSuccessfulHelp(result, command, helpCase.markers);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  }
});

test('start still rejects an unknown option normally', async () => {
  // Given an initialized disposable repository and an unsupported start option
  const root = await mkdtemp(join(tmpdir(), 'changebudget-invalid-option-'));

  try {
    initializeRepository(root);

    // When start receives a non-help unknown option
    const result = runCli(root, ['start', '--not-a-real-option']);

    // Then normal unknown-option behavior remains intact
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /InputValidationError: Unknown option --not-a-real-option\b/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('short help flag remains an option value when the invocation is not an exact help form', async () => {
  // Given an initialized repository where -h is the separated task value
  const root = await mkdtemp(join(tmpdir(), 'changebudget-help-value-'));

  try {
    initializeRepository(root);

    // When a later unsupported option is parsed
    const result = runCli(root, ['start', '--task', '-h', '--not-a-real-option']);

    // Then normal parser validation runs instead of help routing
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /InputValidationError: Unknown option --not-a-real-option\b/);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /Usage:/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
