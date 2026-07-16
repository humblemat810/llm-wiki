import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const packageManifest = require("../package.json");
const requiredMajor = Number(String(packageManifest.engines?.node || "").match(/(\d+)/)?.[1]);
const currentMajor = Number(process.versions.node.split(".", 1)[0]);

assert(Number.isSafeInteger(requiredMajor) && requiredMajor >= 1, "package.json must declare a numeric Node engine baseline.");
if (!Number.isSafeInteger(currentMajor) || currentMajor < requiredMajor) {
  throw new Error(`Node ${requiredMajor}+ is required; running Node ${process.versions.node}. Run \`nvm install && nvm use\` or select the checked-in .nvmrc/.node-version before retrying.`);
}
for (const file of [".nvmrc", ".node-version"]) {
  const configuredMajor = Number((await readFile(resolve(file), "utf8")).trim().match(/^\d+/)?.[0]);
  assert.equal(configuredMajor, requiredMajor, `${file} must select Node ${requiredMajor} to match package.json.`);
}

console.log(`runtime check ok: Node ${process.versions.node} satisfies ${packageManifest.engines.node}`);
