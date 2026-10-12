import type { DeviceData, Entity, Vibe, VibeEntitySetting } from "../types.js";
import { miredToRgb } from "./color.js";

// ── Entities a vibe can control ──────────────────────────

export interface ControllableEntity {
  device: DeviceData;
  entity: Entity;
}

export function isControllable(entity: Entity): boolean {
  return entity.type === "light" || entity.type === "switch";
}

export function listControllableEntities(devices: DeviceData[]): ControllableEntity[] {
  return devices.flatMap((device) =>
    (device.entities ?? []).filter(isControllable).map((entity) => ({ device, entity })),
  );
}

export const settingKey = (device: string, entity: string) => `${device}:${entity}`;

// ── Current state under canonical names ──────────────────

export interface CanonicalState {
  state?: "ON" | "OFF";
  brightness?: number;
  color_temp?: number;
  color?: { hue: number; saturation: number };
}

/**
 * Read an entity's live state under canonical names. Mirrors the server's
 * readCanonicalEntityState: only the active colour mode is reported, since Z2M
 * keeps stale values for the inactive one.
 */
export function readCanonicalState(entity: Entity): CanonicalState {
  const { features, state } = entity;
  const result: CanonicalState = {};
  const power = state?.[features.stateProperty];
  if (power === "ON" || power === "OFF") result.state = power;

  const brightness = features.brightnessProperty ? state?.[features.brightnessProperty] : undefined;
  if (typeof brightness === "number") result.brightness = brightness;

  const colorMode = features.colorProperty ? state?.[features.colorProperty.replace("color", "color_mode")] : undefined;
  const color = features.colorProperty ? state?.[features.colorProperty] as { hue?: unknown; saturation?: unknown } | undefined : undefined;
  const colorTemp = features.colorTempProperty ? state?.[features.colorTempProperty] : undefined;
  const hasColor = typeof color?.hue === "number" && typeof color?.saturation === "number";

  if (hasColor && (colorMode === "hs" || colorMode === "xy" || (colorMode === undefined && typeof colorTemp !== "number"))) {
    result.color = { hue: color!.hue as number, saturation: color!.saturation as number };
  } else if (typeof colorTemp === "number") {
    result.color_temp = colorTemp;
  }
  return result;
}

// ── Is a vibe currently active? ──────────────────────────

const BRIGHTNESS_TOLERANCE = 6;
const COLOR_TEMP_TOLERANCE = 10;
const HUE_TOLERANCE = 6;
const SATURATION_TOLERANCE = 6;

function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

function settingMatches(entity: Entity, setting: VibeEntitySetting): boolean {
  const current = readCanonicalState(entity);
  if (current.state !== setting.state) return false;
  if (setting.state === "OFF") return true;

  const { features } = entity;
  if (setting.brightness !== undefined && features.brightnessProperty) {
    if (current.brightness === undefined || Math.abs(current.brightness - setting.brightness) > BRIGHTNESS_TOLERANCE) return false;
  }
  if (setting.color && features.colorProperty) {
    if (!current.color) return false;
    if (hueDistance(current.color.hue, setting.color.hue) > HUE_TOLERANCE) return false;
    if (Math.abs(current.color.saturation - setting.color.saturation) > SATURATION_TOLERANCE) return false;
  }
  if (setting.color_temp !== undefined && features.colorTempProperty) {
    if (current.color_temp === undefined || Math.abs(current.color_temp - setting.color_temp) > COLOR_TEMP_TOLERANCE) return false;
  }
  return true;
}

/** Whether the room currently matches a vibe, within small tolerances. */
export function vibeMatches(vibe: Vibe, devices: DeviceData[]): boolean {
  const controllable = new Map(
    listControllableEntities(devices).map((c) => [settingKey(c.device.id, c.entity.key), c.entity]),
  );
  const specified = new Set<string>();
  for (const setting of vibe.entities) {
    const key = settingKey(setting.device, setting.entity);
    const entity = controllable.get(key);
    if (!entity) continue; // device gone — applying skips it too
    specified.add(key);
    if (!settingMatches(entity, setting)) return false;
  }
  if (specified.size === 0) return false;
  if (vibe.offUnspecified) {
    for (const [key, entity] of controllable) {
      if (!specified.has(key) && readCanonicalState(entity).state !== "OFF") return false;
    }
  }
  return true;
}

// ── Palette for the procedural card background ───────────

export interface PaletteColor {
  /** CSS colour. */
  css: string;
  /** Relative weight (brighter lights dominate). */
  weight: number;
}

const GREY_PALETTE: PaletteColor[] = [
  { css: "hsl(30, 6%, 46%)", weight: 1 },
  { css: "hsl(215, 8%, 62%)", weight: 0.8 },
  { css: "hsl(25, 5%, 30%)", weight: 0.7 },
  { css: "hsl(40, 8%, 74%)", weight: 0.5 },
];

const DARK_PALETTE: PaletteColor[] = [
  { css: "hsl(240, 8%, 14%)", weight: 1 },
  { css: "hsl(220, 10%, 22%)", weight: 0.8 },
  { css: "hsl(30, 6%, 10%)", weight: 0.6 },
];

/**
 * Colours a vibe puts into the room: hue lights as hsl, white lights as their
 * colour temperature, each darkened by brightness. Falls back to greys when the
 * vibe has no colour or white settings, and to near-blacks when everything is off.
 */
export function vibePalette(vibe: Pick<Vibe, "entities">): { colors: PaletteColor[]; isFallback: boolean } {
  const on = vibe.entities.filter((s) => s.state === "ON");
  if (on.length === 0) return { colors: DARK_PALETTE, isFallback: true };

  const colors: PaletteColor[] = [];
  for (const setting of on) {
    const level = (setting.brightness ?? 200) / 254;
    if (setting.color) {
      const lightness = Math.round(26 + level * 36);
      colors.push({ css: `hsl(${setting.color.hue}, ${setting.color.saturation}%, ${lightness}%)`, weight: 0.4 + level });
    } else if (setting.color_temp !== undefined) {
      const intensity = 0.45 + level * 0.55;
      const [r, g, b] = miredToRgb(setting.color_temp).map((c) => Math.round(c * intensity * 255));
      colors.push({ css: `rgb(${r}, ${g}, ${b})`, weight: 0.4 + level });
    }
  }
  if (colors.length === 0) return { colors: GREY_PALETTE, isFallback: true };
  return { colors: colors.sort((a, b) => b.weight - a.weight), isFallback: false };
}
