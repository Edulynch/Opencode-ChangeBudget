import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const workflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'ci.yml'), 'utf8');
const taggedWorkflow = readFileSync(join(process.cwd(), '.github', 'workflows', 'release-smoke.yml'), 'utf8');
const smokeHarness = readFileSync(join(process.cwd(), 'scripts', 'smoke-tagged-install.mjs'), 'utf8');
const runSteps = [...workflow.matchAll(/^\s+run:\s+(.+)$/gm)].map((match) => match[1]);
const blockRunSteps = (contents: string): string[] => [...contents.matchAll(/^\s+run:\s+\|\s*\r?\n\s+(.+)$/gm)].map((match) => match[1]);
const hasRunStep = (command: string): boolean => runSteps.some((step) => step === command);

test('T011: normal CI has the required triggers and platform matrix', () => {
  assert.match(workflow, /on:\s*pull_request:\s*push:\s*branches:\s*-\s*master/s);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /ubuntu-latest/);
  assert.match(workflow, /validate-ubuntu:/);
  assert.match(workflow, /validate-windows:/);
  assert.match(workflow, /shard:\s*\[1, 2, 3, 4, 5, 6, 7, 8\]/);
  assert.equal((workflow.match(/test-shard=\$\{\{\s*matrix\.shard\s*\}\}\/8/g) ?? []).length, 1);
  assert.doesNotMatch(workflow, /^\s+tags:/m);
  assert.doesNotMatch(workflow, /release-smoke\.yml/);
});

test('T011: normal CI pins the required toolchain and validation commands', () => {
  const blockSteps = blockRunSteps(workflow);
  assert.match(workflow, /actions\/checkout@v7/);
  assert.doesNotMatch(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v7/);
  assert.match(workflow, /node-version:\s*24\.18\.0/);
  assert.equal(hasRunStep('npm install --global npm@11.16.0 --no-fund --no-audit'), true);
  assert.equal(
    blockSteps.some((step) => step.startsWith('node --input-type=module -e') && step.includes("['--version']") && step.includes('11.16.0')),
    true,
  );
  assert.equal(hasRunStep('npm ci'), true);
  assert.equal(hasRunStep('npm run typecheck'), true);
  assert.equal(hasRunStep('npm run build'), true);
  assert.equal(hasRunStep('npm test'), true);
  assert.match(workflow, /validate-ubuntu:[\s\S]*?run: npm test/);
  assert.match(workflow, /validate-windows:[\s\S]*?run: node --test "--test-shard=\$\{\{ matrix\.shard \}\}\/8" "dist\/tests\/\*\*\/\*\.js"/);
  assert.equal((workflow.match(/shard:\s*\[1, 2, 3, 4, 5, 6, 7, 8\]/g) ?? []).length, 1);
  assert.match(workflow, /if: matrix\.shard == 1[\s\S]*?run: npm pack --dry-run --json --ignore-scripts/);
  assert.match(workflow, /if: matrix\.shard == 1[\s\S]*?run: npm run ci:release-gate/);
  assert.equal(hasRunStep('npm pack --dry-run --json --ignore-scripts'), true);
  assert.equal(hasRunStep('npm run ci:release-gate'), true);
  assert.equal(
    blockSteps.some(
      (step) =>
        step.includes("git', ['ls-files']") &&
        step.includes('dist/src/cli/index.js') &&
        step.includes('dist/src/core/package-root.js') &&
        step.includes('dist/src/core/update/npm.js') &&
        step.includes('opencode-plugin/dist/opencode-plugin/src/index.js') &&
        step.includes('dist/tests/') &&
        step.includes('opencode-plugin/dist/src/'),
    ),
    true,
  );
  assert.equal(hasRunStep('git diff --exit-code -- dist/src opencode-plugin/dist/opencode-plugin'), true);
  assert.equal(hasRunStep('git diff --check'), true);
});

test('workflow JavaScript run steps use YAML block scalars', () => {
  const normalBlockSteps = blockRunSteps(workflow);
  const taggedBlockSteps = blockRunSteps(taggedWorkflow);
  assert.equal(normalBlockSteps.length, 4);
  assert.equal(taggedBlockSteps.length, 1);
  assert.equal(
    [...normalBlockSteps, ...taggedBlockSteps].every((step) => step.startsWith('node --input-type=module -e')),
    true,
  );
  assert.doesNotMatch(workflow, /^\s+run:\s+node --input-type=module.*\{ encoding: 'utf8' \}/m);
  assert.doesNotMatch(taggedWorkflow, /^\s+run:\s+node --input-type=module.*\{ encoding: 'utf8' \}/m);
});

test('toolchain verification uses controlled cross-platform npm execution', () => {
  for (const contents of [workflow, taggedWorkflow]) {
    assert.match(contents, /const npmCommand = process\.platform === 'win32' \? \(process\.env\.ComSpec \|\| 'cmd\.exe'\) : 'npm'/);
    assert.match(contents, /const npmArgs = process\.platform === 'win32' \? \['\/D', '\/S', '\/C', 'npm --version'\] : \['--version'\]/);
    assert.match(contents, /execFileSync\(npmCommand, npmArgs, \{ encoding: 'utf8', shell: false \}\)/);
    assert.match(contents, /version !== '11\.16\.0'/);
    assert.doesNotMatch(contents, /execFileSync\(['"]npm\.cmd['"]/);
    assert.doesNotMatch(contents, /shell:\s*true/);
  }
});

test('T011: normal CI uses read-only security and operational controls', () => {
  assert.match(workflow, /permissions:\s*contents:\s*read/s);
  assert.match(workflow, /timeout-minutes:\s*20/);
  assert.match(workflow, /fail-fast:\s*false/);
  assert.equal((workflow.match(/fail-fast:\s*false/g) ?? []).length, 1);
  assert.match(workflow, /cache:\s*npm/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.doesNotMatch(workflow, /continue-on-error\s*:/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(workflow, /secrets\./);
  assert.doesNotMatch(workflow, /gh\s+(auth|release)/);
  assert.doesNotMatch(workflow, /\bgit\s+(tag|push)\b/);
  assert.doesNotMatch(workflow, /GitHub Release|gh release/i);
});

test('T019: tagged smoke has tag-only trigger and required platform matrix', () => {
  assert.match(taggedWorkflow, /on:\s*push:\s*tags:\s*-\s*["']v\*["']/s);
  assert.doesNotMatch(taggedWorkflow, /pull_request|branches:\s*|master/);
  assert.match(taggedWorkflow, /windows-latest/);
  assert.match(taggedWorkflow, /ubuntu-latest/);
  assert.match(taggedWorkflow, /fail-fast:\s*false/);
  assert.doesNotMatch(taggedWorkflow, /continue-on-error\s*:/);
});

test('T019: tagged smoke checks out only the exact triggering tag', () => {
  assert.match(taggedWorkflow, /actions\/checkout@v7/);
  assert.match(taggedWorkflow, /ref:\s*\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(taggedWorkflow, /persist-credentials:\s*false/);
  assert.doesNotMatch(taggedWorkflow, /npm (?:pack|link|install\s+-g\s+\.\.?[\\/])/);
  assert.doesNotMatch(taggedWorkflow, /\bfile:/);
});

test('T019: tagged smoke pins the toolchain and timeout', () => {
  assert.match(taggedWorkflow, /actions\/setup-node@v7/);
  assert.match(taggedWorkflow, /node-version:\s*24\.18\.0/);
  assert.match(taggedWorkflow, /npm install --global npm@11\.16\.0/);
  assert.match(taggedWorkflow, /\['--version'\]/);
  assert.match(taggedWorkflow, /11\.16\.0/);
  assert.match(taggedWorkflow, /timeout-minutes:\s*15/);
});

test('T019: tagged smoke exposes the read-only token only at harness invocation', () => {
  assert.match(taggedWorkflow, /permissions:\s*contents:\s*read/s);
  assert.doesNotMatch(taggedWorkflow, /contents:\s*write|actions:\s*write|packages:\s*write|id-token:\s*write/);
  assert.equal((taggedWorkflow.match(/GITHUB_TOKEN/g) ?? []).length, 2);
  assert.match(taggedWorkflow, /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  assert.match(taggedWorkflow, /CHANGE_BUDGET_TAG:\s*\$\{\{\s*github\.ref_name\s*\}\}/);
  assert.match(taggedWorkflow, /run:\s*npm run smoke:tagged/);
  assert.doesNotMatch(taggedWorkflow, /secrets\.(?!GITHUB_TOKEN)/);
  assert.doesNotMatch(taggedWorkflow, /set\s+-x|\becho\s+\$\{?GITHUB_TOKEN/);
});

test('T019: tagged smoke rejects credential and release mutation patterns', () => {
  assert.doesNotMatch(taggedWorkflow, /https?:\/\/[^\s]*\$\{\{\s*secrets\.GITHUB_TOKEN/);
  assert.doesNotMatch(taggedWorkflow, /TOKEN@github\.com|git@github\.com|gh\s+auth\s+login/);
  assert.doesNotMatch(taggedWorkflow, /ssh-keygen|credential\.helper\s+store/);
  assert.doesNotMatch(taggedWorkflow, /\bgit\s+(?:tag|push)\b/);
  assert.doesNotMatch(taggedWorkflow, /gh\s+release|GitHub Release|create-release/i);
  assert.match(taggedWorkflow, /cancel-in-progress:\s*false/);
});

test('T024: tagged token scope is structurally limited to the smoke step', () => {
  const jobsIndex = taggedWorkflow.indexOf('jobs:');
  const stepsIndex = taggedWorkflow.indexOf('steps:');
  const smokeStepIndex = taggedWorkflow.indexOf('- name: Run tagged smoke');
  assert.ok(jobsIndex >= 0);
  assert.ok(stepsIndex > jobsIndex);
  assert.ok(smokeStepIndex > stepsIndex);
  assert.doesNotMatch(taggedWorkflow.slice(0, jobsIndex), /GITHUB_TOKEN/);
  assert.doesNotMatch(taggedWorkflow.slice(jobsIndex, stepsIndex), /GITHUB_TOKEN/);
  assert.match(taggedWorkflow.slice(smokeStepIndex), /GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN/);
  assert.equal((taggedWorkflow.match(/^\s+GITHUB_TOKEN:/gm) ?? []).length, 1);
});

test('T024: workflow and harness keep auth transport ephemeral and credential-free', () => {
  assert.match(smokeHarness, /GIT_CONFIG_COUNT:\s*'1'/);
  assert.match(smokeHarness, /GIT_CONFIG_KEY_0:\s*GIT_AUTH_CONFIG_KEY/);
  assert.match(smokeHarness, /GIT_CONFIG_VALUE_0:/);
  assert.match(smokeHarness, /SECRET_ENV_KEYS/);
  assert.match(smokeHarness, /delete environment\[key\]|delete npmEnv\[key\]/);
  assert.doesNotMatch(smokeHarness, /credential\.helper\s+store|git config --global|gh\s+auth|ssh-keygen|git@github\.com/);
  assert.doesNotMatch(smokeHarness, /printenv|set\s+-x|toJSON\(github\)|JSON\.stringify\(process\.env\)/);
  assert.doesNotMatch(smokeHarness, /https?:\/\/[^\s]*\$\{\{\s*secrets\.GITHUB_TOKEN/);
  assert.doesNotMatch(smokeHarness, /FAKE_SECRET_DO_NOT_PRINT_12345/);
  assert.doesNotMatch(smokeHarness, /shell:\s*true/);
  assert.match(smokeHarness, /process\.env\.ComSpec \|\| 'cmd\.exe'/);
  assert.match(smokeHarness, /shell:\s*false/);
});

test('T024: workflow forbids write operations, package mutation, and release publication', () => {
  assert.doesNotMatch(taggedWorkflow, /\bnpm version\b|\bgit\s+(?:tag|push)\b/);
  assert.doesNotMatch(taggedWorkflow, /gh\s+release|create-release|actions\/upload-artifact/i);
  assert.doesNotMatch(taggedWorkflow, /npmrc|credential\.helper|GIT_CONFIG_VALUE_0/);
  assert.doesNotMatch(taggedWorkflow, /\$\{\{\s*toJSON\(/);
  assert.match(taggedWorkflow, /permissions:\s*contents:\s*read/s);
});
