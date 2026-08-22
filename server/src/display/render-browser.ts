/**
 * Chromium-backed renderer for display images.
 *
 * The TRMNL framework is not a stylesheet you can rasterize statically: it ships
 * a terminalize() runtime that measures layout after the fact (getBoundingClientRect,
 * getComputedStyle) and dithers through canvas. So we drive a real browser.
 *
 * Chromium is launched per render rather than kept warm. Measured on a Pi 5 it peaks
 * around 1.2GB RSS while launch costs ~0.4s of a ~1.6s render, and displays refresh on
 * the order of minutes -- holding that much resident to save 0.4s is the wrong trade.
 */

import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import puppeteer from "puppeteer-core";

const VENDOR = resolve(import.meta.dirname, "../../vendor/trmnl-framework");
const FRAMEWORK_CSS = join(VENDOR, "css", "plugins.min.css");
const FRAMEWORK_JS = join(VENDOR, "js", "plugins.min.js");

const CHROMIUM_PATH = process.env.CHROMIUM_PATH ?? "/usr/bin/chromium";

/** How long terminalize() gets to settle before we screenshot anyway. */
const READY_TIMEOUT_MS = 20_000;
/** Hard ceiling on a single render, so a wedged browser cannot hold ~1.2GB forever. */
const RENDER_TIMEOUT_MS = 60_000;

export type FrameworkScreen = {
  /** Framework device profile id, e.g. "v2" or "og". Sets --screen-w/h, --pixel-ratio. */
  device: string;
  /** Bits per pixel; selects the screen--Nbit class. */
  colorDepth: number;
};

export type RenderSize = {
  /** Device pixels. The framework scales by --pixel-ratio itself, so this is the final size. */
  width: number;
  height: number;
};

/**
 * Wrap body markup in the document shape the framework requires.
 *
 * Two non-obvious requirements, both load-bearing:
 *  - `.trmnl` on an ancestor. The bundle scopes ~80k rules under it; without it
 *    essentially nothing applies and you get unstyled text.
 *  - `.screen` must name its device profile and depth (`screen--v2 screen--4bit`),
 *    because the framework is deliberately not device-agnostic.
 *
 * Do not add the docs' `environment` class: its only rule is `background-color: gray`.
 */
export function buildFrameworkDocument(bodyHtml: string, screen: FrameworkScreen): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="file://${FRAMEWORK_CSS}">
<style>html,body{margin:0;padding:0;background:#fff}</style>
</head>
<body class="trmnl">
<div class="screen screen--${screen.device} screen--${screen.colorDepth}bit">${bodyHtml}</div>
<script src="file://${FRAMEWORK_JS}"></script>
</body>
</html>`;
}

// Renders are serialised: two concurrent polls must not launch two Chromiums.
let renderQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = renderQueue.then(task, task);
  // Keep the chain alive regardless of individual failures.
  renderQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function renderOnce(html: string, size: RenderSize): Promise<Buffer> {
  const dir = mkdtempSync(join(tmpdir(), "minhome-display-"));
  const htmlPath = join(dir, "screen.html");
  writeFileSync(htmlPath, html, "utf-8");

  const browser = await puppeteer.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--hide-scrollbars",
    ],
  });

  try {
    const page = await browser.newPage();
    page.on("pageerror", (err) => {
      console.warn(`[display/browser] Page error: ${String(err).slice(0, 200)}`);
    });

    // deviceScaleFactor stays 1: `.trmnl .screen` already applies
    // `transform: scale(var(--pixel-ratio))`, so scaling here would double it.
    await page.setViewport({ ...size, deviceScaleFactor: 1 });
    await page.goto(`file://${htmlPath}`, { waitUntil: "load" });

    // plugins.js self-triggers terminalize() on window load and flips this when done.
    try {
      await page.waitForFunction("window.TRMNL_PLUGINS_READY === true", {
        timeout: READY_TIMEOUT_MS,
        polling: 50,
      });
    } catch {
      console.warn(
        `[display/browser] terminalize() did not settle within ${READY_TIMEOUT_MS}ms;` +
        ` screenshotting anyway`,
      );
    }

    // Clip to the screen element. The framework compensates for its scale transform
    // with negative margins, so a full-page shot can pick up stray area.
    const screen = await page.$(".screen");
    const box = await screen?.boundingBox();
    const clip = box
      ? { x: box.x, y: box.y, width: Math.round(box.width), height: Math.round(box.height) }
      : { x: 0, y: 0, ...size };

    if (!box) {
      console.warn("[display/browser] No .screen element found; falling back to viewport clip");
    }

    return Buffer.from(await page.screenshot({ clip }));
  } finally {
    await browser.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Render a framework document to a raw (unquantized) PNG buffer. */
export async function renderDocumentToPngBuffer(
  html: string,
  size: RenderSize,
): Promise<Buffer> {
  return enqueue(async () => {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Display render exceeded ${RENDER_TIMEOUT_MS}ms`)),
        RENDER_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([renderOnce(html, size), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}
