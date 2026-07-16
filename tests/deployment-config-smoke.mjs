import assert from "node:assert/strict";
import { checkDeploymentConfig } from "../scripts/check-deployment-config.mjs";

const local = checkDeploymentConfig({});
assert.equal(local.ok, true, "empty configuration should remain valid for loopback development");
assert.equal(local.mode, "loopback-development");
assert(local.warnings.some((warning) => warning.includes("EXTRACTOR_AUTH_TOKEN")), "loopback development should disclose open extraction");
assert.equal(checkDeploymentConfig({ PUBLIC_ORIGIN: "http://localhost:8000" }).ok, true, "loopback development should explicitly allow a loopback HTTP origin");
const proxiedProduction = checkDeploymentConfig({
  HOST: "127.0.0.1",
  PUBLIC_ORIGIN: "https://wiki.example.test",
  BUILD_REVISION: "unknown"
});
assert.equal(proxiedProduction.mode, "non-loopback-production", "an externally visible origin should mark a loopback-bound process as production");
assert(proxiedProduction.errors.some((error) => error.includes("EXTRACTOR_AUTH_TOKEN"))
  && proxiedProduction.errors.some((error) => error.includes("METRICS_AUTH_TOKEN"))
  && proxiedProduction.errors.some((error) => error.includes("BUILD_REVISION")), "proxied production should require the same identity and authentication boundary");

const production = checkDeploymentConfig({
  HOST: "0.0.0.0",
  PORT: "8000",
  EXTRACTOR_RATE_LIMIT: "60",
  EXTRACTOR_TIMEOUT_MS: "120000",
  EXTRACTOR_CONCURRENCY: "8",
  TRUST_PROXY_HOPS: "1",
  PUBLIC_ORIGIN: "https://wiki.example.test/field-notes",
  PUBLIC_REPOSITORY_URL: "https://github.com/example/field-notes",
  BUILD_REVISION: "abcdef1234567890",
  EXTRACTOR_AUTH_TOKEN: "extractor-token-1234",
  METRICS_AUTH_TOKEN: "metrics-token-1234"
});
assert.equal(production.ok, true, "complete non-loopback configuration should pass");
assert.equal(production.mode, "non-loopback-production");
assert.equal(production.settings.TRUST_PROXY_HOPS, 1);

assert.equal(checkDeploymentConfig({
  HOST: "0.0.0.0",
  PUBLIC_ORIGIN: "http://wiki.example.test",
  BUILD_REVISION: "unknown",
  EXTRACTOR_AUTH_TOKEN: "short",
  METRICS_AUTH_TOKEN: "short"
}).ok, false, "non-loopback configuration should fail closed without secure identity metadata and secrets");

assert(checkDeploymentConfig({
  HOST: "0.0.0.0",
  PUBLIC_ORIGIN: "http://localhost:8000",
  BUILD_REVISION: "abcdef1234567890",
  EXTRACTOR_AUTH_TOKEN: "extractor-token-1234",
  METRICS_AUTH_TOKEN: "metrics-token-1234"
}).errors.some((error) => error.includes("HTTPS")), "non-loopback deployments must not weaken the origin boundary with a loopback HTTP origin");

assert(checkDeploymentConfig({
  HOST: "0.0.0.0",
  PUBLIC_ORIGIN: "https://wiki.example.test",
  BUILD_REVISION: "abcdef1234567890",
  EXTRACTOR_AUTH_TOKEN: "extractor-token-1234",
  METRICS_AUTH_TOKEN: "metrics-token-1234",
  EXTRACTOR_CONCURRENCY: "not-a-number"
}).errors.some((error) => error.includes("EXTRACTOR_CONCURRENCY")), "malformed numeric configuration should be identified before startup");

console.log("deployment config smoke ok");
