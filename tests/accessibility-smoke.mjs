import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { auditHtmlDocument, auditHtmlDirectory } from "../scripts/check-accessibility.mjs";

const root = resolve(new URL("../dist/", import.meta.url).pathname);
const valid = await auditHtmlDirectory(root);
assert.equal(valid.files, 17, "the generated Pages bundle should audit every HTML document");
assert(
  auditHtmlDocument("<!doctype html><html><head><title>x</title></head><body><h1>x</h1><img src='x'></body></html>", "missing-alt.html")
    .some((error) => /missing-alt\.html: every img element must declare alt text/.test(error)),
  "the accessibility audit should reject images without alt text"
);
assert(
  auditHtmlDocument("<!doctype html><html><head><title>x</title></head><body><h1>x</h1><input id='q'></body></html>", "missing-label.html")
    .some((error) => /missing-label\.html: input controls must have a label/.test(error)),
  "the accessibility audit should reject unlabeled form controls"
);
const tamperedRoot = resolve(root, "../dist-tampered-accessibility");
try {
  await cp(root, tamperedRoot, { recursive: true });
  const indexPath = resolve(tamperedRoot, "index.html");
  const index = await (await import("node:fs/promises")).readFile(indexPath, "utf8");
  await writeFile(indexPath, index.replace('<label class="sr-only" for="search">Search notes</label>\n', ""));
  assert.throws(
    () => execFileSync(process.execPath, ["scripts/check-accessibility.mjs", tamperedRoot], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    (error) => String(error?.stderr).includes("input controls must have a label"),
    "the generated accessibility gate should catch a removed form label"
  );
} finally {
  await rm(tamperedRoot, { recursive: true, force: true });
}
console.log("accessibility smoke ok");
