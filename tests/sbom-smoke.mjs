import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = await mkdtemp(join(tmpdir(), "llm-field-notes-sbom-"));
const validPath = join(root, "valid.json");
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const valid = {
  spdxVersion: "SPDX-2.3",
  dataLicense: "CC0-1.0",
  SPDXID: "SPDXRef-DOCUMENT",
  name: "llm-field-notes@0.1.0",
  documentNamespace: "https://llm-field-notes.local/sbom/0.1.0-e8a9d24108496763fb6302e7495c4252",
  documentDescribes: ["SPDXRef-Package-llm-field-notes-0.1.0"],
  creationInfo: {
    created: "2026-07-12T00:00:00.000Z",
    creators: ["Tool: llm-field-notes/sbom-generator@1"]
  },
  packages: [{
    name: "llm-field-notes",
    versionInfo: "0.1.0",
    SPDXID: "SPDXRef-Package-llm-field-notes-0.1.0",
    packageFileName: "",
    externalRefs: []
  }],
  relationships: []
};
try {
  await writeFile(validPath, JSON.stringify(valid));
  const verified = execFileSync(process.execPath, ["scripts/verify-sbom.mjs", validPath], { encoding: "utf8" });
  assert.match(verified, /dependency SBOM verified: 1 packages/);
  const generatedOne = join(root, "generated-one.json");
  const generatedTwo = join(root, "generated-two.json");
  execFileSync(npmCommand, ["run", "sbom:generate", "--", generatedOne], { cwd: process.cwd(), encoding: "utf8" });
  execFileSync(npmCommand, ["run", "sbom:generate", "--", generatedTwo], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(await readFile(generatedOne, "utf8"), await readFile(generatedTwo, "utf8"), "SBOM generation should be byte-for-byte repeatable");
  execFileSync(process.execPath, ["scripts/verify-sbom.mjs", generatedOne], { encoding: "utf8" });
  const tamperedPath = join(root, "tampered.json");
  await writeFile(tamperedPath, JSON.stringify({ ...valid, packages: [{ ...valid.packages[0], SPDXID: "bad id" }] }));
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/verify-sbom.mjs", tamperedPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("valid SPDX IDs"),
    "SBOM verification should reject malformed package identities"
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
console.log("SBOM smoke ok");
