import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Agent, request as httpRequest } from "node:http";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createAppServer, readBoundedFile } from "../server.mjs";
import { extractGraph, MAX_GRAPH_NODES } from "../graph-core.js";
import { FIXED_PUBLIC_ASSETS, MAX_PUBLIC_ASSET_BYTES } from "../scripts/public-assets.mjs";

const logs = [];
const server = createAppServer({ logger: (entry) => logs.push(entry) });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
try {
  const boundedReadRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-bounded-read-"));
  try {
    const boundedReadPath = join(boundedReadRoot, "asset.bin");
    await writeFile(boundedReadPath, Buffer.alloc(17, 0x78));
    await assert.rejects(
      () => readBoundedFile(boundedReadPath, 16),
      (error) => error?.code === "FILE_TOO_LARGE",
      "runtime asset reads should reject bytes beyond the configured limit"
    );
    await assert.rejects(
      () => readBoundedFile(boundedReadPath, Number.POSITIVE_INFINITY),
      (error) => error instanceof RangeError,
      "runtime asset reads should reject invalid unbounded limits"
    );
  } finally {
    await rm(boundedReadRoot, { recursive: true, force: true });
  }
  assert.equal(server.requestTimeout, 120000);
  assert.equal(server.headersTimeout, 15000);
  assert.equal(server.keepAliveTimeout, 5000);
  assert.equal(server.maxHeaderSize, 16 * 1024);
  assert(Number.isFinite(server.getMetrics().uptimeSeconds) && server.getMetrics().uptimeSeconds >= 0, "programmatic metrics should expose process uptime");
  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert((await index.text()).includes("LLM Field Notes"));
  assert.match(index.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/, "static responses should expose a request ID for operational correlation");
  assert.equal(Number(index.headers.get("content-length")), Buffer.byteLength(await (await fetch(`http://127.0.0.1:${port}/index.html`)).text()), "static responses should advertise their byte length");
  assert(index.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  assert.equal(index.headers.get("strict-transport-security"), null, "local HTTP servers should not advertise HSTS");
  const indexEtag = index.headers.get("etag");
  assert.match(indexEtag || "", /^"[0-9a-f]{64}"$/);
  const notModified = await fetch(`http://127.0.0.1:${port}/`, { headers: { "if-none-match": indexEtag } });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("etag"), indexEtag);
  const serviceWorker = await fetch(`http://127.0.0.1:${port}/sw.js`);
  assert.equal(serviceWorker.headers.get("cache-control"), "no-cache", "service-worker scripts should update promptly");
  const release = await fetch(`http://127.0.0.1:${port}/version.json`);
  assert.equal(release.headers.get("cache-control"), "no-cache", "release metadata should update promptly");
  assert.equal((await release.json()).version, "0.1.0");
  const robots = await fetch(`http://127.0.0.1:${port}/robots.txt`);
  assert.equal(robots.headers.get("content-type"), "text/plain; charset=utf-8", "robots.txt should use the standard text MIME type");
  const note = await fetch(`http://127.0.0.1:${port}/notes/tokens.md`);
  assert.equal(note.status, 200);
  assert.equal(note.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert((await note.text()).includes("# Tokens are the interface"), "versioned learning notes should be served as Markdown");
  const notePage = await fetch(`http://127.0.0.1:${port}/notes/tokens.html`);
  assert.equal(notePage.status, 200);
  const notePageText = await notePage.text();
  assert(notePageText.includes("Tokens are the interface") && notePageText.includes("<h2>The short version</h2>") && notePageText.includes("application/ld+json") && notePageText.includes("\"@type\":\"Article\"") && notePageText.includes("application/atom+xml") && notePageText.includes("Content-Security-Policy") && notePageText.includes("script-src 'none'") && notePageText.includes("robots\" content=\"index,follow\"") && notePageText.includes("og:type\" content=\"article\"") && notePageText.includes("text/markdown"), "Node hosts should serve safe rendered note pages with Article structured data, feed discovery, strict CSP, and Markdown alternate");
  assert(notePage.headers.get("content-security-policy")?.includes("script-src 'none'") && notePage.headers.get("content-security-policy")?.includes("connect-src 'none'"), "Node note landing pages should enforce their strict CSP at the response boundary");
  const notePageEtag = notePage.headers.get("etag");
  assert.match(notePageEtag || "", /^"[0-9a-f]{64}"$/, "note landing pages should expose deterministic validators");
  const notePageHead = await fetch(`http://127.0.0.1:${port}/notes/tokens.html`, { method: "HEAD" });
  assert.equal(notePageHead.status, 200, "note landing pages should support HEAD probes");
  assert.equal(Number(notePageHead.headers.get("content-length")), Number(notePage.headers.get("content-length")), "note landing page HEAD responses should advertise the same length");
  assert.equal(await notePageHead.text(), "", "note landing page HEAD responses should not contain a body");
  const notePageNotModified = await fetch(`http://127.0.0.1:${port}/notes/tokens.html`, { headers: { "if-none-match": notePageEtag } });
  assert.equal(notePageNotModified.status, 304, "note landing pages should support conditional requests");
  assert(notePageNotModified.headers.get("content-security-policy")?.includes("script-src 'none'"), "note landing page 304 responses should preserve the strict CSP");
  const oversizedNoteRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-note-page-oversized-"));
  await mkdir(join(oversizedNoteRoot, "notes"), { recursive: true });
  await writeFile(join(oversizedNoteRoot, "notes", "large.md"), `# Large note\n\n${"x".repeat(10 * 1024 * 1024 + 1)}`);
  const oversizedNoteServer = createAppServer({ staticRoot: oversizedNoteRoot });
  await new Promise((resolve) => oversizedNoteServer.listen(0, "127.0.0.1", resolve));
  try {
    const oversizedNoteResponse = await fetch(`http://127.0.0.1:${oversizedNoteServer.address().port}/notes/large.html`);
    assert.equal(oversizedNoteResponse.status, 413, "oversized dynamic note pages should be rejected before source buffering");
  } finally {
    oversizedNoteServer.close();
    await rm(oversizedNoteRoot, { recursive: true, force: true });
  }
  const shareCard = await fetch(`http://127.0.0.1:${port}/social-card.svg`);
  assert.equal(shareCard.status, 200);
  assert.equal(shareCard.headers.get("content-type"), "image/svg+xml");
  assert((await shareCard.text()).includes("Turn documents"), "the deployed server should serve the social card referenced by page metadata");
  const contributing = await fetch(`http://127.0.0.1:${port}/CONTRIBUTING.md`);
  assert.equal(contributing.status, 200);
  assert((await contributing.text()).includes("# Contributing to LLM Field Notes"), "the contribution CTA target should be served");
  const security = await fetch(`http://127.0.0.1:${port}/SECURITY.md`);
  assert.equal(security.status, 200);
  assert((await security.text()).includes("# Security"), "deployed security guidance should be served");
  const conduct = await fetch(`http://127.0.0.1:${port}/CODE_OF_CONDUCT.md`);
  assert.equal(conduct.status, 200);
  assert((await conduct.text()).includes("# Contributor Covenant Code of Conduct"), "community guidance should be served");
  const experiments = await fetch(`http://127.0.0.1:${port}/experiments/README.md`);
  assert.equal(experiments.status, 200);
  const architecture = await fetch(`http://127.0.0.1:${port}/ARCHITECTURE.md`);
  assert.equal(architecture.status, 200);
  assert((await architecture.text()).includes("# LLM Field Notes architecture"), "architecture guidance should be publicly deliverable");
  const changelog = await fetch(`http://127.0.0.1:${port}/CHANGELOG.md`);
  assert.equal(changelog.status, 200);
  assert((await changelog.text()).includes("# Changelog"), "release history should be publicly deliverable");
  const license = await fetch(`http://127.0.0.1:${port}/LICENSE`);
  assert.equal(license.status, 200);
  assert.equal(license.headers.get("content-type"), "text/plain; charset=utf-8");
  assert((await experiments.text()).includes("# Runnable experiments"), "experiment documentation should be served");
  const weakNotModified = await fetch(`http://127.0.0.1:${port}/`, { headers: { "if-none-match": `"other", W/${indexEtag}` } });
  assert.equal(weakNotModified.status, 304);
  const health = await fetch(`http://127.0.0.1:${port}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, schema: "llm-field-notes/graph@1", version: "0.1.0" });
  assert.match(health.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/, "health responses should expose a request ID for operational correlation");
  assert.equal(health.headers.get("cache-control"), "no-store");
  const healthHead = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "HEAD" });
  assert.equal(healthHead.status, 200, "health checks should support HEAD probes");
  assert.equal(Number(healthHead.headers.get("content-length")), Number(health.headers.get("content-length")));
  assert.equal(await healthHead.text(), "", "health HEAD responses should not contain a body");
  const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
  assert.equal(metrics.status, 200);
  assert.equal(metrics.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");
  assert.equal(metrics.headers.get("x-robots-tag"), "noindex, nofollow", "metrics should not be indexed");
  const metricsText = await metrics.text();
  assert(metricsText.includes("llm_field_notes_http_requests_total")
    && metricsText.includes("llm_field_notes_extraction_duration_ms_bucket{le=\"+Inf\"}")
    && metricsText.includes("llm_field_notes_extraction_duration_ms_count")
    && metricsText.includes('llm_field_notes_http_responses_total{status="200"}')
    && metricsText.includes("llm_field_notes_extractions_in_flight 0")
    && metricsText.includes("llm_field_notes_process_uptime_seconds ")
    && metricsText.includes('llm_field_notes_build_info{version="0.1.0"} 1'), "metrics should expose privacy-safe request, latency, and build gauges");
  assert(Number(server.getMetrics().responsesByStatus["200"]) > 0, "programmatic metrics should expose successful HTTP response counts");
  const metricsHead = await fetch(`http://127.0.0.1:${port}/metrics`, { method: "HEAD" });
  assert.equal(metricsHead.status, 200, "metrics should support HEAD probes");
  assert.equal(metricsHead.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");
  assert(Number(metricsHead.headers.get("content-length")) > 0, "metrics HEAD responses should declare their live payload length");
  assert.equal(await metricsHead.text(), "", "metrics HEAD responses should not contain a body");
  const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ok: true, schema: "llm-field-notes/graph@1", version: "0.1.0", ready: true });
  const readyHead = await fetch(`http://127.0.0.1:${port}/readyz`, { method: "HEAD" });
  assert.equal(readyHead.status, 200, "readiness checks should support HEAD probes");
  assert.equal(await readyHead.text(), "", "readiness HEAD responses should not contain a body");
  const wrongMethod = await fetch(`http://127.0.0.1:${port}/api/extract-graph`);
  assert.equal(wrongMethod.status, 405, "the extraction route should report method errors as API errors");
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  server.isDraining = true;
  const drainingReady = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(drainingReady.status, 503);
  assert.equal(drainingReady.headers.get("retry-after"), "5");
  assert.deepEqual(await drainingReady.json(), { ok: false, schema: "llm-field-notes/graph@1", version: "0.1.0", ready: false, error: "Server is draining." });
  const drainingExtraction = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [],
      document: { title: "Draining", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(drainingExtraction.status, 503, "draining servers should reject new extraction work");
  assert.equal(drainingExtraction.headers.get("retry-after"), "5");
  server.isDraining = false;
  const chunkedOversizedUpload = await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: "/api/extract-graph",
      method: "POST",
      headers: { "content-type": "application/json" }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
    request.end(Buffer.alloc(2 * 1024 * 1024 + 1, 0x78));
  });
  assert.equal(chunkedOversizedUpload.status, 413, "chunked oversized bodies should be rejected as soon as the limit is crossed");
  const declaredOversizedUpload = await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: "/api/extract-graph",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024 + 1)
      }
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(declaredOversizedUpload, 413, "declared oversized JSON bodies should be rejected without buffering");
  const invalidMediaType = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json-malicious" },
    body: "{}"
  });
  assert.equal(invalidMediaType.status, 415, "invalid JSON media type variants should be rejected");
  const earlyRejectedOversized = await new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: "/api/extract-graph",
      method: "POST",
      headers: {
        "content-type": "text/plain",
        "content-length": String(2 * 1024 * 1024 + 1)
      }
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(earlyRejectedOversized, 415, "early rejection should respond before draining a declared oversized upload");
  const abortedUpload = httpRequest({
    hostname: "127.0.0.1",
    port,
    path: "/api/extract-graph",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": "100000"
    }
  });
  abortedUpload.on("error", () => {});
  abortedUpload.write("{\"operation\":\"extract-graph\"");
  abortedUpload.destroy();
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  const loggerFailureServer = createAppServer({
    logger: () => {
      throw new Error("logger unavailable");
    }
  });
  await new Promise((resolve) => loggerFailureServer.listen(0, "127.0.0.1", resolve));
  const loggerFailurePort = loggerFailureServer.address().port;
  try {
    const loggerFailureResponse = await fetch(`http://127.0.0.1:${loggerFailurePort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Logger failure", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(loggerFailureResponse.status, 200, "logger failures must not change a successful extraction response");
  } finally {
    loggerFailureServer.close();
  }
  const httpsOriginServer = createAppServer({ publicOrigin: "https://notes.example.test" });
  await new Promise((resolve) => httpsOriginServer.listen(0, "127.0.0.1", resolve));
  try {
    const httpsOriginHealth = await fetch(`http://127.0.0.1:${httpsOriginServer.address().port}/healthz`);
    assert.equal(httpsOriginHealth.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains", "HTTPS public origins should advertise HSTS");
    const crossOriginExtraction = await fetch(`http://127.0.0.1:${httpsOriginServer.address().port}/api/extract-graph`, {
      method: "POST",
      headers: {
        origin: "https://evil.example.test",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Cross origin", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(crossOriginExtraction.status, 403, "browser extraction should reject cross-origin POSTs");
    const fetchMetadataRejected = await fetch(`http://127.0.0.1:${httpsOriginServer.address().port}/api/extract-graph`, {
      method: "POST",
      headers: {
        "sec-fetch-site": "cross-site",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Fetch metadata", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(fetchMetadataRejected.status, 403, "cross-site fetch metadata should reject browser extraction without Origin");
    const sameOriginExtraction = await fetch(`http://127.0.0.1:${httpsOriginServer.address().port}/api/extract-graph`, {
      method: "POST",
      headers: {
        origin: "https://notes.example.test",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Same origin", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(sameOriginExtraction.status, 200, "configured public origins should permit same-origin browser extraction");
  } finally {
    httpsOriginServer.close();
  }
  const symlinkRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-"));
  await symlink(process.execPath, join(symlinkRoot, "index.html"));
  const symlinkServer = createAppServer({ staticRoot: symlinkRoot });
  await new Promise((resolve) => symlinkServer.listen(0, "127.0.0.1", resolve));
  const symlinkPort = symlinkServer.address().port;
  try {
    const escapedReady = await fetch(`http://127.0.0.1:${symlinkPort}/readyz`);
    assert.equal(escapedReady.status, 503);
    const escapedAsset = await fetch(`http://127.0.0.1:${symlinkPort}/`);
    assert.equal(escapedAsset.status, 404);
  } finally {
    symlinkServer.close();
    await rm(symlinkRoot, { recursive: true, force: true });
  }
  const unavailableServer = createAppServer({ staticRoot: "/tmp/llm-field-notes-missing-root" });
  await new Promise((resolve) => unavailableServer.listen(0, "127.0.0.1", resolve));
  const unavailablePort = unavailableServer.address().port;
  try {
    const unavailable = await fetch(`http://127.0.0.1:${unavailablePort}/readyz`);
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get("retry-after"), "5", "unavailable readiness should advise probes to retry after a bounded delay");
    assert.equal((await unavailable.json()).ready, false);
  } finally {
    unavailableServer.close();
  }
  const incompleteRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-incomplete-"));
  await Promise.all([
    writeFile(join(incompleteRoot, "index.html"), "<!doctype html>"),
    writeFile(join(incompleteRoot, "styles.css"), "body {}"),
    writeFile(join(incompleteRoot, "app.js"), "export {};")
  ]);
  const incompleteServer = createAppServer({ staticRoot: incompleteRoot });
  await new Promise((resolve) => incompleteServer.listen(0, "127.0.0.1", resolve));
  const incompletePort = incompleteServer.address().port;
  try {
    const incompleteReady = await fetch(`http://127.0.0.1:${incompletePort}/readyz`);
    assert.equal(incompleteReady.status, 503, "readiness should fail when a core shell asset is missing");
  } finally {
    incompleteServer.close();
    await rm(incompleteRoot, { recursive: true, force: true });
  }
  const incompleteLearningRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-learning-incomplete-"));
  const learningAssets = [
    "index.html",
    "styles.css",
    "app.js",
    "graph-core.js",
    "graph-store.js",
    "extractor-adapter.js",
    "projection-adapter.js",
    "storage-adapter.js",
    "evaluation.js",
    "manifest.webmanifest",
    "icon.svg",
    "sw.js",
    "robots.txt",
    "README.md",
    "ARCHITECTURE.md",
    "LICENSE",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "experiments/README.md",
    "schema/graph.schema.json",
    "schema/feedback.schema.json",
    "schema/backup.schema.json",
    "schema/extractor-request.schema.json",
    "schema/evaluation.schema.json",
    "notes/README.md"
  ];
  await Promise.all(learningAssets.map(async (asset) => {
    const target = join(incompleteLearningRoot, asset);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "asset");
  }));
  const incompleteLearningServer = createAppServer({ staticRoot: incompleteLearningRoot });
  await new Promise((resolve) => incompleteLearningServer.listen(0, "127.0.0.1", resolve));
  const incompleteLearningPort = incompleteLearningServer.address().port;
  try {
    const incompleteLearningReady = await fetch(`http://127.0.0.1:${incompleteLearningPort}/readyz`);
    assert.equal(incompleteLearningReady.status, 503, "readiness should fail when a learning note is missing");
  } finally {
    incompleteLearningServer.close();
    await rm(incompleteLearningRoot, { recursive: true, force: true });
  }
  const brokenAssetRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-broken-"));
  await mkdir(join(brokenAssetRoot, "index.html"));
  const staticFailureLogs = [];
  const brokenAssetServer = createAppServer({ staticRoot: brokenAssetRoot, logger: (entry) => staticFailureLogs.push(entry) });
  await new Promise((resolve) => brokenAssetServer.listen(0, "127.0.0.1", resolve));
  const brokenAssetPort = brokenAssetServer.address().port;
  try {
    const brokenAsset = await fetch(`http://127.0.0.1:${brokenAssetPort}/`);
    assert.equal(brokenAsset.status, 404, "directories should not be served as public files");
    assert.equal(staticFailureLogs.length, 0, "expected missing-file responses should not create server-error logs");
  } finally {
    brokenAssetServer.close();
    await rm(brokenAssetRoot, { recursive: true, force: true });
  }
  const oversizedAssetRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-oversized-"));
  await mkdir(join(oversizedAssetRoot, "notes"), { recursive: true });
  await writeFile(join(oversizedAssetRoot, "notes", "oversized.md"), "x".repeat(10 * 1024 * 1024 + 1));
  const oversizedAssetServer = createAppServer({ staticRoot: oversizedAssetRoot });
  await new Promise((resolve) => oversizedAssetServer.listen(0, "127.0.0.1", resolve));
  const oversizedAssetPort = oversizedAssetServer.address().port;
  try {
    const oversizedAsset = await fetch(`http://127.0.0.1:${oversizedAssetPort}/notes/oversized.md`);
    assert.equal(oversizedAsset.status, 413, "oversized public assets should be rejected before response buffering");
    const oversizedReady = await fetch(`http://127.0.0.1:${oversizedAssetPort}/readyz`);
    assert.equal(oversizedReady.status, 503, "readiness should fail when a public asset exceeds the static budget");
  } finally {
    oversizedAssetServer.close();
    await rm(oversizedAssetRoot, { recursive: true, force: true });
  }
  const aggregateAssetRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-aggregate-assets-"));
  await Promise.all(FIXED_PUBLIC_ASSETS.map(async (asset) => {
    const destination = join(aggregateAssetRoot, asset);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(process.cwd(), asset), destination);
  }));
  await mkdir(join(aggregateAssetRoot, "notes"), { recursive: true });
  const aggregateNoteBytes = 6 * 1024 * 1024;
  const aggregateNoteCount = Math.ceil(MAX_PUBLIC_ASSET_BYTES / aggregateNoteBytes) + 1;
  await Promise.all(Array.from({ length: aggregateNoteCount }, (_, index) => writeFile(
    join(aggregateAssetRoot, "notes", `aggregate-${index}.md`),
    Buffer.concat([Buffer.from(`# Aggregate note ${index}\n\n`), Buffer.alloc(aggregateNoteBytes, 0x78)])
  )));
  const aggregateAssetServer = createAppServer({ staticRoot: aggregateAssetRoot });
  await new Promise((resolve) => aggregateAssetServer.listen(0, "127.0.0.1", resolve));
  try {
    const aggregateReady = await fetch(`http://127.0.0.1:${aggregateAssetServer.address().port}/readyz`);
    assert.equal(aggregateReady.status, 503, "readiness should fail when individually valid public assets exceed the aggregate budget");
  } finally {
    aggregateAssetServer.close();
    await rm(aggregateAssetRoot, { recursive: true, force: true });
  }
  const extraction = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: Array.from({ length: 500 }, (_, index) => ({ kind: "concept", id: String(index), label: `Concept ${index}`, status: "accepted" })),
      document: { title: "Server test", uri: "https://example.org/server-test", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(extraction.status, 200);
  const payload = await extraction.json();
  assert.equal(payload.schema, "llm-field-notes/graph@1");
  assert.equal(payload.feedbackFormat, "llm-field-notes/feedback@1");
  assert(payload.extraction.nodes.length > 0);
  assert.equal(payload.extraction.source.uri, "https://example.org/server-test", "server extraction should preserve source URIs");
  assert.equal(payload.feedbackReceived, 500);
  assert.equal(extraction.headers.get("cache-control"), "no-store");
  assert.equal(extraction.headers.get("x-robots-tag"), "noindex, nofollow", "API responses should not become search-index artifacts");
  assert.equal(extraction.headers.get("x-content-type-options"), "nosniff");
  assert.equal(extraction.headers.get("x-frame-options"), "DENY");
  assert.equal(extraction.headers.get("permissions-policy"), "camera=(), geolocation=(), microphone=(), payment=()");
  assert.equal(extraction.headers.get("cross-origin-opener-policy"), "same-origin");
  assert.equal(extraction.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.match(extraction.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/);
  assert(logs.some((entry) => entry.route === "extract-graph" && entry.status === 200 && Number.isInteger(entry.durationMs) && entry.documentChars > 0 && entry.feedbackCount === 500));
  assert(!JSON.stringify(logs).includes("Attention uses context"), "structured logs must not contain document text");
  const unsafeUriResponse = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [],
      document: { title: "Unsafe URI", uri: "javascript:alert(1)", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(unsafeUriResponse.status, 400, "server extraction should reject unsafe source URI metadata");
  const invalidFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [{ kind: "concept", id: "attention", status: "inferred" }],
      document: { title: "Invalid feedback", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(invalidFeedback.status, 400, "the server should reject unreviewed feedback hints");
  const providerCalls = [];
  const providerLogs = [];
  const providerServer = createAppServer({
    logger: (entry) => providerLogs.push(entry),
    extractor: async ({ document, feedback, requestId }) => {
      if (document.title === "Oversized response") {
        return {
          nodes: Array.from({ length: 1000 }, (_, index) => ({
            id: `oversized-${index}`,
            label: `Oversized ${index}`,
            evidence: [{ text: "x".repeat(12000) }]
          })),
          edges: []
        };
      }
      if (document.title === "Oversized collections") {
        return {
          nodes: Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, index) => ({
            id: `oversized-node-${index}`,
            label: `Oversized node ${index}`
          })),
          edges: []
        };
      }
      if (document.title === "Provider metadata") {
        return {
          source: {
            title: "Untrusted provider title",
            text: "untrusted provider source text",
            fingerprint: "untrusted-provider-fingerprint",
            uri: "https://provider.example.test/private",
            quality: "primary",
            lastReviewedAt: "2020-01-01T00:00:00.000Z"
          },
          nodes: [{ label: "Attention", sources: ["untrusted-provider-source"], evidence: [{ text: "untrusted provider evidence", sources: ["untrusted-provider-source"] }] }],
          edges: []
        };
      }
      if (document.title === "Invalid response") return null;
      if (document.title === "Invalid schema") return { schema: "llm-field-notes/graph@999", nodes: [], edges: [] };
      providerCalls.push({ document, feedback, feedbackCount: feedback.length, requestId });
      return extractGraph(document.title, document.text, { feedback });
    }
  });
  await new Promise((resolve) => providerServer.listen(0, "127.0.0.1", resolve));
  const providerPort = providerServer.address().port;
  try {
    const providerResponse = await fetch(`http://127.0.0.1:${providerPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [{
          kind: "concept",
          id: "attention",
          label: "Attention",
          status: "accepted",
          evidence: [{ text: "private source evidence" }],
          sources: ["private-source"],
          unexpected: "must be stripped"
        }],
        document: { title: "Provider test", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(providerResponse.status, 200);
    assert.equal((await providerResponse.json()).schema, "llm-field-notes/graph@1");
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].feedbackCount, 1);
    assert.deepEqual(providerCalls[0].feedback, [{
      kind: "concept",
      id: "attention",
      label: "Attention",
      status: "accepted"
    }], "the server should strip untrusted feedback fields before invoking an extractor");
    assert.match(providerCalls[0].requestId, /^[0-9a-f-]{36}$/);
    const providerMetadataResponse = await fetch(`http://127.0.0.1:${providerPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: {
          title: "Provider metadata",
          uri: "https://example.org/submitted-source",
          text: "Attention uses context to create a useful graph representation for review."
        }
      })
    });
    assert.equal(providerMetadataResponse.status, 200);
    const providerMetadataPayload = await providerMetadataResponse.json();
    assert.equal(providerMetadataPayload.extraction.source.title, "Provider metadata", "server extraction must preserve the submitted document title");
    assert.equal(providerMetadataPayload.extraction.source.text, "Attention uses context to create a useful graph representation for review.", "server extraction must preserve the submitted document text");
    assert.equal(providerMetadataPayload.extraction.source.uri, "https://example.org/submitted-source", "server extraction must preserve the submitted source URI");
    assert.equal(providerMetadataPayload.extraction.source.quality, "unknown", "provider output must not assign source quality");
    assert.notEqual(providerMetadataPayload.extraction.source.fingerprint, "untrusted-provider-fingerprint", "server extraction must derive source fingerprints from submitted text");
    assert.equal(providerMetadataPayload.extraction.source.id, extractGraph("Provider metadata", "Attention uses context to create a useful graph representation for review.").source.id, "server extraction must derive source IDs from submitted content");
    assert.deepEqual(providerMetadataPayload.extraction.nodes[0].sources, [providerMetadataPayload.extraction.source.id], "server extraction must bind node provenance to the submitted source");
    assert.deepEqual(providerMetadataPayload.extraction.nodes[0].evidence[0].sources, [providerMetadataPayload.extraction.source.id], "server extraction must bind evidence provenance to the submitted source");
    const oversizedResponse = await fetch(`http://127.0.0.1:${providerPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Oversized response", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(oversizedResponse.status, 502);
    assert.equal((await oversizedResponse.json()).error, "The extractor response exceeded the 10 MB safety limit.");
    const oversizedCollectionsResponse = await fetch(`http://127.0.0.1:${providerPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Oversized collections", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(oversizedCollectionsResponse.status, 502);
    assert.equal((await oversizedCollectionsResponse.json()).error, "The configured extractor failed. Try again or inspect the provider logs.", "oversized provider collections should fail closed at the server boundary");
    assert(providerLogs.some((entry) => entry.error === "EXTRACTION_NODES_TOO_LARGE"), "oversized provider collections should remain diagnosable without exposing provider output");
    for (const title of ["Invalid response", "Invalid schema"]) {
      const invalidProviderResponse = await fetch(`http://127.0.0.1:${providerPort}/api/extract-graph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operation: "extract-graph",
          schema: "llm-field-notes/graph@1",
          feedbackFormat: "llm-field-notes/feedback@1",
          feedback: [],
          document: { title, text: "Attention uses context to create a useful graph representation for review." }
        })
      });
      assert.equal(invalidProviderResponse.status, 502, `${title} should fail closed at the server provider boundary`);
    }
  } finally {
    providerServer.close();
  }
  const failingServer = createAppServer({
    logger: (entry) => {
      if (entry.error) entry.loggedError = entry.error;
    },
    extractor: async () => {
      throw Object.assign(new Error("provider unavailable"), { code: "UPSTREAM_DOWN" });
    }
  });
  await new Promise((resolve) => failingServer.listen(0, "127.0.0.1", resolve));
  const failingPort = failingServer.address().port;
  try {
    const failureResponse = await fetch(`http://127.0.0.1:${failingPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Provider failure", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(failureResponse.status, 502);
    assert.match(await failureResponse.text(), /configured extractor failed/);
  } finally {
    failingServer.close();
  }
  const unsafeCodeLogs = [];
  const unsafeCodeServer = createAppServer({
    logger: (entry) => unsafeCodeLogs.push(entry),
    extractor: async () => {
      throw Object.assign(new Error("provider unavailable"), { code: "private document text should not be logged" });
    }
  });
  await new Promise((resolve) => unsafeCodeServer.listen(0, "127.0.0.1", resolve));
  const unsafeCodePort = unsafeCodeServer.address().port;
  try {
    const unsafeCodeResponse = await fetch(`http://127.0.0.1:${unsafeCodePort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Unsafe diagnostic", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(unsafeCodeResponse.status, 502);
    assert(unsafeCodeLogs.every((entry) => entry.error !== "private document text should not be logged"), "untrusted diagnostic codes should not be written to logs");
    assert(unsafeCodeLogs.some((entry) => entry.error === "EXTRACTOR_FAILURE"), "unsafe diagnostic codes should fall back to a bounded code");
  } finally {
    unsafeCodeServer.close();
  }
  const timeoutLogs = [];
  const timeoutServer = createAppServer({
    extractorTimeoutMs: 10,
    logger: (entry) => timeoutLogs.push(entry),
    extractor: ({ signal }) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(Object.assign(new Error("aborted"), { code: "ABORTED_BY_TIMEOUT" }));
      }, { once: true });
    })
  });
  await new Promise((resolve) => timeoutServer.listen(0, "127.0.0.1", resolve));
  const timeoutPort = timeoutServer.address().port;
  try {
    const timeoutResponse = await fetch(`http://127.0.0.1:${timeoutPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Provider timeout", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(timeoutResponse.status, 504);
    assert.match(await timeoutResponse.text(), /extractor timed out/);
    assert(timeoutLogs.some((entry) => entry.status === 504 && entry.error === "EXTRACTOR_TIMEOUT"));
  } finally {
    timeoutServer.close();
  }
  let providerStarted = false;
  let abortObserved = false;
  let providerStartedResolve;
  let abortObservedResolve;
  const providerStartedPromise = new Promise((resolve) => {
    providerStartedResolve = resolve;
  });
  const abortObservedPromise = new Promise((resolve) => {
    abortObservedResolve = resolve;
  });
  const disconnectServer = createAppServer({
    extractor: ({ signal }) => new Promise((resolve, reject) => {
      providerStarted = true;
      providerStartedResolve();
      signal.addEventListener("abort", () => {
        abortObserved = true;
        abortObservedResolve();
        reject(Object.assign(new Error("client disconnected"), { code: "CLIENT_ABORTED" }));
      }, { once: true });
    })
  });
  await new Promise((resolve) => disconnectServer.listen(0, "127.0.0.1", resolve));
  const disconnectPort = disconnectServer.address().port;
  try {
    const disconnectController = new AbortController();
    const requestPromise = fetch(`http://127.0.0.1:${disconnectPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: disconnectController.signal,
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Client disconnect", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    await providerStartedPromise;
    disconnectController.abort();
    await assert.rejects(requestPromise);
    await Promise.race([abortObservedPromise, new Promise((resolve) => setTimeout(resolve, 100))]);
    assert(providerStarted && abortObserved, "client disconnects should abort provider work");
  } finally {
    disconnectServer.close();
  }
  let drainStartedResolve;
  let drainAborted = false;
  const drainStarted = new Promise((resolve) => {
    drainStartedResolve = resolve;
  });
  const drainServer = createAppServer({
    extractor: ({ signal }) => new Promise((resolve, reject) => {
      drainStartedResolve();
      signal.addEventListener("abort", () => {
        drainAborted = true;
        reject(Object.assign(new Error("shutdown"), { code: "SERVER_SHUTDOWN" }));
      }, { once: true });
    })
  });
  await new Promise((resolve) => drainServer.listen(0, "127.0.0.1", resolve));
  const drainPort = drainServer.address().port;
  try {
    const drainRequest = fetch(`http://127.0.0.1:${drainPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Shutdown", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    await drainStarted;
    assert.equal(drainServer.beginDrain(), true, "programmatic shutdown should enter draining mode once");
    assert.equal(drainServer.beginDrain(), false, "shutdown entry should be idempotent");
    const drainResponse = await drainRequest;
    assert.equal(drainResponse.status, 502);
    assert(drainAborted, "shutdown should abort active provider work");
  } finally {
    drainServer.close();
  }
  const adapted = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [{ kind: "concept", id: "latent-bridge", label: "Latent Bridge", status: "accepted" }],
      document: { title: "Adaptive extraction", text: "The latent bridge organizes signals for review." }
    })
  });
  assert.equal(adapted.status, 200);
  const adaptedPayload = await adapted.json();
  assert(adaptedPayload.extraction.nodes.some((node) => node.id === "latent-bridge"), "reference endpoint should apply reviewed feedback to extraction");
  const invalid = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "wrong" })
  });
  assert.equal(invalid.status, 400);
  const tooMuchFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: Array.from({ length: 501 }, () => ({})),
      document: { title: "Overflow", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(tooMuchFeedback.status, 400);
  const oversizedFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [{ kind: "concept", label: "Oversized", evidence: [{ text: "x".repeat(500000) }] }],
      document: { title: "Feedback overflow", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(oversizedFeedback.status, 413);
  const malformedFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [null],
      document: { title: "Malformed feedback", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(malformedFeedback.status, 400);
  const wrongFeedbackFormat = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "wrong",
      document: { title: "Format test", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(wrongFeedbackFormat.status, 400);
  const unsupportedType = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: "{}"
  });
  assert.equal(unsupportedType.status, 415);
  const traversal = await fetch(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/etc/passwd`);
  assert.equal(traversal.status, 404);
  const malformedPathEncoding = await fetch(`http://127.0.0.1:${port}/%E0%A4%A`);
  assert.equal(malformedPathEncoding.status, 400, "malformed path encoding should be a client error");
  const privateAsset = await fetch(`http://127.0.0.1:${port}/package.json`);
  assert.equal(privateAsset.status, 404);
  assert.equal(privateAsset.headers.get("cache-control"), "no-store");
  assert.equal(privateAsset.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), true);
  const sourceAsset = await fetch(`http://127.0.0.1:${port}/server.mjs`);
  assert.equal(sourceAsset.status, 404);
  const oversized = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation: "extract-graph", schema: "llm-field-notes/graph@1", feedbackFormat: "llm-field-notes/feedback@1", feedback: [], document: { title: "Large", text: "x".repeat(2 * 1024 * 1024) } })
  });
  assert.equal(oversized.status, 413);
  const declaredOversized = await new Promise((resolve, reject) => {
    const request = httpRequest(`http://127.0.0.1:${port}/api/extract-graph`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(3 * 1024 * 1024)
      }
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(declaredOversized, 413, "declared oversized bodies should be rejected before buffering");
  const limitedServer = createAppServer({ maxRequestsPerMinute: 0 });
  await new Promise((resolve) => limitedServer.listen(0, "127.0.0.1", resolve));
  const limitedPort = limitedServer.address().port;
  try {
    const limited = await fetch(`http://127.0.0.1:${limitedPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        document: { title: "Limited", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
  } finally {
    limitedServer.close();
  }
  const invalidConfigServer = createAppServer({ maxRequestsPerMinute: Number.NaN });
  await new Promise((resolve) => invalidConfigServer.listen(0, "127.0.0.1", resolve));
  const invalidConfigPort = invalidConfigServer.address().port;
  try {
    const safeDefault = await fetch(`http://127.0.0.1:${invalidConfigPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Config test", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.notEqual(safeDefault.status, 500, "invalid embedded rate-limit configuration must not break the server");
    assert.equal(safeDefault.status, 200, "invalid embedded rate-limit configuration should fail safe to the default");
  } finally {
    invalidConfigServer.close();
  }
  const authenticatedServer = createAppServer({ extractorAuthToken: "test-secret-token", maxRequestsPerMinute: 3 });
  await new Promise((resolve) => authenticatedServer.listen(0, "127.0.0.1", resolve));
  const authenticatedPort = authenticatedServer.address().port;
  const authenticatedRequest = {
    operation: "extract-graph",
    schema: "llm-field-notes/graph@1",
    feedbackFormat: "llm-field-notes/feedback@1",
    feedback: [],
    document: { title: "Authenticated", text: "Attention uses context to create a useful graph representation for review." }
  };
  try {
    const missingToken = await fetch(`http://127.0.0.1:${authenticatedPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authenticatedRequest)
    });
    assert.equal(missingToken.status, 401, "configured extraction authentication should reject missing credentials");
    assert.equal(missingToken.headers.get("www-authenticate"), "Bearer");
    const wrongToken = await fetch(`http://127.0.0.1:${authenticatedPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token" },
      body: JSON.stringify(authenticatedRequest)
    });
    assert.equal(wrongToken.status, 401, "configured extraction authentication should reject incorrect credentials");
    const authenticated = await fetch(`http://127.0.0.1:${authenticatedPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "bearer test-secret-token" },
      body: JSON.stringify(authenticatedRequest)
    });
    assert.equal(authenticated.status, 200, "configured extraction authentication should accept a valid bearer token");
    const rateLimitedUnauthorized = await fetch(`http://127.0.0.1:${authenticatedPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(authenticatedRequest)
    });
    assert.equal(rateLimitedUnauthorized.status, 429, "failed authentication attempts should consume the bounded extraction request budget");
    assert.equal(authenticatedServer.getMetrics().authenticationFailures, 2, "authentication failures should be observable without recording credentials");
  } finally {
    authenticatedServer.close();
  }
  const keepAliveServer = createAppServer({ extractorAuthToken: "keep-alive-secret", maxRequestsPerMinute: 10 });
  await new Promise((resolve) => keepAliveServer.listen(0, "127.0.0.1", resolve));
  const keepAlivePort = keepAliveServer.address().port;
  const keepAliveAgent = new Agent({ keepAlive: true, maxSockets: 1 });
  const keepAliveRequest = (headers, body) => new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: keepAlivePort,
      path: "/api/extract-graph",
      method: "POST",
      agent: keepAliveAgent,
      headers: { "content-length": Buffer.byteLength(body), ...headers }
    }, (response) => {
      let responseBody = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: responseBody }));
    });
    request.on("error", reject);
    request.end(body);
  });
  const keepAlivePayload = JSON.stringify({
    operation: "extract-graph",
    schema: "llm-field-notes/graph@1",
    feedbackFormat: "llm-field-notes/feedback@1",
    feedback: [],
    document: { title: "Keep alive", text: "Attention uses context to create a useful graph representation for review." }
  });
  try {
    assert.equal((await keepAliveRequest({ "content-type": "application/json" }, keepAlivePayload)).status, 401, "unauthorized keep-alive requests should still be rejected");
    assert.equal((await keepAliveRequest({ "content-type": "application/json", authorization: "Bearer keep-alive-secret" }, keepAlivePayload)).status, 200, "a valid request should survive after an early rejection on the same keep-alive connection");
  } finally {
    keepAliveAgent.destroy();
    keepAliveServer.close();
  }
  const protectedMetricsServer = createAppServer({ metricsAuthToken: "metrics-secret-token" });
  await new Promise((resolve) => protectedMetricsServer.listen(0, "127.0.0.1", resolve));
  const protectedMetricsPort = protectedMetricsServer.address().port;
  try {
    const metricsMissingToken = await fetch(`http://127.0.0.1:${protectedMetricsPort}/metrics`);
    assert.equal(metricsMissingToken.status, 401, "metrics authentication should reject missing credentials when configured");
    assert.equal(metricsMissingToken.headers.get("www-authenticate"), "Bearer");
    const metricsMissingTokenHead = await fetch(`http://127.0.0.1:${protectedMetricsPort}/metrics`, { method: "HEAD" });
    assert.equal(metricsMissingTokenHead.status, 401, "protected metrics should preserve authentication failures for HEAD probes");
    assert.equal(await metricsMissingTokenHead.text(), "", "protected metrics HEAD failures should not contain a body");
    const metricsWithToken = await fetch(`http://127.0.0.1:${protectedMetricsPort}/metrics`, {
      headers: { authorization: "Bearer metrics-secret-token" }
    });
    assert.equal(metricsWithToken.status, 200, "metrics authentication should accept its configured bearer token");
  } finally {
    protectedMetricsServer.close();
  }
  const xmlRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-xml-"));
  await mkdir(join(xmlRoot, "notes"), { recursive: true });
  await writeFile(join(xmlRoot, "notes", "control.md"), "# Unsafe\u0001 title\n\nA useful learning note with enough context for a feed summary.");
  const xmlServer = createAppServer({ staticRoot: xmlRoot, publicOrigin: "https://xml.example.test" });
  await new Promise((resolve) => xmlServer.listen(0, "127.0.0.1", resolve));
  const xmlPort = xmlServer.address().port;
  try {
    const xmlFeed = await fetch(`http://127.0.0.1:${xmlPort}/feed.xml`);
    const xmlFeedText = await xmlFeed.text();
    assert.equal(xmlFeed.status, 200);
    assert(!xmlFeedText.includes("\u0001"), "runtime Atom feeds should remove invalid XML control characters");
  } finally {
    xmlServer.close();
    await rm(xmlRoot, { recursive: true, force: true });
  }
  const seoServer = createAppServer({ publicOrigin: "https://notes.example.test" });
  await new Promise((resolve) => seoServer.listen(0, "127.0.0.1", resolve));
  const seoPort = seoServer.address().port;
  try {
    const seoIndex = await fetch(`http://127.0.0.1:${seoPort}/`);
    const seoIndexText = await seoIndex.text();
    assert(seoIndexText.includes('href="https://notes.example.test/"') && seoIndexText.includes('href="https://notes.example.test/feed.xml"') && seoIndexText.includes('content="https://notes.example.test/"') && (seoIndexText.match(/content="https:\/\/notes\.example\.test\/social-card\.svg"/g) || []).length === 2, "configured public origins should emit absolute canonical and social metadata");
    const seoStructuredData = seoIndexText.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
    assert(seoStructuredData, "origin-aware server HTML should retain structured discovery metadata");
    const seoStructuredDataCsp = `'sha256-${createHash("sha256").update(seoStructuredData).digest("base64")}'`;
    assert((seoIndex.headers.get("content-security-policy") || "").includes(seoStructuredDataCsp), "origin-aware server CSP should authorize rewritten structured metadata");
    const seoIndexEtag = seoIndex.headers.get("etag");
    assert.match(seoIndexEtag || "", /^"[0-9a-f]{64}"$/);
    assert.equal((await fetch(`http://127.0.0.1:${seoPort}/`, { headers: { "if-none-match": seoIndexEtag } })).status, 304, "origin-aware HTML should revalidate against its transformed representation");
    const seoIndexHead = await fetch(`http://127.0.0.1:${seoPort}/`, { method: "HEAD" });
    assert.equal(seoIndexHead.status, 200);
    assert.equal(Number(seoIndexHead.headers.get("content-length")), Number(seoIndex.headers.get("content-length")), "origin-aware HTML HEAD should report the transformed body length");
    assert.equal(await seoIndexHead.text(), "", "origin-aware HTML HEAD should not contain a body");
    const sitemap = await fetch(`http://127.0.0.1:${seoPort}/sitemap.xml`);
    assert.equal(sitemap.status, 200, "configured public origins should expose a sitemap");
    assert.equal(sitemap.headers.get("content-type"), "application/xml; charset=utf-8");
    const sitemapText = await sitemap.text();
    assert(sitemapText.includes("https://notes.example.test/notes/tokens.md") && sitemapText.includes("https://notes.example.test/notes/tokens.html"), "sitemap should include both source notes and canonical learning-note landing pages");
    assert(!(await (await fetch(`http://127.0.0.1:${seoPort}/sitemap.xml`)).text()).includes("https://notes.example.test/notes/README.md"), "sitemap should exclude the learning-map index README");
    const seoRobots = await fetch(`http://127.0.0.1:${seoPort}/robots.txt`);
    assert.equal(seoRobots.status, 200);
    assert.equal(seoRobots.headers.get("content-type"), "text/plain; charset=utf-8", "dynamic robots should use the standard text MIME type");
    assert((await seoRobots.text()).includes("Sitemap: https://notes.example.test/sitemap.xml"), "configured robots should point crawlers at the sitemap");
    const sitemapEtag = sitemap.headers.get("etag");
    const robotsEtag = seoRobots.headers.get("etag");
    assert.match(sitemapEtag || "", /^"[0-9a-f]{64}"$/);
    assert.match(robotsEtag || "", /^"[0-9a-f]{64}"$/);
    assert.equal((await fetch(`http://127.0.0.1:${seoPort}/sitemap.xml`, { headers: { "if-none-match": sitemapEtag } })).status, 304, "sitemap should support conditional revalidation");
    assert.equal((await fetch(`http://127.0.0.1:${seoPort}/robots.txt`, { headers: { "if-none-match": `W/${robotsEtag}` } })).status, 304, "robots should support weak conditional revalidation");
    const sitemapHead = await fetch(`http://127.0.0.1:${seoPort}/sitemap.xml`, { method: "HEAD" });
    assert.equal(sitemapHead.status, 200, "sitemap should support crawler HEAD requests");
    assert.equal(sitemapHead.headers.get("etag"), sitemapEtag);
    assert.equal(Number(sitemapHead.headers.get("content-length")), Number(sitemap.headers.get("content-length")));
    assert.equal(await sitemapHead.text(), "", "sitemap HEAD responses should not contain a body");
    const robotsHead = await fetch(`http://127.0.0.1:${seoPort}/robots.txt`, { method: "HEAD" });
    assert.equal(robotsHead.status, 200, "robots should support crawler HEAD requests");
    assert.equal(robotsHead.headers.get("etag"), robotsEtag);
    assert.equal(await robotsHead.text(), "", "robots HEAD responses should not contain a body");
    const feed = await fetch(`http://127.0.0.1:${seoPort}/feed.xml`);
    assert.equal(feed.status, 200, "configured public origins should expose an Atom feed");
    assert.equal(feed.headers.get("content-type"), "application/atom+xml; charset=utf-8");
    const feedText = await feed.text();
    assert(feedText.includes("<feed xmlns=\"http://www.w3.org/2005/Atom\">") && feedText.includes("notes/tokens.html") && feedText.includes("Tokens are the interface") && feedText.includes("Why can&apos;t the model see words?"), "the Atom feed should include titled landing entries with note-derived summaries");
    assert.equal((feedText.match(/<id>/g) || []).length, (feedText.match(/<entry>/g) || []).length + 1, "the Atom feed should contain exactly one feed ID plus one ID per entry");
    const feedEtag = feed.headers.get("etag");
    assert.match(feedEtag || "", /^"[0-9a-f]{64}"$/);
    assert.equal((await fetch(`http://127.0.0.1:${seoPort}/feed.xml`, { headers: { "if-none-match": feedEtag } })).status, 304, "the Atom feed should support conditional revalidation");
    const feedHead = await fetch(`http://127.0.0.1:${seoPort}/feed.xml`, { method: "HEAD" });
    assert.equal(feedHead.status, 200);
    assert.equal(feedHead.headers.get("etag"), feedEtag);
    assert.equal(await feedHead.text(), "", "Atom feed HEAD responses should not contain a body");
    const subpathServer = createAppServer({ publicOrigin: "https://notes.example.test/field-notes/" });
    await new Promise((resolve) => subpathServer.listen(0, "127.0.0.1", resolve));
    const subpathPort = subpathServer.address().port;
    try {
      const subpathSitemap = await fetch(`http://127.0.0.1:${subpathPort}/sitemap.xml`);
      assert.equal(subpathSitemap.status, 200, "Node deployments should accept project-subpath public origins");
      const subpathSitemapText = await subpathSitemap.text();
      assert(subpathSitemapText.includes("https://notes.example.test/field-notes/notes/tokens.md") && subpathSitemapText.includes("https://notes.example.test/field-notes/notes/tokens.html"), "project-subpath sitemaps should preserve the deployment prefix for source and landing pages");
    } finally {
      subpathServer.close();
    }
    const noOriginServer = createAppServer();
    await new Promise((resolve) => noOriginServer.listen(0, "127.0.0.1", resolve));
    const noOriginPort = noOriginServer.address().port;
    try {
      assert.equal((await fetch(`http://127.0.0.1:${noOriginPort}/sitemap.xml`)).status, 404, "sitemaps should not invent an untrusted deployment origin");
      assert.equal((await fetch(`http://127.0.0.1:${noOriginPort}/feed.xml`)).status, 404, "feeds should not invent an untrusted deployment origin");
    } finally {
      noOriginServer.close();
    }
  } finally {
    seoServer.close();
  }
  console.log("server smoke ok");
} finally {
  server.close();
}
