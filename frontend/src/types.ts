// ── Entity types (matching server EntityResponse) ────────

export interface EntityFeatures {
  stateProperty: string;
  brightnessProperty?: string;
  colorTempProperty?: string;
}

export interface Entity {
  key: string;
  name: string;
  type: string;
  state: Record<string, unknown>;
  features: EntityFeatures;
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
