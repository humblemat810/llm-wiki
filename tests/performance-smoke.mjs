import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkPerformanceBudget, MAX_CRITICAL_SCRIPT_BYTES, MAX_CRITICAL_SHELL_BYTES } from "../scripts/check-performance.mjs";

const root = resolve(new URL("../dist/", import.meta.url).pathname);
const result = await checkPerformanceBudget(root);
assert(result.shellBytes < MAX_CRITICAL_SHELL_BYTES, "the generated critical shell should retain measurable headroom");
assert(result.scriptBytes < MAX_CRITICAL_SCRIPT_BYTES, "the generated critical scripts should retain measurable headroom");
const tamperedRoot = resolve(root, "../dist-tampered-performance");
try {
  await cp(root, tamperedRoot, { recursive: true });
  const appPath = resolve(tamperedRoot, "app.js");
  const app = await readFile(appPath, "utf8");
  await writeFile(appPath, `${app}${"x".repeat(MAX_CRITICAL_SCRIPT_BYTES)}`);
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/check-performance.mjs", tamperedRoot], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("JavaScript critical bundle"),
    "the performance gate should reject accidental critical JavaScript growth"
  );
} finally {
  await rm(tamperedRoot, { recursive: true, force: true });
}
console.log("performance smoke ok");
