import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { buildLearningNotePage } from "../scripts/note-page.mjs";

const notesDirectory = new URL("../notes/", import.meta.url);
const index = readFileSync(new URL("README.md", notesDirectory), "utf8");
const noteFiles = readdirSync(notesDirectory)
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .sort();

assert(noteFiles.length >= 12, "the learning map should retain its core note set");
for (const file of noteFiles) {
  const id = basename(file, ".md");
  const content = readFileSync(new URL(file, notesDirectory), "utf8");
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/)?.[1] || "";
  assert(frontmatter.split(/\r?\n/).some((line) => line === `id: ${id}`), `${file} should declare its filename-stable ID`);
  assert.match(frontmatter, /^title:\s*\S.+$/m, `${file} should declare a title`);
  assert.match(frontmatter, /^category:\s*\S.+$/m, `${file} should declare a category`);
  for (const heading of ["## The short version", "## Build it", "## Failure modes", "## Sources", "## Try it yourself"]) {
    assert(content.includes(heading), `${file} should retain the learning note section ${heading}`);
  }
  const sourceSection = content.match(/## Sources\s*\n([\s\S]*?)(?=\n## |\s*$)/)?.[1] || "";
  assert.match(sourceSection, /^\s*-\s+\S/m, `${file} should name at least one source`);
  const trySection = content.match(/## Try it yourself\s*\n([\s\S]*?)(?=\n## |\s*$)/)?.[1] || "";
  assert(trySection.trim().length >= 40, `${file} should include a reproducible try-it-yourself exercise`);
  assert(index.includes(`(${file})`), `notes/README.md should link ${file}`);
}

const hostilePage = buildLearningNotePage({
  id: "security-check",
  title: "Security check",
  description: "Renderer safety check.",
  content: `---
id: security-check
---

# Security check

## Rendered section

<script>alert("xss")</script>

<img src=x onerror=alert(1)>

[A safe source](https://example.org/paper)
[A hostile source](javascript:alert(1))
[A credential source](https://user:password@example.org/private)
`
});
assert(hostilePage.includes("<h2>Rendered section</h2>"), "learning-note renderer should preserve Markdown structure");
const hostileStructuredData = JSON.parse(hostilePage.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] || "{}");
assert.equal(hostileStructuredData["@type"], "Article", "learning-note pages should expose Article structured data");
assert.equal(hostileStructuredData.headline, "Security check", "Article structured data should preserve the note title");
assert(hostilePage.includes('type="application/atom+xml"') && hostilePage.includes('href="../feed.xml"'), "learning-note pages should advertise the curriculum feed");
assert(!hostilePage.includes("</script><script>alert"), "structured note metadata should not allow HTML/script breakout");
assert(hostilePage.includes('<a href="https://example.org/paper" target="_blank" rel="noopener noreferrer">A safe source</a>'), "learning-note renderer should preserve safe external links");
assert(hostilePage.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"), "learning-note renderer should escape hostile HTML");
assert(hostilePage.includes("&lt;img src=x onerror=alert(1)&gt;"), "learning-note renderer should escape hostile attributes");
assert(!hostilePage.includes('href="javascript:'), "learning-note renderer should not emit executable URL schemes");
assert(!hostilePage.includes('href="https://user:password@example.org/private"'), "learning-note renderer should not emit credential-bearing external links");
assert(!hostilePage.includes("<script>alert"), "learning-note renderer should not emit executable note HTML");
assert.throws(
  () => buildLearningNotePage({
    id: "unsafe-origin",
    title: "Unsafe origin",
    description: "The origin must be validated at the rendering boundary.",
    content: "content",
    origin: "javascript:alert(1)"
  }),
  /absolute credential-free HTTP\(S\) origin/,
  "learning-note renderer should reject executable origins before building links"
);
const originPage = buildLearningNotePage({
  id: "safe-origin",
  title: "Safe origin",
  description: "The origin is normalized at the rendering boundary.",
  content: "content",
  origin: "https://notes.example.test/field-notes///"
});
assert(originPage.includes('href="https://notes.example.test/field-notes/notes/safe-origin.html"'), "learning-note renderer should normalize safe deployment origins");
assert(!originPage.includes("field-notes////"), "learning-note renderer should avoid duplicated origin separators");

console.log(`notes smoke ok: ${noteFiles.length} learning notes`);
