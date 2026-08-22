/**
 * Generate src/display/device-profiles.ts from the vendored framework stylesheet.
 *
 * The framework is deliberately not device-agnostic: each supported panel has a
 * `.screen--<id>` class carrying its dimensions, pixel ratio and colour depth. We
 * read those out of the vendored CSS rather than transcribing them, so a framework
 * bump cannot leave our table quietly stale.
 *
 * Run after updating server/vendor/trmnl-framework:
 *   node server/scripts/generate-device-profiles.mjs
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const root = resolve(import.meta.dirname, "..");
const cssPath = resolve(root, "vendor/trmnl-framework/css/plugins.min.css");
const outPath = resolve(root, "src/display/device-profiles.ts");
const version = readFileSync(resolve(root, "vendor/trmnl-framework/VERSION"), "utf-8").trim();

const css = readFileSync(cssPath, "utf-8");

const devices = {};
for (const match of css.matchAll(/\.screen--([a-z0-9_]+)\{([^}]*)\}/g)) {
  const [, id, body] = match;
  // Only blocks declaring --device-name are device profiles; the rest are
  // modifiers like screen--4bit, screen--dark, screen--1x.
  if (!body.includes("--device-name")) continue;
  const read = (name) => {
    const m = body.match(new RegExp(`--${name}:([^;]+)`));
    return m ? Number.parseFloat(m[1]) : undefined;
  };
  const width = read("screen-w");
  const height = read("screen-h");
  const pixelRatio = read("pixel-ratio");
  const colorDepth = read("color-depth");
  if ([width, height, pixelRatio, colorDepth].some((v) => v === undefined || Number.isNaN(v))) {
    throw new Error(`Incomplete device profile for "${id}"`);
  }
  devices[id] = { width, height, pixelRatio, colorDepth };
}

const ids = Object.keys(devices).sort();
if (ids.length === 0) throw new Error("No device profiles found; did the CSS format change?");

const entries = ids.map((id) => {
  const d = devices[id];
  // Device pixels are what we screenshot at. A few ratios (1.28, 2.06, ...) do not
  // divide evenly, so round -- a viewport must be whole pixels.
  const deviceWidth = Math.round(d.width * d.pixelRatio);
  const deviceHeight = Math.round(d.height * d.pixelRatio);
  return `  ${id}: { width: ${d.width}, height: ${d.height}, pixelRatio: ${d.pixelRatio}, `
    + `colorDepth: ${d.colorDepth}, deviceWidth: ${deviceWidth}, deviceHeight: ${deviceHeight} },`;
});

writeFileSync(outPath, `// GENERATED FILE -- do not edit.
// Source: vendor/trmnl-framework/css/plugins.min.css (framework ${version})
// Regenerate: node server/scripts/generate-device-profiles.mjs

export type FrameworkDeviceProfile = {
  /** Layout size in CSS pixels, from --screen-w/--screen-h. */
  width: number;
  height: number;
  /** The framework applies this itself via transform: scale(). */
  pixelRatio: number;
  /** Bits per pixel the panel can show; selects the screen--Nbit class. */
  colorDepth: number;
  /** width/height x pixelRatio: the size to screenshot at, rounded to whole pixels. */
  deviceWidth: number;
  deviceHeight: number;
};

export const FRAMEWORK_DEVICES = {
${entries.join("\n")}
} as const satisfies Record<string, FrameworkDeviceProfile>;

export type FrameworkDeviceId = keyof typeof FRAMEWORK_DEVICES;

export const FRAMEWORK_DEVICE_IDS = Object.keys(FRAMEWORK_DEVICES) as [
  FrameworkDeviceId,
  ...FrameworkDeviceId[],
];

export function getDeviceProfile(id: FrameworkDeviceId): FrameworkDeviceProfile {
  return FRAMEWORK_DEVICES[id];
}
`);

console.log(`Wrote ${outPath} with ${ids.length} device profiles (framework ${version})`);
