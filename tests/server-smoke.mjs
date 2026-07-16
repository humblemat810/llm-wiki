import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { Agent, request as httpRequest } from "node:http";
import { connect as tcpConnect } from "node:net";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { canWriteResponse, createAppServer, MIN_AUTH_TOKEN_CHARS, parseConfiguredBoundedInteger, parseTrustedProxyHops, readBody, readBoundedFile, readBoundedUtf8, resolveRateLimitClientKey, safeDiagnosticCode, sanitizeLogEntry } from "../server.mjs";
import { extractGraph, MAX_GRAPH_NODES } from "../graph-core.js";
import { FIXED_PUBLIC_ASSETS, MAX_PUBLIC_ASSET_BYTES } from "../scripts/public-assets.mjs";
import { verifyCanvasProjection } from "../scripts/verify-canvas.mjs";
import { verifyServiceHealth } from "../scripts/verify-service-health.mjs";

const expectedBuildRevision = /^(?:unknown|[0-9a-f]{7,64})$/i.test(String(process.env.BUILD_REVISION || "").trim())
  ? String(process.env.BUILD_REVISION).trim().toLowerCase()
  : "unknown";
const sanitizedRevision = execFileSync(
  process.execPath,
  ["--input-type=module", "-e", "const { createAppServer } = await import('./server.mjs'); console.log(createAppServer().getMetrics().buildRevision);"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, BUILD_REVISION: 'bad"\\nllm_field_notes_build_info{revision="forged"} 1' }
  }
).trim();
assert.equal(sanitizedRevision, "unknown", "malformed build revisions must not reach logs or Prometheus labels");
for (const state of [
  { destroyed: true, headersSent: false, writableEnded: false },
  { destroyed: false, headersSent: true, writableEnded: false },
  { destroyed: false, headersSent: false, writableEnded: true }
]) {
  assert.equal(canWriteResponse(state), false, "response helpers must refuse writes after any terminal response state");
}
assert.equal(canWriteResponse({ destroyed: false, headersSent: false, writableEnded: false }), true, "response helpers should permit a fresh response");
assert.equal(safeDiagnosticCode("EXTRACTOR_TIMEOUT"), "EXTRACTOR_TIMEOUT", "known diagnostic codes should remain available for incident correlation");
assert.equal(safeDiagnosticCode(`bad${"x".repeat(200)}`), "EXTRACTOR_FAILURE", "unexpected diagnostic codes should use a bounded generic fallback");
assert.equal(safeDiagnosticCode("BAD CODE"), "EXTRACTOR_FAILURE", "diagnostic codes containing unsafe characters should not reach lifecycle logs");
assert.equal(safeDiagnosticCode(""), "EXTRACTOR_FAILURE", "empty diagnostic codes should use a generic fallback");
assert.deepEqual(parseTrustedProxyHops(undefined), { value: 0, valid: true, configured: false }, "missing proxy trust configuration should use direct-socket mode");
assert.deepEqual(parseTrustedProxyHops("2"), { value: 2, valid: true, configured: true }, "valid proxy trust configuration should preserve its hop count");
assert.deepEqual(parseTrustedProxyHops(""), { value: 0, valid: true, configured: false }, "empty proxy trust configuration should remain optional");
assert.equal(parseTrustedProxyHops("1.5").valid, false, "fractional proxy trust configuration should be rejected");
assert.equal(parseTrustedProxyHops("9").valid, false, "proxy trust configuration above the safety ceiling should be rejected");
assert.deepEqual(parseConfiguredBoundedInteger("PORT", undefined, { defaultValue: 8000, max: 65535 }), { value: 8000, configured: false, valid: true }, "missing integer settings should use their documented default");
assert.deepEqual(parseConfiguredBoundedInteger("EXTRACTOR_TIMEOUT_MS", "2500", { defaultValue: 120000, max: 120000 }), { value: 2500, configured: true, valid: true }, "valid bounded integer settings should be preserved");
  assert.equal(parseConfiguredBoundedInteger("EXTRACTOR_RATE_LIMIT", "oops", { defaultValue: 60, max: 1000000 }).valid, false, "malformed integer settings should fail validation");
  assert.equal(parseConfiguredBoundedInteger("EXTRACTOR_CONCURRENCY", "0", { defaultValue: 8, max: 1024 }).valid, false, "out-of-range integer settings should fail validation");
  assert.throws(
    () => createAppServer({
      publicOrigin: "http://localhost:8000",
      requireSecurePublicOrigin: true,
      requireBuildRevision: false
    }),
    /Public origin must use HTTPS/,
    "strict non-loopback origin policy should reject HTTP even when the configured origin hostname is loopback"
  );
  const invalidProxyTrustStartup = spawnSync(
  process.execPath,
  ["server.mjs"],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 2000,
    env: { ...process.env, HOST: "127.0.0.1", TRUST_PROXY_HOPS: "not-an-integer" }
  }
);
assert.notEqual(invalidProxyTrustStartup.status, 0, "standalone startup should fail on explicit invalid proxy trust configuration");
assert.match(invalidProxyTrustStartup.stderr, /TRUST_PROXY_HOPS must be an integer from 0 to 8/, "invalid proxy trust startup should provide an actionable bounded diagnostic");
for (const [variable, value, expectedMessage] of [
  ["PORT", "not-a-port", /PORT must be an integer from 1 to 65535/],
  ["EXTRACTOR_RATE_LIMIT", "not-a-rate", /EXTRACTOR_RATE_LIMIT must be an integer from 1 to 1000000/],
  ["EXTRACTOR_TIMEOUT_MS", "0", /EXTRACTOR_TIMEOUT_MS must be an integer from 1 to 120000/],
  ["EXTRACTOR_CONCURRENCY", "9999", /EXTRACTOR_CONCURRENCY must be an integer from 1 to 1024/]
]) {
  const invalidSettingStartup = spawnSync(
    process.execPath,
    ["server.mjs"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 2000,
      env: { ...process.env, HOST: "127.0.0.1", [variable]: value }
    }
  );
  assert.notEqual(invalidSettingStartup.status, 0, `${variable} should fail standalone startup when explicitly malformed`);
  assert.match(invalidSettingStartup.stderr, expectedMessage, `${variable} startup failure should identify the accepted range`);
}
const directRateLimitRequest = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
assert.equal(resolveRateLimitClientKey(directRateLimitRequest), "127.0.0.1", "rate limiting should use the socket address by default");
assert.equal(
  resolveRateLimitClientKey({
    socket: { remoteAddress: "10.0.0.8" },
    headers: { "x-forwarded-for": "198.51.100.10, 10.0.0.7" }
  }, 1),
  "198.51.100.10",
  "an explicitly trusted proxy hop should expose the client address immediately before the trusted proxy"
);
assert.equal(
  resolveRateLimitClientKey({
    socket: { remoteAddress: "10.0.0.8" },
    headers: { "x-forwarded-for": "198.51.100.10, 203.0.113.20, 10.0.0.7" }
  }, 1),
  "203.0.113.20",
  "multi-hop forwarding should select the address immediately before the configured trusted chain"
);
assert.equal(
  resolveRateLimitClientKey({
    socket: { remoteAddress: "10.0.0.8" },
    headers: { "x-forwarded-for": "attacker, 10.0.0.7" }
  }, 1),
  "10.0.0.8",
  "malformed forwarded addresses must fail closed to the socket identity"
);
assert.equal(
  resolveRateLimitClientKey({
    socket: { remoteAddress: "10.0.0.8" },
    headers: { "x-forwarded-for": "198.51.100.10" }
  }, 0),
  "10.0.0.8",
  "forwarded headers must be ignored unless proxy trust is explicitly enabled"
);
assert.deepEqual(
  sanitizeLogEntry({
    error: `bad${"x".repeat(400)}`,
    message: `unsafe${String.fromCharCode(0)}message`,
    durationMs: Number.POSITIVE_INFINITY,
    nested: { secret: true },
    enabled: true
  }),
  {
    error: "SERVER_FAILURE"
  },
  "structured log entries should retain only bounded allowlisted operational fields"
);

const logs = [];
const server = createAppServer({ logger: (entry) => logs.push(entry) });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
try {
  const malformedResponse = await new Promise((resolve, reject) => {
    const socket = tcpConnect(port, "127.0.0.1");
    let response = "";
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: localhost\r\nBad Header\r\n\r\n"));
    socket.on("data", (chunk) => { response += chunk; });
    socket.on("end", () => resolve(response));
    socket.on("error", reject);
  });
  assert.match(malformedResponse, /^HTTP\/1\.1 400 Bad Request\r\n/, "malformed HTTP requests should receive a deterministic bounded response");
  assert.match(malformedResponse, /Connection: close\r\n/);
  assert(logs.some((entry) => entry.route === "client" && entry.error === "CLIENT_PROTOCOL_ERROR"), "malformed HTTP requests should emit a sanitized protocol diagnostic");

  const truncatedRequest = new EventEmitter();
  truncatedRequest.headers = {};
  truncatedRequest.aborted = false;
  truncatedRequest.destroyed = false;
  truncatedRequest.readableEnded = false;
  truncatedRequest.complete = false;
  const truncatedBody = readBody(truncatedRequest, {});
  truncatedRequest.emit("close");
  await assert.rejects(
    truncatedBody,
    (error) => error?.code === "REQUEST_ABORTED",
    "truncated request bodies should reject immediately when the client closes the stream"
  );
  const mismatchedLengthRequest = new EventEmitter();
  mismatchedLengthRequest.headers = { "content-length": "5" };
  mismatchedLengthRequest.aborted = false;
  mismatchedLengthRequest.destroyed = false;
  mismatchedLengthRequest.readableEnded = false;
  mismatchedLengthRequest.complete = true;
  const mismatchedLengthBody = readBody(mismatchedLengthRequest, {});
  mismatchedLengthRequest.emit("data", Buffer.from("ok"));
  mismatchedLengthRequest.emit("end");
  await assert.rejects(
    mismatchedLengthBody,
    (error) => error?.statusCode === 400 && error?.code === "REQUEST_LENGTH_MISMATCH",
    "HTTP request bodies should reject a Content-Length mismatch even when the stream emits end"
  );
  const invalidUtf8Request = new EventEmitter();
  invalidUtf8Request.headers = {};
  invalidUtf8Request.aborted = false;
  invalidUtf8Request.destroyed = false;
  invalidUtf8Request.readableEnded = false;
  invalidUtf8Request.complete = false;
  const invalidUtf8Body = readBody(invalidUtf8Request, {});
  invalidUtf8Request.emit("data", Buffer.from([0xff]));
  invalidUtf8Request.emit("end");
  await assert.rejects(invalidUtf8Body, /not valid UTF-8/, "HTTP request bodies should reject invalid UTF-8 before JSON parsing");
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
    await assert.rejects(
      () => readBoundedFile(boundedReadPath, MAX_PUBLIC_ASSET_BYTES + 1),
      (error) => error instanceof RangeError,
      "runtime asset reads should reject finite limits above the per-asset ceiling"
    );
    assert.throws(
      () => readBoundedUtf8(boundedReadPath, Number.POSITIVE_INFINITY),
      (error) => error instanceof RangeError,
      "bounded UTF-8 reads should reject invalid unbounded character limits"
    );
    assert.throws(
      () => readBoundedUtf8(boundedReadPath, MAX_PUBLIC_ASSET_BYTES),
      (error) => error instanceof RangeError,
      "bounded UTF-8 reads should reject finite character limits above the runtime ceiling"
    );
    const unicodePrefixPath = join(boundedReadRoot, "unicode.md");
    await writeFile(unicodePrefixPath, `a${"€".repeat(26668)}`);
    assert.equal(
      readBoundedUtf8(unicodePrefixPath, 20000),
      `a${"€".repeat(19999)}`,
      "bounded UTF-8 reads should preserve valid multibyte characters across the byte window"
    );
    const astralPrefixPath = join(boundedReadRoot, "astral.md");
    await writeFile(astralPrefixPath, `a${"😀".repeat(10000)}`);
    const boundedAstral = readBoundedUtf8(astralPrefixPath, 20000);
    assert.equal(boundedAstral, `a${"😀".repeat(9999)}`, "bounded UTF-8 reads should not split astral characters at the UTF-16 safety boundary");
    assert(!/[\uD800-\uDBFF]$/.test(boundedAstral), "bounded UTF-8 reads should never return a trailing high surrogate");
    const symlinkedReadPath = join(boundedReadRoot, "symlinked-read.md");
    await symlink(astralPrefixPath, symlinkedReadPath);
    if (process.platform !== "win32") {
      await assert.rejects(
        () => readBoundedFile(symlinkedReadPath, 16),
        (error) => error?.code === "ELOOP",
        "bounded binary reads should refuse symlink paths when the platform supports O_NOFOLLOW"
      );
      assert.throws(
        () => readBoundedUtf8(symlinkedReadPath, 16),
        (error) => error?.code === "ELOOP",
        "bounded UTF-8 reads should refuse symlink paths when the platform supports O_NOFOLLOW"
      );
    }
    const malformedUtf8Path = join(boundedReadRoot, "malformed.md");
    await writeFile(malformedUtf8Path, Buffer.from([0xff]));
    assert.throws(
      () => readBoundedUtf8(malformedUtf8Path, 20000),
      /encoded data was not valid(?: for encoding)? utf-8|invalid utf-8/i,
      "bounded UTF-8 reads should reject malformed bytes"
    );
  } finally {
    await rm(boundedReadRoot, { recursive: true, force: true });
  }
  assert.equal(server.requestTimeout, 30000, "request bodies should have a shorter bounded window than provider extraction work");
  assert.equal(server.headersTimeout, 15000);
  assert.equal(server.keepAliveTimeout, 5000);
  assert.equal(server.maxHeaderSize, 16 * 1024);
  const readinessTimeoutServer = createAppServer({ readinessTimeoutMs: 1 });
  await new Promise((resolve) => readinessTimeoutServer.listen(0, "127.0.0.1", resolve));
  const readinessTimeoutPort = readinessTimeoutServer.address().port;
  try {
    const readinessTimeoutResponse = await fetch(`http://127.0.0.1:${readinessTimeoutPort}/readyz`);
    assert.equal(readinessTimeoutResponse.status, 503, "readiness should fail closed when its validation deadline expires");
    assert.equal(readinessTimeoutResponse.headers.get("retry-after"), "5");
    assert.deepEqual(await readinessTimeoutResponse.json(), {
      ok: false,
      schema: "llm-field-notes/graph@1",
      version: "0.1.0",
      revision: expectedBuildRevision,
      ready: false,
      error: "Readiness check timed out."
    });
    const readinessTimeoutMetrics = await fetch(`http://127.0.0.1:${readinessTimeoutPort}/metrics`);
    assert.match(await readinessTimeoutMetrics.text(), /llm_field_notes_readiness_timeouts_total 1/, "readiness timeouts should be observable in Prometheus metrics");
  } finally {
    readinessTimeoutServer.close();
  }
  const failedReadinessLogs = [];
  const failedReadinessServer = createAppServer({
    staticRoot: join(tmpdir(), `llm-field-notes-missing-readiness-${process.pid}-${Date.now()}`),
    logger: (entry) => failedReadinessLogs.push(entry)
  });
  await new Promise((resolve) => failedReadinessServer.listen(0, "127.0.0.1", resolve));
  const failedReadinessPort = failedReadinessServer.address().port;
  try {
    const failedReadinessResponse = await fetch(`http://127.0.0.1:${failedReadinessPort}/readyz`);
    assert.equal(failedReadinessResponse.status, 503, "missing readiness assets should fail closed");
    const failedReadinessMetrics = await fetch(`http://127.0.0.1:${failedReadinessPort}/metrics`);
    assert.match(await failedReadinessMetrics.text(), /llm_field_notes_readiness_failures_total 1/, "completed readiness failures should be observable in Prometheus metrics");
    assert(failedReadinessLogs.some((entry) => entry.route === "readyz" && entry.error === "READINESS_FAILED"), "readiness failures should emit a sanitized structured diagnostic");
  } finally {
    failedReadinessServer.close();
  }
  assert(Number.isFinite(server.getMetrics().uptimeSeconds) && server.getMetrics().uptimeSeconds >= 0, "programmatic metrics should expose process uptime");
  assert.equal(server.getMetrics().draining, false, "programmatic metrics should expose the initial non-draining state");
  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert((await index.text()).includes("LLM Field Notes"));
  assert.match(index.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/, "static responses should expose a request ID for operational correlation");
  assert.equal(Number(index.headers.get("content-length")), Buffer.byteLength(await (await fetch(`http://127.0.0.1:${port}/index.html`)).text()), "static responses should advertise their byte length");
  assert(index.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"));
  assert.equal(index.headers.get("strict-transport-security"), null, "local HTTP servers should not advertise HSTS");
  const readiness = await fetch(`http://127.0.0.1:${port}/readyz`);
  const readinessHead = await fetch(`http://127.0.0.1:${port}/readyz`, { method: "HEAD" });
  assert.equal(readiness.status, 200);
  assert.equal(readinessHead.status, 200);
  assert.equal(await readinessHead.text(), "", "HEAD readiness responses should not include a body");
  assert.equal(Number(readinessHead.headers.get("content-length")), Number(readiness.headers.get("content-length")), "HEAD readiness should preserve the GET representation length");
  const indexEtag = index.headers.get("etag");
  assert.match(indexEtag || "", /^"[0-9a-f]{64}"$/);
  const notModified = await fetch(`http://127.0.0.1:${port}/`, { headers: { "if-none-match": indexEtag } });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get("etag"), indexEtag);
  const serviceWorker = await fetch(`http://127.0.0.1:${port}/sw.js`);
  assert.equal(serviceWorker.headers.get("cache-control"), "no-cache", "service-worker scripts should update promptly");
  assert.match(await serviceWorker.clone().text(), new RegExp(`const CACHE = "llm-field-notes-v0\\.1\\.0${expectedBuildRevision === "unknown" ? "" : `-${expectedBuildRevision}`}"`), "Node service workers should retain the release identity and optional source revision");
  const release = await fetch(`http://127.0.0.1:${port}/version.json`);
  assert.equal(release.headers.get("cache-control"), "no-cache", "release metadata should update promptly");
  assert.deepEqual((await release.json()), { version: "0.1.0", channel: "unreleased", date: "2026-07-12", revision: expectedBuildRevision });
  const webManifest = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`);
  assert.equal(webManifest.headers.get("cache-control"), "no-cache", "installable-app metadata should update promptly");
  const notFoundPage = await fetch(`http://127.0.0.1:${port}/404.html`);
  assert.equal(notFoundPage.headers.get("cache-control"), "no-cache", "the branded recovery page should update promptly");
    const robots = await fetch(`http://127.0.0.1:${port}/robots.txt`);
    assert.equal(robots.headers.get("content-type"), "text/plain; charset=utf-8", "robots.txt should use the standard text MIME type");
    const securityMetadata = await fetch(`http://127.0.0.1:${port}/.well-known/security.txt`);
    const securityText = await securityMetadata.text();
    assert.equal(securityMetadata.status, 200);
    assert(securityText.includes("Contact: https://github.com/humblemat810/llm-wiki/security/advisories/new")
      && securityText.includes("Policy: https://github.com/humblemat810/llm-wiki/blob/main/SECURITY.md")
      && securityText.includes("Canonical: https://github.com/humblemat810/llm-wiki/blob/main/.well-known/security.txt"), "runtime security metadata should target the default repository");
  const note = await fetch(`http://127.0.0.1:${port}/notes/tokens.md`);
  assert.equal(note.status, 200);
  assert.equal(note.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert((await note.text()).includes("# Tokens are the interface"), "versioned learning notes should be served as Markdown");
  const notePage = await fetch(`http://127.0.0.1:${port}/notes/tokens.html`);
  assert.equal(notePage.status, 200);
  assert.equal(notePage.headers.get("cache-control"), "no-cache", "generated learning-note pages should revalidate after publication changes");
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
  const sampleGraphPage = await fetch(`http://127.0.0.1:${port}/sample-graph.html`);
  assert.equal(sampleGraphPage.status, 200);
  assert.equal(sampleGraphPage.headers.get("content-type"), "text/html; charset=utf-8");
  const sampleGraphPageText = await sampleGraphPage.text();
  assert(sampleGraphPageText.includes("A document,") && sampleGraphPageText.includes("CONCEPTS WITH EVIDENCE") && sampleGraphPageText.includes("RELATIONS WITH GROUNDS") && sampleGraphPageText.includes("fnv64-") && sampleGraphPageText.includes("script-src 'none'"), "Node hosts should serve the script-free sample graph explainer with evidence, relations, and fingerprint");
  assert(sampleGraphPage.headers.get("content-security-policy")?.includes("script-src 'none'"), "Node sample graph pages should enforce their strict CSP at the response boundary");
  const sampleGraphCanvas = await fetch(`http://127.0.0.1:${port}/examples/sample-graph.canvas`);
  assert.equal(sampleGraphCanvas.status, 200, "Node hosts should serve the standalone sample Graph.canvas projection");
  assert.equal(sampleGraphCanvas.headers.get("content-type"), "application/json; charset=utf-8", "Node hosts should advertise the Canvas projection as JSON");
  const sampleGraphCanvasPayload = JSON.parse(await sampleGraphCanvas.text());
  verifyCanvasProjection(sampleGraphCanvasPayload, "served sample Graph.canvas");
  const sampleGraphCanvasIds = new Set(sampleGraphCanvasPayload.nodes.map((node) => node.id));
  assert(sampleGraphCanvasPayload.nodes.length > 0 && sampleGraphCanvasPayload.edges.every((edge) => sampleGraphCanvasIds.has(edge.fromNode) && sampleGraphCanvasIds.has(edge.toNode)), "Node Canvas projections should expose resolvable native nodes and edges");
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
  const rasterShareCard = await fetch(`http://127.0.0.1:${port}/social-card.png`);
  assert.equal(rasterShareCard.status, 200);
  assert.equal(rasterShareCard.headers.get("content-type"), "image/png");
  const rasterShareCardBytes = new Uint8Array(await rasterShareCard.arrayBuffer());
  assert.deepEqual([...rasterShareCardBytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "the deployed raster share card should be a PNG");
  assert.equal(new DataView(rasterShareCardBytes.buffer).getUint32(16), 1200, "the raster share card should declare the production width");
  assert.equal(new DataView(rasterShareCardBytes.buffer).getUint32(20), 630, "the raster share card should declare the production height");
  for (const [asset, size] of [["icon-192.png", 192], ["icon-512.png", 512]]) {
    const icon = await fetch(`http://127.0.0.1:${port}/${asset}`);
    assert.equal(icon.status, 200, `${asset} should be served`);
    assert.equal(icon.headers.get("content-type"), "image/png", `${asset} should use the PNG MIME type`);
    const bytes = new Uint8Array(await icon.arrayBuffer());
    assert.deepEqual([...bytes.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${asset} should be a PNG`);
    const view = new DataView(bytes.buffer);
    assert.equal(view.getUint32(16), size, `${asset} should declare its width`);
    assert.equal(view.getUint32(20), size, `${asset} should declare its height`);
  }
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
  const artifactGallery = await fetch(`http://127.0.0.1:${port}/artifacts.html`);
  assert.equal(artifactGallery.status, 200);
  assert((artifactGallery.headers.get("content-security-policy") || "").includes("script-src 'none'"), "script-free artifact pages should receive a response-level script prohibition");
  assert((await artifactGallery.text()).includes("Small things"), "the Node host should serve the public artifact gallery");
  const artifactSource = await fetch(`http://127.0.0.1:${port}/experiments/tiny-bpe.mjs`);
  assert.equal(artifactSource.status, 200);
  assert.equal(artifactSource.headers.get("content-type"), "text/javascript; charset=utf-8", "published runnable artifacts should use an explicit JavaScript MIME type");
  assert((await artifactSource.text()).includes("export function trainBpe"), "published artifact source should remain inspectable");
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
  const healthPayload = await health.json();
  verifyServiceHealth(healthPayload, "health response", "liveness");
  assert.deepEqual(healthPayload, { ok: true, live: true, schema: "llm-field-notes/graph@1", version: "0.1.0", revision: expectedBuildRevision });
  assert.match(health.headers.get("x-request-id") || "", /^[0-9a-f-]{36}$/, "health responses should expose a request ID for operational correlation");
  assert.equal(health.headers.get("cache-control"), "no-store");
  const healthHead = await fetch(`http://127.0.0.1:${port}/healthz`, { method: "HEAD" });
  assert.equal(healthHead.status, 200, "health checks should support HEAD probes");
  assert.equal(Number(healthHead.headers.get("content-length")), Number(health.headers.get("content-length")));
  assert.equal(await healthHead.text(), "", "health HEAD responses should not contain a body");
  const liveness = await fetch(`http://127.0.0.1:${port}/livez`);
  assert.equal(liveness.status, 200, "liveness checks should answer independently of readiness");
  const livenessPayload = await liveness.json();
  verifyServiceHealth(livenessPayload, "liveness response", "liveness");
  assert.deepEqual(livenessPayload, { ok: true, live: true, schema: "llm-field-notes/graph@1", version: "0.1.0", revision: expectedBuildRevision });
  const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
  assert.equal(metrics.status, 200);
  assert.equal(metrics.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");
  assert.equal(metrics.headers.get("x-robots-tag"), "noindex, nofollow", "metrics should not be indexed");
  const metricsText = await metrics.text();
  assert(metricsText.includes("llm_field_notes_http_requests_total")
    && metricsText.includes("llm_field_notes_http_requests_in_flight")
    && metricsText.includes("llm_field_notes_http_duration_ms_bucket{le=\"+Inf\"}")
    && metricsText.includes("llm_field_notes_http_duration_ms_count")
    && metricsText.includes("llm_field_notes_extraction_duration_ms_bucket{le=\"+Inf\"}")
    && metricsText.includes("llm_field_notes_extraction_duration_ms_count")
    && metricsText.includes('llm_field_notes_http_responses_total{status="200"}')
    && metricsText.includes("llm_field_notes_rate_limit_keys ")
    && metricsText.includes("llm_field_notes_rate_limit_key_capacity 10000")
    && metricsText.includes("llm_field_notes_trusted_proxy_hops 0")
    && metricsText.includes("llm_field_notes_concurrency_limited_total 0")
    && metricsText.includes("llm_field_notes_extractions_in_flight 0")
    && metricsText.includes("llm_field_notes_extractor_concurrency_limit 8")
    && metricsText.includes("llm_field_notes_extraction_client_aborts_total 0")
    && metricsText.includes("llm_field_notes_process_uptime_seconds ")
    && metricsText.includes("llm_field_notes_draining 0")
    && metricsText.includes('llm_field_notes_build_info{version="0.1.0"} 1')
    && metricsText.includes(`llm_field_notes_build_revision_info{revision="${expectedBuildRevision}"} 1`), "metrics should expose privacy-safe request, latency, version, and source-revision gauges");
  assert.equal(server.getMetrics().buildRevision, expectedBuildRevision, "programmatic metrics should expose the sanitized source revision");
  assert.equal(server.getMetrics().httpRequestsInFlight, 0, "completed HTTP requests should leave no request pressure behind");
  assert(Number.isSafeInteger(server.getMetrics().rateLimitKeys) && server.getMetrics().rateLimitKeys >= 0, "programmatic metrics should expose bounded rate-limit client-window occupancy");
  assert.equal(server.getMetrics().rateLimitKeyCapacity, 10000, "programmatic metrics should expose the rate-limit client-window ceiling");
  assert.equal(server.getMetrics().trustedProxyHops, 0, "programmatic metrics should expose the default direct-socket proxy trust mode");
  assert(Number.isFinite(server.getMetrics().httpLatencyCount) && server.getMetrics().httpLatencyCount > 0, "programmatic metrics should record completed HTTP latency observations");
  assert(Number(server.getMetrics().responsesByStatus["200"]) > 0, "programmatic metrics should expose successful HTTP response counts");
  const metricsHead = await fetch(`http://127.0.0.1:${port}/metrics`, { method: "HEAD" });
  assert.equal(metricsHead.status, 200, "metrics should support HEAD probes");
  assert.equal(metricsHead.headers.get("content-type"), "text/plain; version=0.0.4; charset=utf-8");
  assert(Number(metricsHead.headers.get("content-length")) > 0, "metrics HEAD responses should declare their live payload length");
  assert.equal(await metricsHead.text(), "", "metrics HEAD responses should not contain a body");
  const ready = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), { ok: true, schema: "llm-field-notes/graph@1", version: "0.1.0", revision: expectedBuildRevision, ready: true });
  const readyHead = await fetch(`http://127.0.0.1:${port}/readyz`, { method: "HEAD" });
  assert.equal(readyHead.status, 200, "readiness checks should support HEAD probes");
  assert.equal(await readyHead.text(), "", "readiness HEAD responses should not contain a body");
  const wrongMethod = await fetch(`http://127.0.0.1:${port}/api/extract-graph`);
  assert.equal(wrongMethod.status, 405, "the extraction route should report method errors as API errors");
  assert.equal(wrongMethod.headers.get("allow"), "POST");
  const trustedProxyRateServer = createAppServer({ maxRequestsPerMinute: 1, trustedProxyHops: 1 });
  await new Promise((resolve) => trustedProxyRateServer.listen(0, "127.0.0.1", resolve));
  try {
    assert.equal(trustedProxyRateServer.getMetrics().trustedProxyHops, 1, "programmatic metrics should expose the normalized trusted proxy hop count");
    const trustedProxyRateUrl = `http://127.0.0.1:${trustedProxyRateServer.address().port}/api/extract-graph`;
    const firstForwardedClient = await fetch(trustedProxyRateUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10, 10.0.0.7" },
      body: "{}"
    });
    const secondForwardedClient = await fetch(trustedProxyRateUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.11, 10.0.0.7" },
      body: "{}"
    });
    const repeatedForwardedClient = await fetch(trustedProxyRateUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.10, 10.0.0.7" },
      body: "{}"
    });
    assert.equal(firstForwardedClient.status, 400, "the first forwarded client should reach request validation");
    assert.equal(secondForwardedClient.status, 400, "different forwarded clients should receive independent process-local budgets");
    assert.equal(repeatedForwardedClient.status, 429, "repeated requests from one forwarded client should be rate limited");
  } finally {
    trustedProxyRateServer.close();
  }
  server.isDraining = true;
  const drainingReady = await fetch(`http://127.0.0.1:${port}/readyz`);
  assert.equal(drainingReady.status, 503);
  assert.equal(drainingReady.headers.get("retry-after"), "5");
  assert.deepEqual(await drainingReady.json(), { ok: false, schema: "llm-field-notes/graph@1", version: "0.1.0", revision: expectedBuildRevision, ready: false, error: "Server is draining." });
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
  let parsingDrainExtractorCalls = 0;
  const parsingDrainServer = createAppServer({
    extractor: async () => {
      parsingDrainExtractorCalls += 1;
      return { schema: "llm-field-notes/graph@1", concepts: [], relations: [] };
    }
  });
  await new Promise((resolve) => parsingDrainServer.listen(0, "127.0.0.1", resolve));
  const parsingDrainResponse = await new Promise((resolve, reject) => {
    let settled = false;
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: parsingDrainServer.address().port,
      path: "/api/extract-graph",
      method: "POST",
      headers: { "content-type": "application/json", "transfer-encoding": "chunked" }
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        settled = true;
        resolve({ status: response.statusCode, body });
      });
    });
    request.on("error", (error) => {
      if (!settled) reject(error);
    });
    request.write('{"operation":"extract-graph","schema":"llm-field-notes/graph@1","feedbackFormat":"llm-field-notes/feedback@1","feedback":[],"document":{"title":"Drain');
    setImmediate(() => {
      parsingDrainServer.beginDrain();
      request.end('ing","text":"Attention uses context to create a useful graph representation for review."}}');
    });
  });
  assert.equal(parsingDrainResponse.status, 503, "requests still parsing when drain begins should be rejected before provider work starts");
  assert.match(parsingDrainResponse.body, /Server is draining/);
  assert.equal(parsingDrainExtractorCalls, 0, "drain-time parsing rejection must not invoke the extractor");
  await new Promise((resolve) => parsingDrainServer.close(resolve));
  const chunkedOversizedUpload = await new Promise((resolve, reject) => {
    let settled = false;
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
      response.on("end", () => {
        settled = true;
        resolve({ status: response.statusCode, body, reset: false });
      });
    });
    request.on("error", (error) => {
      if (!settled && error?.code === "ECONNRESET") {
        settled = true;
        resolve({ status: 413, body: "", reset: true });
        return;
      }
      if (!settled) reject(error);
    });
    request.end(Buffer.alloc(2 * 1024 * 1024 + 1, 0x78));
  });
  assert.equal(chunkedOversizedUpload.status, 413, "chunked oversized bodies should be rejected as soon as the limit is crossed");
  const declaredOversizedUpload = await new Promise((resolve, reject) => {
    let settled = false;
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
      response.on("end", () => {
        settled = true;
        resolve({ status: response.statusCode, reset: false });
      });
    });
    request.on("error", (error) => {
      if (!settled && error?.code === "ECONNRESET") {
        settled = true;
        resolve({ status: 413, reset: true });
        return;
      }
      if (!settled) reject(error);
    });
    request.end();
  });
  assert.equal(declaredOversizedUpload.status, 413, "declared oversized JSON bodies should be rejected without buffering");
  const expectContinueOversizedUpload = await new Promise((resolve, reject) => {
    let interim = "";
    let settled = false;
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: "/api/extract-graph",
      method: "POST",
      headers: {
        expect: "100-continue",
        "content-type": "application/json",
        "content-length": String(2 * 1024 * 1024 + 1)
      }
    }, (response) => {
      response.resume();
      response.on("end", () => {
        settled = true;
        resolve({ status: response.statusCode, interim });
      });
    });
    request.on("continue", () => {
      if (!settled) reject(new Error("oversized Expect: 100-continue request was accepted before rejection"));
    });
    request.on("information", (info) => {
      interim += `${info.statusCode} `;
    });
    request.on("error", (error) => {
      if (!settled && error?.code === "ECONNRESET") {
        settled = true;
        resolve({ status: 413, interim });
        return;
      }
      if (!settled) reject(error);
    });
    request.end();
  });
  assert.equal(expectContinueOversizedUpload.status, 413, "Expect: 100-continue oversized bodies should be rejected before upload");
  assert(!expectContinueOversizedUpload.interim.includes("100"), "oversized Expect: 100-continue bodies must not receive an interim acceptance");
  const invalidMediaType = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json-malicious" },
    body: "{}"
  });
  assert.equal(invalidMediaType.status, 415, "invalid JSON media type variants should be rejected");
  const earlyRejectedOversized = await new Promise((resolve, reject) => {
    let settled = false;
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
      response.on("end", () => {
        settled = true;
        resolve({ status: response.statusCode, reset: false });
      });
    });
    request.on("error", (error) => {
      if (!settled && error?.code === "ECONNRESET") {
        settled = true;
        resolve({ status: 415, reset: true });
        return;
      }
      if (!settled) reject(error);
    });
    request.end();
  });
  assert.equal(earlyRejectedOversized.status, 415, "early rejection should respond before draining a declared oversized upload");
  let releaseAbortExtraction;
  let abortExtractionStartedResolve;
  const abortExtractionStarted = new Promise((resolve) => {
    abortExtractionStartedResolve = resolve;
  });
  const abortExtraction = new Promise((resolve) => {
    releaseAbortExtraction = resolve;
  });
  const abortLogs = [];
  const abortServer = createAppServer({
    logger: (entry) => abortLogs.push(entry),
    extractor: async () => {
      abortExtractionStartedResolve();
      return abortExtraction;
    }
  });
  await new Promise((resolve) => abortServer.listen(0, "127.0.0.1", resolve));
  const abortRequest = httpRequest({
    hostname: "127.0.0.1",
    port: abortServer.address().port,
    path: "/api/extract-graph",
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  abortRequest.on("error", () => {});
  abortRequest.end(JSON.stringify({
    operation: "extract-graph",
    schema: "llm-field-notes/graph@1",
    feedbackFormat: "llm-field-notes/feedback@1",
    feedback: [],
    document: { title: "Aborted extraction", text: "Attention uses context to create a useful graph representation for review." }
  }));
  try {
    await abortExtractionStarted;
    abortRequest.destroy();
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(abortServer.getMetrics().extractionClientAborts, 1, "programmatic metrics should count client-aborted extraction requests");
    const abortLog = abortServer.getMetrics();
    assert.equal(abortLog.extractionFailures, 1, "client-aborted extraction should count as a failed extraction without a response");
    assert(abortLogs.some((entry) => entry.route === "extract-graph" && entry.status === 499 && entry.error === "REQUEST_ABORTED" && Number.isFinite(entry.durationMs)), "client-aborted extraction requests should emit bounded request-correlated cancellation telemetry");
  } finally {
    releaseAbortExtraction?.({ schema: "llm-field-notes/graph@1", concepts: [], relations: [] });
    abortServer.close();
  }
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);
  let releaseStubbornExtraction;
  const stubbornExtraction = new Promise((resolve) => {
    releaseStubbornExtraction = resolve;
  });
  const stubbornServer = createAppServer({
    extractorTimeoutMs: 10,
    extractor: async () => stubbornExtraction
  });
  await new Promise((resolve) => stubbornServer.listen(0, "127.0.0.1", resolve));
  try {
    const stubbornResponse = await fetch(`http://127.0.0.1:${stubbornServer.address().port}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Stubborn extractor", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(stubbornResponse.status, 504, "timed-out extractor work should return a gateway timeout");
    assert.equal(stubbornServer.getMetrics().extractionsInFlight, 1, "in-flight metrics should retain provider work after timeout until its promise settles");
    assert.equal(await stubbornServer.waitForIdle({ timeoutMs: 20 }), false, "idle waits should time out when a provider ignores cancellation");
    releaseStubbornExtraction({ schema: "llm-field-notes/graph@1", concepts: [], relations: [] });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(await stubbornServer.waitForIdle({ timeoutMs: 1000 }), true, "idle waits should resolve true after late provider settlement");
    assert.equal(stubbornServer.getMetrics().extractionsInFlight, 0, "in-flight metrics should clear after late provider settlement");
  } finally {
    releaseStubbornExtraction?.({ schema: "llm-field-notes/graph@1", concepts: [], relations: [] });
    stubbornServer.close();
  }
  let releaseCapacityExtraction;
  let capacityExtractionStartedResolve;
  const capacityExtractionStarted = new Promise((resolve) => {
    capacityExtractionStartedResolve = resolve;
  });
  const capacityExtraction = new Promise((resolve) => {
    releaseCapacityExtraction = resolve;
  });
  const capacityServer = createAppServer({
    maxConcurrentExtractors: 1,
    extractor: async () => {
      capacityExtractionStartedResolve();
      return capacityExtraction;
    }
  });
  await new Promise((resolve) => capacityServer.listen(0, "127.0.0.1", resolve));
  const capacityPort = capacityServer.address().port;
  const capacityPayload = {
    operation: "extract-graph",
    schema: "llm-field-notes/graph@1",
    feedbackFormat: "llm-field-notes/feedback@1",
    feedback: [],
    document: { title: "Capacity", text: "Attention uses context to create a useful graph representation for review." }
  };
  try {
    const firstCapacityRequest = fetch(`http://127.0.0.1:${capacityPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(capacityPayload)
    });
    await capacityExtractionStarted;
    const rejectedCapacityRequest = await fetch(`http://127.0.0.1:${capacityPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(capacityPayload)
    });
    assert.equal(rejectedCapacityRequest.status, 503, "provider concurrency limits should reject excess extraction work");
    assert.equal(rejectedCapacityRequest.headers.get("retry-after"), "1", "capacity rejections should advertise a short retry delay");
    assert.match((await rejectedCapacityRequest.json()).error, /capacity/i);
    assert.equal(capacityServer.getMetrics().concurrencyLimited, 1, "capacity rejections should be observable in programmatic metrics");
    assert.equal(capacityServer.getMetrics().extractorConcurrencyLimit, 1, "programmatic metrics should expose the configured extractor ceiling");
    releaseCapacityExtraction({ schema: "llm-field-notes/graph@1", concepts: [], relations: [] });
    assert.equal((await firstCapacityRequest).status, 200, "the admitted extraction should complete after provider release");
  } finally {
    releaseCapacityExtraction?.({ schema: "llm-field-notes/graph@1", concepts: [], relations: [] });
    capacityServer.close();
  }
  const invalidConcurrencyServer = createAppServer({ maxConcurrentExtractors: 0 });
  assert.equal(invalidConcurrencyServer.getMetrics().extractorConcurrencyLimit, 8, "invalid extractor concurrency configuration should fail safe to the default");
  invalidConcurrencyServer.close();
  assert.throws(
    () => createAppServer({ publicOrigin: "javascript:alert(1)" }),
    /absolute credential-free HTTP\(S\) origin/,
    "invalid public origins should fail closed instead of silently disabling deployment metadata"
  );
  assert.throws(
    () => createAppServer({ publicRepository: "https://github.com/example/forked-wiki?invalid=1" }),
    /credential-free GitHub HTTPS repository URL/,
    "invalid public repositories should fail closed instead of publishing broken contribution links"
  );
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
    const sameSiteFetchMetadataRejected = await fetch(`http://127.0.0.1:${httpsOriginServer.address().port}/api/extract-graph`, {
      method: "POST",
      headers: {
        "sec-fetch-site": "same-site",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Same site metadata", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(sameSiteFetchMetadataRejected.status, 403, "same-site fetch metadata should reject sibling-origin browser extraction without Origin");
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
  const internalSymlinkRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-internal-symlink-"));
  await Promise.all(FIXED_PUBLIC_ASSETS.map(async (asset) => {
    const target = join(internalSymlinkRoot, asset);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(process.cwd(), asset), target);
  }));
  await rm(join(internalSymlinkRoot, "app.js"));
  await symlink("graph-core.js", join(internalSymlinkRoot, "app.js"));
  const internalSymlinkServer = createAppServer({ staticRoot: internalSymlinkRoot });
  await new Promise((resolve) => internalSymlinkServer.listen(0, "127.0.0.1", resolve));
  const internalSymlinkPort = internalSymlinkServer.address().port;
  try {
    const internalSymlinkReady = await fetch(`http://127.0.0.1:${internalSymlinkPort}/readyz`);
    assert.equal(internalSymlinkReady.status, 503, "readiness should reject symlinked assets even when the target remains inside the static root");
    const internalSymlinkAsset = await fetch(`http://127.0.0.1:${internalSymlinkPort}/app.js`);
    assert.equal(internalSymlinkAsset.status, 404, "runtime serving should not expose symlinked public assets");
  } finally {
    internalSymlinkServer.close();
    await rm(internalSymlinkRoot, { recursive: true, force: true });
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
  const malformedAssetRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-malformed-asset-"));
  await Promise.all(FIXED_PUBLIC_ASSETS.map(async (asset) => {
    const target = join(malformedAssetRoot, asset);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(process.cwd(), asset), target);
  }));
  await writeFile(join(malformedAssetRoot, "app.js"), Buffer.from([0xff]));
  const malformedAssetServer = createAppServer({ staticRoot: malformedAssetRoot });
  await new Promise((resolve) => malformedAssetServer.listen(0, "127.0.0.1", resolve));
  try {
    const malformedReady = await fetch(`http://127.0.0.1:${malformedAssetServer.address().port}/readyz`);
    assert.equal(malformedReady.status, 503, "readiness should fail when a published text asset is not valid UTF-8");
  } finally {
    malformedAssetServer.close();
    await rm(malformedAssetRoot, { recursive: true, force: true });
  }
  const staleReleaseRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-stale-release-"));
  await Promise.all(FIXED_PUBLIC_ASSETS.map(async (asset) => {
    const target = join(staleReleaseRoot, asset);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(process.cwd(), asset), target);
  }));
  await writeFile(join(staleReleaseRoot, "version.json"), JSON.stringify({
    version: "9.9.9",
    channel: "stable",
    date: "2026-07-12"
  }));
  const staleReleaseServer = createAppServer({ staticRoot: staleReleaseRoot });
  await new Promise((resolve) => staleReleaseServer.listen(0, "127.0.0.1", resolve));
  try {
    const staleReleaseReady = await fetch(`http://127.0.0.1:${staleReleaseServer.address().port}/readyz`);
    assert.equal(staleReleaseReady.status, 503, "readiness should fail when release metadata does not match the running package");
  } finally {
    staleReleaseServer.close();
    await rm(staleReleaseRoot, { recursive: true, force: true });
  }
  const impossibleDateRoot = await mkdtemp(join(tmpdir(), "llm-field-notes-impossible-release-date-"));
  await Promise.all(FIXED_PUBLIC_ASSETS.map(async (asset) => {
    const target = join(impossibleDateRoot, asset);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(process.cwd(), asset), target);
  }));
  await writeFile(join(impossibleDateRoot, "version.json"), JSON.stringify({
    version: "0.1.0",
    channel: "stable",
    date: "2026-02-31"
  }));
  const impossibleDateServer = createAppServer({ staticRoot: impossibleDateRoot });
  await new Promise((resolve) => impossibleDateServer.listen(0, "127.0.0.1", resolve));
  try {
    const impossibleDateReady = await fetch(`http://127.0.0.1:${impossibleDateServer.address().port}/readyz`);
    assert.equal(impossibleDateReady.status, 503, "readiness should reject impossible calendar dates instead of accepting Date.parse rollover");
  } finally {
    impossibleDateServer.close();
    await rm(impossibleDateRoot, { recursive: true, force: true });
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
  assert.equal(extraction.headers.get("ratelimit-limit"), "60", "extraction responses should expose the configured request budget");
  const remainingRateLimit = Number(extraction.headers.get("ratelimit-remaining"));
  assert(Number.isSafeInteger(remainingRateLimit) && remainingRateLimit >= 0 && remainingRateLimit < 60, "successful extraction responses should expose remaining request capacity");
  assert.match(extraction.headers.get("ratelimit-reset") || "", /^\d+$/, "extraction responses should expose a bounded reset countdown");
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
  const duplicateKeyRequest = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"operation":"extract-graph","operation":"extract-graph","schema":"llm-field-notes/graph@1","feedbackFormat":"llm-field-notes/feedback@1","feedback":[],"document":{"title":"Duplicate key","text":"Attention uses context to create a useful graph representation for review."}}'
  });
  assert.equal(duplicateKeyRequest.status, 400, "extraction requests with duplicate JSON keys should be rejected");
  assert.equal((await duplicateKeyRequest.json()).error, "Invalid extraction request body.", "extraction parser details should not be reflected to clients");
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
  const unknownRequestField = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [],
      requestTrace: "must-not-be-silently-ignored",
      document: { title: "Unknown request field", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(unknownRequestField.status, 400, "the server should reject unknown request envelope fields");
  const unknownDocumentField = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [],
      document: { title: "Unknown document field", text: "Attention uses context to create a useful graph representation for review.", language: "en" }
    })
  });
  assert.equal(unknownDocumentField.status, 400, "the server should reject unknown document fields");
  const unknownFeedbackField = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [{ kind: "concept", id: "attention", label: "Attention", status: "accepted", confidence: 1 }],
      document: { title: "Unknown feedback field", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(unknownFeedbackField.status, 400, "the server should reject unknown feedback fields");
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
  const duplicateAliasFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [{ kind: "concept", id: "attention", label: "Attention", aliases: ["focus", "focus"], status: "accepted" }],
      document: { title: "Duplicate aliases", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(duplicateAliasFeedback.status, 400, "the server should reject duplicate feedback aliases consistently with the browser adapter");
  const contradictoryFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [
        { kind: "concept", id: "attention", label: "Attention", status: "accepted" },
        { kind: "concept", id: "attention", label: "Attention", status: "rejected" }
      ],
      document: { title: "Contradictory feedback", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(contradictoryFeedback.status, 400, "the server should reject contradictory concept guidance before provider execution");
  assert.match((await contradictoryFeedback.json()).error, /contradictory decisions/);
  const contradictoryRelationFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [
        { kind: "relation", id: "attention-context", source: "attention", target: "context", label: "uses", status: "accepted" },
        { kind: "relation", id: "attention-context", source: "attention", target: "context", label: "supports", status: "rejected" }
      ],
      document: { title: "Contradictory relation feedback", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(contradictoryRelationFeedback.status, 400, "the server should reject contradictory relation guidance even when details disagree");
  const sameStatusDuplicateFeedback = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: [
        { kind: "concept", id: "attention", label: "Attention", status: "accepted" },
        { kind: "concept", id: "attention", label: "Attention", status: "accepted" }
      ],
      document: { title: "Duplicate feedback", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(sameStatusDuplicateFeedback.status, 200, "same-status duplicate guidance should remain compatible");
  const oversizedFeedbackArray = await fetch(`http://127.0.0.1:${port}/api/extract-graph`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      operation: "extract-graph",
      schema: "llm-field-notes/graph@1",
      feedbackFormat: "llm-field-notes/feedback@1",
      feedback: Array.from({ length: 501 }, (_, index) => ({ kind: "concept", id: String(index), status: "accepted" })),
      document: { title: "Oversized feedback array", text: "Attention uses context to create a useful graph representation for review." }
    })
  });
  assert.equal(oversizedFeedbackArray.status, 400, "the server should reject feedback arrays above the item bound before mapping them");
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
    assert.equal(providerResponse.status, 400, "the server should reject feedback fields outside the closed request schema");
    assert.equal(providerCalls.length, 0, "invalid closed-contract requests should not reach the configured extractor");
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
    assert.equal(oversizedResponse.headers.get("retry-after"), null, "oversized provider responses should not advertise a retry");
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
    assert.equal(oversizedCollectionsResponse.headers.get("retry-after"), null, "oversized provider collections should not advertise a retry");
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
      assert.equal(invalidProviderResponse.headers.get("retry-after"), null, `${title} should not advertise a retry`);
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
    assert.equal(failureResponse.headers.get("retry-after"), "1", "transient extractor failures should advertise bounded retry guidance");
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
    assert.equal(timeoutResponse.headers.get("retry-after"), "5", "extractor timeouts should advertise a longer bounded retry delay");
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
    assert.equal(drainServer.getMetrics().draining, true, "programmatic metrics should expose the active draining state");
    const drainMetrics = await fetch(`http://127.0.0.1:${drainPort}/metrics`);
    assert.equal(drainMetrics.status, 200, "metrics should remain available while the server drains");
    assert((await drainMetrics.text()).includes("llm_field_notes_draining 1"), "Prometheus metrics should expose active draining state");
    const drainResponse = await drainRequest;
    assert.equal(drainResponse.status, 503, "aborted in-flight work should report a retryable draining response");
    assert.equal(drainResponse.headers.get("retry-after"), "5", "draining responses should advertise a bounded retry delay");
    assert.deepEqual(await drainResponse.json(), { error: "Server is draining." });
    assert(drainAborted, "shutdown should abort active provider work");
    await drainServer.waitForIdle();
  } finally {
    drainServer.close();
  }
  let stubbornDrainStartedResolve;
  const stubbornDrainStarted = new Promise((resolve) => {
    stubbornDrainStartedResolve = resolve;
  });
  const stubbornDrainServer = createAppServer({
    extractor: () => {
      stubbornDrainStartedResolve();
      return new Promise(() => {});
    }
  });
  await new Promise((resolve) => stubbornDrainServer.listen(0, "127.0.0.1", resolve));
  const stubbornDrainPort = stubbornDrainServer.address().port;
  try {
    const stubbornDrainRequest = fetch(`http://127.0.0.1:${stubbornDrainPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Stubborn shutdown", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    await stubbornDrainStarted;
    const drainAt = Date.now();
    assert.equal(stubbornDrainServer.beginDrain(), true, "stubborn provider shutdown should enter draining mode");
    const stubbornDrainResponse = await stubbornDrainRequest;
    assert(Date.now() - drainAt < 1000, "draining should settle a provider that ignores cancellation without waiting for its provider timeout");
    assert.equal(stubbornDrainResponse.status, 503, "stubborn provider shutdown should return a retryable response");
    assert.equal(stubbornDrainResponse.headers.get("retry-after"), "5");
    await stubbornDrainServer.waitForIdle({ timeoutMs: 20 });
  } finally {
    stubbornDrainServer.close();
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
  const controlCharacterPath = await fetch(`http://127.0.0.1:${port}/%00`);
  assert.equal(controlCharacterPath.status, 400, "decoded control characters in static paths should be client errors");
  const privateAsset = await fetch(`http://127.0.0.1:${port}/package.json`);
  assert.equal(privateAsset.status, 404);
  assert.equal(privateAsset.headers.get("cache-control"), "no-store");
  assert.equal(privateAsset.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), true);
  const privateAssetText = await privateAsset.text();
  assert(privateAssetText.includes("That page is not in the graph.") && privateAssetText.includes('href="/styles.css"') && privateAssetText.includes('href="/artifacts.html"'), "unknown static routes should receive root-safe branded recovery links");
  const privateAssetHead = await fetch(`http://127.0.0.1:${port}/package.json`, { method: "HEAD" });
  assert.equal(privateAssetHead.status, 404);
  assert.equal(await privateAssetHead.text(), "", "branded 404 HEAD responses should not include a body");
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
    assert.equal(limited.headers.get("ratelimit-limit"), "0", "rate-limited responses should expose the configured zero budget");
    assert.equal(limited.headers.get("ratelimit-remaining"), "0", "rate-limited responses should expose no remaining capacity");
    assert.match(limited.headers.get("ratelimit-reset") || "", /^\d+$/, "rate-limited responses should expose a bounded reset countdown");
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
  const publicDefaultServer = createAppServer({ requireExtractorAuth: true });
  await new Promise((resolve) => publicDefaultServer.listen(0, "127.0.0.1", resolve));
  const publicDefaultPort = publicDefaultServer.address().port;
  try {
    const unconfiguredReadiness = await fetch(`http://127.0.0.1:${publicDefaultPort}/readyz`);
    assert.equal(unconfiguredReadiness.status, 503, "readiness should fail closed when required extraction authentication is not configured");
    assert.equal((await unconfiguredReadiness.json()).error, "Extraction authentication is not configured.");
    const unconfiguredAuth = await fetch(`http://127.0.0.1:${publicDefaultPort}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: { title: "Auth configuration", text: "Attention uses context to create a useful graph representation for review." }
      })
    });
    assert.equal(unconfiguredAuth.status, 503, "non-loopback extraction should fail closed when authentication is not configured");
    assert.equal(unconfiguredAuth.headers.get("retry-after"), "60");
  } finally {
    publicDefaultServer.close();
  }
  for (const insecureOrigin of [""]) {
    const insecureOriginServer = createAppServer({
      publicOrigin: insecureOrigin,
      requireSecurePublicOrigin: true
    });
    await new Promise((resolve) => insecureOriginServer.listen(0, "127.0.0.1", resolve));
    try {
      const insecureOriginReady = await fetch(`http://127.0.0.1:${insecureOriginServer.address().port}/readyz`);
      assert.equal(insecureOriginReady.status, 503, "non-loopback deployments should fail readiness without a trusted HTTPS public origin");
      assert.equal((await insecureOriginReady.json()).error, "A trusted HTTPS public origin is not configured.");
    } finally {
      insecureOriginServer.close();
    }
  }
  assert.throws(
    () => createAppServer({
      publicOrigin: "http://wiki.example.test",
      requireSecurePublicOrigin: true
    }),
    /Public origin must use HTTPS/,
    "strict non-loopback origin configuration should reject HTTP before the server listens"
  );
  const secureOriginServer = createAppServer({
    publicOrigin: "https://wiki.example.test",
    requireSecurePublicOrigin: true
  });
  await new Promise((resolve) => secureOriginServer.listen(0, "127.0.0.1", resolve));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${secureOriginServer.address().port}/readyz`)).status, 200, "non-loopback deployments should accept a configured HTTPS public origin");
  } finally {
    secureOriginServer.close();
  }
  for (const invalidToken of ["short", ` ${"x".repeat(MIN_AUTH_TOKEN_CHARS)} `, `x${String.fromCharCode(1)}${"x".repeat(MIN_AUTH_TOKEN_CHARS)}`]) {
    const invalidTokenServer = createAppServer({ extractorAuthToken: invalidToken });
    await new Promise((resolve) => invalidTokenServer.listen(0, "127.0.0.1", resolve));
    try {
      const invalidTokenReady = await fetch(`http://127.0.0.1:${invalidTokenServer.address().port}/readyz`);
      assert.equal(invalidTokenReady.status, 503, "invalid extraction bearer configuration should fail readiness closed");
      assert.equal((await invalidTokenReady.json()).error, "Extraction authentication is not configured.");
    } finally {
      invalidTokenServer.close();
    }
  }
  const publicMetricsServer = createAppServer({ requireMetricsAuth: true });
  await new Promise((resolve) => publicMetricsServer.listen(0, "127.0.0.1", resolve));
  const publicMetricsPort = publicMetricsServer.address().port;
  try {
    const unconfiguredMetricsReadiness = await fetch(`http://127.0.0.1:${publicMetricsPort}/readyz`);
    assert.equal(unconfiguredMetricsReadiness.status, 503, "readiness should fail closed when required metrics authentication is not configured");
    assert.equal((await unconfiguredMetricsReadiness.json()).error, "Metrics authentication is not configured.");
    const unconfiguredMetricsAuth = await fetch(`http://127.0.0.1:${publicMetricsPort}/metrics`);
    assert.equal(unconfiguredMetricsAuth.status, 503, "non-loopback metrics should fail closed when authentication is not configured");
    assert.equal(unconfiguredMetricsAuth.headers.get("retry-after"), "60");
  } finally {
    publicMetricsServer.close();
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
  const keepAliveRequest = (method, path, headers, body) => new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port: keepAlivePort,
      path,
      method,
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
    assert.equal((await keepAliveRequest("POST", "/api/extract-graph", { "content-type": "application/json" }, keepAlivePayload)).status, 401, "unauthorized keep-alive requests should still be rejected");
    assert.equal((await keepAliveRequest("POST", "/api/extract-graph", { "content-type": "application/json", authorization: "Bearer keep-alive-secret" }, keepAlivePayload)).status, 200, "a valid request should survive after an early rejection on the same keep-alive connection");
    assert.equal((await keepAliveRequest("GET", "/api/extract-graph", { "content-type": "text/plain" }, "ignored body")).status, 405, "body-bearing method errors should still report 405");
    assert.equal((await keepAliveRequest("POST", "/api/extract-graph", { "content-type": "application/json", authorization: "Bearer keep-alive-secret" }, keepAlivePayload)).status, 200, "a valid request should survive after a body-bearing method error on the same keep-alive connection");
    assert.equal((await keepAliveRequest("PUT", "/private", { "content-type": "text/plain" }, "ignored body")).status, 405, "unsupported body-bearing methods should still report 405");
    assert.equal((await keepAliveRequest("POST", "/api/extract-graph", { "content-type": "application/json", authorization: "Bearer keep-alive-secret" }, keepAlivePayload)).status, 200, "a valid request should survive after an unsupported body-bearing method on the same keep-alive connection");
    assert.equal((await keepAliveRequest("GET", "/private", { "content-type": "text/plain" }, "ignored body")).status, 404, "body-bearing unknown GET paths should still report 404");
    assert.equal((await keepAliveRequest("POST", "/api/extract-graph", { "content-type": "application/json", authorization: "Bearer keep-alive-secret" }, keepAlivePayload)).status, 200, "a valid request should survive after a body-bearing unknown GET path on the same keep-alive connection");
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
  const seoServer = createAppServer({
    publicOrigin: "https://notes.example.test",
    publicRepository: "https://github.com/example/forked-wiki"
  });
  await new Promise((resolve) => seoServer.listen(0, "127.0.0.1", resolve));
  const seoPort = seoServer.address().port;
  try {
    const seoIndex = await fetch(`http://127.0.0.1:${seoPort}/`);
    const seoIndexText = await seoIndex.text();
    assert(seoIndexText.includes('href="https://notes.example.test/"') && seoIndexText.includes('href="https://notes.example.test/feed.xml"') && seoIndexText.includes('content="https://notes.example.test/"') && seoIndexText.includes('<meta name="repository-url" content="https://github.com/example/forked-wiki"') && (seoIndexText.match(/content="https:\/\/notes\.example\.test\/social-card\.png"/g) || []).length === 2, "configured public origins should emit absolute canonical, raster social, and fork repository metadata");
    assert(seoIndexText.includes('href="https://github.com/example/forked-wiki/fork"') && seoIndexText.includes('href="https://github.com/example/forked-wiki/issues/new?template=graph_correction.yml"') && seoIndexText.includes('href="https://github.com/example/forked-wiki/issues/new?template=learning_note.yml"') && seoIndexText.includes('href="https://github.com/example/forked-wiki/issues/new?template=artifact.yml"'), "runtime fork and contribution links should point at the configured repository");
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
    const seoArtifacts = await fetch(`http://127.0.0.1:${seoPort}/artifacts.html`);
    const seoArtifactsText = await seoArtifacts.text();
    assert.equal(seoArtifacts.status, 200);
    assert.equal(seoArtifacts.headers.get("cache-control"), "no-cache", "origin-aware artifact pages should revalidate transformed metadata");
    assert(seoArtifactsText.includes('content="https://notes.example.test/social-card.png"') && seoArtifactsText.includes('content="https://notes.example.test/artifacts.html"') && seoArtifactsText.includes('rel="canonical" href="https://notes.example.test/artifacts.html"') && seoArtifactsText.includes('"@type":"ItemList"') && seoArtifactsText.includes('"url":"https://notes.example.test/experiments/tiny-bpe.mjs"'), "configured public origins should emit absolute artifact-gallery raster social and structured metadata");
    assert(seoArtifactsText.includes('href="https://github.com/example/forked-wiki/fork"') && seoArtifactsText.includes('href="https://github.com/example/forked-wiki/issues/new?template=graph_correction.yml"') && seoArtifactsText.includes('href="https://github.com/example/forked-wiki/issues/new?template=artifact.yml"'), "runtime artifact pages should point fork and contribution links at the configured repository");
    const literalOriginServer = createAppServer({ publicOrigin: "https://notes.example.test/$release" });
    await new Promise((resolve) => literalOriginServer.listen(0, "127.0.0.1", resolve));
    try {
      const literalArtifacts = await fetch(`http://127.0.0.1:${literalOriginServer.address().port}/artifacts.html`);
      const literalArtifactsText = await literalArtifacts.text();
      assert(literalArtifactsText.includes('content="https://notes.example.test/$release/social-card.png"') && literalArtifactsText.includes('"url":"https://notes.example.test/$release/experiments/tiny-bpe.mjs"'), "origin metadata rewrites should preserve literal dollar signs in valid deployment paths");
    } finally {
      literalOriginServer.close();
    }
    const sitemap = await fetch(`http://127.0.0.1:${seoPort}/sitemap.xml`);
    assert.equal(sitemap.status, 200, "configured public origins should expose a sitemap");
    assert.equal(sitemap.headers.get("content-type"), "application/xml; charset=utf-8");
    assert.equal(sitemap.headers.get("cache-control"), "no-cache", "generated sitemaps should revalidate after publication changes");
    const sitemapText = await sitemap.text();
    assert(sitemapText.includes("https://notes.example.test/artifacts.html") && sitemapText.includes("https://notes.example.test/sample-graph.html") && sitemapText.includes("https://notes.example.test/experiments/README.md") && sitemapText.includes("https://notes.example.test/notes/tokens.md") && sitemapText.includes("https://notes.example.test/notes/tokens.html"), "sitemap should include the sample graph explainer, public discovery pages, source notes, and canonical learning-note landing pages");
    assert(!(await (await fetch(`http://127.0.0.1:${seoPort}/sitemap.xml`)).text()).includes("https://notes.example.test/notes/README.md"), "sitemap should exclude the learning-map index README");
    const seoRobots = await fetch(`http://127.0.0.1:${seoPort}/robots.txt`);
    assert.equal(seoRobots.status, 200);
    assert.equal(seoRobots.headers.get("content-type"), "text/plain; charset=utf-8", "dynamic robots should use the standard text MIME type");
    assert.equal(seoRobots.headers.get("cache-control"), "no-cache", "generated robots metadata should revalidate after publication changes");
    assert((await seoRobots.text()).includes("Sitemap: https://notes.example.test/sitemap.xml"), "configured robots should point crawlers at the sitemap");
    const seoSecurity = await fetch(`http://127.0.0.1:${seoPort}/.well-known/security.txt`);
    const seoSecurityText = await seoSecurity.text();
    assert.equal(seoSecurity.status, 200);
    assert(seoSecurityText.includes("Contact: https://github.com/example/forked-wiki/security/advisories/new")
      && seoSecurityText.includes("Policy: https://github.com/example/forked-wiki/blob/main/SECURITY.md")
      && seoSecurityText.includes("Canonical: https://github.com/example/forked-wiki/blob/main/.well-known/security.txt"), "runtime security metadata should target the configured fork repository");
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
    assert.equal(feed.headers.get("cache-control"), "no-cache", "generated feeds should revalidate after publication changes");
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
      assert(subpathSitemapText.includes("https://notes.example.test/field-notes/artifacts.html") && subpathSitemapText.includes("https://notes.example.test/field-notes/sample-graph.html") && subpathSitemapText.includes("https://notes.example.test/field-notes/experiments/README.md") && subpathSitemapText.includes("https://notes.example.test/field-notes/notes/tokens.md") && subpathSitemapText.includes("https://notes.example.test/field-notes/notes/tokens.html"), "project-subpath sitemaps should preserve the deployment prefix for the sample graph explainer, public discovery pages, and learning notes");
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
