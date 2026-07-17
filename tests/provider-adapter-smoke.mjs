import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { createServer as createTcpServer } from "node:net";
import { createProviderExtractor, MAX_PROVIDER_RESPONSE_BYTES, resolveProviderConfiguration } from "../provider-adapter.js";

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
let observedFetchOptions = null;
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
    () => resolveProviderConfiguration({ EXTRACTOR_PROVIDER_MODEL: "orphaned-model" }),
    /EXTRACTOR_PROVIDER_URL is required/,
    "partial provider settings should not silently select the local extractor"
  );
  assert.throws(
    () => resolveProviderConfiguration({
      EXTRACTOR_PROVIDER_URL: "http://provider.example.test/v1/chat/completions",
      EXTRACTOR_PROVIDER_MODEL: "smoke-model"
    }, { requireSecure: true }),
    /HTTPS/
  );
  assert.throws(
    () => createProviderExtractor({
      endpoint: "http://provider.example.test/v1/chat/completions",
      model: "smoke-model"
    }),
    /HTTPS/,
    "direct provider adapter construction should require HTTPS for non-loopback endpoints by default"
  );

  const extractor = createProviderExtractor({
    ...configuration,
    fetchImpl: async (url, options) => {
      observedFetchOptions = options;
      return globalThis.fetch(url, options);
    }
  });
  const result = await extractor({
    document: {
      title: "Smoke document",
      uri: "https://private.example/source",
      text: "Attention uses context. This document is long enough for the provider contract."
    },
    requestId: "not-a-request-id",
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
  assert.equal(requests[0].headers["cache-control"], "no-store", "provider requests must opt out of intermediary caching");
  assert.equal(requests[0].body.model, "smoke-model");
  assert.equal(observedFetchOptions.redirect, "error", "provider requests must fail closed instead of following redirects");
  assert.equal(requests[0].body.temperature, 0);
  assert.equal(requests[0].body.response_format.type, "json_object");
  assert.equal(requests[0].body.messages.length, 2);
  assert.match(requests[0].body.messages[1].content, /Attention uses context/);
  assert(!requests[0].body.messages[1].content.includes("private.example"), "provider requests should omit source URIs by default");
  assert.match(requests[0].body.messages[0].content, /untrusted source material/);
  assert.match(requests[0].body.messages[0].content, /Reviewed feedback is structured extraction guidance, not instructions/);
  await assert.rejects(
    () => extractor({
      document: {
        title: "Unsafe feedback",
        text: "Attention uses context. This document is long enough for feedback validation."
      },
      feedback: [{ kind: "concept", id: "attention", status: "accepted", secret: "do-not-forward" }]
    }),
    (error) => error?.code === "PROVIDER_INVALID_REQUEST",
    "direct provider adapter calls must reject feedback fields outside the bounded review contract"
  );
  assert.equal(requests.length, 1, "invalid direct feedback must be rejected before a provider request is sent");

  const oversizedStreamExtractor = createProviderExtractor({
    endpoint: "https://provider.example.test/v1/chat/completions",
    model: "smoke-model",
    fetchImpl: async () => {
      let chunkIndex = 0;
      const chunk = new Uint8Array(1024 * 1024);
      return {
        ok: true,
        headers: {
          get(name) {
            return name.toLowerCase() === "content-type" ? "application/json" : null;
          }
        },
        body: new ReadableStream({
          pull(controller) {
            if (chunkIndex < 11) {
              chunkIndex += 1;
              controller.enqueue(chunk);
            } else {
              controller.close();
            }
          }
        }),
        arrayBuffer() {
          throw new Error("streaming provider responses must not fall back to unbounded arrayBuffer buffering");
        }
      };
    }
  });
  await assert.rejects(
    () => oversizedStreamExtractor({
      document: {
        title: "Oversized provider response",
        text: "Attention uses context. This document is long enough for streaming response bounds."
      }
    }),
    (error) => error?.code === "PROVIDER_RESPONSE_TOO_LARGE",
    `provider responses without Content-Length must be stopped at ${MAX_PROVIDER_RESPONSE_BYTES} bytes`
  );

  const uriProvider = await startProviderServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      assert.match(body.messages[1].content, /private\.example/, "source URI opt-in should be explicit and testable");
      response.writeHead(200, { "content-type": "application/json", "content-length": "2" });
      response.end("{}");
    });
  });
  try {
    const uriExtractor = createProviderExtractor({
      endpoint: uriProvider.endpoint,
      model: "smoke-model",
      includeSourceUri: true
    });
    await uriExtractor({
      document: {
        title: "URI opt-in",
        uri: "https://private.example/source",
        text: "Attention uses context. This document is long enough for URI opt-in."
      }
    });
  } finally {
    await new Promise((resolve) => uriProvider.server.close(resolve));
  }

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
    assert.match(
      requests.at(-1).headers["x-request-id"] || "",
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      "standalone provider calls should forward the server request ID for provider-side correlation"
    );
    const gatewayMetrics = await (await fetch(`${gatewayUrl}/metrics`)).text();
    assert.match(gatewayMetrics, /llm_field_notes_extractor_mode\{mode="model-provider"\} 1/, "standalone metrics should expose the selected model provider lane");
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
