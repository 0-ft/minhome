/**
 * TRMNL e-ink display API routes.
 *
 * Implements the TRMNL device protocol at /display:
 *   GET  /display/api/setup   – device registration
 *   GET  /display/api/display – polling endpoint (image URL + refresh rate)
 *   POST /display/api/log     – device log ingestion
 *   GET  /display/image       – 800×480 PNG (configurable colour depth)
 */

import { Hono } from "hono";
import sharp from "sharp";
import type { CalendarSourceProvider } from "../calendar/service.js";
import type { ConfigStore, DisplayConfig } from "../config/config.js";
import { debugLog } from "../debug-log.js";
import type { TileConfig } from "./tiles.js";
import { renderComponentToPngBuffer } from "./render.js";

function normalizeMac(mac: string): string {
  return mac.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

type DisplayDevice = DisplayConfig["devices"][string];

type DeviceMatch = {
  mac: string;
  device: DisplayDevice;
};

function lookupDeviceByMac(displayConfig: DisplayConfig, mac: string): DeviceMatch | undefined {
  const normalized = normalizeMac(mac);
  for (const [configuredMac, device] of Object.entries(displayConfig.devices)) {
    if (normalizeMac(configuredMac) === normalized) {
      return { mac: configuredMac, device };
    }
  }
  return undefined;
}

function lookupDeviceByToken(displayConfig: DisplayConfig, token: string): DeviceMatch | undefined {
  for (const [configuredMac, device] of Object.entries(displayConfig.devices)) {
    if (device.token === token) {
      return { mac: configuredMac, device };
    }
  }
  return undefined;
}

function getTokenFromRequest(
  accessToken: string | undefined,
  authHeader: string | undefined,
): string | undefined {
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
  return bearer ?? accessToken;
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

type DisplayDimensions = {
  width: number;
  height: number;
};

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function getDisplayDimensionsFromRequest(
  widthValue: string | undefined,
  heightValue: string | undefined,
): DisplayDimensions | undefined {
  const width = parsePositiveInt(widthValue);
  const height = parsePositiveInt(heightValue);
  if (!width || !height) return undefined;
  return { width, height };
}

function appendDimensionsToImageUrl(imageUrl: string, dimensions: DisplayDimensions): string {
  const url = new URL(imageUrl);
  url.searchParams.set("width", String(dimensions.width));
  url.searchParams.set("height", String(dimensions.height));
  return url.toString();
}

function getRenderDimensions(
  orientation: DisplayConfig["orientation"],
  deviceDimensions: DisplayDimensions,
): { width: number; height: number } {
  if (orientation === "portrait") {
    return { width: deviceDimensions.height, height: deviceDimensions.width };
  }
  return { width: deviceDimensions.width, height: deviceDimensions.height };
}

function regionToPixels(
  region: TileConfig["region"],
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number } {
  const left = Math.max(0, Math.min(width - 1, Math.round(region.x * width)));
  const top = Math.max(0, Math.min(height - 1, Math.round(region.y * height)));
  const right = Math.max(left + 1, Math.min(width, Math.round((region.x + region.w) * width)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round((region.y + region.h) * height)));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function defaultTiles(fallbackText: string): TileConfig[] {
  return [
    {
      region: { x: 0, y: 0, w: 1, h: 1 },
      component: {
        kind: "string_display",
        text: fallbackText,
        border_width: 3,
        padding: 20,
      },
    },
  ];
}

function resolveTilesForImage(device: DeviceMatch | undefined): TileConfig[] {
  if (!device) {
    return defaultTiles("Display token not recognized");
  }

  if (device.device.tiles.length > 0) {
    return device.device.tiles;
  }

  return defaultTiles("Configure display tiles");
}

function getPaletteColourCount(colorDepth: DisplayConfig["color_depth"]): 2 | 4 {
  if (colorDepth === 2) return 4;
  return 2;
}

async function renderTileWithFallback(
  tile: TileConfig,
  calendarSourceProvider: CalendarSourceProvider,
  width: number,
  height: number,
): Promise<Buffer> {
  try {
    return await renderComponentToPngBuffer(tile.component, calendarSourceProvider, width, height);
  } catch (error) {
    console.warn(`[display/image] Tile render failed (${tile.component.kind}): ${(error as Error).message}`);
    return renderComponentToPngBuffer(
      {
        kind: "string_display",
        text: "Tile render error",
        border_width: 2,
      },
      calendarSourceProvider,
      width,
      height,
    );
  }
}

async function generateImage(
  device: DeviceMatch | undefined,
  calendarSourceProvider: CalendarSourceProvider,
  orientation: DisplayConfig["orientation"],
  colorDepth: DisplayConfig["color_depth"],
  dimensions: DisplayDimensions,
): Promise<Buffer> {
  const renderSize = getRenderDimensions(orientation, dimensions);
  const tiles = resolveTilesForImage(device);
  const compositeInputs: sharp.OverlayOptions[] = [];

  for (const tile of tiles) {
    const pixelRegion = regionToPixels(tile.region, renderSize.width, renderSize.height);
    const tilePng = await renderTileWithFallback(tile, calendarSourceProvider, pixelRegion.width, pixelRegion.height);
    compositeInputs.push({
      input: tilePng,
      left: pixelRegion.left,
      top: pixelRegion.top,
    });
  }

  let image = sharp({
    create: {
      width: renderSize.width,
      height: renderSize.height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .composite(compositeInputs)
    .flatten({ background: "#ffffff" })
    .grayscale();

  if (orientation === "portrait") {
    image = image.rotate(90);
  }

  // Quantize after rendering so both 1-bit and 2-bit use the same pipeline.
  const colours = getPaletteColourCount(colorDepth);
  return image.png({ palette: true, colours, dither: 0 }).toBuffer();
}

export function createDisplayRoute(config: ConfigStore) {
  const display = new Hono();
  const calendarSourceProvider: CalendarSourceProvider = {
    getCalendarSource: (calendarId) => config.getCalendarSource(calendarId),
    getCalendars: () => config.getCalendars(),
  };

  display.get("/display/api/setup", (c) => {
    console.log("[display/setup] Request received");
    const mac = c.req.header("ID");
    if (!mac) {
      console.warn("[display/setup] Missing ID header");
      debugLog.add("display_setup", "Display setup rejected (missing ID header)", {
        host: c.req.header("Host"),
      });
      return c.json({ status: 400, message: "Missing device ID header" }, 400);
    }

    console.log(`[display/setup] ID header mac=${mac}`);
    const cfg = config.getDisplay();
    console.log(`[display/setup] Config loaded refresh_rate=${cfg.refresh_rate} devices=${Object.keys(cfg.devices).length}`);
    const matchedDevice = lookupDeviceByMac(cfg, mac);
    const device = matchedDevice?.device;
    if (!device) {
      console.warn(`[display/setup] Device not configured mac=${mac}`);
      debugLog.add("display_setup", "Display setup rejected (device not configured)", {
        mac,
      });
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
    debugLog.add("display_setup", `Display setup accepted (${friendlyId})`, {
      mac: normalizedMac,
      friendly_id: friendlyId,
      device_config_mac: matchedDevice?.mac,
      origin: host,
    });

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
    const dimensions = getDisplayDimensionsFromRequest(
      c.req.header("Width"),
      c.req.header("Height"),
    );
    if (!dimensions) {
      console.warn("[display/poll] Missing or invalid Width/Height headers");
      debugLog.add("display_poll", "Display poll rejected (invalid dimensions)", {
        width_header: c.req.header("Width"),
        height_header: c.req.header("Height"),
      });
      return c.json({ status: 400, message: "Missing or invalid Width/Height headers" }, 400);
    }
    const rawImageUrl = `${host}/display/image`;
    const imageUrl = appendDimensionsToImageUrl(rawImageUrl, dimensions);
    console.log(
      `[display/poll] Responding refresh_rate=${cfg.refresh_rate}` +
      ` image_url=${imageUrl} width=${dimensions.width} height=${dimensions.height}`,
    );
    debugLog.add("display_poll", "Display poll responded", {
      width: dimensions.width,
      height: dimensions.height,
      refresh_rate: cfg.refresh_rate,
      image_url: imageUrl,
      has_access_token: Boolean(accessToken),
      has_bearer_token: Boolean(authHeader?.startsWith("Bearer ")),
    });
    return c.json({
      status: 0,
      image_url: imageUrl,
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
      debugLog.add("display_log", `Display posted ${logs.length} log entr${logs.length === 1 ? "y" : "ies"}`, {
        count: logs.length,
        first_message: (logs[0] as Record<string, unknown> | undefined)?.message ?? null,
      });
    } else {
      console.log("[display/log] No logs array provided");
      debugLog.add("display_log", "Display log endpoint called without logs array");
    }
    return c.body(null, 204);
  });

  display.get("/display/image", async (c) => {
    console.log("[display/image] Render requested");
    const cfg = config.getDisplay();
    const accessToken = c.req.header("Access-Token");
    const authHeader = c.req.header("Authorization");
    const token = getTokenFromRequest(accessToken, authHeader);
    const queryMac = c.req.query("mac");
    const headerMac = c.req.header("ID");
    const dimensions = getDisplayDimensionsFromRequest(
      c.req.query("width") ?? c.req.header("Width"),
      c.req.query("height") ?? c.req.header("Height"),
    );
    if (!dimensions) {
      console.warn("[display/image] Missing or invalid width/height values");
      debugLog.add("display_image", "Display image rejected (invalid dimensions)", {
        width: c.req.query("width") ?? c.req.header("Width"),
        height: c.req.query("height") ?? c.req.header("Height"),
      });
      return c.json({ status: 400, message: "Missing or invalid width/height values" }, 400);
    }

    const matchedDevice =
      (queryMac && lookupDeviceByMac(cfg, queryMac)) ||
      (headerMac && lookupDeviceByMac(cfg, headerMac)) ||
      (token && lookupDeviceByToken(cfg, token)) ||
      undefined;

    const start = Date.now();
    const png = await generateImage(
      matchedDevice,
      calendarSourceProvider,
      cfg.orientation,
      cfg.color_depth,
      dimensions,
    );
    const paletteColours = getPaletteColourCount(cfg.color_depth);
    console.log(
      `[display/image] Rendered ${png.length} bytes in ${Date.now() - start}ms` +
      ` mac=${matchedDevice?.mac ?? "unknown"} orientation=${cfg.orientation}` +
      ` width=${dimensions.width} height=${dimensions.height}` +
      ` color_depth=${cfg.color_depth} colours=${paletteColours}`,
    );
    debugLog.add("display_image", "Display image rendered", {
      mac: matchedDevice?.mac ?? "unknown",
      orientation: cfg.orientation,
      width: dimensions.width,
      height: dimensions.height,
      color_depth: cfg.color_depth,
      colours: paletteColours,
      bytes: png.length,
      elapsed_ms: Date.now() - start,
    });
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache, no-store",
        "X-Display-Color-Depth": String(cfg.color_depth),
        "X-Display-Colours": String(paletteColours),
        "X-Display-Indexed": "true",
      },
    });
  });

  return display;
}
