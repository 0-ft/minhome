/**
 * TRMNL e-ink display API routes.
 *
 * Implements the TRMNL device protocol at /display:
 *   GET  /display/api/setup   – device registration
 *   GET  /display/api/display – polling endpoint (image URL + refresh rate)
 *   POST /display/api/log     – device log ingestion
 *   GET  /display/image       – 800×480 1-bit PNG
 */

import { Hono } from "hono";
import sharp from "sharp";
import type { ConfigStore, DisplayConfig } from "../config/config.js";

const WIDTH = 800;
const HEIGHT = 480;

const WORDS = [
  "serendipity", "cascade", "ephemeral", "labyrinth", "solitude",
  "nebula", "chrysalis", "vortex", "enigma", "silhouette",
  "aurora", "zenith", "catalyst", "paradox", "reverie",
  "mosaic", "fjord", "quartz", "zephyr", "obsidian",
  "mirage", "velvet", "cipher", "prism", "ember",
  "gossamer", "halcyon", "incognito", "juxtapose", "kaleidoscope",
];

function normalizeMac(mac: string): string {
  return mac.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

function lookupDevice(displayConfig: DisplayConfig, mac: string): DisplayConfig["devices"][string] | undefined {
  const normalized = normalizeMac(mac);
  for (const [configuredMac, device] of Object.entries(displayConfig.devices)) {
    if (normalizeMac(configuredMac) === normalized) {
      return device;
    }
  }
  return undefined;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function getPublicOrigin(url: string, hostHeader: string | undefined, forwardedHost: string | undefined, forwardedProto: string | undefined): string {
  const reqUrl = new URL(url);
  const proto = forwardedProto?.split(",")[0]?.trim() || reqUrl.protocol.replace(":", "");
  const rawHost = forwardedHost?.split(",")[0]?.trim() || hostHeader || reqUrl.host;
  try {
    // Normalize possibly malformed proxy host values (e.g. accidental path suffixes)
    const normalized = new URL(`${proto}://${rawHost}`);
    return normalized.origin;
  } catch {
    return reqUrl.origin;
  }
}

async function generateImage(): Promise<Buffer> {
  const now = new Date();
  const timeStr = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dateStr = now.toLocaleDateString("en-GB", { weekday: "long", month: "long", day: "numeric" });
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];

  const svg = `<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="white"/>
  <text x="${WIDTH / 2}" y="150" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="120" font-weight="bold" fill="black">${escapeXml(timeStr)}</text>
  <text x="${WIDTH / 2}" y="230" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="40" fill="black">${escapeXml(dateStr)}</text>
  <line x1="200" y1="280" x2="600" y2="280" stroke="black" stroke-width="2"/>
  <text x="${WIDTH / 2}" y="375" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-size="64" font-weight="bold" fill="black">${escapeXml(word)}</text>
</svg>`;

  return sharp(Buffer.from(svg))
    .png({ colours: 2 })
    .toBuffer();
}

export function createDisplayRoute(config: ConfigStore) {
  const display = new Hono();

  display.get("/display/api/setup", (c) => {
    console.log("[display/setup] Request received");
    const mac = c.req.header("ID");
    if (!mac) {
      console.warn("[display/setup] Missing ID header");
      return c.json({ status: 400, message: "Missing device ID header" }, 400);
    }

    console.log(`[display/setup] ID header mac=${mac}`);
    const cfg = config.getDisplay();
    console.log(`[display/setup] Config loaded refresh_rate=${cfg.refresh_rate} devices=${Object.keys(cfg.devices).length}`);
    const device = lookupDevice(cfg, mac);
    if (!device) {
      console.warn(`[display/setup] Device not configured mac=${mac}`);
      return c.json({ status: 404, message: `Device ${mac} is not configured` }, 404);
    }

    const normalizedMac = normalizeMac(mac);
    const fallbackFriendlyId = normalizedMac.slice(-8).toUpperCase();
    const host = getPublicOrigin(
      c.req.url,
      c.req.header("Host"),
      c.req.header("X-Forwarded-Host"),
      c.req.header("X-Forwarded-Proto"),
    );
    const friendlyId = device.friendly_id ?? fallbackFriendlyId;
    console.log(`[display/setup] Provisioning mac=${normalizedMac} friendly_id=${friendlyId} origin=${host}`);

    return c.json({
      status: 200,
      api_key: device.token,
      friendly_id: friendlyId,
      image_url: `${host}/display/image`,
      message: "Welcome to minhome TRMNL",
    });
  });

  display.get("/display/api/display", (c) => {
    const accessToken = c.req.header("Access-Token");
    const authHeader = c.req.header("Authorization");
    console.log(`[display/poll] Request received access_token=${accessToken ? "yes" : "no"} bearer=${authHeader?.startsWith("Bearer ") ? "yes" : "no"}`);
    const cfg = config.getDisplay();
    const host = getPublicOrigin(
      c.req.url,
      c.req.header("Host"),
      c.req.header("X-Forwarded-Host"),
      c.req.header("X-Forwarded-Proto"),
    );
    console.log(`[display/poll] Responding refresh_rate=${cfg.refresh_rate} image_url=${host}/display/image`);
    return c.json({
      status: 0,
      image_url: `${host}/display/image`,
      filename: new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14),
      refresh_rate: cfg.refresh_rate,
      update_firmware: false,
      reset_firmware: false,
      firmware_url: "",
      special_function: "",
    });
  });

  display.post("/display/api/log", async (c) => {
    console.log("[display/log] Request received");
    const data = await c.req.json().catch(() => ({}));
    const logs = (data as Record<string, unknown>).logs;
    if (Array.isArray(logs)) {
      console.log(`[display/log] Received ${logs.length} log entries`);
      for (const log of logs) {
        console.log(`[display log] ${(log as Record<string, unknown>).message ?? ""}`);
      }
    } else {
      console.log("[display/log] No logs array provided");
    }
    return c.body(null, 204);
  });

  display.get("/display/image", async (c) => {
    console.log("[display/image] Render requested");
    const start = Date.now();
    const png = await generateImage();
    console.log(`[display/image] Rendered ${png.length} bytes in ${Date.now() - start}ms`);
    return new Response(new Uint8Array(png), {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-cache, no-store" },
    });
  });

  return display;
}
