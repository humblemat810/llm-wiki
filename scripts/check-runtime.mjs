import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const packageManifest = require("../package.json");
const requiredMajor = Number(String(packageManifest.engines?.node || "").match(/(\d+)/)?.[1]);
const currentMajor = Number(process.versions.node.split(".", 1)[0]);

assert(Number.isSafeInteger(requiredMajor) && requiredMajor >= 1, "package.json must declare a numeric Node engine baseline.");
assert(Number.isSafeInteger(currentMajor) && currentMajor >= requiredMajor, `Node ${requiredMajor}+ is required; running Node ${process.versions.node}.`);

console.log(`runtime check ok: Node ${process.versions.node} satisfies ${packageManifest.engines.node}`);
