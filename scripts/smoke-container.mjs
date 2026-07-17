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
    ? environment.CONTAINER_EXPECTED_REVISION.trim().toLowerCase()
    : DEFAULT_REVISION;
  const version = typeof environment.CONTAINER_EXPECTED_VERSION === "string" && environment.CONTAINER_EXPECTED_VERSION.trim()
    ? environment.CONTAINER_EXPECTED_VERSION.trim()
    : packageManifest.version;
  const source = typeof environment.CONTAINER_EXPECTED_SOURCE === "string" && environment.CONTAINER_EXPECTED_SOURCE.trim()
    ? environment.CONTAINER_EXPECTED_SOURCE.trim()
    : EXPECTED_SOURCE;
  const documentation = typeof environment.CONTAINER_EXPECTED_DOCUMENTATION === "string" && environment.CONTAINER_EXPECTED_DOCUMENTATION.trim()
    ? environment.CONTAINER_EXPECTED_DOCUMENTATION.trim()
    : EXPECTED_DOCUMENTATION;
  if (!/^(?:unknown|[0-9a-f]{7,64})$/i.test(revision) || revision === "unknown") {
    throw new Error("CONTAINER_EXPECTED_REVISION must be 7–64 hexadecimal characters.");
  }
  return {
    image,
    port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0,
    revision,
    version,
    source,
    documentation,
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

export function formatReadinessFailure(status, body) {
  let detail = "";
  try {
    const payload = JSON.parse(boundDiagnosticLog(body));
    if (typeof payload?.error === "string" && payload.error.trim()) {
      detail = payload.error.trim().slice(0, 256);
    }
  } catch {
    // Keep the status-only diagnostic for non-JSON readiness responses.
  }
  return `HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

export async function readBoundedResponseBody(response, maxBytes = MAX_DIAGNOSTIC_LOG_BYTES) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    return boundDiagnosticLog(await response.text());
  }
  const chunks = [];
  let totalBytes = 0;
  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const remainingBytes = maxBytes - totalBytes;
      const chunk = value.subarray(0, remainingBytes);
      chunks.push(chunk);
      totalBytes += chunk.byteLength;
      if (chunk.byteLength < value.byteLength) {
        await reader.cancel();
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
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
        "--build-arg", `PUBLIC_REPOSITORY_URL=${config.source}`,
        "--build-arg", `PUBLIC_DOCUMENTATION_URL=${config.documentation}`,
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
    const imageEnvironment = runDocker(["image", "inspect", "--format", "{{json .Config.Env}}", config.image], { quiet: true }).trim();
    assert.match(imageEnvironment, /"NODE_ENV=production"/, "container must bake the production Node environment");
    assert.doesNotMatch(imageEnvironment, /EXTRACTOR_AUTH_TOKEN|METRICS_AUTH_TOKEN/, "container image metadata must not bake authentication secrets");
    const imageHealthcheck = runDocker(["image", "inspect", "--format", "{{json .Config.Healthcheck.Test}}", config.image], { quiet: true }).trim();
    assert.match(imageHealthcheck, /\/readyz/, "container image must retain its readiness healthcheck");
    assert.match(imageHealthcheck, /parseConfiguredBoundedInteger/, "container healthcheck must reuse the server's bounded configuration parser");
    assert.match(imageHealthcheck, /setting\.valid/, "container healthcheck must fail closed on invalid runtime configuration");
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
      config.source,
      "container source metadata must identify the repository"
    );
    assert.equal(
      runDocker(["image", "inspect", "--format", "{{index .Config.Labels \"org.opencontainers.image.documentation\"}}", config.image], { quiet: true }).trim(),
      config.documentation,
      "container documentation metadata must identify the runbook"
    );
    runDocker(["run", "--rm", "--entrypoint", "sh", config.image, "-c", "test ! -e /app/.git && test ! -e /app/.codex && test ! -e /app/.env && test ! -e /app/node_modules && test ! -e /app/benchmarks && test ! -e /app/tests && test ! -e /app/backups && test ! -e /app/exports && test ! -e /app/sbom.spdx.json && test ! -e /app/scripts/check-runtime.mjs && test ! -e /app/scripts/smoke-container.mjs && test ! -e /app/scripts/load-server.mjs && test -f /app/experiments/tiny-training.mjs && test -f /app/scripts/public-assets.mjs && test -f /app/scripts/sample-graph-page.mjs && test -f /app/scripts/verify-share.mjs && test -f /app/experiments/verify-backup.mjs"]);
    runDocker([
      "run", "--read-only", "--tmpfs", "/tmp", "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      // The container serves plain HTTP directly; the HTTPS logical origin
      // keeps the production-mode origin contract honest while this probe
      // exercises the service behind the TLS gateway boundary used in real
      // deployments.
      "--env", `PUBLIC_ORIGIN=https://127.0.0.1:${port}`,
      "--env", `PUBLIC_REPOSITORY_URL=${config.source}`,
      "--env", `EXTRACTOR_AUTH_TOKEN=${config.extractorToken}`,
      "--env", `METRICS_AUTH_TOKEN=${config.metricsToken}`,
      "--detach", "--name", containerName, "--publish", `${port}:8000`, config.image
    ]);
    containerStarted = true;
    assert.equal(
      runDocker(["inspect", "--format", "{{.HostConfig.ReadonlyRootfs}}", containerName], { quiet: true }).trim(),
      "true",
      "container must record a read-only root filesystem"
    );
    const tmpfsMounts = runDocker(["inspect", "--format", "{{json .HostConfig.Tmpfs}}", containerName], { quiet: true }).trim();
    assert.match(tmpfsMounts, /"\/tmp"/, "container must provide the bounded writable /tmp mount");
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
        const body = await readBoundedResponseBody(response);
        lastReadinessError = formatReadinessFailure(response.status, body);
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
    const liveness = await fetchWithTimeout(`${baseUrl}/livez`);
    assert.equal(liveness.status, 200, "container liveness should remain available independently of readiness");
    assert.equal((await liveness.json()).live, true, "container liveness should expose the liveness contract");
    const securityMetadata = await fetchWithTimeout(`${baseUrl}/.well-known/security.txt`);
    const securityText = await securityMetadata.text();
    assert.equal(securityMetadata.status, 200);
    assert(securityText.includes(`Contact: ${config.source}/security/advisories/new`)
      && securityText.includes(`Policy: ${config.source}/blob/main/SECURITY.md`)
      && securityText.includes(`Canonical: ${config.source}/blob/main/.well-known/security.txt`), "container security metadata must target the configured repository");
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
    runDocker(["rm", containerName], { quiet: true });
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
    // Native fetch may retain an idle undici connection after every response
    // body has been consumed. This is a standalone probe, not a long-lived
    // service, so terminate explicitly after the container is fully stopped.
    process.exit(0);
  } catch (error) {
    console.error(`container smoke failed: ${error.message}`);
    process.exit(1);
  }
}
