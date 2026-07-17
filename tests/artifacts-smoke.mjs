import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../artifacts.html", import.meta.url), "utf8");
const checker = await readFile(new URL("../scripts/check-artifacts.mjs", import.meta.url), "utf8");
assert(checker.includes("parseJsonWithUniqueKeys"), "artifact verification must use duplicate-key-safe JSON parsing");
const commands = [...html.matchAll(/<a class="artifact-card"[\s\S]*?<code>([\s\S]*?)<\/code><\/a>/g)]
  .map(([, command]) => command.replace(/<[^>]+>/g, "").trim());

assert.equal(commands.length, 21, "the artifact smoke should cover every public card");
for (const command of commands) {
  const tokens = command.split(/\s+/);
  const executable = tokens.shift();
  const output = executable === "node"
    ? execFileSync(process.execPath, tokens, { cwd: process.cwd(), encoding: "utf8", timeout: 15000 })
    : executable === "npm"
      ? execFileSync("npm", tokens, { cwd: process.cwd(), encoding: "utf8", timeout: 15000 })
      : (() => { throw new Error(`Unsupported artifact command: ${command}`); })();
  assert(output.trim(), `artifact command produced no output: ${command}`);
}

console.log(`artifact smoke ok: ${commands.length} commands`);
