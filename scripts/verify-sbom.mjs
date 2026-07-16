import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { parseJsonWithUniqueKeys } from "../graph-core.js";

const require = createRequire(import.meta.url);
const manifest = require("../package.json");
const release = require("../version.json");
const inputPath = resolve(process.argv[2] || "sbom.spdx.json");
const metadata = await stat(inputPath);
assert(metadata.isFile() && metadata.size > 0 && metadata.size <= 20 * 1024 * 1024, "dependency SBOM must be a bounded non-empty regular file");
const sbom = parseJsonWithUniqueKeys(await readFile(inputPath, "utf8"), "dependency SBOM");
assert.equal(sbom.spdxVersion, "SPDX-2.3", "dependency SBOM must use SPDX 2.3");
assert.equal(sbom.dataLicense, "CC0-1.0", "dependency SBOM must use the SPDX document license");
assert.equal(sbom.SPDXID, "SPDXRef-DOCUMENT", "dependency SBOM must declare the SPDX document identity");
assert(typeof sbom.name === "string" && sbom.name.length > 0 && sbom.name.length <= 200, "dependency SBOM must declare a bounded document name");
assert.equal(sbom.name, `${manifest.name}@${manifest.version}`, "dependency SBOM must identify the current application version");
assert.match(sbom.documentNamespace || "", new RegExp(`^https://llm-field-notes\\.local/sbom/${manifest.version}-[0-9a-f]{32}$`), "dependency SBOM namespace must be deterministic and content-bound");
assert(Array.isArray(sbom.documentDescribes) && sbom.documentDescribes.length > 0 && sbom.documentDescribes.length <= 5000, "dependency SBOM must describe at least one package");
assert(Array.isArray(sbom.packages) && sbom.packages.length > 0 && sbom.packages.length <= 5000, "dependency SBOM must contain a bounded package inventory");
assert(Array.isArray(sbom.relationships) && sbom.relationships.length <= 20000, "dependency SBOM relationships must be a bounded array");
const packageIds = new Set();
for (const item of sbom.packages) {
  assert(item && typeof item === "object" && !Array.isArray(item), "dependency SBOM packages must be objects");
  assert(typeof item.name === "string" && item.name.length > 0 && item.name.length <= 200, "dependency SBOM package names must be bounded");
  assert(typeof item.versionInfo === "string" && item.versionInfo.length > 0 && item.versionInfo.length <= 200, "dependency SBOM package versions must be bounded");
  assert(typeof item.SPDXID === "string" && /^SPDXRef-[A-Za-z0-9.-]+$/.test(item.SPDXID), "dependency SBOM package identities must be valid SPDX IDs");
  assert(!packageIds.has(item.SPDXID), "dependency SBOM package identities must be unique");
  packageIds.add(item.SPDXID);
  if (item.packageFileName) assert(typeof item.packageFileName === "string" && (item.packageFileName === "" || item.packageFileName.startsWith("node_modules/")), "dependency SBOM package paths must remain inside node_modules");
  if (Array.isArray(item.externalRefs)) {
    for (const reference of item.externalRefs) {
      assert(reference && typeof reference === "object" && typeof reference.referenceLocator === "string" && reference.referenceLocator.length <= 500, "dependency SBOM package references must be bounded");
    }
  }
}
const rootPackage = sbom.packages.find((item) => item.name === manifest.name && item.versionInfo === manifest.version);
assert(rootPackage, "dependency SBOM must include the application package and current version");
assert(sbom.documentDescribes.includes(rootPackage.SPDXID), "dependency SBOM must describe the application package");
for (const relationship of sbom.relationships) {
  assert(relationship && typeof relationship === "object"
    && typeof relationship.spdxElementId === "string"
    && typeof relationship.relatedSpdxElement === "string"
    && typeof relationship.relationshipType === "string"
    && relationship.relationshipType.length <= 100, "dependency SBOM relationships must be bounded SPDX records");
  assert(packageIds.has(relationship.spdxElementId) || relationship.spdxElementId === "SPDXRef-DOCUMENT", "dependency SBOM relationships must reference declared elements");
  assert(packageIds.has(relationship.relatedSpdxElement) || relationship.relatedSpdxElement === "SPDXRef-DOCUMENT", "dependency SBOM relationships must reference declared elements");
}
const canonicalPackages = [...sbom.packages].sort((left, right) => left.SPDXID < right.SPDXID ? -1 : left.SPDXID > right.SPDXID ? 1 : 0);
const canonicalRelationships = [...sbom.relationships].sort((left, right) => {
  const leftText = JSON.stringify(left);
  const rightText = JSON.stringify(right);
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
});
const packageDigest = createHash("sha256")
  .update(JSON.stringify(canonicalPackages))
  .update(JSON.stringify(canonicalRelationships))
  .digest("hex");
assert.equal(sbom.documentNamespace, `https://llm-field-notes.local/sbom/${manifest.version}-${packageDigest.slice(0, 32)}`, "dependency SBOM namespace must match its package and relationship inventory");
const created = sbom.creationInfo?.created;
assert.deepEqual(sbom.creationInfo?.creators, ["Tool: llm-field-notes/sbom-generator@1"], "dependency SBOM creator metadata must identify the stable generator contract");
assert.equal(created, `${release.date}T00:00:00.000Z`, "dependency SBOM creation time must use the versioned release date");
console.log(`dependency SBOM verified: ${sbom.packages.length} packages`);
