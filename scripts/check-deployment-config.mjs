import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  isLoopbackPublicOrigin,
  isUsableAuthToken,
  parseConfiguredBoundedInteger,
  parseTrustedProxyHops
} from "../server.mjs";
import { requirePublicOrigin } from "./public-origin.mjs";
import { requirePublicRepository } from "./public-repository.mjs";
import { resolveProviderConfiguration } from "../provider-adapter.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const DEPLOYMENT_MODES = new Set(["server", "static-pages"]);
const SETTINGS = [
  ["PORT", { defaultValue: 8000, max: 65535 }, "1 to 65535"],
  ["EXTRACTOR_RATE_LIMIT", { defaultValue: 60, max: 1000000 }, "1 to 1000000"],
  ["EXTRACTOR_TIMEOUT_MS", { defaultValue: 120000, max: 120000 }, "1 to 120000"],
  ["EXTRACTOR_CONCURRENCY", { defaultValue: 8, max: 1024 }, "1 to 1024"]
];

function configuredString(environment, name) {
  return typeof environment[name] === "string" ? environment[name].trim() : "";
}

function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(host.toLowerCase());
}

function validRevision(value) {
  return /^(?:unknown|[0-9a-f]{7,64})$/i.test(value);
}

export function checkDeploymentConfig(environment = process.env) {
  const errors = [];
  const warnings = [];
  const deploymentMode = configuredString(environment, "DEPLOYMENT_MODE") || "server";
  if (!DEPLOYMENT_MODES.has(deploymentMode)) {
    errors.push("DEPLOYMENT_MODE must be server or static-pages when configured.");
  }
  const staticPages = deploymentMode === "static-pages";
  const host = configuredString(environment, "HOST") || "127.0.0.1";
  const loopbackHost = isLoopbackHost(host);
  const settings = {};

  if (!staticPages) {
    for (const [name, options, range] of SETTINGS) {
      const setting = parseConfiguredBoundedInteger(name, environment[name], options);
      settings[name] = setting.value;
      if (!setting.valid) errors.push(`${name} must be an integer from ${range} when configured.`);
    }
  }

  if (!staticPages) {
    const proxy = parseTrustedProxyHops(environment.TRUST_PROXY_HOPS);
    settings.TRUST_PROXY_HOPS = proxy.value;
    if (!proxy.valid) errors.push("TRUST_PROXY_HOPS must be an integer from 0 to 8 when configured.");
  }

  const publicOrigin = configuredString(environment, "PUBLIC_ORIGIN");
  const publicOriginIsLoopback = !publicOrigin || isLoopbackPublicOrigin(publicOrigin);
  const loopback = loopbackHost && publicOriginIsLoopback;
  if (publicOrigin) {
    try {
      requirePublicOrigin(publicOrigin, { requireSecure: true, allowLoopbackHttp: !staticPages && loopback });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "PUBLIC_ORIGIN is invalid.");
    }
  } else if (staticPages) {
    errors.push("PUBLIC_ORIGIN must be configured for a static-pages deployment.");
  } else if (!loopback) {
    errors.push("PUBLIC_ORIGIN must be configured for a non-loopback deployment.");
  }

  const repository = configuredString(environment, "PUBLIC_REPOSITORY_URL");
  if (repository) {
    try {
      requirePublicRepository(repository);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "PUBLIC_REPOSITORY_URL is invalid.");
    }
  } else if (!loopback) {
    warnings.push("PUBLIC_REPOSITORY_URL is not configured; the default repository metadata will be used.");
  }

  const revision = configuredString(environment, "BUILD_REVISION") || "unknown";
  if (!validRevision(revision)) errors.push("BUILD_REVISION must be unknown or a 7–64 character hexadecimal source revision.");
  if ((staticPages || !loopback) && revision === "unknown") {
    errors.push(`BUILD_REVISION must identify the source commit for a ${staticPages ? "static-pages" : "non-loopback"} deployment.`);
  }

  if (!staticPages) {
    try {
      const provider = resolveProviderConfiguration(environment, { requireSecure: !loopback });
      if (provider.configured) settings.EXTRACTOR_PROVIDER = `${provider.model} @ ${new URL(provider.endpoint).origin}`;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Model provider configuration is invalid.");
    }

    for (const [name, label] of [
      ["EXTRACTOR_AUTH_TOKEN", "EXTRACTOR_AUTH_TOKEN"],
      ["METRICS_AUTH_TOKEN", "METRICS_AUTH_TOKEN"]
    ]) {
      const token = environment[name] ?? "";
      if (!isUsableAuthToken(token)) {
        if (loopback && !token) warnings.push(`${label} is unset; ${label === "EXTRACTOR_AUTH_TOKEN" ? "extraction" : "metrics"} remains open for loopback development.`);
        else errors.push(`${label} must be 16–4096 characters with no surrounding whitespace or control characters.`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    mode: staticPages ? "static-pages" : loopback ? "loopback-development" : "non-loopback-production",
    host,
    settings,
    errors,
    warnings
  };
}

function main() {
  const result = checkDeploymentConfig();
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.ok) {
    for (const error of result.errors) console.error(`error: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`deployment config ok: ${result.mode} (${result.host})`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
