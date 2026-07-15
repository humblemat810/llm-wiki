import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const packageManifest = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const activeCache = `llm-field-notes-v${packageManifest.version}`;
const location = new URL("https://notes.example.test/wiki/sw.js");
const handlers = new Map();
const entries = new Map();
const deletedKeys = [];
let cacheWritable = true;
let cacheReadable = true;
let cacheDeleteFailure = false;
const shellCache = {
  async addAll(assets) {
    for (const asset of assets) {
      const url = new URL(asset, location).toString();
      entries.set(url, new Response(`cached:${url}`, { status: 200 }));
    }
  },
  async put(request, response) {
    if (!cacheWritable) throw new Error("cache quota");
    entries.set(typeof request === "string" ? new URL(request, location).toString() : request.url, response);
  },
  async match(request) {
    const cached = entries.get(typeof request === "string" ? new URL(request, location).toString() : request.url);
    return cached?.clone?.() || cached || null;
  }
};
const cachesApi = {
  async open() {
    if (!cacheReadable) throw new Error("cache unavailable");
    return shellCache;
  },
  async match() {
    return new Response("foreign-cache-response", { status: 200 });
  },
  async keys() {
    return ["llm-field-notes-v1", "llm-field-notes-v2", "llm-field-notes-v3", "llm-field-notes-v4", "llm-field-notes-v5", "llm-field-notes-v6", "llm-field-notes-v7", "llm-field-notes-v8", "llm-field-notes-v9", "other-application-cache", activeCache];
  },
  async delete(key) {
    if (cacheDeleteFailure) throw new Error("cache delete unavailable");
    deletedKeys.push(key);
    return key !== activeCache;
  }
};
let online = true;
let hanging = false;
let networkStatus = 200;
let stalledBody = false;
let stalledBodyCancel = false;
let malformedBody = false;
let crossOriginResponse = false;
let opaqueResponse = false;
let htmlForAssetResponse = false;
let declaredResponseLength = null;
let bodyUnavailable = false;
let networkCalls = 0;
let lastFetchOptions = null;
let claimCalls = 0;
let skipWaitingCalls = 0;
let precacheMode = false;
let precacheActive = 0;
let maxPrecacheActive = 0;
const context = {
  URL,
  Request,
  Set,
  Response,
  ReadableStream,
  TextEncoder,
  AbortController,
  setTimeout,
  clearTimeout,
  console,
  caches: cachesApi,
  fetch: async (request, options) => {
    networkCalls += 1;
    lastFetchOptions = options;
    if (precacheMode) {
      precacheActive += 1;
      maxPrecacheActive = Math.max(maxPrecacheActive, precacheActive);
      await new Promise((resolve) => setTimeout(resolve, 1));
      precacheActive -= 1;
    }
    if (hanging) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error("network timeout")), { once: true });
      });
    }
    if (!online) throw new Error("offline");
    if (opaqueResponse) {
      const response = new Response(`opaque:${request.url}`, { status: 200 });
      Object.defineProperty(response, "type", { value: "opaque" });
      return response;
    }
    if (htmlForAssetResponse) {
      return new Response("<!doctype html><title>Login</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
    if (crossOriginResponse) {
      const response = new Response(`foreign:${request.url}`, { status: 200 });
      Object.defineProperty(response, "url", { value: "https://evil.example.test/app.js" });
      return response;
    }
    if (stalledBody) {
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`fresh:${request.url}`));
        },
        cancel() {
          if (stalledBodyCancel) return new Promise(() => {});
        }
      }), { status: networkStatus });
    }
    if (malformedBody) {
      const response = new Response(null, { status: networkStatus });
      Object.defineProperty(response, "body", {
        value: {
          getReader() {
            return {
              read: async () => ({ value: undefined, done: false }),
              cancel: async () => {},
              releaseLock: () => {}
            };
          }
        }
      });
      return response;
    }
    if (bodyUnavailable) return new Response(null, { status: networkStatus });
    return new Response(`fresh:${request.url}`, {
      status: networkStatus,
      headers: declaredResponseLength === null ? undefined : { "content-length": String(declaredResponseLength) }
    });
  },
  self: {
    location,
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    clients: { claim: async () => { claimCalls += 1; } },
    skipWaiting: async () => { skipWaitingCalls += 1; }
  }
};
context.globalThis = context;
vm.runInNewContext(source, context);

handlers.get("message")({ data: { type: "SKIP_WAITING" } });
assert.equal(skipWaitingCalls, 1, "the worker should accept an explicit user-approved activation message");

const installWaits = [];
precacheMode = true;
handlers.get("install")({ waitUntil(promise) { installWaits.push(promise); } });
await Promise.all(installWaits);
precacheMode = false;
assert(entries.has(new URL("./index.html", location).toString()), "install should precache the app shell");
assert(entries.has(new URL("./storage-adapter.js", location).toString()), "install should precache the storage adapter");
assert(entries.has(new URL("./evaluation.js", location).toString()), "install should precache the evaluator");
assert(entries.has(new URL("./SECURITY.md", location).toString()), "install should precache security guidance");
assert(entries.has(new URL("./social-card.svg", location).toString()), "install should precache the social share card");
assert(maxPrecacheActive > 1 && maxPrecacheActive <= 4, "shell precaching should use bounded parallelism");
const activateWaits = [];
handlers.get("activate")({ waitUntil(promise) { activateWaits.push(promise); } });
await Promise.all(activateWaits);
assert.equal(claimCalls, 1, "activation should claim clients before completing");
assert(["llm-field-notes-v1", "llm-field-notes-v2", "llm-field-notes-v3", "llm-field-notes-v4", "llm-field-notes-v5", "llm-field-notes-v6", "llm-field-notes-v7", "llm-field-notes-v8", "llm-field-notes-v9"].every((key) => deletedKeys.includes(key)), "activation should remove previous cache versions");
assert(!deletedKeys.includes("other-application-cache"), "activation should preserve unrelated origin caches");
assert(!deletedKeys.includes(activeCache), "activation should retain the current release cache");
cacheDeleteFailure = true;
const failedCleanupActivation = [];
handlers.get("activate")({ waitUntil(promise) { failedCleanupActivation.push(promise); } });
await Promise.all(failedCleanupActivation);
assert.equal(claimCalls, 2, "cache cleanup failures must not prevent the worker from claiming clients");
cacheDeleteFailure = false;

async function dispatchFetch(request) {
  let responsePromise;
  handlers.get("fetch")({
    request,
    respondWith(promise) {
      responsePromise = Promise.resolve(promise);
    }
  });
  return responsePromise;
}

const fresh = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert(fresh, "shell requests should be intercepted");
assert.equal(await fresh.text(), `fresh:${new URL("./app.js", location).toString()}`);
assert(networkCalls > 0, "online shell requests should prefer the network");
assert.equal(lastFetchOptions?.cache, "no-cache", "online shell requests should revalidate HTTP-cached assets");
const versionedFresh = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js?cache-bust=online", location).toString() });
assert.equal(await versionedFresh.text(), `fresh:${new URL("./app.js?cache-bust=online", location).toString()}`);
assert([...entries.keys()].every((key) => !key.includes("?")), "shell cache keys should ignore query strings to prevent duplicate cache growth");
assert.equal(await (await shellCache.match(new URL("./app.js", location).toString())).text(), `fresh:${new URL("./app.js", location).toString()}`, "query-bearing shell responses should not overwrite canonical cache content");

cacheWritable = false;
const freshWithCacheFailure = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./styles.css", location).toString() });
assert.equal(await freshWithCacheFailure.text(), `fresh:${new URL("./styles.css", location).toString()}`, "cache failures must not hide fresh network responses");
cacheWritable = true;

declaredResponseLength = 1;
const truncatedShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert.equal(await truncatedShell.text(), `fresh:${new URL("./app.js", location).toString()}`, "shell responses with mismatched Content-Length should fall back to the last complete cache entry");
declaredResponseLength = null;

networkStatus = 503;
const transientHttpFailure = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert.equal(await transientHttpFailure.text(), `fresh:${new URL("./app.js", location).toString()}`, "cached shell assets should survive transient non-OK network responses");
cacheReadable = false;
const cacheReadFailure = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert.equal(cacheReadFailure.status, 503, "cache read failures must preserve a non-OK network response instead of rejecting the fetch event");
assert.equal(await cacheReadFailure.text(), `fresh:${new URL("./app.js", location).toString()}`, "cache read failures must not discard the network response body");
cacheReadable = true;
networkStatus = 200;
networkStatus = 503;
const transientNavigationFailure = await dispatchFetch({ method: "GET", mode: "navigate", url: new URL("./unknown-transient-route", location).toString() });
assert.equal(await transientNavigationFailure.text(), `fresh:${new URL("./index.html", location).toString()}`, "navigations should fall back to the bounded cached app shell after transient non-OK responses");
networkStatus = 200;
bodyUnavailable = true;
networkStatus = 404;
const emptyNotFoundNavigation = await dispatchFetch({ method: "GET", mode: "navigate", url: new URL("./empty-missing-route", location).toString() });
assert.equal(emptyNotFoundNavigation.status, 404, "online empty-body 4xx navigations should remain client errors");
assert.equal(await emptyNotFoundNavigation.text(), "", "online empty-body 4xx responses should pass through without shell substitution");
bodyUnavailable = false;
networkStatus = 200;

const callsBeforeApi = networkCalls;
const apiResponse = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./healthz", location).toString() });
assert.equal(apiResponse, undefined, "API and health requests should bypass the service worker");
assert.equal(networkCalls, callsBeforeApi, "bypassed requests should not be fetched by the worker");

const unknownNavigationUrl = new URL("./unknown-successful-route", location);
const unknownNavigation = await dispatchFetch({ method: "GET", mode: "navigate", url: unknownNavigationUrl.toString() });
assert.equal(await unknownNavigation.text(), `fresh:${unknownNavigationUrl.toString()}`, "unknown navigations should still prefer a fresh network response");
assert(!entries.has(unknownNavigationUrl.toString()), "unknown navigations must not create unbounded service-worker cache entries");
networkStatus = 404;
const notFoundNavigationUrl = new URL("./missing-online-route", location);
const notFoundNavigation = await dispatchFetch({ method: "GET", mode: "navigate", url: notFoundNavigationUrl.toString() });
assert.equal(notFoundNavigation.status, 404, "online client-error navigations should preserve the deployed not-found response");
assert.equal(await notFoundNavigation.text(), `fresh:${notFoundNavigationUrl.toString()}`, "online not-found responses should not be replaced by the cached workbench shell");
networkStatus = 200;

online = false;
const offlineShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert.equal(await offlineShell.text(), `fresh:${new URL("./app.js", location).toString()}`, "offline shell requests should use the updated cache");
const offlineVersionedShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js?cache-bust=1", location).toString() });
assert.equal(await offlineVersionedShell.text(), `fresh:${new URL("./app.js", location).toString()}`, "offline shell requests with cache-busting queries should reuse the pathname cache");
const offlineNavigation = await dispatchFetch({ method: "GET", mode: "navigate", url: new URL("./missing-route", location).toString() });
assert.equal(await offlineNavigation.text(), `fresh:${new URL("./index.html", location).toString()}`, "offline navigation should fall back to the bounded cached index");
hanging = true;
const stalledShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert((await stalledShell.text()).startsWith("fresh:"), "stalled shell requests should fall back after the network timeout");
hanging = false;
stalledBody = true;
const stalledBodyShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./styles.css", location).toString() });
assert.equal(await stalledBodyShell.text(), `fresh:${new URL("./styles.css", location).toString()}`, "stalled shell response bodies should fall back after the body timeout");
stalledBodyCancel = true;
const stalledCancelShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./styles.css", location).toString() });
assert.equal(await stalledCancelShell.text(), `fresh:${new URL("./styles.css", location).toString()}`, "a never-settling body cancellation must not block the bounded shell fallback");
stalledBodyCancel = false;
malformedBody = true;
const malformedBodyShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./styles.css", location).toString() });
assert.equal(await malformedBodyShell.text(), `fresh:${new URL("./styles.css", location).toString()}`, "malformed shell stream chunks must fail closed and use the cached response");
malformedBody = false;
crossOriginResponse = true;
const crossOriginShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert.equal(await crossOriginShell.text(), `fresh:${new URL("./app.js", location).toString()}`, "cross-origin redirects must not replace a cached shell response");
crossOriginResponse = false;
opaqueResponse = true;
const opaqueShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert.equal(await opaqueShell.text(), `fresh:${new URL("./app.js", location).toString()}`, "opaque shell responses must not replace a cached application asset");
opaqueResponse = false;
htmlForAssetResponse = true;
const htmlForScriptShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert.equal(await htmlForScriptShell.text(), `fresh:${new URL("./app.js", location).toString()}`, "HTML responses must not replace non-HTML shell assets with a cached login or error page");
htmlForAssetResponse = false;

console.log("service worker smoke ok");
