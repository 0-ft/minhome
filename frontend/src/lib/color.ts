import { hexToRgb, hslToRgb, miredToRgb as miredRgb255, mix, type Rgb } from "@minhome/server/vibe-art";
import type { Entity } from "../types.js";
import { readCanonicalState, type CanonicalState } from "./vibes.js";

export type { Rgb };

// ── Light colour helpers ─────────────────────────────────

/** Build a CSS hsl() string from hue (0-360) and saturation (0-100). */
export function hslCss(h: number, s: number, l = 50): string {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export const HUE_GRADIENT =
  "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))";

export function saturationGradient(hue: number): string {
  return `linear-gradient(to right, hsl(${hue},0%,80%), hsl(${hue},100%,50%))`;
}

export const COLOR_TEMP_MIN = 142;
export const COLOR_TEMP_MAX = 500;

/**
 * Approximate the white of a colour temperature (mired, 142 cool → 500 warm)
 * as RGB in 0-1, for three.js. Same curve as the vibe artwork.
 */
export function miredToRgb(mired: number): [number, number, number] {
  const [r, g, b] = miredRgb255(mired);
  return [r / 255, g / 255, b / 255];
}

/** CSS colour for a colour temperature, optionally scaled darker (0-1). */
export function miredToCss(mired: number, intensity = 1): string {
  return rgbCss(mix(miredRgb255(mired), "black", 1 - intensity));
}

export const rgbCss = ([r, g, b]: Rgb) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

// ── Colour a light gives off ─────────────────────────────

/** Fallback for switches/plugs that are on but have no known colour. */
const SWITCH_ON_RGB: Rgb = [42, 157, 143]; // teal-400

/**
 * The colour an entity is giving off right now, or null when it is off (or a
 * sensor). Colour lights use their hue in colour mode, otherwise their white
 * temperature; non-colour lights use their configured fixed colour. Dimmer
 * lights come out darker.
 */
export function entityGlowColor(entity: Entity, overrides: Partial<CanonicalState> = {}): Rgb | null {
  if (entity.type !== "light" && entity.type !== "switch") return null;
  const live = { ...readCanonicalState(entity), ...overrides };
  if (live.state !== "ON") return null;

  let rgb: Rgb;
  if (live.color && entity.features.colorProperty) {
    rgb = hslToRgb(live.color.hue, Math.max(live.color.saturation, 15), 55);
  } else if (entity.fixedColor) {
    rgb = hexToRgb(entity.fixedColor);
  } else if (entity.type === "light") {
    rgb = miredRgb255(live.color_temp ?? 370);
  } else {
    rgb = SWITCH_ON_RGB;
  }
  const level = live.brightness !== undefined && entity.features.brightnessProperty ? live.brightness / 254 : 1;
  return mix(rgb, "black", (1 - level) * 0.45);
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** White or near-black, whichever reads better on the given background. */
export function readableTextColor(background: Rgb): "#ffffff" | "#1c1c20" {
  const l = luminance(background);
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (luminance([28, 28, 32]) + 0.05);
  return onWhite >= onDark ? "#ffffff" : "#1c1c20";
}

export const COLOR_TEMP_GRADIENT =
  `linear-gradient(to right, ${miredToCss(COLOR_TEMP_MIN)}, ${miredToCss(COLOR_TEMP_MAX)})`;
