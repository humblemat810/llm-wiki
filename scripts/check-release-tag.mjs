import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);

export function validateReleaseTag(tag, version, channel = "stable") {
  if (!/^\d+\.\d+\.\d+$/.test(String(version))) {
    throw new Error(`package version is not a stable semver triplet: ${version}`);
  }
  if (channel !== "stable") {
    throw new Error(`versioned releases require a stable release channel, received: ${channel}`);
  }
  if (tag !== `v${version}`) {
    throw new Error(`release tag ${tag || "(missing)"} does not match package version v${version}`);
  }
  return true;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const packageManifest = require("../package.json");
  const release = require("../version.json");
  validateReleaseTag(process.env.GITHUB_REF_NAME || process.argv[2] || "", packageManifest.version, release.channel);
  console.log(`release tag check ok: v${packageManifest.version}`);
}
