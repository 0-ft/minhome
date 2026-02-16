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
import { randomUUID } from "crypto";
import sharp from "sharp";
import type { ConfigStore } from "./config/config.js";

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

interface DeviceEntry {
  api_key: string;
  friendly_id: string;
}

const deviceDb = new Map<string, DeviceEntry>();

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    const mac = c.req.header("ID") ?? "unknown";
    let entry = deviceDb.get(mac);
    if (!entry) {
      entry = {
        api_key: randomUUID().replace(/-/g, ""),
        friendly_id: randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase(),
      };
      deviceDb.set(mac, entry);
      console.log(`[display] Registered device ${mac} → ${entry.friendly_id}`);
    }
    const host = new URL(c.req.url).origin;
    return c.json({
      status: 200,
      api_key: entry.api_key,
      friendly_id: entry.friendly_id,
      image_url: `${host}/display/image`,
      message: "Welcome to minhome TRMNL",
    });
  });

  display.get("/display/api/display", (c) => {
    const cfg = config.getDisplay();
    const host = new URL(c.req.url).origin;
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
    const data = await c.req.json().catch(() => ({}));
    const logs = (data as Record<string, unknown>).logs;
    if (Array.isArray(logs)) {
      for (const log of logs) {
        console.log(`[display log] ${(log as Record<string, unknown>).message ?? ""}`);
      }
    }
    return c.body(null, 204);
  });

  display.get("/display/image", async (c) => {
    const png = await generateImage();
    return new Response(png, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-cache, no-store" },
    });
  });

  return display;
}
