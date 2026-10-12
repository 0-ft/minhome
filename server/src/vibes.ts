import { z } from "zod";
import type { MqttBridge } from "./mqtt.js";
import type { ConfigStore } from "./config/config.js";
import {
  extractEntitiesFromExposes,
  isControllableEntity,
  readCanonicalEntityState,
  resolveEntityPayload,
  withTransition,
  type ExtractedEntity,
} from "./config/devices.js";
import { VibeColorSchema, type Vibe, type VibeEntitySetting, type VibeStore } from "./config/vibes.js";
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

/** Fixed colours of non-colour lights, keyed by `${device}:${entity}` (for vibe artwork). */
export function fixedEntityColors(bridge: MqttBridge, config: ConfigStore): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const { deviceId, entity } of listControllableEntities(bridge)) {
    const fixedColor = config.getDevice(deviceId)?.entities?.[entity.key]?.fixedColor;
    if (fixedColor) colors[entityId(deviceId, entity.key)] = fixedColor;
  }
  return colors;
}

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

export interface ApplyVibeResult extends ApplySettingsResult {
  ok: true;
  vibe: string;
  at: string;
}

export interface ApplySettingsResult {
  /** Entities the settings cover (whether or not they needed a command). */
  applied: number;
  /** Unlisted entities switched off by offUnspecified. */
  turnedOff: number;
  /** Entities already in their target state, so no command was sent. */
  unchanged: number;
  /** Every setting was sent regardless of current state. */
  forced: boolean;
  /** Settings whose device or entity no longer exists. */
  skipped: Array<{ device: string; entity: string }>;
}

/**
 * Bring entities to the given settings, sending only what differs from their
 * reported state unless `force`. With `offUnspecified`, every other light and
 * switch is turned off. Payloads are merged so each device gets a single MQTT
 * publish, and lights fade over `transition` seconds.
 */
export function applySettings(
  bridge: MqttBridge,
  settings: VibeEntitySetting[],
  options: { offUnspecified: boolean; force: boolean; transition?: number },
): ApplySettingsResult {
  const { force } = options;
  const controllable = new Map(listControllableEntities(bridge).map((c) => [entityId(c.deviceId, c.entity.key), c]));
  const perDevice = new Map<string, { payload: Record<string, unknown>; entities: ExtractedEntity[] }>();
  const send = (deviceId: string, entity: ExtractedEntity, payload: Record<string, unknown>) => {
    const current = perDevice.get(deviceId) ?? { payload: {}, entities: [] };
    perDevice.set(deviceId, {
      payload: { ...current.payload, ...resolveEntityPayload(entity, payload) },
      entities: [...current.entities, entity],
    });
  };

  const specified = new Set<string>();
  const skipped: ApplySettingsResult["skipped"] = [];
  let unchanged = 0;
  for (const setting of settings) {
    const id = entityId(setting.device, setting.entity);
    const target = controllable.get(id);
    if (!target) {
      skipped.push({ device: setting.device, entity: setting.entity });
      continue;
    }
    specified.add(id);
    const payload = force
      ? settingPayload(target.entity, setting)
      : settingDelta(target.entity, target.deviceState, setting);
    if (payload) send(target.deviceId, target.entity, payload);
    else unchanged++;
  }

  let turnedOff = 0;
  if (options.offUnspecified) {
    for (const [id, target] of controllable) {
      if (specified.has(id)) continue;
      if (!force && readCanonicalEntityState(target.entity, target.deviceState).state === "OFF") {
        unchanged++;
        continue;
      }
      send(target.deviceId, target.entity, { state: "OFF" });
      turnedOff++;
    }
  }

  // Lights fade (default DEFAULT_TRANSITION_SECONDS) so the room changes as one smooth move
  for (const [deviceId, { payload, entities }] of perDevice) {
    bridge.setDeviceState(deviceId, withTransition(entities, payload, options.transition));
  }

  return { applied: specified.size, turnedOff, unchanged, forced: force, skipped };
}

/**
 * Apply a vibe. Only lights that differ from it get commands, except that
 * re-applying a vibe that already looks active sends everything — the way to
 * fix lights whose reported state is stale.
 */
export function applyVibe(
  bridge: MqttBridge,
  vibe: Vibe,
  options: { transition?: number; force?: boolean } = {},
): ApplyVibeResult {
  const result: ApplyVibeResult = {
    ok: true,
    vibe: vibe.id,
    ...applySettings(bridge, vibe.entities, {
      offUnspecified: vibe.offUnspecified,
      force: options.force ?? isVibeActive(bridge, vibe),
      transition: options.transition,
    }),
    at: new Date().toISOString(),
  };
  debugLog.add("vibe_applied", `Vibe applied: ${vibe.name}`, result);
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

/**
 * The part of a setting the entity still needs, as a canonical payload, or
 * null when it already matches (within tolerance). Unknown state counts as
 * needing everything; a light that's already on only gets the properties that
 * are off.
 */
function settingDelta(
  entity: ExtractedEntity,
  deviceState: Record<string, unknown>,
  setting: VibeEntitySetting,
): Record<string, unknown> | null {
  const full = settingPayload(entity, setting);
  const current = readCanonicalEntityState(entity, deviceState);
  if (current.state !== setting.state) return full;
  if (setting.state === "OFF") return null;

  const delta: Record<string, unknown> = {};
  const wanted = full as { brightness?: number; color?: { hue: number; saturation: number }; color_temp?: number };
  if (wanted.brightness !== undefined
    && (current.brightness === undefined || Math.abs(current.brightness - wanted.brightness) > BRIGHTNESS_TOLERANCE)) {
    delta.brightness = wanted.brightness;
  }
  if (wanted.color
    && (!current.color
      || hueDistance(current.color.hue, wanted.color.hue) > HUE_TOLERANCE
      || Math.abs(current.color.saturation - wanted.color.saturation) > SATURATION_TOLERANCE)) {
    delta.color = wanted.color;
  }
  if (wanted.color_temp !== undefined
    && (current.color_temp === undefined || Math.abs(current.color_temp - wanted.color_temp) > COLOR_TEMP_TOLERANCE)) {
    delta.color_temp = wanted.color_temp;
  }
  return Object.keys(delta).length > 0 ? delta : null;
}

const settingMatches = (entity: ExtractedEntity, deviceState: Record<string, unknown>, setting: VibeEntitySetting) =>
  settingDelta(entity, deviceState, setting) === null;

/**
 * Whether the room currently matches a vibe, within small tolerances (lights
 * report back slightly different values than they were sent).
 */
export function isVibeActive(bridge: MqttBridge, vibe: Vibe): boolean {
  const controllable = new Map(listControllableEntities(bridge).map((c) => [entityId(c.deviceId, c.entity.key), c]));
  const specified = new Set<string>();
  for (const setting of vibe.entities) {
    const id = entityId(setting.device, setting.entity);
    const target = controllable.get(id);
    if (!target) continue; // device gone — applying skips it too
    specified.add(id);
    if (!settingMatches(target.entity, target.deviceState, setting)) return false;
  }
  // An empty vibe that leaves everything else alone has nothing to match;
  // one that turns everything else off (e.g. "dark") matches when all is off
  if (specified.size === 0 && !vibe.offUnspecified) return false;
  if (vibe.offUnspecified) {
    for (const [id, target] of controllable) {
      if (!specified.has(id) && readCanonicalEntityState(target.entity, target.deviceState).state !== "OFF") return false;
    }
  }
  return true;
}

/** Vibes with an `active` flag, as served by the API. */
export function withActivity(bridge: MqttBridge, vibes: Vibe[]): Array<Vibe & { active: boolean }> {
  return vibes.map((vibe) => ({ ...vibe, active: isVibeActive(bridge, vibe) }));
}

/**
 * Calls `onChange` whenever the set of active vibes changes, re-checking on
 * device state changes and vibe edits.
 */
export function watchActiveVibes(bridge: MqttBridge, vibes: VibeStore, onChange: () => void): void {
  const signature = () => vibes.getAll().filter((v) => isVibeActive(bridge, v)).map((v) => v.id).join(",");
  let last = signature();
  const check = () => {
    const next = signature();
    if (next === last) return;
    last = next;
    onChange();
  };
  bridge.on("state_change", check);
  vibes.onChanged(check);
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
