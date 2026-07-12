import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const manifest = JSON.parse(fs.readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
const graphSchema = JSON.parse(fs.readFileSync(new URL("../schema/graph.schema.json", import.meta.url), "utf8"));
const app = fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
const serviceWorker = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const bugTemplate = fs.readFileSync(new URL("../.github/ISSUE_TEMPLATE/bug_report.yml", import.meta.url), "utf8");
const featureTemplate = fs.readFileSync(new URL("../.github/ISSUE_TEMPLATE/feature_request.yml", import.meta.url), "utf8");

for (const id of ["workbench", "app-error", "reload-app", "document-file", "ingest-document", "clear-graph", "undo-graph", "graph-search", "manual-node-label", "add-manual-node", "manual-edge-source", "manual-edge-target", "add-manual-edge", "graph-canvas", "node-list", "relation-list", "inspector-panel", "graph-health", "download-markdown", "download-vault", "download-json", "download-backup"]) {
  assert(html.includes(`id="${id}"`), `missing required element: ${id}`);
}
for (const match of html.matchAll(/<label[^>]+for="([^"]+)"/g)) {
  assert(html.includes(`id="${match[1]}"`), `label target is missing: ${match[1]}`);
}
assert(/id="document-file"[^>]*multiple/.test(html), "document input should support batches");
assert(html.includes('id="file-queue"'), "file queue status should be visible");
for (const asset of ["./index.html", "./styles.css", "./app.js", "./graph-core.js", "./graph-store.js", "./extractor-adapter.js", "./projection-adapter.js", "./manifest.webmanifest", "./icon.svg", "./schema/graph.schema.json"]) {
  assert(serviceWorker.includes(asset), `service worker missing shell asset: ${asset}`);
}
assert.equal(manifest.name, "LLM Field Notes");
assert.equal(graphSchema.properties.schema.const, "llm-field-notes/graph@1");
assert(graphSchema.$defs.evidence.required.includes("sources"), "evidence provenance is part of the graph contract");
assert(html.includes("Content-Security-Policy"), "a restrictive content security policy must be present");
assert(app.includes("normalizeGraph"), "state normalization must remain wired");
assert(app.includes("downloadFile"), "projection download must remain wired");
assert(app.includes("zipStore"), "Obsidian vault export must remain wired");
assert(app.includes("renderInspector"), "evidence inspector must remain wired");
assert(app.includes("data-select-source"), "source inspection links must remain wired");
assert(app.includes("previewLimit"), "source previews must remain bounded");
assert(app.includes("pendingFiles"), "batch ingestion state must remain wired");
assert(app.includes("renderWorkbenchUnsafe"), "workbench error boundary must remain wired");
assert(app.includes("data-edit-source"), "source metadata editing must remain wired");
assert(app.includes("data-remove-source"), "source removal must remain wired");
assert(app.includes("commitManualGraph"), "manual graph editing must remain wired");
assert(app.includes("inspectGraph"), "graph health diagnostics must remain wired");
assert(app.includes("applyFeedback"), "feedback behavior must remain centralized in the graph core");
assert(app.includes("feedback} feedback"), "feedback state should be visible in the workbench");
assert(app.includes("applyObsidianFeedback"), "Obsidian feedback import must remain wired");
assert(app.includes("parseObsidianVault"), "ZIP vault feedback import must remain wired");
assert(app.includes("Select an Obsidian vault ZIP by itself"), "mixed ZIP selections must be rejected");
assert(app.includes("Relations/${safeFileName"), "relation projections must have stable editable notes");
assert(app.includes("broken source reference"), "broken provenance must be visible in the health strip");
assert(app.includes("readRecovery"), "corrupt graph recovery must be wired");
assert(app.includes("data-recovery-action"), "recovery actions must be visible in the workbench");
assert(app.includes("requestPersistentStorage"), "local graph durability request must remain wired");
assert(app.includes("Saved with reduced undo history"), "degraded storage writes must be visible");
assert(app.includes("That feedback could not be saved"), "feedback persistence failures must be surfaced");
assert(app.includes("graph.revisions = graph.revisions.slice(0, 20)"), "feedback revisions must remain bounded");
assert(bugTemplate.includes("name: Bug report") && bugTemplate.includes("id: reproduce"), "bug intake should request reproduction steps");
assert(featureTemplate.includes("name: Feature request") && featureTemplate.includes("id: proposal"), "feature intake should request a concrete proposal");
assert(app.includes("revision-items"), "revision timeline must remain wired");
assert(app.includes("backup@1"), "full backup format must remain wired");
console.log("site check ok");
