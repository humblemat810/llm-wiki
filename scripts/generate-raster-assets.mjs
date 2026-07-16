import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const assets = [
  { source: "icon.svg", output: "icon-192.png", width: 192, height: 192 },
  { source: "icon.svg", output: "icon-512.png", width: 512, height: 512 },
  { source: "social-card.svg", output: "social-card.png", width: 1200, height: 630 }
];

const browser = await chromium.launch({ headless: true });
try {
  for (const asset of assets) {
    const svg = await readFile(resolve(root, asset.source), "utf8");
    const page = await browser.newPage({
      viewport: { width: asset.width, height: asset.height },
      deviceScaleFactor: 1
    });
    try {
      await page.setContent(svg, { waitUntil: "load" });
      await page.screenshot({
        path: resolve(root, asset.output),
        type: "png"
      });
    } finally {
      await page.close();
    }
    console.log(`generated ${asset.output} from ${asset.source} (${asset.width}×${asset.height})`);
  }
} finally {
  await browser.close();
}
