import assert from "node:assert/strict";
import { parseContainerConfig } from "../scripts/smoke-container.mjs";

const defaults = parseContainerConfig({});
assert.equal(defaults.image, "llm-field-notes:local-smoke");
assert.equal(defaults.port, 0);
assert.equal(defaults.skipBuild, false);
assert.equal(defaults.version, "0.1.0");
assert.equal(defaults.revision, "abcdef1234567890");

const configured = parseContainerConfig({
  CONTAINER_IMAGE: "llm-field-notes:release",
  CONTAINER_PORT: "18002",
  CONTAINER_EXPECTED_VERSION: "1.2.3",
  CONTAINER_EXPECTED_REVISION: "abcdef1234567890",
  CONTAINER_SKIP_BUILD: "1",
  CONTAINER_EXTRACTOR_TOKEN: "extractor-secret",
  CONTAINER_METRICS_TOKEN: "metrics-secret"
});
assert.deepEqual(configured, {
  image: "llm-field-notes:release",
  port: 18002,
  revision: "abcdef1234567890",
  version: "1.2.3",
  source: "https://github.com/humblemat810/llm-wiki",
  documentation: "https://github.com/humblemat810/llm-wiki/blob/main/RUNBOOK.md",
  skipBuild: true,
  extractorToken: "extractor-secret",
  metricsToken: "metrics-secret"
});
assert.equal(parseContainerConfig({ CONTAINER_PORT: "70000" }).port, 0);
assert.throws(
  () => parseContainerConfig({ CONTAINER_EXPECTED_REVISION: "not-a-revision" }),
  /7–64 hexadecimal/,
  "container smoke should reject revisions the server would treat as unknown"
);

console.log("container smoke config ok");
