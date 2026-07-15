import assert from "node:assert/strict";
import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const packageManifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const DEFAULT_IMAGE = "llm-field-notes:local-smoke";
const DEFAULT_REVISION = "abcdef1234567890";
const DEFAULT_EXTRACTOR_TOKEN = "container-smoke-extractor-token";
const DEFAULT_METRICS_TOKEN = "container-smoke-metrics-token";
const EXPECTED_SOURCE = "https://github.com/humblemat810/llm-wiki";
const EXPECTED_DOCUMENTATION = "https://github.com/humblemat810/llm-wiki/blob/main/RUNBOOK.md";
const MAX_DIAGNOSTIC_LOG_BYTES = 64 * 1024;

export function parseContainerConfig(environment = process.env) {
  const port = Number(environment.CONTAINER_PORT || 0);
  const image = typeof environment.CONTAINER_IMAGE === "string" && environment.CONTAINER_IMAGE.trim()
    ? environment.CONTAINER_IMAGE.trim()
    : DEFAULT_IMAGE;
  const revision = typeof environment.CONTAINER_EXPECTED_REVISION === "string" && environment.CONTAINER_EXPECTED_REVISION.trim()
    ? environment.CONTAINER_EXPECTED_REVISION.trim()
    : DEFAULT_REVISION;
  const version = typeof environment.CONTAINER_EXPECTED_VERSION === "string" && environment.CONTAINER_EXPECTED_VERSION.trim()
    ? environment.CONTAINER_EXPECTED_VERSION.trim()
    : packageManifest.version;
  if (!/^(?:unknown|[0-9a-f]{7,64})$/i.test(revision) || revision === "unknown") {
    throw new Error("CONTAINER_EXPECTED_REVISION must be 7–64 hexadecimal characters.");
  }
  return {
    image,
    port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0,
    revision,
    version,
    skipBuild: environment.CONTAINER_SKIP_BUILD === "1",
    extractorToken: environment.CONTAINER_EXTRACTOR_TOKEN || DEFAULT_EXTRACTOR_TOKEN,
    metricsToken: environment.CONTAINER_METRICS_TOKEN || DEFAULT_METRICS_TOKEN
  };
}

const runDocker = (args, options = {}) => execFileSync("docker", args, {
  cwd: root,
  encoding: "utf8",
  stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit"
});

export function boundDiagnosticLog(value) {
  const bytes = Buffer.from(String(value || ""), "utf8");
  if (bytes.byteLength <= MAX_DIAGNOSTIC_LOG_BYTES) return bytes.toString("utf8");
  let start = bytes.byteLength - MAX_DIAGNOSTIC_LOG_BYTES;
  while (start < bytes.byteLength && (bytes[start] & 0xc0) === 0x80) start += 1;
  return bytes.subarray(start).toString("utf8");
}

const printContainerDiagnostics = (containerName) => {
  try {
    const logs = runDocker(["logs", "--tail", "200", containerName], { quiet: true }).trim();
    if (logs) console.error(boundDiagnosticLog(logs));
  } catch {
    console.error("container diagnostics were unavailable");
  }
};

const allocatePort = async () => {
  const probe = createServer();
  await new Promise((resolveListen, rejectListen) => {
    probe.once("error", rejectListen);
    probe.listen(0, "127.0.0.1", resolveListen);
  });
  const port = probe.address().port;
  await new Promise((resolveClose) => probe.close(resolveClose));
  return port;
};

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const requestBody = (title) => JSON.stringify({
  operation: "extract-graph",
  schema: "llm-field-notes/graph@1",
  feedbackFormat: "llm-field-notes/feedback@1",
  feedback: [],
  document: {
    title,
    text: "Attention uses context to create a useful graph representation for review."
  }
});

export async function smokeContainer(environment = process.env) {
  const config = parseContainerConfig(environment);
  const port = config.port || await allocatePort();
  const containerName = `llm-field-notes-smoke-${process.pid}`;
  const baseUrl = `http://127.0.0.1:${port}`;
  let containerStarted = false;
  try {
    if (!config.skipBuild) {
      runDocker([
        "build",
        "--build-arg", `APP_VERSION=${config.version}`,
        "--build-arg", `VCS_REF=${config.revision}`,
        "--tag", config.image,
        "."
      ]);
    }
    assert.equal(
      runDocker(["image", "inspect", "--format", "{{.Config.User}}", config.image], { quiet: true }).trim(),
      "node",
      "container must run as the non-root node user"
    );
    assert.equal(
      runDocker(["image", "inspect", "--format", "{{.Config.StopSignal}}", config.image], { quiet: true }).trim(),
      "SIGTERM",
      "container must preserve graceful SIGTERM shutdown"
    );
    assert.equal(
      runDocker(["image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.version\"}}", config.image], { quiet: true }).trim(),
      config.version,
      "container version metadata must match the expected release"
    );
    assert.equal(
      runDocker(["image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.revision\"}}", config.image], { quiet: true }).trim(),
      config.revision,
      "container revision metadata must match the expected source"
    );
    assert.equal(
      runDocker(["image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.source\"}}", config.image], { quiet: true }).trim(),
      EXPECTED_SOURCE,
      "container source metadata must identify the repository"
    );
    assert.equal(
      runDocker(["image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.documentation\"}}", config.image], { quiet: true }).trim(),
      EXPECTED_DOCUMENTATION,
      "container documentation metadata must identify the runbook"
    );
    runDocker(["run", "--rm", "--entrypoint", "sh", config.image, "-c", "test ! -e /app/benchmarks && test ! -e /app/tests && test ! -e /app/scripts/check-runtime.mjs && test ! -e /app/scripts/smoke-container.mjs && test ! -e /app/scripts/load-server.mjs && test -f /app/scripts/public-assets.mjs && test -f /app/experiments/verify-backup.mjs"]);
    runDocker([
      "run", "--read-only", "--tmpfs", "/tmp", "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--env", `PUBLIC_ORIGIN=${baseUrl}`,
      "--env", `EXTRACTOR_AUTH_TOKEN=${config.extractorToken}`,
      "--env", `METRICS_AUTH_TOKEN=${config.metricsToken}`,
      "--detach", "--name", containerName, "--publish", `${port}:8000`, config.image
    ]);
    containerStarted = true;
    const capDrop = runDocker(["inspect", "--format", "{{json .HostConfig.CapDrop}}", containerName], { quiet: true }).trim();
    assert.match(capDrop, /ALL/, "container must drop all Linux capabilities");
    const securityOptions = runDocker(["inspect", "--format", "{{json .HostConfig.SecurityOpt}}", containerName], { quiet: true }).trim();
    assert.match(securityOptions, /no-new-privileges/, "container must disable privilege escalation");

    let ready = false;
    let lastReadinessError = "unknown readiness failure";
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetchWithTimeout(`${baseUrl}/readyz`);
        if (response.ok) {
          ready = true;
          break;
        }
        lastReadinessError = `HTTP ${response.status}`;
        await response.arrayBuffer();
      } catch (error) {
        lastReadinessError = error.message;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
    if (!ready) {
      throw new Error(`container did not become ready: ${lastReadinessError}`);
    }
    const readiness = await fetchWithTimeout(`${baseUrl}/readyz`);
    const readinessPayload = await readiness.json();
    assert.equal(readinessPayload.version, config.version);
    assert.equal(readinessPayload.revision, config.revision);
    runDocker([
      "exec", containerName, "sh", "-c",
      "test ! -w /app && touch /tmp/container-smoke-write-test && rm -f /tmp/container-smoke-write-test"
    ]);

    const unauthorized = await fetchWithTimeout(`${baseUrl}/api/extract-graph`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody("Unauthenticated container smoke")
    });
    assert.equal(unauthorized.status, 401);
    await unauthorized.arrayBuffer();

    const authenticated = await fetchWithTimeout(`${baseUrl}/api/extract-graph`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.extractorToken}`,
        "content-type": "application/json"
      },
      body: requestBody("Authenticated container smoke")
    });
    assert.equal(authenticated.status, 200);
    const authenticatedPayload = await authenticated.json();
    assert.equal(authenticatedPayload.schema, "llm-field-notes/graph@1");

    const unauthorizedMetrics = await fetchWithTimeout(`${baseUrl}/metrics`);
    assert.equal(unauthorizedMetrics.status, 401);
    await unauthorizedMetrics.arrayBuffer();
    const authenticatedMetrics = await fetchWithTimeout(`${baseUrl}/metrics`, {
      headers: { authorization: `Bearer ${config.metricsToken}` }
    });
    assert.equal(authenticatedMetrics.status, 200);
    assert.match(await authenticatedMetrics.text(), /llm_field_notes_http_requests_total/);

    let healthy = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (runDocker(["inspect", "--format", "{{.State.Health.Status}}", containerName], { quiet: true }).trim() === "healthy") {
        healthy = true;
        break;
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
    }
    if (!healthy) {
      runDocker(["inspect", "--format", "{{json .State.Health}}", containerName]);
      throw new Error("container Docker health check did not become healthy");
    }

    runDocker(["stop", "--timeout", "5", containerName]);
    const exitCode = runDocker(["inspect", "--format", "{{.State.ExitCode}}", containerName], { quiet: true }).trim();
    assert.equal(exitCode, "0", "container must exit cleanly after SIGTERM");
    containerStarted = false;
    return { image: config.image, port, version: config.version, revision: config.revision };
  } catch (error) {
    if (containerStarted) printContainerDiagnostics(containerName);
    throw error;
  } finally {
    if (containerStarted) runDocker(["rm", "--force", containerName], { quiet: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await smokeContainer();
    console.log(`container smoke ok: ${result.image} ${result.version} ${result.revision}`);
  } catch (error) {
    console.error(`container smoke failed: ${error.message}`);
    process.exitCode = 1;
  }
}
