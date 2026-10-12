import type { DeviceData, Entity } from "../types.js";

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

/** Fixed colours of non-colour lights (e.g. a pink lamp on a plug), keyed by settingKey. */
export function fixedColorMap(devices: DeviceData[]): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const { device, entity } of listControllableEntities(devices)) {
    if (entity.fixedColor) colors[settingKey(device.id, entity.key)] = entity.fixedColor;
  }
  return colors;
}
