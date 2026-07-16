import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chromium, firefox, webkit } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_VERSION = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")).version;
const engines = { chromium, firefox, webkit };
const engineName = String(process.env.BROWSER_ENGINE || "chromium").toLowerCase();
if (!engines[engineName]) throw new Error(`BROWSER_ENGINE must be one of: ${Object.keys(engines).join(", ")}.`);
const debug = (message) => {
  if (process.env.BROWSER_SMOKE_DEBUG === "1") console.error(`[browser-smoke] ${message}`);
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
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  const pageErrors = [];
  const consoleErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("frame-ancestors")) consoleErrors.push(message.text());
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
  await page.locator("#try-sample").focus();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "try-sample", "keyboard focus should reach the sample action");

  debug("loading public sample graph page");
  samplePage = await context.newPage();
  samplePage.setDefaultTimeout(10000);
  samplePage.on("pageerror", (error) => pageErrors.push(`sample-graph: ${error.message}`));
  samplePage.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("frame-ancestors")) consoleErrors.push(`sample-graph: ${message.text()}`);
  });
  await samplePage.goto(new URL("sample-graph.html", baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: 10000 });
  assert.equal(await samplePage.title(), "Sample knowledge graph · LLM Field Notes", "the public sample graph should expose its page title");
  assert.equal(await samplePage.locator("h1").count(), 1, "the public sample graph should expose one primary heading");
  assert.equal(await samplePage.locator(".sample-graph-visual svg").getAttribute("role"), "img", "the public sample graph should expose an accessible visual graph");
  assert.match(await samplePage.locator(".sample-graph-visual svg").getAttribute("aria-label") || "", /knowledge graph visualization/i);
  assert(await samplePage.locator(".sample-graph-card").count() >= 1, "the public sample graph should render concept cards");
  assert(await samplePage.locator(".sample-graph-relations li").count() >= 1, "the public sample graph should render relation rows");
  assert(await samplePage.locator("a[href*='#sample']").count() >= 1, "the public sample graph should link back to the interactive sample");
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

  debug("running sample walkthrough");
  await page.locator("#try-sample").click();
  await waitForText(page.locator("#ingest-status"), /Revision/);
  assert.match(await waitForText(page.locator("#graph-health"), /provenance/), /provenance/, "the browser should render graph health after local extraction");
  assert.notEqual(await page.locator("#hero-node-count").textContent(), "0", "the sample walkthrough should render concepts");
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
  debug("round-tripping Obsidian vault");
  await page.locator("#document-file").setInputFiles({
    name: "llm-field-notes-vault.zip",
    mimeType: "application/zip",
    buffer: vaultBytes
  });
  await waitForText(page.locator("#ingest-status"), /Obsidian vault loaded/);
  await page.locator("#ingest-document").click();
  await waitForText(page.locator("#ingest-status"), /Obsidian vault feedback imported|No matching graph items or changes were found/);

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
  assert.deepEqual(pageErrors, [], "browser smoke should not produce uncaught page errors");
  assert.deepEqual(consoleErrors, [], "browser smoke should not produce console errors");
  console.log(`browser smoke ok: ${engineName}`);
} catch (error) {
  if (page) {
    const diagnostic = await page.locator("body").innerText().catch(() => "");
    console.error(`browser diagnostics: url=${page.url()} title=${await page.title().catch(() => "")} body=${diagnostic.slice(0, 1200)}`);
    if (diagnosticDirectory) {
      try {
        await mkdir(diagnosticDirectory, { recursive: true });
        const screenshotPath = resolve(diagnosticDirectory, `browser-${engineName}-failure.png`);
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
