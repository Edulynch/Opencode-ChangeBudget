import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

// Fixed Phase A ownership manifest: changed/added Phase A test owners, followed
// by direct owners for changed source and packaged Runtime Guard surfaces.
const ownershipGroups = [
  {
    owner: "Changed or added Phase A test owners",
    files: [
      "tests/acceptance/spec005-stack-policy-metrics.test.ts",
      "tests/acceptance/spec008-reliability-metrics.test.ts",
      "tests/integration/amend-runtime-re-evaluation.spec.ts",
      "tests/integration/check-budget-engine.spec.ts",
      "tests/integration/lifecycle-init-start-status-check.spec.ts",
      "tests/integration/opencode-plugin-runtime-hook.spec.ts",
      "tests/integration/cli/amend.test.ts",
      "tests/integration/package-contents.test.ts",
      "tests/unit/amend-command.test.ts",
      "tests/unit/changebudget-command.test.ts",
      "tests/unit/check-rules.test.ts",
      "tests/unit/contract-validation.test.ts",
      "tests/unit/forced-close.test.ts",
      "tests/unit/integration-opencode-invariants.test.ts",
      "tests/unit/opencode-runtime-projection.test.ts",
      "tests/unit/scope-amend-command.test.ts",
      "tests/unit/start-command.test.ts",
      "tests/unit/state-validation.test.ts",
      "tests/unit/status-check-close.test.ts",
      "tests/unit/lifecycle-lock-recovery.test.ts",
    ],
  },
  {
    owner: "Direct owners for changed source and installed/package behavior",
    files: [
      "tests/unit/smoke-tagged-install.test.ts",
      "tests/unit/state-transitions.test.ts",
      "tests/unit/state-helpers.test.ts",
      "tests/integration/integration-opencode-runtime.spec.ts",
      "tests/integration/cli/help.test.ts",
      "tests/integration/baseline/activation.spec.ts",
      "tests/acceptance/tagged-install.test.ts",
    ],
  },
];

const sourceFiles = ownershipGroups.flatMap(({ files }) => files);
const compiledFiles = sourceFiles.map((file) => `dist/${file.replace(/\.ts$/u, ".js")}`);
const runnerArgs = ["--test", ...compiledFiles];

function printList() {
  console.log("Gate command: npm run test:phase-a");
  console.log("Build step: npm run compile");
  console.log("Runner executable: process.execPath");
  console.log("Runner arguments after compile (JSON argv):");
  console.log(JSON.stringify(runnerArgs, null, 2));
  console.log("Runner working directory: repository root");
  console.log(`Owned TypeScript test files (${sourceFiles.length}):`);

  let compiledIndex = 0;
  for (const group of ownershipGroups) {
    console.log(`\n${group.owner}:`);
    for (const sourceFile of group.files) {
      console.log(`  ${sourceFile} -> ${compiledFiles[compiledIndex]}`);
      compiledIndex += 1;
    }
  }
}

const args = process.argv.slice(2);
if (args.length > 0) {
  if (args.length === 1 && args[0] === "--list") {
    printList();
  } else {
    console.error("Usage: node scripts/test-phase-a-focused.mjs [--list]");
    process.exitCode = 2;
  }
} else {
  const result = spawnSync(process.execPath, runnerArgs, {
    cwd: repositoryRoot,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Unable to start the focused test runner: ${result.error.message}`);
    process.exitCode = 1;
  } else if (result.signal) {
    console.error(`The focused test runner was terminated by ${result.signal}.`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
