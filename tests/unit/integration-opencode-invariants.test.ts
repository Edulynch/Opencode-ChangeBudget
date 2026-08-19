// SPEC-009 Phase 3 — T016 (Architectural Invariants).
//
// Pure unit tests for the architectural and CLI-parsing invariants of the
// `changebudget integrate opencode` command. No disposable repos required.
//
// Invariants covered:
//   - Exactly 3 managed resources, no AGENTS.md, no OMO-agent-specific text
//     in managed paths or instructions content.
//   - No managed resource references a global OpenCode config path
//     (e.g. ~/.config/opencode, $HOME/.opencode, /etc/opencode).
//   - Ownership marker constants contain `ChangeBudget-managed`.
//   - `INSTRUCTION_ENTRY` is the exact managed instructions path.
//   - `generateMinimalConfig()` is exactly `{ $schema, instructions: [entry] }`.
//   - CLI parser rejects missing target, unknown target, and unknown flag.

import * as assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  INSTRUCTION_ENTRY,
  INSTRUCTIONS_MARKER,
  MANAGED_RESOURCES,
  OWNERSHIP_MARKER,
  WRAPPER_MARKER,
  generateInstructionsContent,
  generateMinimalConfig,
  generateMinimalConfigString,
} from '../../src/core/integration/opencode.js';
import { runIntegrate } from '../../src/cli/commands/integrate.js';
import { InputValidationError } from '../../src/models/errors.js';

// ---------------------------------------------------------------------------
// Managed resource shape
// ---------------------------------------------------------------------------

test('T016: MANAGED_RESOURCES has exactly 3 keys (pluginWrapper, instructions, opencodeConfig)', () => {
  assert.deepEqual(
    Object.keys(MANAGED_RESOURCES).sort(),
    ['instructions', 'opencodeConfig', 'pluginWrapper'],
  );
  assert.equal(Object.keys(MANAGED_RESOURCES).length, 3);
});

test('T016: MANAGED_RESOURCES paths are exactly the expected project-local paths', () => {
  assert.equal(MANAGED_RESOURCES.pluginWrapper, '.opencode/plugins/changebudget.js');
  assert.equal(MANAGED_RESOURCES.instructions, '.opencode/instructions/changebudget.md');
  assert.equal(MANAGED_RESOURCES.opencodeConfig, 'opencode.json');
});

test('T016: no managed resource path includes AGENTS.md', () => {
  for (const value of Object.values(MANAGED_RESOURCES)) {
    assert.equal(
      value.includes('AGENTS.md'),
      false,
      `Managed path must not include AGENTS.md: ${value}`,
    );
  }
});

test('T016: no managed resource path mentions any OMO-agent-specific name', () => {
  const forbidden = ['Sisyphus', 'Prometheus', 'Atlas', 'Oracle', 'OMO'];
  for (const value of Object.values(MANAGED_RESOURCES)) {
    for (const term of forbidden) {
      assert.equal(
        value.includes(term),
        false,
        `Managed path must not contain ${term}: ${value}`,
      );
    }
  }
});

test('T016: no managed resource path references a global OpenCode config location', () => {
  const forbidden = [
    '~/.config/opencode',
    '$HOME/.opencode',
    '$XDG_CONFIG_HOME',
    '/etc/opencode',
    'C:\\Windows\\System32',
  ];
  for (const value of Object.values(MANAGED_RESOURCES)) {
    for (const token of forbidden) {
      assert.equal(
        value.includes(token),
        false,
        `Managed path must not contain ${token}: ${value}`,
      );
    }
  }
});

test('T016: managed paths are project-relative (no leading slash, no home prefix)', () => {
  for (const value of Object.values(MANAGED_RESOURCES)) {
    assert.equal(value.startsWith('/'), false, `Managed path must not be absolute: ${value}`);
    assert.equal(value.startsWith('~'), false, `Managed path must not start with ~: ${value}`);
    assert.equal(value.startsWith('$'), false, `Managed path must not be an env-var reference: ${value}`);
  }
});

// ---------------------------------------------------------------------------
// Instructions content
// ---------------------------------------------------------------------------

test('T016: generateInstructionsContent does not contain any OMO-agent-specific name', () => {
  const content = generateInstructionsContent();
  const forbidden = ['Sisyphus', 'Prometheus', 'Atlas', 'Oracle', 'OMO'];
  for (const term of forbidden) {
    assert.equal(
      content.includes(term),
      false,
      `Instructions must not contain ${term}: ${content}`,
    );
  }
});

test('T016: instructions content does not contain AGENTS.md mentions', () => {
  const content = generateInstructionsContent();
  // The instructions file intentionally never references AGENTS.md — that file
  // is user-owned and must never be touched.
  assert.equal(content.includes('AGENTS.md'), false, 'Instructions must not reference AGENTS.md');
});

// ---------------------------------------------------------------------------
// Ownership marker constants
// ---------------------------------------------------------------------------

test('T016: WRAPPER_MARKER contains the canonical ChangeBudget-managed string', () => {
  assert.ok(
    WRAPPER_MARKER.includes(OWNERSHIP_MARKER),
    `WRAPPER_MARKER must contain "${OWNERSHIP_MARKER}": ${WRAPPER_MARKER}`,
  );
  assert.equal(OWNERSHIP_MARKER, 'ChangeBudget-managed');
});

test('T016: INSTRUCTIONS_MARKER contains the canonical ChangeBudget-managed string', () => {
  assert.ok(
    INSTRUCTIONS_MARKER.includes(OWNERSHIP_MARKER),
    `INSTRUCTIONS_MARKER must contain "${OWNERSHIP_MARKER}": ${INSTRUCTIONS_MARKER}`,
  );
});

// ---------------------------------------------------------------------------
// INSTRUCTION_ENTRY + minimal config
// ---------------------------------------------------------------------------

test('T016: INSTRUCTION_ENTRY is exactly the instructions managed resource path', () => {
  assert.equal(INSTRUCTION_ENTRY, '.opencode/instructions/changebudget.md');
  assert.equal(INSTRUCTION_ENTRY, MANAGED_RESOURCES.instructions);
});

test('T016: generateMinimalConfig has $schema and instructions with exactly [INSTRUCTION_ENTRY]', () => {
  const config = generateMinimalConfig();
  const schema = config.$schema;
  assert.equal(typeof schema, 'string');
  assert.ok(typeof schema === 'string' && schema.length > 0, '$schema must be non-empty');
  assert.deepEqual(config.instructions, [INSTRUCTION_ENTRY]);
  assert.equal(config.instructions?.length, 1, 'instructions must contain exactly one entry');
});

test('T016: generateMinimalConfigString contains exactly one instructions entry line', () => {
  const serialized = generateMinimalConfigString();
  // Count occurrences of the entry string in the serialized config. Must be 1.
  const occurrences = serialized.split(INSTRUCTION_ENTRY).length - 1;
  assert.equal(occurrences, 1, `expected exactly one entry occurrence, got ${occurrences}: ${serialized}`);
});

// ---------------------------------------------------------------------------
// CLI parser edge cases
// ---------------------------------------------------------------------------

test('T016: CLI — runIntegrate with no args throws InputValidationError', async () => {
  await assert.rejects(
    async () => {
      await runIntegrate(process.cwd(), []);
    },
    (error: unknown) => {
      assert.ok(error instanceof InputValidationError, `expected InputValidationError, got ${String(error)}`);
      assert.equal(error.field, 'target');
      return true;
    },
  );
});

test('T016: CLI — runIntegrate with unknown target `other` throws InputValidationError', async () => {
  await assert.rejects(
    async () => {
      await runIntegrate(process.cwd(), ['other']);
    },
    (error: unknown) => {
      assert.ok(error instanceof InputValidationError);
      assert.equal(error.field, 'target');
      assert.ok(
        error.message.includes('integrate requires a target'),
        `message must mention "integrate requires a target": ${error.message}`,
      );
      return true;
    },
  );
});

test('T016: CLI — runIntegrate with `opencode --dry-run --remove` throws InputValidationError', async () => {
  await assert.rejects(
    async () => {
      await runIntegrate(process.cwd(), ['opencode', '--dry-run', '--remove']);
    },
    (error: unknown) => {
      assert.ok(error instanceof InputValidationError);
      assert.equal(error.field, 'options');
      assert.ok(
        error.message.includes('--dry-run and --remove cannot be combined'),
        `message must mention the conflict: ${error.message}`,
      );
      return true;
    },
  );
});

test('T016: CLI — runIntegrate with `opencode --unknown` throws InputValidationError', async () => {
  await assert.rejects(
    async () => {
      await runIntegrate(process.cwd(), ['opencode', '--unknown']);
    },
    (error: unknown) => {
      assert.ok(error instanceof InputValidationError);
      assert.ok(
        error.message.includes('Unknown option'),
        `message must mention "Unknown option": ${error.message}`,
      );
      return true;
    },
  );
});
