import type { DeviceData, Entity, Vibe, VibeEntitySetting } from "../types.js";

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

/** Fixed colours of non-colour lights (e.g. a pink lamp on a plug), keyed by settingKey. */
export function fixedColorMap(devices: DeviceData[]): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const { device, entity } of listControllableEntities(devices)) {
    if (entity.fixedColor) colors[settingKey(device.id, entity.key)] = entity.fixedColor;
  }
  return colors;
}
