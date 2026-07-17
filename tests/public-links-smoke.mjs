import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { checkPublicLinks, discoverHtmlSources, extractLocalHtmlReferences } from "../scripts/check-public-links.mjs";

assert.deepEqual(
  extractLocalHtmlReferences(`
    <a href="./README.md">read</a>
    <img src="icon.svg" />
    <a href="#section">skip</a>
    <a href="https://example.test/">external</a>
  `),
  ["./README.md", "icon.svg"],
  "public link extraction should retain local href/src targets and ignore fragments/external URLs"
);

const root = resolve(new URL("../public-links-smoke-fixture/", import.meta.url).pathname);
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
try {
  await writeFile(resolve(root, "index.html"), '<a href="./present.txt">present</a><a href="./sample-graph.html">generated</a>', "utf8");
  await writeFile(resolve(root, "present.txt"), "ok", "utf8");
  await checkPublicLinks({ root, sources: ["index.html"] });
  await writeFile(resolve(root, "nested.html"), '<a href="./present.txt">present</a>', "utf8");
  assert.deepEqual(await discoverHtmlSources(root), ["index.html", "nested.html"], "HTML source discovery should be deterministic");

  await writeFile(resolve(root, "index.html"), '<a href="./missing.txt">missing</a>', "utf8");
  await assert.rejects(
    () => checkPublicLinks({ root, sources: ["index.html"] }),
    /target is missing/,
    "public link checks should reject missing local targets"
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("public links smoke ok");
