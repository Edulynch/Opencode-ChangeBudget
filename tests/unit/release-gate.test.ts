import * as assert from 'node:assert/strict';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';


const gate = join(process.cwd(), 'scripts', 'validate-release.mjs');

test('release gate requires npm updater runtime and exact registry installation behavior', async () => {
  // Given the release gate and npm updater source
  const [gateSource, npmSource] = await Promise.all([
    readFile(gate, 'utf8'),
    readFile(join(process.cwd(), 'src', 'core', 'update', 'npm.ts'), 'utf8'),
  ]);

  // When the release transport contract is inspected

  // Then the gate tracks the npm updater without conflating it with tagged Git smoke
  assert.match(gateSource, /dist\/src\/core\/update\/npm\.js/);
  assert.match(gateSource, /dist\/src\/core\/update\/selection\.js/);
  assert.doesNotMatch(gateSource, /dist\/src\/core\/update\/github\.js/);
  assert.match(npmSource, /export const NPM_REGISTRY = 'https:\/\/registry\.npmjs\.org\/'/);
  assert.match(npmSource, /\$\{NPM_PACKAGE_NAME\}@\$\{expectedVersion\}/);
  assert.match(npmSource, /--registry=\$\{NPM_REGISTRY\}/);
});

test('SPEC-011 release validation rejects github: shorthand in current contracts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'changebudget-transport-contract-'));
  try {
    await mkdir(join(root, 'specs', '011-prebuilt-tagged-install', 'contracts'), { recursive: true });
    await writeFile(
      join(root, 'specs', '011-prebuilt-tagged-install', 'spec.md'),
      'npm install -g --ignore-scripts --allow-git=all --install-links=true github:Edulynch/Opencode-ChangeBudget#vX.Y.Z\n',
    );
    await writeFile(join(root, 'package.json'), '{"version":"9.9.9"}\n');
    await writeFile(join(root, 'package-lock.json'), '{"version":"9.9.9","packages":{"":{"version":"9.9.9"}}}\n');
    const result = spawnSync(process.execPath, [gate, '--root', root, '--skip-build', '--skip-tag-check'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /github: shorthand/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function git(root: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'changebudget-release-gate-'));
  await mkdir(join(root, 'dist', 'src'), { recursive: true });
  await mkdir(join(root, 'opencode-plugin', 'dist', 'opencode-plugin', 'src'), { recursive: true });
  await cp(join(process.cwd(), 'dist', 'src'), join(root, 'dist', 'src'), { recursive: true });
  await cp(
    join(process.cwd(), 'opencode-plugin', 'dist', 'opencode-plugin'),
    join(root, 'opencode-plugin', 'dist', 'opencode-plugin'),
    { recursive: true },
  );
  const packageJson = {
    name: 'changebudget-release-fixture',
    version: '9.9.9',
    type: 'module',
    bin: { changebudget: 'dist/src/cli/index.js' },
    files: ['dist/src/**', 'opencode-plugin/dist/opencode-plugin/**'],
  };
  await writeFile(join(root, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(join(root, 'package-lock.json'), `${JSON.stringify({
    name: packageJson.name,
    version: packageJson.version,
    lockfileVersion: 3,
    packages: { '': { name: packageJson.name, version: packageJson.version } },
  }, null, 2)}\n`);
  git(root, ['init']);
  git(root, ['config', 'user.name', 'release gate test']);
  git(root, ['config', 'user.email', 'release-gate@example.test']);
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'fixture']);
  return root;
}

function runGate(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [gate, '--root', root, '--skip-build', '--skip-tag-check', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function runCiSafeGate(root: string, ...args: string[]) {
  return spawnSync(process.execPath, [gate, '--root', root, '--skip-build', '--ci-safe', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

async function withFixture(callback: (root: string) => Promise<void>): Promise<void> {
  const root = await fixture();
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('T024: valid release fixture passes the read-only gate', async () => {
  await withFixture(async (root) => {
    const result = runGate(root);
    assert.equal(result.status, 0, result.stderr);
  });
});

test('T024: package version and lockfile mismatch fails', async () => {
  await withFixture(async (root) => {
    const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as { version: string };
    lock.version = '9.9.8';
    await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
    assert.notEqual(runGate(root).status, 0);
  });
});

test('T024: missing required runtime fails', async () => {
  await withFixture(async (root) => {
    await rm(join(root, 'dist', 'src', 'cli', 'index.js'));
    assert.notEqual(runGate(root).status, 0);
  });
});

test('T024: stale tracked runtime fails the zero-diff check', async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, 'dist', 'src', 'cli', 'index.js'), 'stale\n', { flag: 'a' });
    assert.notEqual(runGate(root).status, 0);
  });
});

test('T024: untracked required runtime fails', async () => {
  await withFixture(async (root) => {
    git(root, ['rm', '--cached', 'dist/src/cli/index.js']);
    assert.notEqual(runGate(root).status, 0);
  });
});

test('T024: ignored required runtime fails', async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, '.gitignore'), 'dist/src/cli/index.js\n');
    assert.notEqual(runGate(root).status, 0);
  });
});

test('T024: forbidden package content fails', async () => {
  await withFixture(async (root) => {
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { files: string[] };
    packageJson.files.push('tests/**');
    await writeFile(join(root, 'package.json'), JSON.stringify(packageJson));
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'tests', 'leak.txt'), 'forbidden\n');
    assert.notEqual(runGate(root).status, 0);
  });
});

test('T024: dirty final tree always fails the release gate', async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, 'README.md'), 'dirty\n');
    assert.notEqual(runGate(root).status, 0);
    assert.notEqual(runGate(root, '--require-clean').status, 0);
  });
});

test('T024: staged release candidate changes pass final cleanliness', async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, 'README.md'), 'candidate\n');
    git(root, ['add', 'README.md']);
    assert.equal(runGate(root).status, 0);
  });
});

test('T024: existing local tag is reported without tag mutation', async () => {
  await withFixture(async (root) => {
    git(root, ['tag', 'v9.9.9']);
    const result = spawnSync(process.execPath, [gate, '--root', root, '--skip-build'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /already exists locally/);
    assert.equal(spawnSync('git', ['tag', '--list', 'v9.9.9'], { cwd: root, encoding: 'utf8' }).stdout.trim(), 'v9.9.9');
  });
});

test('T003: CI-safe mode accepts an existing current tag without tag mutation', async () => {
  await withFixture(async (root) => {
    git(root, ['tag', 'v9.9.9']);
    const result = runCiSafeGate(root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      spawnSync('git', ['tag', '--list', 'v9.9.9'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
      'v9.9.9',
    );
  });
});

test('T003: CI-safe mode still rejects stale runtime', async () => {
  await withFixture(async (root) => {
    await writeFile(join(root, 'dist', 'src', 'cli', 'index.js'), 'stale\n');
    assert.notEqual(runCiSafeGate(root).status, 0);
  });
});

test('T003: CI-safe mode still rejects package metadata mismatch', async () => {
  await withFixture(async (root) => {
    const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')) as { version: string };
    lock.version = '9.9.8';
    await writeFile(join(root, 'package-lock.json'), JSON.stringify(lock));
    assert.notEqual(runCiSafeGate(root).status, 0);
  });
});

test('T003: CI-safe mode still rejects forbidden package content', async () => {
  await withFixture(async (root) => {
    const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { files: string[] };
    packageJson.files.push('tests/**');
    await writeFile(join(root, 'package.json'), JSON.stringify(packageJson));
    await mkdir(join(root, 'tests'), { recursive: true });
    await writeFile(join(root, 'tests', 'leak.txt'), 'forbidden\n');
    assert.notEqual(runCiSafeGate(root).status, 0);
  });
});

test('T003: CI-safe mode still rejects missing, untracked, and ignored runtime', async () => {
  await withFixture(async (root) => {
    await rm(join(root, 'dist', 'src', 'cli', 'index.js'));
    assert.notEqual(runCiSafeGate(root).status, 0);
  });

  await withFixture(async (root) => {
    git(root, ['rm', '--cached', 'dist/src/cli/index.js']);
    assert.notEqual(runCiSafeGate(root).status, 0);
  });

  await withFixture(async (root) => {
    await writeFile(join(root, '.gitignore'), 'dist/src/cli/index.js\n');
    assert.notEqual(runCiSafeGate(root).status, 0);
  });
});

test('T024: existing remote tag is reported without remote mutation', async () => {
  await withFixture(async (root) => {
    const remote = await mkdtemp(join(tmpdir(), 'changebudget-release-remote-'));
    try {
      git(remote, ['init', '--bare']);
      git(root, ['remote', 'add', 'origin', remote]);
      git(root, ['tag', 'v9.9.9']);
      git(root, ['push', 'origin', 'v9.9.9']);
      git(root, ['tag', '--delete', 'v9.9.9']);
      const result = spawnSync(process.execPath, [gate, '--root', root, '--skip-build', '--check-remote'], {
        cwd: process.cwd(),
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /already exists remotely/);
    } finally {
      await rm(remote, { recursive: true, force: true });
    }
  });
});
