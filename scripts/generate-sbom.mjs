import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { parseJsonWithUniqueKeys } from "../graph-core.js";

const require = createRequire(import.meta.url);
const manifest = require("../package.json");
const release = require("../version.json");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const lexicalCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const outputPath = resolve(process.argv[2] || "sbom.spdx.json");
const result = spawnSync(npmCommand, ["sbom", "--sbom-format=spdx", "--sbom-type=application"], {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024
});
if (result.error) throw result.error;
if (result.status !== 0) {
  process.stderr.write(result.stderr || "npm sbom failed.\n");
  process.exit(result.status ?? 1);
}
const rawSbom = parseJsonWithUniqueKeys(result.stdout, "dependency SBOM");
if (!Array.isArray(rawSbom.packages) || !Array.isArray(rawSbom.relationships)) {
  throw new Error("npm generated an incomplete SPDX dependency SBOM.");
}
const packages = [...rawSbom.packages].sort((left, right) => lexicalCompare(String(left.SPDXID), String(right.SPDXID)));
const relationships = [...rawSbom.relationships].sort((left, right) => lexicalCompare(JSON.stringify(left), JSON.stringify(right)));
const packageDigest = createHash("sha256")
  .update(JSON.stringify(packages))
  .update(JSON.stringify(relationships))
  .digest("hex");
const sbom = {
  ...rawSbom,
  name: `${manifest.name}@${manifest.version}`,
  documentNamespace: `https://llm-field-notes.local/sbom/${manifest.version}-${packageDigest.slice(0, 32)}`,
  documentDescribes: [...rawSbom.documentDescribes].sort(),
  creationInfo: {
    ...rawSbom.creationInfo,
    created: `${release.date}T00:00:00.000Z`,
    creators: ["Tool: llm-field-notes/sbom-generator@1"]
  },
  packages,
  relationships
};
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(sbom, null, 2)}\n`, "utf8");
console.log(`dependency SBOM written: ${outputPath}`);
