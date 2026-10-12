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
 * as RGB in 0-1. Same curve as the 3D room view.
 */
export function miredToRgb(mired: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (mired - COLOR_TEMP_MIN) / (COLOR_TEMP_MAX - COLOR_TEMP_MIN)));
  return [1.0, Math.max(0.55, 0.95 - t * 0.35), Math.max(0.25, 0.85 - t * 0.55)];
}

/** CSS colour for a colour temperature, optionally scaled darker (0-1). */
export function miredToCss(mired: number, intensity = 1): string {
  const [r, g, b] = miredToRgb(mired).map((c) => Math.round(c * intensity * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

export const COLOR_TEMP_GRADIENT =
  `linear-gradient(to right, ${miredToCss(COLOR_TEMP_MIN)}, ${miredToCss(COLOR_TEMP_MAX)})`;
