/**
 * Procedural vibe artwork as a standalone SVG: a gradient base overlaid with
 * soft radial-gradient shapes in the vibe's light colours. Pure (no Node or DOM
 * APIs) so the frontend can import it too and render unsaved drafts identically
 * to what GET /api/vibes/:id/art.svg serves.
 *
 * Only plain gradients and opacity are used — no filters, blend modes or CSS
 * colour functions — so any SVG renderer draws it the same.
 */

export interface VibeArtSetting {
  device: string;
  entity: string;
  state: "ON" | "OFF";
  brightness?: number;
  color_temp?: number;
  color?: { hue: number; saturation: number };
}

export interface VibeArtInput {
  id: string;
  entities: VibeArtSetting[];
  /** Fixed colours ("#rrggbb") of non-colour lights, keyed by `${device}:${entity}`. */
  fixedColors?: Record<string, string>;
}

export interface VibeArtOptions {
  width?: number;
  height?: number;
}

// ── Colour maths ─────────────────────────────────────────

type Rgb = [number, number, number]; // 0-255

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function hexToRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Same warm/cool white curve as the dashboard (mired 142 cool → 500 warm). */
function miredToRgb(mired: number): Rgb {
  const t = Math.max(0, Math.min(1, (mired - 142) / (500 - 142)));
  return [255, Math.max(0.55, 0.95 - t * 0.35) * 255, Math.max(0.25, 0.85 - t * 0.55) * 255];
}

/** Mix towards black or white; amount 0 = unchanged, 1 = fully black/white. */
function mix(rgb: Rgb, towards: "black" | "white", amount: number): Rgb {
  const target = towards === "black" ? 0 : 255;
  return rgb.map((c) => c + (target - c) * amount) as Rgb;
}

function toHex(rgb: Rgb): string {
  return "#" + rgb.map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("");
}

// ── Palette ──────────────────────────────────────────────

interface PaletteColor {
  rgb: Rgb;
  /** Relative weight (brighter lights dominate). */
  weight: number;
}

const GREYS: PaletteColor[] = [
  { rgb: hslToRgb(30, 6, 46), weight: 1 },
  { rgb: hslToRgb(215, 8, 62), weight: 0.8 },
  { rgb: hslToRgb(25, 5, 30), weight: 0.7 },
  { rgb: hslToRgb(40, 8, 74), weight: 0.5 },
];

const DARKS: PaletteColor[] = [
  { rgb: hslToRgb(240, 8, 14), weight: 1 },
  { rgb: hslToRgb(220, 10, 22), weight: 0.8 },
  { rgb: hslToRgb(30, 6, 10), weight: 0.6 },
];

/**
 * Colours a vibe puts into the room: hue lights as their colour, fixed-colour
 * lights as that colour, white lights as their colour temperature, each darkened
 * by brightness. Greys when nothing is coloured, near-blacks when all is off.
 */
export function vibeArtPalette(input: VibeArtInput): { colors: PaletteColor[]; isFallback: boolean } {
  const on = input.entities.filter((s) => s.state === "ON");
  if (on.length === 0) return { colors: DARKS, isFallback: true };

  const colors: PaletteColor[] = [];
  for (const setting of on) {
    const level = (setting.brightness ?? 200) / 254;
    const weight = 0.4 + level;
    const fixed = input.fixedColors?.[`${setting.device}:${setting.entity}`];
    if (setting.color) {
      colors.push({ rgb: hslToRgb(setting.color.hue, setting.color.saturation, 26 + level * 36), weight });
    } else if (fixed) {
      colors.push({ rgb: mix(hexToRgb(fixed), "black", (1 - level) * 0.55), weight });
    } else if (setting.color_temp !== undefined) {
      colors.push({ rgb: mix(miredToRgb(setting.color_temp), "black", (1 - level) * 0.55), weight });
    }
  }
  if (colors.length === 0) return { colors: GREYS, isFallback: true };
  return { colors: colors.sort((a, b) => b.weight - a.weight), isFallback: false };
}

// ── Seeded randomness (same vibe → same artwork) ─────────

function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createRng(seed: number) {
  const next = mulberry32(seed);
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    weighted: (colors: PaletteColor[]): Rgb => {
      const total = colors.reduce((sum, c) => sum + c.weight, 0);
      let roll = next() * total;
      for (const c of colors) {
        roll -= c.weight;
        if (roll <= 0) return c.rgb;
      }
      return colors[colors.length - 1].rgb;
    },
  };
}

// ── SVG ──────────────────────────────────────────────────

const round = (n: number) => Math.round(n * 10) / 10;

/** Render a vibe's artwork as an SVG document string. */
export function renderVibeArt(input: VibeArtInput, options: VibeArtOptions = {}): string {
  const width = options.width ?? 400;
  const height = options.height ?? 250;
  const { colors, isFallback } = vibeArtPalette(input);
  const fixed = Object.entries(input.fixedColors ?? {}).sort();
  const rng = createRng(hashString(input.id + JSON.stringify(input.entities) + JSON.stringify(fixed)));

  // Base: a gradient between the two strongest colours, ending in a deep shade
  const first = colors[0].rgb;
  const second = colors.length > 1 ? colors[1].rgb : mix(first, "black", 0.55);
  const deep = mix(rng.weighted(colors), "black", rng.range(0.45, 0.7));
  const angle = rng.range(0, Math.PI * 2);
  const dx = Math.cos(angle) / 2;
  const dy = Math.sin(angle) / 2;
  const defs: string[] = [
    `<linearGradient id="base" x1="${round(0.5 - dx)}" y1="${round(0.5 - dy)}" x2="${round(0.5 + dx)}" y2="${round(0.5 + dy)}">` +
      `<stop offset="0" stop-color="${toHex(first)}"/>` +
      `<stop offset="${round(rng.range(0.4, 0.65))}" stop-color="${toHex(second)}"/>` +
      `<stop offset="1" stop-color="${toHex(deep)}"/>` +
    `</linearGradient>`,
  ];
  const shapes: string[] = [`<rect width="${width}" height="${height}" fill="url(#base)"/>`];

  // Glows: ellipses filled with a radial gradient that fades to transparent,
  // giving soft shapes without any blur filter
  const count = Math.round(rng.range(3, isFallback ? 5 : 6.99));
  const span = Math.max(width, height);
  for (let i = 0; i < count; i++) {
    const roll = rng.next();
    const rgb = roll < 0.25
      ? mix(rng.weighted(colors), rng.next() < 0.5 ? "white" : "black", rng.range(0.15, 0.4))
      : rng.weighted(colors);
    const rx = span * rng.range(0.25, 0.6);
    const ry = rx * rng.range(0.55, 1.3);
    const cx = width * rng.range(-0.1, 1.1);
    const cy = height * rng.range(-0.2, 1.2);
    const rotate = rng.range(0, 180);
    const opacity = rng.range(0.55, 0.95);
    const hex = toHex(rgb);
    defs.push(
      `<radialGradient id="g${i}">` +
        `<stop offset="0" stop-color="${hex}" stop-opacity="${round(opacity)}"/>` +
        `<stop offset="${round(rng.range(0.25, 0.5))}" stop-color="${hex}" stop-opacity="${round(opacity * 0.6)}"/>` +
        `<stop offset="1" stop-color="${hex}" stop-opacity="0"/>` +
      `</radialGradient>`,
    );
    shapes.push(
      `<ellipse cx="${round(cx)}" cy="${round(cy)}" rx="${round(rx)}" ry="${round(ry)}" ` +
      `transform="rotate(${round(rotate)} ${round(cx)} ${round(cy)})" fill="url(#g${i})"/>`,
    );
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice">` +
    `<defs>${defs.join("")}</defs>${shapes.join("")}</svg>`;
}
