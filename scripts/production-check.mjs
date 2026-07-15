import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const checks = [
  ["Verify the supported Node runtime", ["run", "runtime:check"]],
  ["Audit production dependencies", ["audit", "--omit=dev", "--audit-level=high"]],
  ["Validate release metadata and deployment contracts", ["run", "release:check"]],
  ["Run the complete test and contract suite", ["test"]],
  ["Smoke the standalone server lifecycle", ["run", "smoke:server"]],
  ["Validate security disclosure metadata", ["run", "security:check"]],
  ["Gate deterministic self-improvement proof", ["run", "learning:check"]],
  ["Gate the reviewed extraction quality benchmark", ["run", "evaluation:check"]],
  ["Verify encrypted backup round-trip", ["run", "backup:smoke"]],
  ["Gate the published sample graph", ["run", "health:sample"]],
  ["Build the static Pages artifact", ["run", "build:pages"]],
  ["Verify the static Pages artifact", ["run", "verify:pages"]]
];

for (const [label, args] of checks) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(npmCommand, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    console.error(`production check could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`production check failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nproduction check ok");
