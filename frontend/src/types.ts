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
