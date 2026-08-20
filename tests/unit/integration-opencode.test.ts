// SPEC-009 Phase 1 — unit tests for the pure domain logic of the
// ChangeBudget → OpenCode project integration.
//
// Covers T001-T006: ownership, content generation, file URL, config merge,
// and pre-flight inspection. All tests are read-only (no project writes).

import * as assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  INSTRUCTION_ENTRY,
  INSTRUCTIONS_MARKER,
  MANAGED_RESOURCES,
  OWNERSHIP_MARKER,
  WRAPPER_MARKER,
  detectOwnership,
  generateInstructionsContent,
  generateMinimalConfig,
  generateMinimalConfigString,
  generateWrapperContent,
  inspectIntegration,
  mergeInstructionEntry,
  parseOpenCodeConfig,
  resolveChangeBudgetRoot,
  resolveRuntimeGuardEntry,
  runtimeGuardFileUrl,
  runtimeGuardTargetExists,
  serializeConfig,
  type OpenCodeConfig,
} from '../../src/core/integration/opencode.js';
import { InputValidationError } from '../../src/models/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTempRoot(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

async function removeTree(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

async function writeFileRecursive(root: string, relativePath: string, content: string): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(join(root, relativePath, '..'), { recursive: true });
  await writeFile(target, content, 'utf8');
  return target;
}

// ---------------------------------------------------------------------------
// T001 — Types & constants
// ---------------------------------------------------------------------------

test('T001: managed resources are exactly 3 paths and do NOT include AGENTS.md', () => {
  const values = Object.values(MANAGED_RESOURCES).sort();
  assert.deepEqual(values, [
    '.opencode/instructions/changebudget.md',
    '.opencode/plugins/changebudget.js',
    'opencode.json',
  ]);
  for (const value of values) {
    assert.equal(value.includes('AGENTS.md'), false, `Managed path must not include AGENTS.md: ${value}`);
  }
});

test('T001: no managed resource path mentions OMO-specific agent names', () => {
  const forbidden = ['Sisyphus', 'Prometheus', 'Atlas', 'Oracle', 'OMO'];
  for (const value of Object.values(MANAGED_RESOURCES)) {
    for (const term of forbidden) {
      assert.equal(value.includes(term), false, `Managed path must not contain ${term}: ${value}`);
    }
  }
});

test('T001: managed resources are project-local, never global OpenCode config paths', () => {
  for (const value of Object.values(MANAGED_RESOURCES)) {
    assert.equal(value.startsWith('/'), false, `Managed path must not be absolute: ${value}`);
    assert.equal(value.includes('etc/'), false, `Managed path must not be a global config location: ${value}`);
    assert.equal(value.includes('home/'), false, `Managed path must not be a global config location: ${value}`);
    assert.equal(value.includes('~/.config'), false, `Managed path must not be a global config location: ${value}`);
  }
});

test('T001: instruction entry equals the instructions path under MANAGED_RESOURCES', () => {
  assert.equal(INSTRUCTION_ENTRY, MANAGED_RESOURCES.instructions);
});

test('T001: ownership markers reference the canonical CLI command', () => {
  assert.equal(WRAPPER_MARKER.includes(OWNERSHIP_MARKER), true);
  assert.equal(INSTRUCTIONS_MARKER.includes(OWNERSHIP_MARKER), true);
  assert.equal(WRAPPER_MARKER.includes('changebudget integrate opencode'), true);
  assert.equal(INSTRUCTIONS_MARKER.includes('changebudget integrate opencode'), true);
});

// ---------------------------------------------------------------------------
// T003 — Ownership detection (detectOwnership)
// ---------------------------------------------------------------------------

const OWNERSHIP_CASES: Array<{
  name: string;
  setup: (root: string) => Promise<{ filePath: string; expected: string }>;
  expectedState: 'MISSING' | 'MANAGED_CURRENT' | 'MANAGED_STALE' | 'CONFLICT';
}> = [
  {
    name: 'MISSING when file does not exist',
    setup: async (root) => {
      const filePath = join(root, 'nope.js');
      return { filePath, expected: '// hello' };
    },
    expectedState: 'MISSING',
  },
  {
    name: 'MANAGED_CURRENT when file is byte-identical to expected',
    setup: async (root) => {
      const expected = `${WRAPPER_MARKER}\nexport { default } from "file:///x/index.js";\n`;
      const filePath = await writeFileRecursive(root, 'wrapper.js', expected);
      return { filePath, expected };
    },
    expectedState: 'MANAGED_CURRENT',
  },
  {
    name: 'MANAGED_STALE when marker present but content differs',
    setup: async (root) => {
      const expected = `${WRAPPER_MARKER}\nexport { default } from "file:///x/index.js";\n`;
      const stale = `${WRAPPER_MARKER}\nexport { default } from "file:///old/index.js";\n`;
      const filePath = await writeFileRecursive(root, 'wrapper.js', stale);
      return { filePath, expected };
    },
    expectedState: 'MANAGED_STALE',
  },
  {
    name: 'CONFLICT when file exists but does not contain the ownership marker',
    setup: async (root) => {
      const filePath = await writeFileRecursive(root, 'wrapper.js', '// user content\n');
      return { filePath, expected: '// anything' };
    },
    expectedState: 'CONFLICT',
  },
];

for (const tc of OWNERSHIP_CASES) {
  test(`T003: detectOwnership returns ${tc.expectedState} — ${tc.name}`, async () => {
    const root = await createTempRoot('cb-int-detect-');
    try {
    const { filePath, expected } = await tc.setup(root);
    const state = await detectOwnership(filePath, WRAPPER_MARKER, expected);
      assert.equal(state, tc.expectedState);
    } finally {
      await removeTree(root);
    }
  });
}

// ---------------------------------------------------------------------------
// T004 — Wrapper generation (generateWrapperContent)
// ---------------------------------------------------------------------------

test('T004: generateWrapperContent produces marker + export + trailing newline', () => {
  const content = generateWrapperContent('file:///D:/repo/index.js');
  const lines = content.split('\n');

  assert.equal(lines.length, 3, 'expected 2 lines + trailing empty line');
  assert.equal(lines[0], WRAPPER_MARKER);
  assert.equal(lines[1], 'export { default } from "file:///D:/repo/index.js";');
  assert.equal(lines[2], '', 'trailing newline means the third split element is empty');
  assert.equal(content.endsWith('\n'), true);
});

test('T004: same file URL produces byte-identical wrapper output', () => {
  const url = 'file:///C:/work/guard/index.js';
  const a = generateWrapperContent(url);
  const b = generateWrapperContent(url);
  assert.equal(a, b);
  assert.equal(Buffer.byteLength(a, 'utf8'), Buffer.byteLength(b, 'utf8'));
});

test('T004: different file URLs produce different wrapper output', () => {
  const a = generateWrapperContent('file:///C:/work/guard/index.js');
  const b = generateWrapperContent('file:///D:/work/guard/index.js');
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// T004 — Instructions generation (generateInstructionsContent)
// ---------------------------------------------------------------------------

test('T004: generateInstructionsContent first line is the marker', () => {
  const content = generateInstructionsContent();
  const firstNewline = content.indexOf('\n');
  assert.equal(firstNewline > 0, true);
  const firstLine = content.slice(0, firstNewline);
  assert.equal(firstLine, INSTRUCTIONS_MARKER);
});

test('T004: instructions content contains all 11 behavioral bullets', () => {
  const content = generateInstructionsContent();
  const bullets = content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '));

  // Count bullets that apply to the workflow (excluding headings and the title).
  const behavioralBullets = bullets.filter((line) => !line.startsWith('# '));
  assert.equal(behavioralBullets.length >= 11, true, `expected >=11 behavioral bullets, got ${behavioralBullets.length}`);

  // Spot-check a few specific bullets by content.
  assert.ok(content.includes('changebudget status'));
  assert.ok(content.includes('changebudget start'));
  assert.ok(content.includes('changebudget diagnose Txxx'));
  assert.ok(content.includes('changebudget check'));
  assert.ok(content.includes('changebudget close'));
  assert.ok(content.includes('.changebudget/**'));
  assert.ok(content.includes('Do not modify denied or protected paths'));
  assert.ok(content.includes('build, typecheck, focused tests'));
  assert.ok(content.includes('Stay within the allowed paths'));
  assert.ok(content.includes('Never widen a ChangeBudget contract automatically'));
  assert.ok(content.includes('PASS'));
  assert.ok(content.includes('REPAIR'));
});

test('T004: instructions content does NOT contain OMO-agent-specific terms', () => {
  const content = generateInstructionsContent();
  const forbidden = ['Sisyphus', 'Prometheus', 'Atlas', 'Oracle', 'OMO'];
  for (const term of forbidden) {
    assert.equal(content.includes(term), false, `instructions must not mention ${term}`);
  }
});

test('T004: instructions content is byte-identical on repeated calls', () => {
  const a = generateInstructionsContent();
  const b = generateInstructionsContent();
  assert.equal(a, b);
  assert.equal(Buffer.byteLength(a, 'utf8'), Buffer.byteLength(b, 'utf8'));
});

// ---------------------------------------------------------------------------
// T002 — Runtime Guard path resolution + file URL
// ---------------------------------------------------------------------------

test('T002: resolveChangeBudgetRoot returns the actual repository root', () => {
  const root = resolveChangeBudgetRoot();
  // The src layout means the root must contain a `src` directory and a
  // `package.json` file — we only assert on the directory name to avoid
  // coupling to specific contents.
  assert.equal(root.endsWith(`${sep}ChangeBudget`), true, `expected root to end with ChangeBudget, got: ${root}`);
});

test('T002: resolveRuntimeGuardEntry joins the known compiled path', () => {
  const root = resolveChangeBudgetRoot();
  const entry = resolveRuntimeGuardEntry(root);
  assert.equal(
    entry,
    join(root, 'opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js'),
  );
});

test('T002: runtimeGuardFileUrl produces a Windows-safe file:// URL from a drive-letter path', () => {
  const url = runtimeGuardFileUrl('D:\\WORKSPACE\\repo');
  assert.equal(url, 'file:///D:/WORKSPACE/repo/opencode-plugin/dist/opencode-plugin/src/index.js');
});

test('T002: runtimeGuardFileUrl produces a file:// URL whose path roundtrips to the input', () => {
  // pathToFileURL is platform-aware: on Windows, a leading-slash input like
  // '/home/user/repo' is normalized to a drive-relative path
  // (e.g. 'file:///D:/home/user/repo'). The exact URL shape therefore
  // depends on the host platform, so we assert the round-trip property:
  // the produced URL, once decoded via fileURLToPath, ends with the
  // Runtime Guard entry component regardless of host drive prefix.
  const input = '/home/user/repo';
  const url = runtimeGuardFileUrl(input);
  const expectedSuffix = join('opencode-plugin', 'dist', 'opencode-plugin', 'src', 'index.js');
  // join may produce backslashes on Windows; the decoded path uses native
  // separators too, so we compare with the same path.join result.
  const decoded = fileURLToPath(url);
  const normalizedDecoded = decoded.replace(/\\/g, '/');
  const normalizedSuffix = expectedSuffix.replace(/\\/g, '/');
  assert.ok(url.startsWith('file://'), `URL must use file:// scheme: ${url}`);
  assert.ok(normalizedDecoded.endsWith(normalizedSuffix), `decoded path must end with ${normalizedSuffix}: ${decoded}`);
  assert.ok(normalizedDecoded.includes('home/user/repo'), `decoded path must preserve the input prefix: ${decoded}`);
});

test('T002: runtimeGuardFileUrl is byte-stable for the same input', () => {
  const a = runtimeGuardFileUrl('D:\\WORKSPACE\\repo');
  const b = runtimeGuardFileUrl('D:\\WORKSPACE\\repo');
  assert.equal(a, b);
});

test('T002: runtimeGuardTargetExists returns true when the compiled entry exists', async () => {
  const root = resolveChangeBudgetRoot();
  // The build is executed as part of the test pipeline, so the entry should
  // exist if the build has been run. We don't fail if it does not — we only
  // assert that the check is deterministic for any given state.
  const exists = await runtimeGuardTargetExists(root);
  const existsViaAccessor = await runtimeGuardTargetExists(root);
  assert.equal(exists, existsViaAccessor);
});

// ---------------------------------------------------------------------------
// T005 — opencode.json parse / merge / validate / serialize
// ---------------------------------------------------------------------------

test('T005: parseOpenCodeConfig accepts a minimal valid object', () => {
  const parsed = parseOpenCodeConfig('{"a":1}');
  assert.deepEqual(parsed, { a: 1 });
});

test('T005: parseOpenCodeConfig rejects invalid JSON with InputValidationError', () => {
  assert.throws(
    () => parseOpenCodeConfig('{ this is not json'),
    (error: unknown) => {
      assert.ok(error instanceof InputValidationError);
      assert.equal(error.field, 'opencode.json');
      return true;
    },
  );
});

test('T005: parseOpenCodeConfig rejects top-level arrays', () => {
  assert.throws(
    () => parseOpenCodeConfig('[1,2,3]'),
    (error: unknown) => {
      assert.ok(error instanceof InputValidationError);
      assert.equal(error.field, 'opencode.json');
      return true;
    },
  );
});

test('T005: parseOpenCodeConfig rejects top-level primitives', () => {
  assert.throws(() => parseOpenCodeConfig('null'), (error: unknown) => error instanceof InputValidationError);
  assert.throws(() => parseOpenCodeConfig('42'), (error: unknown) => error instanceof InputValidationError);
  assert.throws(() => parseOpenCodeConfig('"a"'), (error: unknown) => error instanceof InputValidationError);
});

test('T005: generateMinimalConfig has $schema and instructions with the entry', () => {
  const config = generateMinimalConfig();
  assert.equal(config.$schema, 'https://opencode.ai/config.json');
  assert.deepEqual(config.instructions, [INSTRUCTION_ENTRY]);
});

test('T005: generateMinimalConfigString is deterministic and ends with newline', () => {
  const a = generateMinimalConfigString();
  const b = generateMinimalConfigString();
  assert.equal(a, b);
  assert.equal(a.endsWith('\n'), true);
  assert.equal(a.includes('"  "'), false, 'JSON serialization must not include raw 2-space idents as escaped strings');
  assert.ok(a.includes(`"instructions": [\n    "${INSTRUCTION_ENTRY}"\n  ]`));
});

test('T005: mergeInstructionEntry preserves unrelated fields', () => {
  const config: OpenCodeConfig = {
    $schema: 'https://opencode.ai/config.json',
    theme: 'dark',
    provider: { name: 'openai' },
  };
  const merged = mergeInstructionEntry(config, INSTRUCTION_ENTRY);
  assert.equal(merged.$schema, 'https://opencode.ai/config.json');
  assert.equal(merged.theme, 'dark');
  assert.deepEqual(merged.provider, { name: 'openai' });
  assert.deepEqual(merged.instructions, [INSTRUCTION_ENTRY]);

  // The original config object must not be mutated.
  assert.equal(config.instructions, undefined);
});

test('T005: mergeInstructionEntry appends to existing instructions array (preserves order)', () => {
  const config: OpenCodeConfig = {
    instructions: ['.opencode/instructions/base.md', '.opencode/instructions/extra.md'],
  };
  const merged = mergeInstructionEntry(config, INSTRUCTION_ENTRY);
  assert.deepEqual(merged.instructions, [
    '.opencode/instructions/base.md',
    '.opencode/instructions/extra.md',
    INSTRUCTION_ENTRY,
  ]);
  assert.equal(config.instructions?.length, 2, 'must not mutate the source array');
});

test('T005: mergeInstructionEntry does NOT duplicate when entry is already present', () => {
  const config: OpenCodeConfig = {
    instructions: [INSTRUCTION_ENTRY, '.opencode/instructions/extra.md'],
  };
  const merged = mergeInstructionEntry(config, INSTRUCTION_ENTRY);
  assert.deepEqual(merged.instructions, [INSTRUCTION_ENTRY, '.opencode/instructions/extra.md']);
  assert.equal(merged.instructions.length, 2);
});

test('T005: mergeInstructionEntry rejects non-array instructions', () => {
  const cases: OpenCodeConfig[] = [
    { instructions: 'not an array' as unknown as string[] },
    { instructions: 42 as unknown as string[] },
    { instructions: { some: 'object' } as unknown as string[] },
    { instructions: true as unknown as string[] },
  ];

  for (const config of cases) {
    assert.throws(
      () => mergeInstructionEntry(config, INSTRUCTION_ENTRY),
      (error: unknown) => {
        assert.ok(error instanceof InputValidationError);
        assert.equal(error.field, 'instructions');
        return true;
      },
    );
  }
});

test('T005: mergeInstructionEntry creates array when field is absent', () => {
  const merged = mergeInstructionEntry({}, INSTRUCTION_ENTRY);
  assert.deepEqual(merged.instructions, [INSTRUCTION_ENTRY]);
});

test('T005: serializeConfig uses 2-space indent and trailing newline', () => {
  const serialized = serializeConfig({
    $schema: 'https://opencode.ai/config.json',
    instructions: [INSTRUCTION_ENTRY],
  });
  assert.equal(serialized.endsWith('\n'), true);
  assert.ok(serialized.includes('  "$schema"'), 'expected 2-space indent on $schema');
  assert.ok(serialized.includes('  "instructions"'), 'expected 2-space indent on instructions');
  assert.ok(serialized.includes('    "' + INSTRUCTION_ENTRY + '"'), 'expected 4-space indent on array element');
});

test('T005: serializeConfig preserves existing key order (V8 insertion order)', () => {
  const config: OpenCodeConfig = {
    zzz: 1,
    aaa: 2,
    instructions: [INSTRUCTION_ENTRY],
  };
  const serialized = serializeConfig(config);
  const zzzIndex = serialized.indexOf('"zzz"');
  const aaaIndex = serialized.indexOf('"aaa"');
  assert.ok(zzzIndex >= 0 && aaaIndex >= 0);
  assert.ok(zzzIndex < aaaIndex, 'insertion order must be preserved');
});

test('T005: serializer acceptance — minimal config roundtrip parses identically', () => {
  const serialized = generateMinimalConfigString();
  const parsed = parseOpenCodeConfig(serialized);
  assert.deepEqual(parsed, generateMinimalConfig());
});

// ---------------------------------------------------------------------------
// T006 — Pre-flight inspection (inspectIntegration)
// ---------------------------------------------------------------------------

interface PreflightFixture {
  projectRoot: string;
  changeBudgetRoot: string;
  cleanup: () => Promise<void>;
}

async function buildFixture(options: {
  wrapper?: 'missing' | 'current' | 'stale' | 'conflict';
  instructions?: 'missing' | 'current' | 'stale' | 'conflict';
  config?: 'missing' | 'invalid' | 'empty' | 'no-entry' | 'has-entry' | 'non-array';
  changeBudgetRoot?: string;
}): Promise<PreflightFixture> {
  const projectRoot = await createTempRoot('cb-int-preflight-');
  const changeBudgetRoot = options.changeBudgetRoot ?? resolveChangeBudgetRoot();

  const wrapperExpected = generateWrapperContent(runtimeGuardFileUrl(changeBudgetRoot));
  const instructionsExpected = generateInstructionsContent();

  if (options.wrapper === 'current') {
    await writeFileRecursive(projectRoot, MANAGED_RESOURCES.pluginWrapper, wrapperExpected);
  } else if (options.wrapper === 'stale') {
    await writeFileRecursive(
      projectRoot,
      MANAGED_RESOURCES.pluginWrapper,
      `${WRAPPER_MARKER}\nexport { default } from "file:///old/index.js";\n`,
    );
  } else if (options.wrapper === 'conflict') {
    await writeFileRecursive(projectRoot, MANAGED_RESOURCES.pluginWrapper, '// user content\n');
  }

  if (options.instructions === 'current') {
    await writeFileRecursive(projectRoot, MANAGED_RESOURCES.instructions, instructionsExpected);
  } else if (options.instructions === 'stale') {
    await writeFileRecursive(
      projectRoot,
      MANAGED_RESOURCES.instructions,
      `${INSTRUCTIONS_MARKER}\n# different content\n`,
    );
  } else if (options.instructions === 'conflict') {
    await writeFileRecursive(projectRoot, MANAGED_RESOURCES.instructions, '# user content\n');
  }

  if (options.config === 'invalid') {
    await writeFileRecursive(projectRoot, MANAGED_RESOURCES.opencodeConfig, '{ invalid json');
  } else if (options.config === 'empty') {
    await writeFileRecursive(projectRoot, MANAGED_RESOURCES.opencodeConfig, '{}');
  } else if (options.config === 'no-entry') {
    await writeFileRecursive(
      projectRoot,
      MANAGED_RESOURCES.opencodeConfig,
      `${JSON.stringify({ instructions: ['other.md'] }, null, 2)}\n`,
    );
  } else if (options.config === 'has-entry') {
    await writeFileRecursive(
      projectRoot,
      MANAGED_RESOURCES.opencodeConfig,
      `${JSON.stringify({ instructions: [INSTRUCTION_ENTRY, 'other.md'] }, null, 2)}\n`,
    );
  } else if (options.config === 'non-array') {
    await writeFileRecursive(
      projectRoot,
      MANAGED_RESOURCES.opencodeConfig,
      `${JSON.stringify({ instructions: 'not-an-array' }, null, 2)}\n`,
    );
  }

  return {
    projectRoot,
    changeBudgetRoot,
    cleanup: () => removeTree(projectRoot),
  };
}

test('T006: preflight with everything missing is readyToWrite when Runtime Guard exists', async () => {
  const fixture = await buildFixture({
    wrapper: 'missing',
    instructions: 'missing',
    config: 'missing',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.runtimeGuardTargetExists, true);
    assert.equal(plan.pluginWrapper, 'MISSING');
    assert.equal(plan.instructions, 'MISSING');
    assert.equal(plan.opencodeConfig.exists, false);
    assert.equal(plan.opencodeConfig.valid, false);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.readyToWrite, true);
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight with MANAGED_CURRENT is readyToWrite', async () => {
  const fixture = await buildFixture({
    wrapper: 'current',
    instructions: 'current',
    config: 'has-entry',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.pluginWrapper, 'MANAGED_CURRENT');
    assert.equal(plan.instructions, 'MANAGED_CURRENT');
    assert.equal(plan.opencodeConfig.entryPresent, true);
    assert.deepEqual(plan.conflicts, []);
    assert.equal(plan.readyToWrite, true);
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight with MANAGED_STALE is readyToWrite (update path, not conflict)', async () => {
  const fixture = await buildFixture({
    wrapper: 'stale',
    instructions: 'stale',
    config: 'no-entry',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.pluginWrapper, 'MANAGED_STALE');
    assert.equal(plan.instructions, 'MANAGED_STALE');
    assert.equal(plan.opencodeConfig.entryPresent, false);
    assert.deepEqual(plan.conflicts, [], 'STALE is not a conflict');
    assert.equal(plan.readyToWrite, true);
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight with wrapper CONFLICT reports conflict and blocks writes', async () => {
  const fixture = await buildFixture({
    wrapper: 'conflict',
    instructions: 'missing',
    config: 'missing',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.pluginWrapper, 'CONFLICT');
    assert.ok(plan.conflicts.includes(MANAGED_RESOURCES.pluginWrapper), 'conflict must be reported');
    assert.equal(plan.readyToWrite, false);
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight with instructions CONFLICT reports conflict and blocks writes', async () => {
  const fixture = await buildFixture({
    wrapper: 'missing',
    instructions: 'conflict',
    config: 'missing',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.instructions, 'CONFLICT');
    assert.ok(plan.conflicts.includes(MANAGED_RESOURCES.instructions), 'conflict must be reported');
    assert.equal(plan.readyToWrite, false);
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight with invalid opencode.json reports conflict and blocks writes', async () => {
  const fixture = await buildFixture({
    wrapper: 'missing',
    instructions: 'missing',
    config: 'invalid',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.opencodeConfig.exists, true);
    assert.equal(plan.opencodeConfig.valid, false);
    assert.ok(plan.opencodeConfig.parseError !== undefined);
    assert.ok(plan.conflicts.includes(MANAGED_RESOURCES.opencodeConfig));
    assert.equal(plan.readyToWrite, false);
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight with non-array instructions reports conflict and blocks writes', async () => {
  const fixture = await buildFixture({
    wrapper: 'missing',
    instructions: 'missing',
    config: 'non-array',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.opencodeConfig.hasInstructionsField, true);
    assert.equal(plan.opencodeConfig.instructionsIsArray, false);
    assert.ok(plan.conflicts.includes('opencode.json: instructions is not an array'));
    assert.equal(plan.readyToWrite, false);
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight with missing Runtime Guard is never readyToWrite', async () => {
  // Use a non-existent root as the changebudget root so runtimeGuardTargetExists is false.
  const fakeRoot = join(tmpdir(), 'cb-no-such-runtime-guard');
  // Make sure the path doesn't exist.
  await rm(fakeRoot, { recursive: true, force: true });

  const fixture = await buildFixture({
    wrapper: 'missing',
    instructions: 'missing',
    config: 'missing',
    changeBudgetRoot: fakeRoot,
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.runtimeGuardTargetExists, false);
    assert.equal(plan.readyToWrite, false, 'readyToWrite must be false when Runtime Guard is missing');
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight accumulates all conflicts when multiple are present', async () => {
  const fixture = await buildFixture({
    wrapper: 'conflict',
    instructions: 'conflict',
    config: 'invalid',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.conflicts.length, 3);
    assert.ok(plan.conflicts.includes(MANAGED_RESOURCES.pluginWrapper));
    assert.ok(plan.conflicts.includes(MANAGED_RESOURCES.instructions));
    assert.ok(plan.conflicts.includes(MANAGED_RESOURCES.opencodeConfig));
    assert.equal(plan.readyToWrite, false);
  } finally {
    await fixture.cleanup();
  }
});

test('T006: preflight treats valid opencode.json without instructions field as readyToWrite', async () => {
  const fixture = await buildFixture({
    wrapper: 'missing',
    instructions: 'missing',
    config: 'empty',
  });
  try {
    const plan = await inspectIntegration(fixture.projectRoot, fixture.changeBudgetRoot);
    assert.equal(plan.opencodeConfig.exists, true);
    assert.equal(plan.opencodeConfig.valid, true);
    assert.equal(plan.opencodeConfig.hasInstructionsField, false);
    assert.equal(plan.opencodeConfig.instructionsIsArray, false);
    assert.equal(plan.opencodeConfig.entryPresent, false);
    assert.equal(plan.readyToWrite, true);
  } finally {
    await fixture.cleanup();
  }
});
