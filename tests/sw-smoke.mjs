import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../sw.js", import.meta.url), "utf8");
const location = new URL("https://notes.example.test/wiki/sw.js");
const handlers = new Map();
const entries = new Map();
let cacheWritable = true;
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
  }
};
const cachesApi = {
  async open() {
    return shellCache;
  },
  async match(request) {
    return entries.get(typeof request === "string" ? new URL(request, location).toString() : request.url) || null;
  },
  async keys() {
    return ["llm-field-notes-v1", "llm-field-notes-v2"];
  },
  async delete(key) {
    return key !== "llm-field-notes-v2";
  }
};
let online = true;
let networkCalls = 0;
const context = {
  URL,
  Set,
  Response,
  console,
  caches: cachesApi,
  fetch: async (request) => {
    networkCalls += 1;
    if (!online) throw new Error("offline");
    return new Response(`fresh:${request.url}`, { status: 200 });
  },
  self: {
    location,
    addEventListener(type, handler) {
      handlers.set(type, handler);
    },
    clients: { claim: async () => {} },
    skipWaiting: async () => {}
  }
};
context.globalThis = context;
vm.runInNewContext(source, context);

const installWaits = [];
handlers.get("install")({ waitUntil(promise) { installWaits.push(promise); } });
await Promise.all(installWaits);
assert(entries.has(new URL("./index.html", location).toString()), "install should precache the app shell");

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

cacheWritable = false;
const freshWithCacheFailure = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./styles.css", location).toString() });
assert.equal(await freshWithCacheFailure.text(), `fresh:${new URL("./styles.css", location).toString()}`, "cache failures must not hide fresh network responses");
cacheWritable = true;

const callsBeforeApi = networkCalls;
const apiResponse = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./healthz", location).toString() });
assert.equal(apiResponse, undefined, "API and health requests should bypass the service worker");
assert.equal(networkCalls, callsBeforeApi, "bypassed requests should not be fetched by the worker");

online = false;
const offlineShell = await dispatchFetch({ method: "GET", mode: "cors", url: new URL("./app.js", location).toString() });
assert.equal(await offlineShell.text(), `fresh:${new URL("./app.js", location).toString()}`, "offline shell requests should use the updated cache");
const offlineNavigation = await dispatchFetch({ method: "GET", mode: "navigate", url: new URL("./missing-route", location).toString() });
assert((await offlineNavigation.text()).startsWith("cached:"), "offline navigation should fall back to the cached index");

console.log("service worker smoke ok");
