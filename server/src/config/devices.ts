import { z } from "zod";

// ── Config schemas ──────────────────────────────────────

export const EntityConfigSchema = z.object({
  name: z.string().optional(),
});

export type EntityConfig = z.infer<typeof EntityConfigSchema>;

// Accept legacy string values ("name") and convert to { name: "name" }
const EntityConfigValue = z.preprocess(
  (val) => (typeof val === "string" ? { name: val } : val),
  EntityConfigSchema,
);

export const DeviceConfigSchema = z.object({
  name: z.string().optional(),
  entities: z.record(z.string(), EntityConfigValue).optional(),
});

export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

// ── Entity extraction from Z2M exposes ──────────────────

export interface EntityFeatures {
  stateProperty: string;
  brightnessProperty?: string;
  colorTempProperty?: string;
}

export interface ExtractedEntity {
  key: string;
  type: string;
  features: EntityFeatures;
}

export interface EntityResponse {
  key: string;
  name: string;
  type: string;
  state: Record<string, unknown>;
  features: EntityFeatures;
}

/**
 * Extract entities from Z2M exposes array.
 * Each controllable group (switch or light) becomes one entity.
 * Multi-endpoint devices get entity keys from Z2M (e.g. "l1", "l2", "l3").
 * Single-endpoint devices get the sentinel key "main".
 */
export function extractEntitiesFromExposes(exposes: unknown[]): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  for (const expose of exposes) {
    const e = expose as {
      type?: string;
      endpoint?: string;
      features?: Array<{ name: string; property: string; type: string }>;
    };
    if ((e.type === "switch" || e.type === "light") && e.features) {
      const stateFeature = e.features.find(f => f.name === "state" && f.type === "binary");
      if (!stateFeature) continue;
      const brightnessFeature = e.features.find(f => f.name === "brightness" && f.type === "numeric");
      const colorTempFeature = e.features.find(f => f.name === "color_temp" && f.type === "numeric");
      entities.push({
        key: e.endpoint ?? "main",
        type: e.type,
        features: {
          stateProperty: stateFeature.property,
          brightnessProperty: brightnessFeature?.property,
          colorTempProperty: colorTempFeature?.property,
        },
      });
    }
  }
  return entities;
}

/**
 * Build structured entity responses for a device.
 * Merges Z2M exposes with config overrides and live state.
 *
 * Name resolution: config entity name > device name (single entity) > endpoint key.
 */
export function buildEntityResponses(
  extracted: ExtractedEntity[],
  deviceName: string,
  entityConfigs: Record<string, EntityConfig> | undefined,
  deviceState: Record<string, unknown>,
): EntityResponse[] {
  const stateMap = partitionEntityState(extracted, deviceState);
  const isSingle = extracted.length === 1;

  return extracted.map(e => ({
    key: e.key,
    name: entityConfigs?.[e.key]?.name ?? (isSingle ? deviceName : e.key),
    type: e.type,
    state: stateMap.get(e.key) ?? {},
    features: e.features,
  }));
}

/**
 * Resolve a canonical entity payload to actual MQTT property names.
 * e.g. { state: "ON" } on entity "l3" → { state_l3: "ON" }
 */
export function resolveEntityPayload(
  entity: ExtractedEntity,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    resolved[resolveCanonicalProperty(entity, key)] = value;
  }
  return resolved;
}

/**
 * Get the actual MQTT property name from a canonical name for an entity.
 * e.g. "state" on entity l3 → "state_l3"; "state" on entity main → "state"
 */
export function resolveCanonicalProperty(entity: ExtractedEntity, canonical: string): string {
  switch (canonical) {
    case "state": return entity.features.stateProperty;
    case "brightness": return entity.features.brightnessProperty ?? canonical;
    case "color_temp": return entity.features.colorTempProperty ?? canonical;
    default: return canonical;
  }
}

/**
 * Partition a flat device state into per-entity state objects.
 * Each entity gets only the properties it owns.
 */
export function partitionEntityState(
  entities: ExtractedEntity[],
  deviceState: Record<string, unknown>,
): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>();
  for (const entity of entities) {
    const state: Record<string, unknown> = {};
    const props = [
      entity.features.stateProperty,
      entity.features.brightnessProperty,
      entity.features.colorTempProperty,
    ].filter((p): p is string => !!p);
    for (const prop of props) {
      if (prop in deviceState) {
        state[prop] = deviceState[prop];
      }
    }
    result.set(entity.key, state);
  }
  return result;
}
