import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";
import { prepareDiagnosticScreenshotPath } from "./browser-diagnostics.mjs";
import { encodeSharePayload, SHARE_FORMAT } from "../share-projection.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_VERSION = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
const engines = { chromium, firefox, webkit };
const engineName = String(process.env.BROWSER_ENGINE || "chromium").toLowerCase();
if (!engines[engineName]) throw new Error(`BROWSER_ENGINE must be one of: ${Object.keys(engines).join(", ")}.`);
const debug = (message) => {
  if (process.env.BROWSER_SMOKE_DEBUG === "1") console.error(`[browser-smoke] ${message}`);
};
const MAX_BROWSER_ERROR_RECORDS = 100;
const MAX_BROWSER_ERROR_CHARS = 512;
const appendBoundedDiagnostic = (records, value) => {
  if (records.length >= MAX_BROWSER_ERROR_RECORDS) return;
  records.push(String(value).slice(0, MAX_BROWSER_ERROR_CHARS));
};
const diagnosticDirectory = typeof process.env.BROWSER_SMOKE_ARTIFACT_DIR === "string"
  && process.env.BROWSER_SMOKE_ARTIFACT_DIR.trim()
  ? resolve(process.env.BROWSER_SMOKE_ARTIFACT_DIR.trim())
  : "";
const expectedRevision = typeof process.env.BROWSER_SMOKE_EXPECTED_REVISION === "string"
  && process.env.BROWSER_SMOKE_EXPECTED_REVISION.trim()
  ? process.env.BROWSER_SMOKE_EXPECTED_REVISION.trim().toLowerCase()
  : null;
if (expectedRevision !== null && !/^(?:unknown|[0-9a-f]{7,64})$/.test(expectedRevision)) {
  throw new Error("BROWSER_SMOKE_EXPECTED_REVISION must be unknown or a 7–64 character hexadecimal source revision.");
}
const localRevision = typeof process.env.BROWSER_SMOKE_LOCAL_REVISION === "string"
  && process.env.BROWSER_SMOKE_LOCAL_REVISION.trim()
  ? process.env.BROWSER_SMOKE_LOCAL_REVISION.trim().toLowerCase()
  : "abcdef1234567890";
if (!/^[0-9a-f]{7,64}$/.test(localRevision)) {
  throw new Error("BROWSER_SMOKE_LOCAL_REVISION must be a 7–64 character hexadecimal source revision.");
}
const expectedRepository = typeof process.env.BROWSER_SMOKE_EXPECTED_REPOSITORY === "string"
  && process.env.BROWSER_SMOKE_EXPECTED_REPOSITORY.trim()
  ? process.env.BROWSER_SMOKE_EXPECTED_REPOSITORY.trim().replace(/\/+$/, "")
  : null;
if (expectedRepository !== null) {
  let repositoryUrl;
  try {
    repositoryUrl = new URL(expectedRepository);
  } catch {
    throw new Error("BROWSER_SMOKE_EXPECTED_REPOSITORY must be an absolute GitHub HTTPS repository URL.");
  }
  if (repositoryUrl.protocol !== "https:" || repositoryUrl.hostname.toLowerCase() !== "github.com"
    || repositoryUrl.username || repositoryUrl.password || repositoryUrl.search || repositoryUrl.hash
    || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repositoryUrl.pathname)) {
    throw new Error("BROWSER_SMOKE_EXPECTED_REPOSITORY must be an absolute credential-free GitHub HTTPS repository URL.");
  }
}

const configuredTarget = typeof process.env.BROWSER_SMOKE_URL === "string" && process.env.BROWSER_SMOKE_URL.trim()
  ? process.env.BROWSER_SMOKE_URL.trim()
  : "";
let baseUrl;
let port = null;
let child = null;
if (configuredTarget) {
  baseUrl = new URL(configuredTarget);
  if (!["http:", "https:"].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash) {
    throw new Error("BROWSER_SMOKE_URL must be an HTTP(S) URL without credentials, query, or fragment.");
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(baseUrl.hostname.toLowerCase());
  if (!loopback && (baseUrl.protocol !== "https:" || process.env.BROWSER_SMOKE_CONFIRM !== "I_UNDERSTAND")) {
    throw new Error("Non-loopback browser smoke targets require HTTPS and BROWSER_SMOKE_CONFIRM=I_UNDERSTAND.");
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, "") + "/";
} else {
  const portProbe = createServer();
  await new Promise((resolveProbe, rejectProbe) => {
    portProbe.once("error", rejectProbe);
    portProbe.listen(0, "127.0.0.1", resolveProbe);
  });
  port = portProbe.address().port;
  await new Promise((resolveClose) => portProbe.close(resolveClose));
  baseUrl = new URL(`http://127.0.0.1:${port}/`);
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      BUILD_REVISION: localRevision,
      PUBLIC_ORIGIN: baseUrl.origin
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}
let output = "";
const appendOutput = (chunk) => {
  output = `${output}${String(chunk)}`.slice(-64 * 1024);
};
child?.stdout.on("data", appendOutput);
child?.stderr.on("data", appendOutput);

const waitForExit = async (timeoutMs = 5000) => {
  if (!child) return [null, null];
  if (child.exitCode !== null || child.signalCode !== null) return [child.exitCode, child.signalCode];
  let timer;
  try {
    return await Promise.race([
      once(child, "exit"),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("browser smoke server did not exit in time")), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const waitForReady = async () => {
  let lastError = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(`browser smoke server exited before readiness: ${output || "no process output"}`);
    }
    try {
      const response = await fetch(child ? new URL("readyz", baseUrl) : baseUrl);
      if (response.ok) return;
      lastError = new Error(`readiness returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error(`browser smoke server did not become ready: ${lastError?.message || "unknown error"}`);
};

const waitForText = async (locator, matcher, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const text = await locator.textContent({ timeout: 250 }).catch(() => "");
    lastText = text || "";
    if (matcher.test(text || "")) return text;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`browser element did not produce expected text: ${matcher}; last text: ${lastText.slice(0, 360)}`);
};

const waitForServiceWorker = async (page, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const active = await page.evaluate(async () => {
      if (!navigator.serviceWorker) return false;
      const registrations = await navigator.serviceWorker.getRegistrations();
      return registrations.some((registration) => Boolean(registration.active));
    }).catch(() => false);
    if (active) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error("browser smoke service worker did not become active");
};

let browser;
let context;
let page;
let samplePage;
let sharePage;
let forkContext;
let forkPage;
let checkpointPage;
let failurePage;
let failureContext;
try {
  debug(`target ${baseUrl.href}`);
  debug("waiting for server readiness");
  await waitForReady();
  debug("launching browser");
  browser = await engines[engineName].launch({ headless: true });
  context = await browser.newContext({
    reducedMotion: "reduce",
    viewport: { width: 390, height: 844 }
  });
  await context.addInitScript(() => {
    window.__llmFieldNotesClipboard = "";
    try {
      Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    } catch {
      // Some engines expose navigator.share as a non-configurable property.
    }
    try {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: async (value) => { window.__llmFieldNotesClipboard = String(value); } }
      });
    } catch {
      // The static recipient-view test still covers link rendering.
    }
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => appendBoundedDiagnostic(pageErrors, error?.message || error));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("frame-ancestors")) {
      appendBoundedDiagnostic(consoleErrors, message.text());
    }
  });

  debug("loading workbench");
  await page.goto(new URL("#workbench", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 10000 });
  debug("workbench document loaded");
  const workbench = page.locator("#workbench");
  await workbench.waitFor({ state: "attached" });
  assert.equal(await workbench.isVisible(), true, "the browser should render the workbench");
  debug("waiting for release metadata");
  await waitForText(page.locator("#release-version"), new RegExp(APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const servedRelease = await page.evaluate(async () => {
    const response = await fetch(new URL("./version.json", location.href), { cache: "no-store" });
    if (!response.ok) throw new Error(`release metadata returned HTTP ${response.status}`);
    return response.json();
  });
  assert.equal(servedRelease.version, APP_VERSION, "the browser should load release metadata for the expected application version");
  assert.match(String(servedRelease.revision || ""), /^(?:unknown|[0-9a-f]{7,64})$/, "the browser should load bounded source revision metadata");
  if (expectedRevision !== null) {
    assert.equal(servedRelease.revision, expectedRevision, "the browser should exercise the expected deployed source revision");
    if (expectedRevision !== "unknown") {
      await waitForText(
        page.locator("#release-version"),
        new RegExp(`${APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*${expectedRevision.slice(0, 12)}`),
        5000
      );
      assert.match(
        await page.locator("#release-version").textContent() || "",
        new RegExp(expectedRevision.slice(0, 12)),
        "the visible release footer should expose the same canonical source revision as version.json"
      );
    }
  }
  const servedManifest = await page.evaluate(async () => {
    const response = await fetch(new URL("./manifest.webmanifest", location.href), { cache: "no-store" });
    if (!response.ok) throw new Error(`web manifest returned HTTP ${response.status}`);
    const manifest = await response.json();
    const icons = await Promise.all((manifest.icons || []).slice(0, 2).map(async (icon) => {
      const iconResponse = await fetch(new URL(icon.src, location.href), { cache: "no-store" });
      const bytes = new Uint8Array(await iconResponse.arrayBuffer());
      const view = new DataView(bytes.buffer);
      return {
        src: icon.src,
        status: iconResponse.status,
        contentType: iconResponse.headers.get("content-type"),
        signature: [...bytes.slice(0, 8)],
        width: bytes.length >= 24 ? view.getUint32(16) : 0,
        height: bytes.length >= 24 ? view.getUint32(20) : 0
      };
    }));
    return { manifest, icons };
  });
  assert.deepEqual(servedManifest.manifest.icons.slice(0, 2), [
    { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
  ], "the browser should receive explicit raster PWA icon metadata");
  assert.deepEqual(servedManifest.icons.map((icon) => ({
    src: icon.src,
    status: icon.status,
    contentType: icon.contentType,
    signature: icon.signature,
    width: icon.width,
    height: icon.height
  })), [
    {
      src: "icon-192.png",
      status: 200,
      contentType: "image/png",
      signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      width: 192,
      height: 192
    },
    {
      src: "icon-512.png",
      status: 200,
      contentType: "image/png",
      signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      width: 512,
      height: 512
    }
  ], "the browser should receive valid raster PWA icon bytes");
  assert.equal(
    await page.locator('link[rel="apple-touch-icon"]').getAttribute("href"),
    "icon-192.png",
    "the browser shell should expose the verified raster icon for Apple home-screen installation"
  );
  assert.equal(
    await page.locator('meta[name="apple-mobile-web-app-capable"]').getAttribute("content"),
    "yes",
    "the browser shell should expose Apple installed-app capability metadata"
  );
  assert.equal(await page.locator("#graph-canvas").getAttribute("aria-label"), "Interactive knowledge graph");
  assert.equal(
    await page.evaluate(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches),
    true,
    "the browser should expose reduced-motion preferences to the workbench"
  );
  const layoutMetrics = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const overflowing = [...document.querySelectorAll("*")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ element, rect }) => !element.closest(".ticker") && (rect.right > viewport + 2 || rect.left < -2))
      .sort((left, right) => (right.rect.width - left.rect.width))
      .slice(0, 5)
      .map(({ element, rect }) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: typeof element.className === "string" ? element.className.slice(0, 80) : "",
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width)
      }));
    return {
      viewport,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      overflowing
    };
  });
  assert(
    layoutMetrics.overflowing.length === 0,
    `the narrow workbench should not overflow horizontally outside its decorative ticker: ${JSON.stringify(layoutMetrics)}`
  );
  const unnamedControls = await page.evaluate(() => [...document.querySelectorAll("a,button,input,select,textarea,[role='button']")]
    .filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    })
    .map((element) => {
      const labelledBy = element.getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
        .trim();
      const label = element.getAttribute("aria-label")
        || labelledBy
        || element.labels?.[0]?.textContent?.trim()
        || (["A", "BUTTON"].includes(element.tagName) ? element.textContent?.trim() : "")
        || element.getAttribute("placeholder")
        || element.getAttribute("title")
        || "";
      return label ? null : `${element.tagName.toLowerCase()}#${element.id || "(no-id)"}`;
    })
    .filter(Boolean));
  assert.deepEqual(unnamedControls, [], "visible browser controls should expose accessible names");
  const lowContrastControls = await page.evaluate(() => {
    const parseColor = (value) => {
      const match = String(value).match(/^rgba?\(([^)]+)\)$/);
      if (!match) return null;
      const channels = match[1].split(",").map(Number);
      if (channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) return null;
      return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 };
    };
    const luminance = ({ r, g, b }) => [r, g, b]
      .map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      })
      .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);
    const contrastRatio = (foreground, background) => {
      const [lighter, darker] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const effectiveBackground = (element) => {
      for (let current = element; current; current = current.parentElement) {
        const color = parseColor(getComputedStyle(current).backgroundColor);
        if (color?.a === 1) return color;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    return [...document.querySelectorAll(".workbench-section button:not(:disabled), .map-section button:not(:disabled), .contribute-section button:not(:disabled)")]
      .filter((element) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden")
      .map((element) => {
        const foreground = parseColor(getComputedStyle(element).color);
        const background = effectiveBackground(element);
        return {
          id: element.id || "(no-id)",
          text: element.textContent?.trim().slice(0, 80) || "(no text)",
          ratio: foreground ? contrastRatio(foreground, background) : 0
        };
      })
      .filter((control) => control.ratio < 4.5);
  });
  assert.deepEqual(lowContrastControls, [], `visible enabled dark-surface buttons must meet 4.5:1 contrast: ${JSON.stringify(lowContrastControls)}`);
  await page.locator("#try-sample").focus();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "try-sample", "keyboard focus should reach the sample action");

  debug("loading public sample graph page");
  samplePage = await context.newPage();
  samplePage.setDefaultTimeout(10000);
  samplePage.on("pageerror", (error) => appendBoundedDiagnostic(pageErrors, `sample-graph: ${error?.message || error}`));
  samplePage.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("frame-ancestors")) {
      appendBoundedDiagnostic(consoleErrors, `sample-graph: ${message.text()}`);
    }
  });
  await samplePage.goto(new URL("sample-graph.html", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 10000 });
  assert.equal(await samplePage.title(), "Sample knowledge graph · LLM Field Notes", "the public sample graph should expose its page title");
  assert.equal(await samplePage.locator("h1").count(), 1, "the public sample graph should expose one primary heading");
  assert.equal(await samplePage.locator(".sample-graph-visual svg").getAttribute("role"), "img", "the public sample graph should expose an accessible visual graph");
  assert.match(await samplePage.locator(".sample-graph-visual svg").getAttribute("aria-label") || "", /knowledge graph visualization/i);
  assert(await samplePage.locator(".sample-graph-card").count() >= 1, "the public sample graph should render concept cards");
  assert(await samplePage.locator(".sample-graph-relations li").count() >= 1, "the public sample graph should render relation rows");
  assert(await samplePage.locator("a[href*='#sample']").count() >= 1, "the public sample graph should link back to the interactive sample");
  assert.equal(await samplePage.locator("a[href$='examples/sample-graph.canvas']").count(), 1, "the public sample graph should expose one direct Obsidian Canvas download");
  const sampleLayout = await samplePage.evaluate(() => {
    const viewport = window.innerWidth;
    const overflowing = [...document.querySelectorAll("*")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.right > viewport + 2 || rect.left < -2)
      .slice(0, 5)
      .map(({ element, rect }) => ({
        tag: element.tagName.toLowerCase(),
        className: typeof element.className === "string" ? element.className.slice(0, 80) : "",
        left: Math.round(rect.left),
        right: Math.round(rect.right)
      }));
    const cta = document.querySelector(".sample-graph-next .button-light");
    return {
      viewport,
      document: document.documentElement.scrollWidth,
      overflowing,
      ctaColor: cta ? getComputedStyle(cta).color : "",
      ctaBackground: cta ? getComputedStyle(cta).backgroundColor : ""
    };
  });
  assert.deepEqual(sampleLayout.overflowing, [], `the public sample graph should not overflow its mobile viewport: ${JSON.stringify(sampleLayout)}`);
  assert.notEqual(sampleLayout.ctaBackground, "rgb(28, 26, 22)", "the public sample CTA should remain visually distinct from its dark panel");
  await samplePage.close();
  samplePage = null;

  debug("loading recipient-openable share projection");
  const sharePayload = {
    format: SHARE_FORMAT,
    title: "Browser share fixture",
    nodes: [
      { id: "n0", label: "Retrieval <b>unsafe</b>", type: "concept", status: "accepted", confidence: 0.9 },
      { id: "n1", label: "Grounded answer", type: "concept", status: "accepted", confidence: 0.8 }
    ],
    edges: [{ source: "n0", target: "n1", label: "supports", status: "accepted", confidence: 0.85 }],
    documents: 1,
    reviewed: 2
  };
  sharePage = await context.newPage();
  sharePage.setDefaultTimeout(10000);
  const shareRequests = [];
  sharePage.on("request", (request) => shareRequests.push(request.url()));
  const shareUrlObject = new URL(`share.html#graph=${encodeSharePayload(sharePayload)}`, baseUrl);
  shareUrlObject.searchParams.set("utm_source", "browser-smoke");
  const shareUrl = shareUrlObject.toString();
  await sharePage.goto(
    shareUrl,
    { waitUntil: "networkidle", timeout: 10000 }
  );
  assert.equal(await sharePage.title(), "Shared knowledge graph · LLM Field Notes", "the recipient share page should expose its page title");
  assert.equal(await sharePage.locator("#error").isHidden(), true, "a valid share payload should not render the error state");
  assert.equal(await sharePage.locator("#title").textContent(), "Browser share fixture", "the share page should render the payload title");
  assert.equal(await sharePage.locator("#graph-map").getAttribute("role"), "img", "the share page should expose an accessible visual graph");
  assert(await sharePage.locator("#graph-map circle").count() >= 2, "the share page should render visual concept nodes");
  assert.equal(await sharePage.locator("#nodes li").count(), 2, "the share page should render every bounded concept");
  assert((await sharePage.locator("#nodes").textContent() || "").includes("Retrieval <b>unsafe</b>"), "shared labels should remain literal text");
  assert.equal(await sharePage.locator("#nodes b").count(), 0, "shared labels must not inject markup into the recipient page");
  assert.equal(await sharePage.locator("#edges li").count(), 1, "the share page should render every bounded relation");
  assert.match(await sharePage.locator("#edges").textContent() || "", /Retrieval.*supports.*Grounded answer/);
  const forkHref = await sharePage.locator("#fork-share").getAttribute("href");
  assert.match(forkHref || "", /#shared=[A-Za-z0-9_-]+$/, "the share page should expose a bounded workbench fork link");
  const correctionHref = await sharePage.locator('a[href*="template=graph_correction.yml"]').getAttribute("href");
  assert(correctionHref, "the recipient share page should expose a correction path");
  const correctionUrl = new URL(correctionHref);
  assert.equal(correctionUrl.hostname, "github.com", "the recipient correction path should target GitHub");
  assert.equal(correctionUrl.searchParams.get("template"), "graph_correction.yml", "the recipient correction path should use the graph-correction template");
  if (expectedRepository) {
    assert.equal(
      `${correctionUrl.origin}${correctionUrl.pathname}`,
      `${new URL(expectedRepository).origin}${new URL(expectedRepository).pathname}/issues/new`,
      "the recipient correction path should target the configured repository"
    );
  }
  await sharePage.locator("#copy-correction-context").click();
  const correctionContext = await sharePage.evaluate(() => window.__llmFieldNotesClipboard);
  assert.match(correctionContext || "", /^LLM Field Notes graph correction\n\nShare link: /, "the recipient should offer a structured correction handoff");
  assert(correctionContext?.includes(sharePage.url().replace("?utm_source=browser-smoke", "")), "correction context should include the query-free share link");
  assert(!correctionContext?.includes("Attention uses context"), "correction context must remain source-free");
  await sharePage.locator("#copy-share-link").click();
  assert.equal(
    await sharePage.evaluate(() => window.__llmFieldNotesClipboard),
    sharePage.url().replace("?utm_source=browser-smoke", ""),
    "the recipient share page should copy the safe fragment link without query parameters"
  );
  forkContext = await browser.newContext({ reducedMotion: "reduce", serviceWorkers: "block" });
  forkPage = await forkContext.newPage();
  forkPage.setDefaultTimeout(10000);
  await forkPage.goto(forkHref, { waitUntil: "networkidle", timeout: 10000 });
  assert.equal(new URL(forkPage.url()).hash, "", "the workbench should remove the shared payload from the address bar after import");
  assert.match(await forkPage.locator("#ingest-status").textContent() || "", /Shared graph forked/, "the workbench should report a successful shared graph fork");
  assert.equal(await forkPage.locator("#hero-node-count").textContent(), "2", "the workbench should render all forked concepts");
  await forkPage.close();
  forkPage = null;
  await forkContext.close();
  forkContext = null;
  const shareDownloadPromise = sharePage.waitForEvent("download");
  await sharePage.locator("#download-share").click();
  const shareDownload = await shareDownloadPromise;
  assert.equal(shareDownload.suggestedFilename(), "shared-knowledge-graph-redacted.json", "the shared graph download should use a stable redacted filename");
  const shareDownloadPath = await shareDownload.path();
  assert(shareDownloadPath, "the browser should expose the shared graph download bytes");
  const shareDownloadBytes = await readFile(shareDownloadPath);
  const shareDownloadPayload = JSON.parse(shareDownloadBytes.toString("utf8"));
  assert.equal(shareDownloadPayload.format, SHARE_FORMAT, "the shared graph download should preserve its versioned format");
  assert(!JSON.stringify(shareDownloadPayload).includes("source text"), "the shared graph download must remain source-free");
  const malformedSharePage = await context.newPage();
  malformedSharePage.setDefaultTimeout(10000);
  const duplicateSharePayload = Buffer.from('{"format":"llm-field-notes/share@1","format":"llm-field-notes/share@1"}').toString("base64url");
  await malformedSharePage.goto(new URL(`share.html#graph=${duplicateSharePayload}`, baseUrl).toString(), { waitUntil: "networkidle", timeout: 10000 });
  assert.equal(await malformedSharePage.locator("#error").isHidden(), false, "duplicate-key share payloads should render the safe error state");
  assert.equal(await malformedSharePage.locator("#download-share").isDisabled(), true, "malformed share payloads should disable downloads");
  assert.equal(await malformedSharePage.locator("#copy-share-link").isDisabled(), true, "malformed share payloads should disable link copying");
  assert.equal(await malformedSharePage.locator("#copy-correction-context").isDisabled(), true, "malformed share payloads should disable correction-context copying");
  await malformedSharePage.close();
  forkContext = await browser.newContext({ reducedMotion: "reduce", serviceWorkers: "block" });
  forkPage = await forkContext.newPage();
  forkPage.setDefaultTimeout(10000);
  await forkPage.goto(new URL("#workbench", baseUrl).toString(), { waitUntil: "networkidle", timeout: 10000 });
  await forkPage.locator("#document-file").setInputFiles({
    name: "shared-knowledge-graph-redacted.json",
    mimeType: "application/json",
    buffer: shareDownloadBytes
  });
  await waitForText(forkPage.locator("#ingest-status"), /Redacted shared graph imported/);
  assert.equal(await forkPage.locator("#hero-node-count").textContent(), "2", "the downloaded redacted JSON should round-trip into the workbench");
  await forkPage.close();
  forkPage = null;
  await forkContext.close();
  forkContext = null;
  const workbenchHref = await sharePage.locator('a').filter({ hasText: "Open the workbench" }).getAttribute("href");
  assert.equal(
    new URL(workbenchHref || "", sharePage.url()).toString(),
    new URL("./", baseUrl).toString(),
    "the recipient share page should offer a path back to the workbench"
  );
  assert(shareRequests.every((url) => !url.includes("#graph=")), "the graph fragment must not be sent in an HTTP request");
  if (engineName !== "webkit") {
    await waitForServiceWorker(page);
    await context.setOffline(true);
    try {
      await sharePage.goto(shareUrl, { waitUntil: "domcontentloaded", timeout: 10000 });
      assert.equal(await sharePage.locator("#error").isHidden(), true, "the cached recipient share page should reopen offline");
      assert.equal(await sharePage.locator("#nodes li").count(), 2, "the cached recipient share page should preserve its concepts offline");
    } finally {
      await context.setOffline(false);
    }
  }
  await sharePage.close();
  sharePage = null;

  debug("running sample walkthrough");
  await page.locator("#try-sample").click();
  await waitForText(page.locator("#ingest-status"), /Revision/);
  assert.match(await waitForText(page.locator("#graph-health"), /provenance/), /provenance/, "the browser should render graph health after local extraction");
  assert.notEqual(await page.locator("#hero-node-count").textContent(), "0", "the sample walkthrough should render concepts");
  assert.match(await page.locator("#graph-health").textContent() || "", /backup checkpoint is missing or out of date/i, "a populated graph without a current full backup should disclose the backup reminder");
  assert.equal(await page.locator("#graph-health [data-storage-action='backup']").count(), 1, "the backup reminder should provide one actionable download control");
  debug("copying an app-generated recipient share link");
  await page.locator("#share-redacted-link").scrollIntoViewIfNeeded();
  await page.locator("#share-redacted-link").click();
  await waitForText(page.locator("#projection-status"), /Share link copied/);
  const copiedShareUrl = await page.evaluate(() => window.__llmFieldNotesClipboard);
  const copiedShare = new URL(copiedShareUrl);
  assert.equal(copiedShare.pathname, new URL("share.html", baseUrl).pathname, "the workbench share action should target the static recipient viewer");
  assert.match(copiedShare.hash, /^#graph=[A-Za-z0-9_-]+$/, "the workbench share action should produce a bounded fragment payload");
  assert(!copiedShareUrl.includes("Attention uses context"), "the workbench share URL must not contain source-bearing evidence");
  if (!configuredTarget) {
    debug("exercising same-origin model extraction");
    await page.locator("details.extractor-settings").evaluate((element) => {
      element.open = true;
    });
    await page.locator("#extractor-endpoint").fill("/api/extract-graph");
    await page.locator("#extractor-endpoint").press("Tab");
    await waitForText(page.locator("#extractor-mode"), /^MODEL$/);
    assert.equal(
      await page.locator("#privacy-live").getAttribute("data-state"),
      "MODEL",
      "configuring a same-origin extractor should disclose model mode to the browser"
    );
    await page.locator("#document-title").fill("Browser remote extraction");
    await page.locator("#document-input").fill("A browser request exercises same-origin model extraction and preserves reviewed context for the knowledge graph.");
    await page.locator("#ingest-document").click();
    await waitForText(page.locator("#ingest-status"), /Revision/);
    if (engineName === "webkit") {
      debug("WebKit service-worker fetches bypass the pinned runner's request interception; skipping the synthetic provider-failure drill");
    } else {
      debug("exercising model extraction failure recovery");
      failureContext = await browser.newContext({
        reducedMotion: "reduce",
        serviceWorkers: "block",
        viewport: { width: 390, height: 844 }
      });
      failurePage = await failureContext.newPage();
      failurePage.setDefaultTimeout(10000);
      const remoteEndpointPattern = /\/api\/extract-graph(?:\?.*)?$/;
      let remoteFailureIntercepted = false;
      await failurePage.route(remoteEndpointPattern, async (route) => {
        remoteFailureIntercepted = true;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "simulated provider outage" })
        });
      });
      const failedRemoteTitle = "Remote outage draft";
      const failedRemoteText = "This draft must remain available when the configured model endpoint is temporarily unavailable.";
      await failurePage.goto(new URL("#workbench", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 10000 });
      await failurePage.locator("#workbench").waitFor({ state: "attached" });
      await failurePage.locator("details.extractor-settings").evaluate((element) => {
        element.open = true;
      });
      await failurePage.locator("#extractor-endpoint").fill("/api/extract-graph");
      await failurePage.locator("#extractor-endpoint").press("Tab");
      await waitForText(failurePage.locator("#extractor-mode"), /^MODEL$/);
      await failurePage.locator("#document-title").fill(failedRemoteTitle);
      await failurePage.locator("#document-input").fill(failedRemoteText);
      await failurePage.locator("#ingest-document").click();
      await waitForText(failurePage.locator("#ingest-status"), /could not be extracted|provider|503/i);
      assert.equal(remoteFailureIntercepted, true, "the browser failure drill should intercept the model endpoint request");
      assert.equal(await failurePage.locator("#document-title").inputValue(), failedRemoteTitle, "remote extraction failures should preserve the document title draft");
      assert.equal(await failurePage.locator("#document-input").inputValue(), failedRemoteText, "remote extraction failures should preserve the document text draft");
      await failurePage.locator("#retry-build").waitFor({ state: "visible" });
      await failurePage.unroute(remoteEndpointPattern);
      await failurePage.locator("#retry-build").click();
      await waitForText(failurePage.locator("#ingest-status"), /Revision/);
      assert.equal(await failurePage.locator("#retry-build").isHidden(), true, "a successful single-document retry should hide the retry action");
      await failurePage.close();
      await failureContext.close();
      failurePage = null;
      failureContext = null;
    }
    await page.locator("#extractor-endpoint").fill("");
    await page.locator("#extractor-endpoint").press("Tab");
    await waitForText(page.locator("#extractor-mode"), /^LOCAL$/);
    assert.equal(
      await page.locator("#privacy-live").getAttribute("data-state"),
      "LOCAL",
      "clearing the extractor endpoint should return the browser to local mode"
    );
  }
  checkpointPage = await context.newPage();
  checkpointPage.setDefaultTimeout(10000);
  await checkpointPage.goto(new URL("#workbench", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 10000 });
  await checkpointPage.locator("#workbench").waitFor({ state: "attached" });
  await waitForText(checkpointPage.locator("#graph-health"), /backup checkpoint is missing or out of date/i);
  const checkpointDownloadPromise = page.waitForEvent("download");
  await page.locator("#download-backup").click();
  const checkpointDownload = await checkpointDownloadPromise;
  assert.equal(await checkpointDownload.failure(), null, "the cross-tab checkpoint backup should download successfully");
  await waitForText(page.locator("#projection-status"), /Full backup downloaded/);
  const checkpointStorageValue = await page.evaluate(() => localStorage.getItem("llm-field-notes-last-backup-fingerprint"));
  assert.match(checkpointStorageValue || "", /^fnv64-[0-9a-f]{16}-\d+$/, "backup checkpoint storage should contain only the bounded graph fingerprint");
  assert(!String(checkpointStorageValue || "").includes("Attention uses context"), "backup checkpoint storage must not contain source text");
  try {
    await checkpointPage.waitForFunction(() => !/backup checkpoint is missing or out of date|undo history is not included in a full backup checkpoint/i.test(
      document.querySelector("#graph-health")?.textContent || ""
    ));
  } catch (error) {
    const checkpointDiagnostics = await checkpointPage.evaluate(() => ({
      storedCheckpoint: localStorage.getItem("llm-field-notes-last-backup-fingerprint"),
      health: document.querySelector("#graph-health")?.textContent?.slice(0, 1200) || ""
    })).catch(() => ({ storedCheckpoint: null, health: "" }));
    throw new Error(`${error?.message || "backup checkpoint did not synchronize"}; checkpoint=${String(checkpointDiagnostics.storedCheckpoint || "").slice(0, 96)}; health=${checkpointDiagnostics.health}`);
  }
  assert.doesNotMatch(
    await checkpointPage.locator("#graph-health").textContent() || "",
    /backup checkpoint is missing or out of date|undo history is not included in a full backup checkpoint/i,
    "another tab should clear its stale backup warning after a checkpoint is recorded"
  );
  await checkpointPage.close();
  checkpointPage = null;
  debug("reviewing a concept");
  await page.locator(".mini-button[data-view='list']").click();
  const confirmConcept = page.locator("#node-list button[data-feedback='up']").first();
  await confirmConcept.waitFor({ state: "visible" });
  await confirmConcept.click();
  await waitForText(page.locator("#graph-health"), /learning:\s*1 accepted/);
  await page.locator("#node-list .row-inspect").first().click();
  const correctionLink = page.locator('#inspector-panel a[href*="graph_correction.yml"]');
  await correctionLink.waitFor({ state: "visible" });
  assert.match(
    await correctionLink.getAttribute("href") || "",
    /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/issues\/new\?template=graph_correction\.yml$/,
    "inspected graph items should point at a credential-free GitHub correction form"
  );
  if (expectedRepository !== null) {
    assert.equal(
      new URL(await correctionLink.getAttribute("href")).origin + new URL(await correctionLink.getAttribute("href")).pathname.replace(/\/issues\/new$/, ""),
      expectedRepository,
      "deployed inspector correction links should target the current repository"
    );
  }
  assert.equal(await correctionLink.getAttribute("target"), "_blank", "inspected graph items should expose a safely opened correction link");
  assert.equal(await correctionLink.getAttribute("rel"), "noopener noreferrer", "correction links should not grant the issue form opener access to the workbench");
  const correctionTemplateButton = page.locator("#inspector-panel button[data-copy-graph-correction]").first();
  await correctionTemplateButton.waitFor({ state: "visible" });
  await correctionTemplateButton.click();
  await waitForText(page.locator("#ingest-status"), /Privacy-safe correction template copied/);

  debug("editing a loaded single document before building");
  await page.locator("#document-file").setInputFiles({
    name: "original-file-name.md",
    mimeType: "text/markdown",
    buffer: Buffer.from("# Original file title\n\nThe original file body is deliberately replaced in the editor before extraction.", "utf8")
  });
  await waitForText(page.locator("#ingest-status"), /loaded\. Edit it if needed/);
  await page.locator("#document-title").fill("Edited document title");
  await page.locator("#document-input").fill("# Edited document title\n\nEdited representation anchor appears repeatedly: edited representation anchor. Edited representation anchor.");
  await page.locator("#ingest-document").click();
  await waitForText(page.locator("#ingest-status"), /Revision/);
  await page.locator(".mini-button[data-view='list']").click();
  await page.locator("#source-list").waitFor({ state: "visible" });
  assert(
    await page.locator("#source-list").getByText("Edited document title", { exact: true }).count() === 1,
    "building a loaded single document should use the edited title and editor text"
  );

  debug("preserving a multi-file batch queue");
  await page.locator("#document-file").setInputFiles([
    {
      name: "batch-one.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Batch one\n\nThe first batch document contains enough durable context for extraction.", "utf8")
    },
    {
      name: "batch-two.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Batch two\n\nThe second batch document contains enough durable context for extraction.", "utf8")
    }
  ]);
  await waitForText(page.locator("#ingest-status"), /2 files loaded/);
  assert.match(await page.locator("#file-queue").textContent() || "", /2 documents queued/, "multi-file selection should remain queued after previewing the first file");
  await page.locator("#ingest-document").click();
  await waitForText(page.locator("#ingest-status"), /2 documents added/);

  debug("applying reviewed learning to saved sources");
  page.once("dialog", (dialog) => dialog.accept());
  const rebuildAction = page.locator("#graph-health button[data-learning-action='rebuild']");
  await rebuildAction.waitFor({ state: "visible" });
  await rebuildAction.click();
  await waitForText(page.locator("#ingest-status"), /source(?:s)? rebuilt/);
  assert.match(
    await page.locator("#graph-health").textContent() || "",
    /learning:\s*1 accepted/,
    "applying reviewed learning to saved sources should preserve the accepted decision in the persisted workbench"
  );

  debug("exporting Obsidian vault");
  await page.locator("#download-vault").scrollIntoViewIfNeeded();
  const vaultDownloadPromise = page.waitForEvent("download");
  await page.locator("#download-vault").click();
  const vaultDownload = await vaultDownloadPromise;
  assert.equal(await vaultDownload.failure(), null, "the Obsidian vault download should complete");
  assert.match(vaultDownload.suggestedFilename(), /^llm-field-notes-vault\.zip$/, "the vault download should use the stable filename");
  const vaultDownloadPath = await vaultDownload.path();
  assert(vaultDownloadPath, "the browser should expose the downloaded vault bytes");
  const vaultBytes = await readFile(vaultDownloadPath);
  assert.equal(vaultBytes.subarray(0, 4).toString("hex"), "504b0304", "the Obsidian vault download should be a ZIP archive");
  await waitForText(page.locator("#projection-status"), /Obsidian vault downloaded/);
  debug("exporting direct Obsidian Canvas projection");
  const canvasDownloadPromise = page.waitForEvent("download");
  await page.locator("#download-canvas").click();
  const canvasDownload = await canvasDownloadPromise;
  assert.equal(await canvasDownload.failure(), null, "the direct Graph.canvas download should complete");
  assert.equal(canvasDownload.suggestedFilename(), "Graph.canvas", "the direct Canvas projection should use the native Obsidian filename");
  const canvasDownloadPath = await canvasDownload.path();
  assert(canvasDownloadPath, "the browser should expose the direct Canvas projection bytes");
  const canvasText = await readFile(canvasDownloadPath, "utf8");
  const canvasPayload = JSON.parse(canvasText);
  assert(Array.isArray(canvasPayload.nodes) && Array.isArray(canvasPayload.edges), "the direct Canvas projection should contain native nodes and edges");
  assert(canvasPayload.nodes.length > 0, "the direct Canvas projection should include the reviewed graph nodes");
  assert(canvasPayload.nodes.every((node) => node.type === "text" && typeof node.text === "string"), "the direct Canvas projection should be self-contained when opened without the vault ZIP");
  assert(canvasPayload.nodes.some((node) => node.id === "projection-provenance" && /Graph fingerprint: fnv64-/.test(node.text)), "the direct Canvas projection should expose its graph fingerprint");
  assert(canvasPayload.edges.every((edge) => edge.fromNode !== "projection-provenance" && edge.toNode !== "projection-provenance"), "the direct Canvas relations should target concept cards, not provenance metadata");
  await waitForText(page.locator("#projection-status"), /Graph\.canvas downloaded/);
  debug("exporting redacted Obsidian Canvas projection");
  const redactedCanvasDownloadPromise = page.waitForEvent("download");
  await page.locator("#download-redacted-canvas").click();
  const redactedCanvasDownload = await redactedCanvasDownloadPromise;
  assert.equal(await redactedCanvasDownload.failure(), null, "the redacted Graph.canvas download should complete");
  assert.equal(redactedCanvasDownload.suggestedFilename(), "Graph-redacted.canvas", "the redacted Canvas projection should use a distinct filename");
  const redactedCanvasDownloadPath = await redactedCanvasDownload.path();
  assert(redactedCanvasDownloadPath, "the browser should expose the redacted Canvas projection bytes");
  const redactedCanvasText = await readFile(redactedCanvasDownloadPath, "utf8");
  assert(!redactedCanvasText.includes("Attention uses context") && !redactedCanvasText.includes("source text"), "the redacted Canvas projection should not contain source-bearing evidence");
  await waitForText(page.locator("#projection-status"), /Redacted Graph\.canvas downloaded/);
  debug("round-tripping Obsidian vault");
  await page.locator("#document-file").setInputFiles({
    name: "llm-field-notes-vault.zip",
    mimeType: "application/zip",
    buffer: vaultBytes
  });
  await waitForText(page.locator("#ingest-status"), /Obsidian vault loaded/);
  await page.locator("#ingest-document").click();
  await waitForText(page.locator("#ingest-status"), /Obsidian vault feedback imported|No matching graph items or changes were found/);

  debug("drilling full backup restore");
  const backupDownloadPromise = page.waitForEvent("download");
  await page.locator("#download-backup").click();
  const backupDownload = await backupDownloadPromise;
  assert.equal(await backupDownload.failure(), null, "the full backup download should complete");
  assert.equal(backupDownload.suggestedFilename(), "llm-field-notes-backup.json", "the full backup should use the stable filename");
  const backupDownloadPath = await backupDownload.path();
  assert(backupDownloadPath, "the browser should expose the full backup bytes");
  const backupText = await readFile(backupDownloadPath, "utf8");
  const backupPayload = JSON.parse(backupText);
  assert.equal(backupPayload.format, "llm-field-notes/backup@1", "the browser backup should use the versioned envelope");
  assert.match(backupPayload.graphFingerprint || "", /^fnv64-[0-9a-f]{16}-\d+$/, "the browser backup should carry a content fingerprint");
  await waitForText(page.locator("#projection-status"), /Full backup downloaded/);
  assert.doesNotMatch(
    await page.locator("#graph-health").textContent() || "",
    /backup checkpoint is missing or out of date|undo history is not included in a full backup checkpoint/i,
    "a successful full backup should clear the stale backup reminder"
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#clear-graph").click();
  await waitForText(page.locator("#ingest-status"), /Local graph cleared/);
  assert.equal(await page.locator("#hero-node-count").textContent(), "0", "the backup drill should clear the graph before restoring it");
  assert.match(await page.locator("#graph-health").textContent() || "", /Undo history is not included in a full backup checkpoint/i, "an empty visible graph with undo history should explicitly disclose the uncheckpointed recoverable state");
  assert.equal(await page.locator("#graph-health [data-storage-action='backup']").count(), 1, "recoverable undo history should retain a direct backup action after clear");
  await page.locator("#document-file").setInputFiles({
    name: "llm-field-notes-backup.json",
    mimeType: "application/json",
    buffer: Buffer.from(backupText, "utf8")
  });
  await waitForText(page.locator("#ingest-status"), /Full backup restored/);
  assert.notEqual(await page.locator("#hero-node-count").textContent(), "0", "full backup restore should recover the graph through the browser import path");

  debug("verifying destructive clear and undo recovery");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#clear-graph").click();
  await waitForText(page.locator("#ingest-status"), /Local graph cleared/);
  assert.equal(await page.locator("#hero-node-count").textContent(), "0", "clearing the graph should remove visible concepts");
  assert.equal(await page.locator("#undo-graph").isEnabled(), true, "clearing the graph should leave an undo recovery action");
  await page.locator("#undo-graph").click();
  await waitForText(page.locator("#ingest-status"), /Last graph change undone/);
  assert.notEqual(await page.locator("#hero-node-count").textContent(), "0", "undo should restore the cleared graph");
  await waitForText(page.locator("#graph-health"), /provenance/);

  debug("reloading workbench");
  await page.goto(new URL("#workbench", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 10000 });
  await workbench.waitFor({ state: "attached" });
  assert.equal(await workbench.isVisible(), true, "the workbench should remain visible after reload");
  await waitForText(page.locator("#release-version"), new RegExp(APP_VERSION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await waitForText(page.locator("#graph-health"), /provenance/);
  assert.notEqual(await page.locator("#hero-node-count").textContent(), "0", "the local graph should survive a browser reload");
  await waitForServiceWorker(page);
  if (engineName === "webkit") {
    debug("WebKit offline emulation does not route service-worker requests in the pinned Playwright runner; offline reopen is covered by Chromium and Firefox");
  } else {
    debug("reopening workbench offline");
    await page.context().setOffline(true);
    try {
      const browserReportsOffline = await page.evaluate(() => navigator.onLine === false);
      if (browserReportsOffline && engineName !== "firefox") {
        await waitForText(page.locator("#connection-status"), /Offline mode/, 5000);
        assert.equal(
          await page.locator("#connection-status").getAttribute("data-state"),
          "offline",
          "the workbench should expose its offline state while the browser is disconnected"
        );
      } else if (engineName === "firefox") {
        debug("Pinned Playwright Firefox does not reliably dispatch the offline event to the page; offline navigation remains covered below");
      } else {
        throw new Error("The browser context reported offline transport without exposing navigator.onLine=false.");
      }
      await page.goto(new URL("#workbench", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 10000 });
      await workbench.waitFor({ state: "attached" });
      assert.equal(await workbench.isVisible(), true, "the service worker should reopen the workbench offline");
      assert.notEqual(await page.locator("#hero-node-count").textContent(), "0", "the saved graph should remain visible offline");
    } finally {
      await page.context().setOffline(false);
    }
  }
  debug("forgetting all local data");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#forget-local-data").click();
  await waitForText(page.locator("#ingest-status"), /All local data forgotten/);
  assert.equal(await page.locator("#hero-node-count").textContent(), "0", "forgetting local data should clear the visible graph");
  const remainingLocalKeys = await page.evaluate(() => {
    const keys = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("llm-field-notes-")) keys.push(key);
    }
    return keys;
  });
  assert.deepEqual(remainingLocalKeys, [], "forgetting local data should remove every application-namespaced synchronous storage key");
  assert.deepEqual(pageErrors, [], "browser smoke should not produce uncaught page errors");
  assert.deepEqual(consoleErrors, [], "browser smoke should not produce console errors");
  console.log(`browser smoke ok: ${engineName}`);
} catch (error) {
  if (page) {
    const diagnostic = await page.locator("body").innerText().catch(() => "");
    console.error(`browser diagnostics: url=${page.url()} title=${await page.title().catch(() => "")} body=${diagnostic.slice(0, 1200)}`);
    if (diagnosticDirectory) {
      try {
        const screenshotPath = await prepareDiagnosticScreenshotPath(diagnosticDirectory, engineName);
        await page.screenshot({ path: screenshotPath, fullPage: false });
        console.error(`browser failure screenshot: ${screenshotPath}`);
      } catch (screenshotError) {
        console.error(`browser failure screenshot unavailable: ${screenshotError?.message || "unknown error"}`);
      }
    }
  }
  console.error(output);
  throw error;
} finally {
  await samplePage?.close().catch(() => {});
  await sharePage?.close().catch(() => {});
  await forkPage?.close().catch(() => {});
  await forkContext?.close().catch(() => {});
  await checkpointPage?.close().catch(() => {});
  await failurePage?.close().catch(() => {});
  await failureContext?.close().catch(() => {});
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  try {
    await waitForExit();
  } catch {
    if (child && child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await waitForExit(1000).catch(() => {});
  }
}
