/**
 * TRMNL e-ink display API routes.
 *
 * Implements the TRMNL device protocol at /display:
 *   GET  /display/api/setup   – device registration
 *   GET  /display/api/display – polling endpoint (image URL + refresh rate)
 *   POST /display/api/log     – device log ingestion
 *   GET  /display/image       – PNG at the device's reported size (configurable colour depth)
 *   GET  /display/html        – the exact framework document /display/image screenshots
 */

import { Hono } from "hono";
import sharp from "sharp";
import { renderToStaticMarkup } from "react-dom/server";
import { CalendarService } from "../calendar/service.js";
import type { ConfigStore, DisplayDeviceConfig, DisplaysConfig } from "../config/config.js";
import { getDisplayColorDepth } from "../config/config.js";
import type { ListStore } from "../config/lists.js";
import { debugLog } from "../debug-log.js";
import type { ScreenLayout } from "./layout.js";
import { createComponentElement } from "./render-components.js";
import { buildFrameworkDocument, renderDocumentToPngBuffer } from "./render-browser.js";
import { FRAMEWORK_DEVICES } from "./device-profiles.js";
import type { ListProvider } from "./components/list-display.js";

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

type ImageRenderTimings = {
  build_root_ms: number;
  build_root_layout_ms: number;
  build_root_components_ms: number;
  renderer_ms: number;
  postprocess_ms: number;
  total_ms: number;
};

const DEFAULT_REFRESH_RATE = 300;
const DEFAULT_ORIENTATION: DisplayDeviceConfig["orientation"] = "landscape";
const DEFAULT_FRAMEWORK_DEVICE = "og" as const;

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

function defaultLayout(fallbackText: string): ScreenLayout {
  return {
    view: "full",
    layout: ["top"],
    columns: [{ component: { kind: "string_display", text: fallbackText, size: "large" } }],
  };
}

function resolveLayoutForImage(device: DeviceMatch | undefined): ScreenLayout {
  if (!device) return defaultLayout("Display token not recognized");
  if (device.display.layout.columns.length > 0) return device.display.layout;
  return defaultLayout("Configure display layout");
}

function getPaletteColourCount(colorDepth: number): number {
  // 1 -> 2, 2 -> 4, 3 -> 8, 4 -> 16 greys (the TRMNL X panel takes 16).
  return 2 ** colorDepth;
}

/** Render the configured columns into the framework's view/layout/columns markup. */
async function buildScreenBodyHtml(
  device: DeviceMatch | undefined,
  calendarService: CalendarService,
  listProvider: ListProvider,
): Promise<{ html: string; timings: { layoutMs: number; componentsMs: number } }> {
  const layout = resolveLayoutForImage(device);

  const componentsStart = Date.now();
  const columnElements = await Promise.all(
    layout.columns.map((column) =>
      createComponentElement(column.component, calendarService, listProvider),
    ),
  );
  const componentsMs = Date.now() - componentsStart;

  const layoutStart = Date.now();
  const layoutClasses = ["layout", ...layout.layout.map((m) => `layout--${m}`)].join(" ");
  const columnsHtml = columnElements
    .map((element) => `<div class="column">${renderToStaticMarkup(element)}</div>`)
    .join("");
  const html =
    `<div class="view view--${layout.view}">` +
      `<div class="${layoutClasses}">` +
        `<div class="columns">${columnsHtml}</div>` +
      `</div>` +
    `</div>`;
  const layoutMs = Date.now() - layoutStart;

  return { html, timings: { layoutMs, componentsMs } };
}

async function generateImage(
  device: DeviceMatch | undefined,
  calendarService: CalendarService,
  listProvider: ListProvider,
  orientation: DisplayDeviceConfig["orientation"],
  colorDepth: number,
  frameworkDevice: keyof typeof FRAMEWORK_DEVICES,
): Promise<{ png: Buffer; timings: ImageRenderTimings }> {
  const totalStart = Date.now();

  const buildStart = Date.now();
  const { html: bodyHtml, timings: buildTimings } = await buildScreenBodyHtml(
    device,
    calendarService,
    listProvider,
  );
  const document = buildFrameworkDocument(bodyHtml, { device: frameworkDevice, colorDepth });
  const buildRootMs = Date.now() - buildStart;

  // Size comes from the framework profile, not the device's reported headers: the
  // stylesheet paints at profile size regardless of what the panel claims.
  const profile = FRAMEWORK_DEVICES[frameworkDevice];
  const rendererStart = Date.now();
  const rendered = await renderDocumentToPngBuffer(document, {
    width: profile.deviceWidth,
    height: profile.deviceHeight,
  });
  const rendererMs = Date.now() - rendererStart;

  const postprocessStart = Date.now();
  let image = sharp(rendered).grayscale().removeAlpha();
  if (orientation === "portrait") {
    image = image.rotate(90);
  }
  // Chromium emits antialiased 8-bit greys; this is what produces the indexed PNG
  // the firmware reads. dither:0 because the framework does its own dithering.
  const colours = getPaletteColourCount(colorDepth);
  const png = await image.png({ palette: true, colours, dither: 0 }).toBuffer();
  const postprocessMs = Date.now() - postprocessStart;

  return {
    png,
    timings: {
      build_root_ms: buildRootMs,
      build_root_layout_ms: buildTimings.layoutMs,
      build_root_components_ms: buildTimings.componentsMs,
      renderer_ms: rendererMs,
      postprocess_ms: postprocessMs,
      total_ms: Date.now() - totalStart,
    },
  };
}

export function createDisplayRoute(config: ConfigStore, lists: ListStore) {
  const display = new Hono();
  const calendarService = new CalendarService(config.getCalendars(), {
    credentialsBaseDir: config.getConfigDir(),
  });
  const listProvider: ListProvider = {
    getList: (listId) => lists.getList(listId),
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
    const frameworkDevice = matchedDevice?.display.framework_device ?? DEFAULT_FRAMEWORK_DEVICE;
    const colorDepth = matchedDevice
      ? getDisplayColorDepth(matchedDevice.display)
      : FRAMEWORK_DEVICES[DEFAULT_FRAMEWORK_DEVICE].colorDepth;

    const { png, timings } = await generateImage(
      matchedDevice,
      calendarService,
      listProvider,
      orientation,
      colorDepth,
      frameworkDevice,
    );
    const paletteColours = getPaletteColourCount(colorDepth);
    const mem = process.memoryUsage();
    const mb = (b: number) => (b / 1024 / 1024).toFixed(1);
    console.log(
      `[display/image] Rendered ${png.length} bytes` +
      ` total_ms=${timings.total_ms} build_root_ms=${timings.build_root_ms}` +
      ` build_root_layout_ms=${timings.build_root_layout_ms}` +
      ` build_root_components_ms=${timings.build_root_components_ms}` +
      ` renderer_ms=${timings.renderer_ms} postprocess_ms=${timings.postprocess_ms}` +
      ` mac=${matchedDevice?.display.mac ?? "unknown"} orientation=${orientation}` +
      ` width=${dimensions.width} height=${dimensions.height}` +
      ` color_depth=${colorDepth} colours=${paletteColours}` +
      ` heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB rss=${mb(mem.rss)}MB ext=${mb(mem.external)}MB ab=${mb(mem.arrayBuffers)}MB`,
    );
    debugLog.add("display_image", "Display image rendered", {
      mac: matchedDevice?.display.mac ?? "unknown",
      orientation,
      width: dimensions.width,
      height: dimensions.height,
      color_depth: colorDepth,
      colours: paletteColours,
      bytes: png.length,
      elapsed_ms: timings.total_ms,
      build_root_ms: timings.build_root_ms,
      build_root_layout_ms: timings.build_root_layout_ms,
      build_root_components_ms: timings.build_root_components_ms,
      renderer_ms: timings.renderer_ms,
      postprocess_ms: timings.postprocess_ms,
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

  display.get("/display/html", async (c) => {
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
      return c.json({ status: 400, message: "Missing or invalid width/height values" }, 400);
    }

    const matchedDevice =
      (queryMac && lookupDeviceByMac(displays, queryMac)) ||
      (headerMac && lookupDeviceByMac(displays, headerMac)) ||
      (token && lookupDeviceByToken(displays, token)) ||
      undefined;
    const frameworkDevice = matchedDevice?.display.framework_device ?? DEFAULT_FRAMEWORK_DEVICE;
    const colorDepth = matchedDevice
      ? getDisplayColorDepth(matchedDevice.display)
      : FRAMEWORK_DEVICES[DEFAULT_FRAMEWORK_DEVICE].colorDepth;

    // Emit exactly the document the screenshot renders, so this endpoint is a
    // faithful debug view rather than a lookalike with its own styling.
    const { html: bodyHtml } = await buildScreenBodyHtml(matchedDevice, calendarService, listProvider);
    const html = buildFrameworkDocument(bodyHtml, { device: frameworkDevice, colorDepth });

    return c.html(html);
  });

  return display;
}
