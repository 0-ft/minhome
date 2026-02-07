// ── Types for Z2M exposes ───────────────────────────────

export interface Feature {
  access: number;
  name: string;
  property: string;
  type: string;
  label?: string;
  endpoint?: string;
  value_on?: unknown;
  value_off?: unknown;
  value_min?: number;
  value_max?: number;
  features?: Feature[];
}

export interface Expose {
  type: string;
  endpoint?: string;
  features?: Feature[];
  name?: string;
  property?: string;
  access?: number;
}

export interface DeviceData {
  id: string;
  name: string;
  type: string;
  vendor: string | null;
  model: string | null;
  state: Record<string, unknown>;
  exposes: Expose[];
  entities: Record<string, string>;
}

export interface Control {
  type: string;
  endpoint?: string;
  stateProperty: string;
  brightnessProperty?: string;
  colorTempProperty?: string;
  label: string;
}

export function extractControls(exposes: Expose[]): Control[] {
  const controls: Control[] = [];
  for (const expose of exposes) {
    if ((expose.type === "switch" || expose.type === "light") && expose.features) {
      const stateFeature = expose.features.find(f => f.name === "state" && f.type === "binary");
      if (!stateFeature) continue;
      const brightnessFeature = expose.features.find(f => f.name === "brightness" && f.type === "numeric");
      const colorTempFeature = expose.features.find(f => f.name === "color_temp" && f.type === "numeric");
      controls.push({
        type: expose.type,
        endpoint: expose.endpoint,
        stateProperty: stateFeature.property,
        brightnessProperty: brightnessFeature?.property,
        colorTempProperty: colorTempFeature?.property,
        label: expose.endpoint ?? expose.type,
      });
    }
  }
  return controls;
}

