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
import { createElement, type ReactElement } from "react";
import type { CalendarSourceProvider } from "../calendar/service.js";
import type { ConfigStore, DisplayDeviceConfig, DisplaysConfig } from "../config/config.js";
import { debugLog } from "../debug-log.js";
import type { TileConfig } from "./tiles.js";
import { createComponentElement, renderElementToPngBuffer } from "./render.js";

function normalizeMac(mac: string): string {
  return mac.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

type DeviceMatch = {
  display: DisplayDeviceConfig;
};

function lookupDeviceByMac(displaysConfig: DisplaysConfig, mac: string): DeviceMatch | undefined {
  const normalized = normalizeMac(mac);
  for (const display of displaysConfig) {
    if (normalizeMac(display.mac) === normalized) {
      return { display };
    }
  }
  return undefined;
}

function lookupDeviceByToken(displaysConfig: DisplaysConfig, token: string): DeviceMatch | undefined {
  for (const display of displaysConfig) {
    if (display.token === token) {
      return { display };
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

const DEFAULT_REFRESH_RATE = 300;
const DEFAULT_ORIENTATION: DisplayDeviceConfig["orientation"] = "landscape";
const DEFAULT_COLOR_DEPTH: DisplayDeviceConfig["color_depth"] = 1;

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
  orientation: DisplayDeviceConfig["orientation"],
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

  if (device.display.tiles.length > 0) {
    return device.display.tiles;
  }

  return defaultTiles("Configure display tiles");
}

function getPaletteColourCount(colorDepth: DisplayDeviceConfig["color_depth"]): 2 | 4 {
  if (colorDepth === 2) return 4;
  return 2;
}

async function generateImage(
  device: DeviceMatch | undefined,
  calendarSourceProvider: CalendarSourceProvider,
  orientation: DisplayDeviceConfig["orientation"],
  colorDepth: DisplayDeviceConfig["color_depth"],
  dimensions: DisplayDimensions,
): Promise<Buffer> {
  const renderSize = getRenderDimensions(orientation, dimensions);
  const tiles = resolveTilesForImage(device);
  const tileElements: ReactElement[] = [];

  for (const tile of tiles) {
    const pixelRegion = regionToPixels(tile.region, renderSize.width, renderSize.height);
    const tileElement = await createComponentElement(
      tile.component,
      calendarSourceProvider,
      pixelRegion.width,
      pixelRegion.height,
    );

    tileElements.push(
      createElement(
        "div",
        {
          key: `${pixelRegion.left}:${pixelRegion.top}:${pixelRegion.width}:${pixelRegion.height}`,
          style: {
            display: "flex",
            flexDirection: "column",
            position: "absolute",
            left: pixelRegion.left,
            top: pixelRegion.top,
            width: pixelRegion.width,
            height: pixelRegion.height,
            overflow: "hidden",
          },
        },
        tileElement,
      ),
    );
  }

  const rootElement = createElement(
    "div",
    {
      style: {
        width: renderSize.width,
        height: renderSize.height,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        backgroundColor: "#ffffff",
        overflow: "hidden",
        fontFamily: "DejaVu Sans",
      },
    },
    tileElements,
  );

  const rendered = await renderElementToPngBuffer(rootElement, renderSize.width, renderSize.height);

  let image = sharp(rendered)
    .grayscale()
    .removeAlpha();

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
    const displays = config.getDisplays();
    console.log(`[display/setup] Config loaded devices=${displays.length}`);
    const matchedDevice = lookupDeviceByMac(displays, mac);
    const displayDevice = matchedDevice?.display;
    if (!displayDevice) {
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
    const friendlyId = displayDevice.friendly_id ?? fallbackFriendlyId;
    console.log(`[display/setup] Provisioning mac=${normalizedMac} friendly_id=${friendlyId} origin=${host}`);
    debugLog.add("display_setup", `Display setup accepted (${friendlyId})`, {
      mac: normalizedMac,
      friendly_id: friendlyId,
      device_config_mac: matchedDevice?.display.mac,
      origin: host,
    });

    return c.json({
      status: 200,
      api_key: displayDevice.token,
      friendly_id: friendlyId,
      image_url: `${host}/display/image`,
      message: "Welcome to minhome TRMNL",
    });
  });

  display.get("/display/api/display", (c) => {
    const accessToken = c.req.header("Access-Token");
    const authHeader = c.req.header("Authorization");
    const token = getTokenFromRequest(accessToken, authHeader);
    const headerMac = c.req.header("ID");
    const queryMac = c.req.query("mac");
    console.log(`[display/poll] Request received access_token=${accessToken ? "yes" : "no"} bearer=${authHeader?.startsWith("Bearer ") ? "yes" : "no"}`);
    const displays = config.getDisplays();
    const matchedDevice =
      (queryMac && lookupDeviceByMac(displays, queryMac)) ||
      (headerMac && lookupDeviceByMac(displays, headerMac)) ||
      (token && lookupDeviceByToken(displays, token)) ||
      undefined;
    const refreshRate = matchedDevice?.display.refresh_rate ?? DEFAULT_REFRESH_RATE;
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
      `[display/poll] Responding refresh_rate=${refreshRate}` +
      ` image_url=${imageUrl} width=${dimensions.width} height=${dimensions.height}`,
    );
    debugLog.add("display_poll", "Display poll responded", {
      width: dimensions.width,
      height: dimensions.height,
      refresh_rate: refreshRate,
      image_url: imageUrl,
      has_access_token: Boolean(accessToken),
      has_bearer_token: Boolean(authHeader?.startsWith("Bearer ")),
    });
    return c.json({
      status: 0,
      image_url: imageUrl,
      filename: new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14),
      refresh_rate: refreshRate,
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
    const displays = config.getDisplays();
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
      (queryMac && lookupDeviceByMac(displays, queryMac)) ||
      (headerMac && lookupDeviceByMac(displays, headerMac)) ||
      (token && lookupDeviceByToken(displays, token)) ||
      undefined;
    const orientation = matchedDevice?.display.orientation ?? DEFAULT_ORIENTATION;
    const colorDepth = matchedDevice?.display.color_depth ?? DEFAULT_COLOR_DEPTH;

    const start = Date.now();
    const png = await generateImage(
      matchedDevice,
      calendarSourceProvider,
      orientation,
      colorDepth,
      dimensions,
    );
    const paletteColours = getPaletteColourCount(colorDepth);
    console.log(
      `[display/image] Rendered ${png.length} bytes in ${Date.now() - start}ms` +
      ` mac=${matchedDevice?.display.mac ?? "unknown"} orientation=${orientation}` +
      ` width=${dimensions.width} height=${dimensions.height}` +
      ` color_depth=${colorDepth} colours=${paletteColours}`,
    );
    debugLog.add("display_image", "Display image rendered", {
      mac: matchedDevice?.display.mac ?? "unknown",
      orientation,
      width: dimensions.width,
      height: dimensions.height,
      color_depth: colorDepth,
      colours: paletteColours,
      bytes: png.length,
      elapsed_ms: Date.now() - start,
    });
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-cache, no-store",
        "X-Display-Color-Depth": String(colorDepth),
        "X-Display-Colours": String(paletteColours),
        "X-Display-Indexed": "true",
      },
    });
  });

  return display;
}
