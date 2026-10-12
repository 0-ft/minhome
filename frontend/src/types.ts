// ── Entity types (matching server EntityResponse) ────────

export interface EntityFeatures {
  stateProperty: string;
  brightnessProperty?: string;
  colorTempProperty?: string;
  /** MQTT property for the composite colour value (e.g. "color" or "color_l3"). */
  colorProperty?: string;
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

export interface Entity {
  key: string;
  name: string;
  /** User-written note on what the entity is. */
  description?: string;
  type: string;
  state: Record<string, unknown>;
  features: EntityFeatures;
  sensorProperties?: SensorProperty[];
}

export interface DeviceData {
  id: string;
  name: string;
  type: string;
  vendor: string | null;
  model: string | null;
  state: Record<string, unknown>;
  entities: Entity[];
  exposes?: unknown[];
}

// ── Vibes (matching server VibeSchema) ───────────────────

export interface VibeColor {
  hue: number;
  saturation: number;
}

/** Target state for one entity, under canonical property names. */
export interface VibeEntitySetting {
  device: string;
  entity: string;
  state: "ON" | "OFF";
  brightness?: number;
  color_temp?: number;
  color?: VibeColor;
}

export interface Vibe {
  id: string;
  name: string;
  /** Lucide icon name (kebab-case). */
  icon?: string;
  /** Turn off every light/switch not in `entities` when applied. */
  offUnspecified: boolean;
  entities: VibeEntitySetting[];
  createdAt: string;
  updatedAt: string;
}
