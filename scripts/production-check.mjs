import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
export const CHECK_TIMEOUT_MS = 5 * 60 * 1000;
const baseChecks = [
  ["Verify the supported Node runtime", ["run", "runtime:check"]],
  ["Validate deployment configuration", ["run", "deployment:check"]],
  ["Audit all locked dependencies", ["audit", "--audit-level=high"]],
  ["Generate dependency SBOM", ["run", "sbom:generate"]],
  ["Verify dependency SBOM", ["run", "verify:sbom"]],
  ["Validate GitHub workflow contracts", ["run", "workflows:check"]],
  ["Validate release metadata and deployment contracts", ["run", "release:check"]],
  ["Verify the published Canvas projection", ["run", "verify:canvas"]],
  ["Verify the published service-health fixture", ["run", "verify:service-health"]],
  ["Build the static Pages artifact", ["run", "build:pages"]],
  ["Verify public artifact inventory", ["run", "artifacts:check"]],
  ["Audit generated HTML accessibility", ["run", "accessibility:check", "--", "dist"]],
  ["Verify critical browser-shell performance budget", ["run", "performance:check", "--", "dist"]],
  ["Verify the static Pages artifact", ["run", "verify:pages"]],
  ["Run the complete test and contract suite", ["test"]],
  ["Smoke the standalone server lifecycle", ["run", "smoke:server"]],
  ["Validate security disclosure metadata", ["run", "security:check"]],
  ["Gate deterministic self-improvement proof", ["run", "learning:check"]],
  ["Gate the reviewed extraction quality benchmark", ["run", "evaluation:check"]],
  ["Verify encrypted backup round-trip", ["run", "backup:smoke"]],
  ["Gate the published sample graph", ["run", "health:sample"]],
  ["Verify the final Pages artifact", ["run", "verify:pages"]],
];

export function buildProductionChecks(environment = process.env) {
  const checks = [...baseChecks];
  const deployedPagesUrl = typeof environment.PAGES_DEPLOYMENT_URL === "string"
    ? environment.PAGES_DEPLOYMENT_URL.trim()
    : "";
  if (deployedPagesUrl) {
    const expectedRevision = typeof environment.PAGES_EXPECTED_REVISION === "string"
      ? environment.PAGES_EXPECTED_REVISION.trim()
      : "";
    if (!expectedRevision) {
      throw Object.assign(new Error("production check requires PAGES_EXPECTED_REVISION when PAGES_DEPLOYMENT_URL is configured."), { exitCode: 1 });
    }
    if (!/^(?:unknown|[0-9a-f]{7,64})$/i.test(expectedRevision)) {
      throw Object.assign(new Error("production check received an invalid PAGES_EXPECTED_REVISION."), { exitCode: 1 });
    }
    checks.push(["Verify the exact deployed Pages origin", ["run", "smoke:pages:deployment"]]);
  }
  return checks;
}

export function runProductionCheck(label, args, {
  command = npmCommand,
  timeoutMs = CHECK_TIMEOUT_MS,
  spawn = spawnSync,
  log = console.log,
  environment = process.env
} = {}) {
  log(`\n==> ${label}`);
  const result = spawn(command, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGTERM"
  });
  if (result.error) {
    const detail = result.error.code === "ETIMEDOUT"
      ? `timed out after ${timeoutMs / 1000} seconds`
      : result.error.message;
    throw Object.assign(new Error(`production check could not complete: ${label}: ${detail}`), { exitCode: 1 });
  }
  if (result.signal) {
    throw Object.assign(new Error(`production check terminated: ${label}: ${result.signal}`), { exitCode: 1 });
  }
  if (result.status !== 0) {
    throw Object.assign(new Error(`production check failed: ${label}`), { exitCode: result.status ?? 1 });
  }
  return result;
}

export function runProductionChecks({
  environment = process.env,
  ...options
} = {}) {
  for (const [label, args] of buildProductionChecks(environment)) {
    runProductionCheck(label, args, { ...options, environment });
  }
}

function main() {
  runProductionChecks();
  console.log("\nproduction check ok");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : "production check failed");
    process.exit(error?.exitCode ?? 1);
  }
}
