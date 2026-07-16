import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { createServer as createTcpServer } from "node:net";
import { createProviderExtractor, resolveProviderConfiguration } from "../provider-adapter.js";

function startProviderServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({
        server,
        endpoint: `http://127.0.0.1:${address.port}/v1/chat/completions`
      });
    });
  });
}

async function allocatePort() {
  const server = createTcpServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForReady(url, child) {
  let lastError = "not ready";
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`standalone provider server exited early: ${lastError}`);
    try {
      const response = await fetch(`${url}/readyz`);
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
      await response.arrayBuffer();
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`standalone provider server did not become ready: ${lastError}`);
}

const requests = [];
const provider = await startProviderServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    requests.push({
      headers: request.headers,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8"))
    });
    const payload = {
      id: "chatcmpl-smoke",
      choices: [{
        message: {
          content: JSON.stringify({
            nodes: [{
              label: "Attention",
              type: "concept",
              confidence: 0.91,
              evidence: [{ text: "Attention uses context." }]
            }],
            edges: []
          })
        }
      }]
    };
    const content = JSON.stringify(payload);
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(content)
    });
    response.end(content);
  });
});

try {
  const configuration = resolveProviderConfiguration({
    EXTRACTOR_PROVIDER_URL: provider.endpoint,
    EXTRACTOR_PROVIDER_MODEL: "smoke-model",
    EXTRACTOR_PROVIDER_API_KEY: "smoke-provider-key"
  });
  assert.equal(configuration.configured, true);
  assert.equal(configuration.model, "smoke-model");
  assert.throws(
    () => resolveProviderConfiguration({
      EXTRACTOR_PROVIDER_URL: "http://provider.example.test/v1/chat/completions",
      EXTRACTOR_PROVIDER_MODEL: "smoke-model"
    }, { requireSecure: true }),
    /HTTPS/
  );

  const extractor = createProviderExtractor({
    ...configuration,
    fetchImpl: globalThis.fetch
  });
  const result = await extractor({
    document: {
      title: "Smoke document",
      text: "Attention uses context. This document is long enough for the provider contract."
    },
    feedback: [{
      kind: "concept",
      id: "attention",
      label: "Attention",
      status: "accepted"
    }]
  });
  assert.equal(result.nodes[0].label, "Attention");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.authorization, "Bearer smoke-provider-key");
  assert.equal(requests[0].body.model, "smoke-model");
  assert.equal(requests[0].body.temperature, 0);
  assert.equal(requests[0].body.response_format.type, "json_object");
  assert.equal(requests[0].body.messages.length, 2);
  assert.match(requests[0].body.messages[1].content, /Attention uses context/);
  assert.match(requests[0].body.messages[0].content, /untrusted source material/);

  const gatewayPort = await allocatePort();
  const gatewayUrl = `http://127.0.0.1:${gatewayPort}`;
  const gateway = spawn(process.execPath, ["server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(gatewayPort),
      PUBLIC_ORIGIN: gatewayUrl,
      EXTRACTOR_PROVIDER_URL: provider.endpoint,
      EXTRACTOR_PROVIDER_MODEL: "smoke-model",
      EXTRACTOR_PROVIDER_API_KEY: "smoke-provider-key",
      BUILD_REVISION: "unknown"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let gatewayOutput = "";
  gateway.stdout.on("data", (chunk) => { gatewayOutput += chunk.toString(); });
  gateway.stderr.on("data", (chunk) => { gatewayOutput += chunk.toString(); });
  try {
    await waitForReady(gatewayUrl, gateway);
    const gatewayResponse = await fetch(`${gatewayUrl}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        operation: "extract-graph",
        schema: "llm-field-notes/graph@1",
        feedbackFormat: "llm-field-notes/feedback@1",
        feedback: [],
        document: {
          title: "Standalone provider wiring",
          text: "Attention uses context. This document verifies standalone provider wiring."
        }
      })
    });
    const gatewayBody = await gatewayResponse.text();
    assert.equal(gatewayResponse.status, 200, gatewayBody);
    const gatewayPayload = JSON.parse(gatewayBody);
    assert.equal(gatewayPayload.extraction.nodes[0].label, "Attention");
    assert.match(gatewayOutput, /"extractor":"model-provider"/, "standalone startup should select the configured model provider");
  } finally {
    gateway.kill("SIGTERM");
    await new Promise((resolve) => {
      if (gateway.exitCode !== null) resolve();
      else gateway.once("exit", resolve);
    });
  }

  const slowProvider = await startProviderServer((_request, response) => {
    response.writeHead(200, {
      "content-type": "application/json",
      "content-length": "2"
    });
    setTimeout(() => response.end("{}"), 500);
  });
  try {
    const slowExtractor = createProviderExtractor({
      endpoint: slowProvider.endpoint,
      model: "smoke-model",
      timeoutMs: 100
    });
    await assert.rejects(
      () => slowExtractor({
        document: {
          title: "Slow provider",
          text: "Attention uses context. This document is long enough for the timeout contract."
        }
      }),
      (error) => error?.code === "PROVIDER_TIMEOUT",
      "a provider body that stalls after headers should be classified as a timeout"
    );
  } finally {
    await new Promise((resolve) => slowProvider.server.close(resolve));
  }
  console.log("provider adapter smoke ok");
} finally {
  await new Promise((resolve) => provider.server.close(resolve));
}
