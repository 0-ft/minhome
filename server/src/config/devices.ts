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

export interface SensorProperty {
  name: string;
  property: string;
  type: string;
  values?: string[];
  unit?: string;
  valueMin?: number;
  valueMax?: number;
  description?: string;
}

export interface ExtractedEntity {
  key: string;
  type: string;
  features: EntityFeatures;
  sensorProperties?: SensorProperty[];
}

export interface EntityResponse {
  key: string;
  name: string;
  type: string;
  state: Record<string, unknown>;
  features: EntityFeatures;
  sensorProperties?: SensorProperty[];
}

/** Top-level expose property names that indicate a sensor device (not linkquality/battery which are diagnostic) */
const SENSOR_PROPERTIES = new Set([
  "action", "contact", "occupancy", "water_leak",
  "temperature", "humidity", "illuminance", "illuminance_lux",
  "pressure", "co2", "voc", "formaldehyde", "pm25", "soil_moisture",
  "vibration", "angle", "angle_x", "angle_y", "angle_z",
]);

/**
 * Extract entities from Z2M exposes array.
 * Each controllable group (switch or light) becomes one entity.
 * Multi-endpoint devices get entity keys from Z2M (e.g. "l1", "l2", "l3").
 * Single-endpoint devices get the sentinel key "main".
 *
 * If no switch/light entities are found, top-level exposes are checked for
 * sensor properties (action, contact, occupancy, temperature, etc.) and
 * collected into a single "sensor" entity with key "main".
 */
export function extractEntitiesFromExposes(exposes: unknown[]): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const topLevelSensorProps: SensorProperty[] = [];

  for (const expose of exposes) {
    const e = expose as {
      type?: string;
      name?: string;
      property?: string;
      endpoint?: string;
      description?: string;
      unit?: string;
      values?: string[];
      value_min?: number;
      value_max?: number;
      features?: Array<{ name: string; property: string; type: string }>;
    };

    // Grouped expose (switch or light)
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
      continue;
    }

    // Top-level expose (potential sensor property)
    if (e.property && e.name && SENSOR_PROPERTIES.has(e.name)) {
      topLevelSensorProps.push({
        name: e.name,
        property: e.property,
        type: e.type ?? "unknown",
        values: e.values,
        unit: e.unit,
        valueMin: e.value_min,
        valueMax: e.value_max,
        description: e.description,
      });
    }
  }

  // If no switch/light entities found but sensor properties exist, create a sensor entity
  if (entities.length === 0 && topLevelSensorProps.length > 0) {
    entities.push({
      key: "main",
      type: "sensor",
      features: { stateProperty: topLevelSensorProps[0].property },
      sensorProperties: topLevelSensorProps,
    });
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
    ...(e.sensorProperties ? { sensorProperties: e.sensorProperties } : {}),
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
      ...(entity.sensorProperties?.map(sp => sp.property) ?? []),
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
