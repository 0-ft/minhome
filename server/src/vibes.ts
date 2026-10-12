import { z } from "zod";
import type { MqttBridge } from "./mqtt.js";
import {
  extractEntitiesFromExposes,
  isControllableEntity,
  readCanonicalEntityState,
  resolveEntityPayload,
  type ExtractedEntity,
} from "./config/devices.js";
import { VibeColorSchema, type Vibe, type VibeEntitySetting } from "./config/vibes.js";
import { debugLog } from "./debug-log.js";

interface ControllableEntity {
  deviceId: string;
  entity: ExtractedEntity;
  deviceState: Record<string, unknown>;
}

/** Every light/switch entity across all devices (vibes never touch sensors). */
export function listControllableEntities(bridge: MqttBridge): ControllableEntity[] {
  return [...bridge.devices.values()]
    .filter((d) => d.type !== "Coordinator")
    .flatMap((d) =>
      extractEntitiesFromExposes(d.definition?.exposes ?? [])
        .filter(isControllableEntity)
        .map((entity) => ({
          deviceId: d.ieee_address,
          entity,
          deviceState: bridge.states.get(d.ieee_address) ?? {},
        })),
    );
}

const entityId = (deviceId: string, key: string) => `${deviceId}:${key}`;

/** Snapshot the current state of every controllable entity as vibe settings. */
export function captureVibeSettings(bridge: MqttBridge): VibeEntitySetting[] {
  const settings: VibeEntitySetting[] = [];
  for (const { deviceId, entity, deviceState } of listControllableEntities(bridge)) {
    const current = readCanonicalEntityState(entity, deviceState);
    if (!current.state) continue; // never reported — leave it out rather than guess
    if (current.state === "OFF") {
      settings.push({ device: deviceId, entity: entity.key, state: "OFF" });
      continue;
    }
    settings.push({
      device: deviceId,
      entity: entity.key,
      state: "ON",
      ...(current.brightness !== undefined && { brightness: Math.max(1, current.brightness) }),
      ...(current.color ? { color: current.color } : current.color_temp !== undefined ? { color_temp: current.color_temp } : {}),
    });
  }
  return settings;
}

/** Canonical payload for a setting, limited to properties the entity supports. */
function settingPayload(entity: ExtractedEntity, setting: VibeEntitySetting): Record<string, unknown> {
  if (setting.state === "OFF") return { state: "OFF" };
  const { features } = entity;
  return {
    state: "ON",
    ...(setting.brightness !== undefined && features.brightnessProperty && { brightness: setting.brightness }),
    ...(setting.color && features.colorProperty && { color: setting.color }),
    ...(setting.color_temp !== undefined && features.colorTempProperty && { color_temp: setting.color_temp }),
  };
}

export interface ApplyVibeResult {
  ok: true;
  vibe: string;
  applied: number;
  turnedOff: number;
  /** Settings whose device or entity no longer exists. */
  skipped: Array<{ device: string; entity: string }>;
  at: string;
}

/**
 * Apply a vibe: send every setting, plus OFF to all other controllable
 * entities when `offUnspecified` is set. Payloads are merged so each device
 * gets a single MQTT publish.
 */
export function applyVibe(bridge: MqttBridge, vibe: Vibe): ApplyVibeResult {
  const controllable = new Map(listControllableEntities(bridge).map((c) => [entityId(c.deviceId, c.entity.key), c]));
  const perDevice = new Map<string, Record<string, unknown>>();
  const send = (deviceId: string, entity: ExtractedEntity, payload: Record<string, unknown>) => {
    perDevice.set(deviceId, { ...perDevice.get(deviceId), ...resolveEntityPayload(entity, payload) });
  };

  const specified = new Set<string>();
  const skipped: ApplyVibeResult["skipped"] = [];
  for (const setting of vibe.entities) {
    const id = entityId(setting.device, setting.entity);
    const target = controllable.get(id);
    if (!target) {
      skipped.push({ device: setting.device, entity: setting.entity });
      continue;
    }
    specified.add(id);
    send(target.deviceId, target.entity, settingPayload(target.entity, setting));
  }

  let turnedOff = 0;
  if (vibe.offUnspecified) {
    for (const [id, target] of controllable) {
      if (specified.has(id)) continue;
      send(target.deviceId, target.entity, { state: "OFF" });
      turnedOff++;
    }
  }

  for (const [deviceId, payload] of perDevice) bridge.setDeviceState(deviceId, payload);

  const result: ApplyVibeResult = {
    ok: true,
    vibe: vibe.id,
    applied: specified.size,
    turnedOff,
    skipped,
    at: new Date().toISOString(),
  };
  debugLog.add("vibe_applied", `Vibe applied: ${vibe.name}`, result);
  return result;
}

/** Settings that target an entity which doesn't exist or can't be controlled. */
export function findUnknownSettings(bridge: MqttBridge, settings: VibeEntitySetting[]): string[] {
  const known = new Set(listControllableEntities(bridge).map((c) => entityId(c.deviceId, c.entity.key)));
  return settings
    .map((s) => entityId(s.device, s.entity))
    .filter((id) => !known.has(id));
}

/** Convert "#RRGGBB" to Z2M hue (0-360) / saturation (0-100). */
export function hexToHueSaturation(hex: string): { hue: number; saturation: number } {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  return {
    hue: Math.round((hue * 60 + 360) % 360),
    saturation: Math.round(max === 0 ? 0 : (delta / max) * 100),
  };
}

/** Setting as accepted from tools and the API: colour may also be given as hex. */
export const VibeSettingInputSchema = z.object({
  device: z.string().describe("Device IEEE address"),
  entity: z.string().describe("Entity key, e.g. 'main', 'l1'"),
  state: z.enum(["ON", "OFF"]),
  brightness: z.number().int().min(1).max(254).optional().describe("1-254, only for entities with brightness"),
  color_temp: z.number().int().positive().optional().describe("Mired, typically 142 (cool) - 500 (warm). Not together with color"),
  color: z.union([
    VibeColorSchema,
    z.object({ hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/) }),
  ]).optional().describe('{"hue":0-360,"saturation":0-100} or {"hex":"#RRGGBB"}. Only for colour lights'),
});
export type VibeSettingInput = z.infer<typeof VibeSettingInputSchema>;

export function normalizeSettingInput(input: VibeSettingInput): VibeEntitySetting {
  const { color, ...rest } = input;
  if (input.state === "OFF") return { device: rest.device, entity: rest.entity, state: "OFF" };
  if (!color) return rest;
  return { ...rest, color: "hex" in color ? hexToHueSaturation(color.hex) : color };
}
