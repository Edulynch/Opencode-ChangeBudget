import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { test } from 'node:test';


type SmokeContract = {
  buildSmokeNpmArgs: (packageSpec: string) => string[];
  buildSmokePackageSpec: (tag: string) => string;
  parseSmokeTag: (tag: string) => { tag: string; version: string } | null;
};

async function smokeContract(): Promise<SmokeContract> {
  return import(
    pathToFileURL(join(process.cwd(), 'scripts', 'smoke-tagged-install.mjs')).href
  ) as Promise<SmokeContract>;
}

const publicPackageSpec =
  'git+https://github.com/Edulynch/Opencode-ChangeBudget.git#v1.2.3';
const publicNpmArgs = [
  'install',
  '-g',
  '--ignore-scripts',
  '--allow-git=all',
  '--install-links=true',
  publicPackageSpec,
];

test('T005: independent public contract defines HTTPS package spec and exact npm argv', async () => {
  const smoke = await smokeContract();

  assert.equal(smoke.buildSmokePackageSpec('v1.2.3'), publicPackageSpec);
  assert.deepEqual(smoke.buildSmokeNpmArgs(publicPackageSpec), publicNpmArgs);
  assert.equal(publicPackageSpec.startsWith('github:'), false);
  assert.equal(publicPackageSpec.startsWith('git+ssh:'), false);
  assert.equal(publicPackageSpec.includes('@'), false);
  assert.doesNotMatch(publicPackageSpec, /FAKE_SECRET_DO_NOT_PRINT_12345|Authorization|token/i);
});


test('T005: public contract requires no GitHub or SSH credential transport', () => {
  assert.match(publicPackageSpec, /^git\+https:\/\/github\.com\//);
  assert.doesNotMatch(publicPackageSpec, /^(github:|git\+ssh:|ssh:)/);
  assert.equal(publicNpmArgs.includes('--allow-git=all'), true);
  assert.equal(publicNpmArgs.includes('--ignore-scripts'), true);
  assert.equal(publicNpmArgs.includes('--install-links=true'), true);
});

test('T007: current contract surfaces contain no active github shorthand install', async () => {
  const currentFiles = [
    'src/core/update/npm.ts',
    'src/cli/commands/update.ts',
    'tests/acceptance/tagged-install.test.ts',
    'specs/011-prebuilt-tagged-install/spec.md',
    'specs/011-prebuilt-tagged-install/quickstart.md',
    'specs/011-prebuilt-tagged-install/contracts/installation.md',
    'specs/011-prebuilt-tagged-install/contracts/release-gate.md',
    'specs/012-cross-platform-ci-release-smoke/spec.md',
    'specs/012-cross-platform-ci-release-smoke/quickstart.md',
    'specs/012-cross-platform-ci-release-smoke/contracts/ci-validation.md',
    'specs/012-cross-platform-ci-release-smoke/contracts/tagged-smoke.md',
  ];

  for (const relativePath of currentFiles) {
    const contents = readFileSync(join(process.cwd(), relativePath), 'utf8');
    assert.doesNotMatch(contents, /npm install[^\r\n]*github:/, relativePath);
    assert.doesNotMatch(contents, /npm install[^\r\n]*git\+ssh:/, relativePath);
  }
});

test('T023: active SPEC-012 docs preserve the independent HTTPS contract', async () => {
  const activeFiles = [
    'specs/012-cross-platform-ci-release-smoke/spec.md',
    'specs/012-cross-platform-ci-release-smoke/plan.md',
    'specs/012-cross-platform-ci-release-smoke/research.md',
    'specs/012-cross-platform-ci-release-smoke/data-model.md',
    'specs/012-cross-platform-ci-release-smoke/quickstart.md',
    'specs/012-cross-platform-ci-release-smoke/contracts/ci-validation.md',
    'specs/012-cross-platform-ci-release-smoke/contracts/tagged-smoke.md',
  ];
  for (const relativePath of activeFiles) {
    const contents = readFileSync(join(process.cwd(), relativePath), 'utf8');
    assert.doesNotMatch(contents, /github:Edulynch|git\+ssh:|git@github\.com/);
  }
  const quickstart = readFileSync(
    join(process.cwd(), 'specs', '012-cross-platform-ci-release-smoke', 'quickstart.md'),
    'utf8',
  );
  assert.match(
    quickstart,
    /git\+https:\/\/github\.com\/Edulynch\/Opencode-ChangeBudget\.git#\$\{TAG\}/,
  );
  assert.match(quickstart, /--ignore-scripts --allow-git=all --install-links=true/);
});
