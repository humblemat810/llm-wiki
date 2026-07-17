import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

const IGNORED_DIRECTORIES = new Set([".git", ".codex", "dist", "node_modules"]);
const STATIC_PUBLICATION_VARIABLES = [
  "DEPLOYMENT_MODE",
  "PUBLIC_ORIGIN",
  "PUBLIC_REPOSITORY_URL",
  "BUILD_REVISION",
  "PAGES_DEPLOYMENT_URL",
  "PAGES_EXPECTED_REVISION"
];
const STATIC_PUBLICATION_TEST_FILES = new Set(["tests/artifacts-smoke.mjs"]);
function collectJavaScriptFiles(directory, output = []) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".llm-field-notes-pages-build-")) {
        collectJavaScriptFiles(path, output);
      }
    } else if (entry.isFile() && /\.(?:cjs|js|mjs)$/i.test(entry.name)) {
      output.push(relative(process.cwd(), path));
    }
  }
  return output;
}

const sourceFiles = collectJavaScriptFiles(".").sort();

const testFiles = readdirSync("tests")
  .filter((file) => file.endsWith(".mjs"))
  .sort()
  .map((file) => join("tests", file));

function run(label, args, { isolateStaticPublication = false } = {}) {
  console.log(`\n==> ${label}`);
  const testFile = args[0];
  const preserveStaticPublication = STATIC_PUBLICATION_TEST_FILES.has(testFile);
  const environment = isolateStaticPublication
      && process.env.DEPLOYMENT_MODE === "static-pages"
      && !preserveStaticPublication
    ? { ...process.env }
    : process.env;
  if (environment !== process.env) {
    for (const variable of STATIC_PUBLICATION_VARIABLES) delete environment[variable];
  }
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit",
    timeout: 120000
  });
  if (result.error) {
    console.error(`${label} could not start: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit ${result.status ?? 1}`;
    console.error(`${label} failed (${reason}).`);
    process.exit(result.status ?? 1);
  }
}

run("Build the Pages artifact for artifact-dependent tests", ["scripts/build-pages.mjs"]);
run("Verify the Pages artifact for artifact-dependent tests", ["scripts/verify-pages.mjs"]);

for (const file of sourceFiles) {
  run(`Syntax check: ${file}`, ["--check", file]);
}

run("Release contract: scripts/check-release.mjs", ["scripts/check-release.mjs"]);

for (const file of testFiles) {
  run(`Behavioral test: ${file}`, [file], { isolateStaticPublication: true });
}

console.log(`\nTest suite passed: ${sourceFiles.length} syntax checks, release contracts, and ${testFiles.length} behavioral tests.`);
