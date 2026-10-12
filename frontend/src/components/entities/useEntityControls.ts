import { useEffect, useState } from "react";
import type { Entity } from "../../types.js";
import type { LightCommit, LightValues } from "../LightControls.js";
import { entityGlowColor, readableTextColor, rgbCss, type Rgb } from "../../lib/color.js";
import { readCanonicalState } from "../../lib/vibes.js";

/**
 * Local slider state and commands for one entity, plus the colour it is giving
 * off (updated live while dragging) for colouring its card.
 */
export function useEntityControls(entity: Entity, onSet: (payload: Record<string, unknown>) => void) {
  const { features, state } = entity;
  const live = readCanonicalState(entity);
  const isOn = live.state === "ON";

  const colorObj = features.colorProperty ? state?.[features.colorProperty] as { hue?: number; saturation?: number } | undefined : undefined;
  const serverValues: LightValues = {
    brightness: live.brightness ?? 127,
    colorTemp: typeof state?.[features.colorTempProperty ?? ""] === "number" ? state[features.colorTempProperty!] as number : 370,
    hue: typeof colorObj?.hue === "number" ? colorObj.hue : 0,
    saturation: typeof colorObj?.saturation === "number" ? colorObj.saturation : 100,
  };
  const [values, setValues] = useState<LightValues>(serverValues);
  // Which colour mode the user last touched, until the light reports back
  const [modeOverride, setModeOverride] = useState<"color" | "white" | null>(null);
  const serverMode = live.color ? "color" : "white";
  const mode = modeOverride ?? serverMode;
  useEffect(() => setModeOverride(null), [serverMode]);

  const glow: Rgb | null = entityGlowColor(entity, {
    brightness: values.brightness,
    ...(features.colorProperty && mode === "color"
      ? { color: { hue: values.hue, saturation: values.saturation }, color_temp: undefined }
      : { color: undefined, color_temp: values.colorTemp }),
  });

  const toggle = () => {
    if (isOn) {
      onSet({ [features.stateProperty]: "OFF" });
      return;
    }
    onSet({
      [features.stateProperty]: "ON",
      ...(features.brightnessProperty && { [features.brightnessProperty]: values.brightness }),
      ...(features.colorProperty && mode === "color"
        ? { [features.colorProperty]: { hue: values.hue, saturation: values.saturation } }
        : features.colorTempProperty ? { [features.colorTempProperty]: values.colorTemp } : {}),
    });
  };

  const change = (next: Partial<LightValues>) => {
    // Sliders echo synced values back, so only count values that actually moved
    const moved = (key: keyof LightValues) => next[key] !== undefined && next[key] !== values[key];
    if (moved("hue") || moved("saturation")) setModeOverride("color");
    else if (moved("colorTemp")) setModeOverride("white");
    setValues((v) => ({ ...v, ...next }));
  };

  const commit = (c: LightCommit) => {
    if ("brightness" in c) onSet({ [features.brightnessProperty!]: c.brightness });
    else if ("color_temp" in c) onSet({ [features.colorTempProperty!]: c.color_temp });
    else onSet({ [features.colorProperty!]: c.color });
  };

  return {
    isOn,
    values,
    serverValues,
    change,
    commit,
    toggle,
    /** CSS background and text colour while on, or null when off. */
    surface: glow ? { background: rgbCss(glow), color: readableTextColor(glow) } : null,
    lightControls: {
      show: {
        brightness: !!features.brightnessProperty,
        colorTemp: !!features.colorTempProperty,
        color: !!features.colorProperty,
      },
    },
  };
}
