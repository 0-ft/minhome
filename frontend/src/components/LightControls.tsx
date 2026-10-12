import { Palette, Sun, Thermometer } from "lucide-react";
import { DebouncedSlider } from "./ui/slider.js";
import { COLOR_TEMP_GRADIENT, COLOR_TEMP_MAX, COLOR_TEMP_MIN, HUE_GRADIENT, hslCss, saturationGradient } from "../lib/color.js";

export interface LightValues {
  brightness: number;
  colorTemp: number;
  hue: number;
  saturation: number;
}

/** A committed change, under canonical property names. */
export type LightCommit =
  | { brightness: number }
  | { color_temp: number }
  | { color: { hue: number; saturation: number } };

/**
 * Brightness / colour temperature / hue / saturation sliders for one light.
 * The parent owns the displayed values; `serverValues` re-syncs them when not
 * dragging.
 */
export function LightControls({ show, values, serverValues, active, onChange, onCommit }: {
  show: { brightness?: boolean; colorTemp?: boolean; color?: boolean };
  values: LightValues;
  serverValues: LightValues;
  /** Tints the slider icons, e.g. when the light is on. */
  active: boolean;
  onChange: (values: Partial<LightValues>) => void;
  onCommit: (commit: LightCommit) => void;
}) {
  const iconCls = `h-3.5 w-3.5 ${active ? "text-teal-600" : "text-sand-500"}`;
  const { hue, saturation } = values;

  return (
    <>
      {show.brightness && (
        <DebouncedSlider
          min={1} max={254}
          serverValue={serverValues.brightness}
          value={values.brightness}
          onValueChange={(brightness) => onChange({ brightness })}
          onCommit={(brightness) => onCommit({ brightness })}
          label={<Sun className={iconCls} />}
        />
      )}

      {show.colorTemp && (
        <DebouncedSlider
          min={COLOR_TEMP_MIN} max={COLOR_TEMP_MAX}
          serverValue={serverValues.colorTemp}
          value={values.colorTemp}
          onValueChange={(colorTemp) => onChange({ colorTemp })}
          onCommit={(color_temp) => onCommit({ color_temp })}
          label={<Thermometer className={iconCls} />}
          trackBackground={COLOR_TEMP_GRADIENT}
        />
      )}

      {show.color && (
        <>
          <DebouncedSlider
            min={0} max={360}
            serverValue={serverValues.hue}
            value={hue}
            onValueChange={(next) => onChange({ hue: next })}
            onCommit={(next) => onCommit({ color: { hue: next, saturation } })}
            label={<Palette className={iconCls} />}
            trackBackground={HUE_GRADIENT}
          />
          <DebouncedSlider
            min={0} max={100}
            serverValue={serverValues.saturation}
            value={saturation}
            onValueChange={(next) => onChange({ saturation: next })}
            onCommit={(next) => onCommit({ color: { hue, saturation: next } })}
            label={
              <div
                className="h-3.5 w-3.5 rounded-full border border-sand-400/40"
                style={{ background: hslCss(hue, saturation) }}
              />
            }
            trackBackground={saturationGradient(hue)}
          />
        </>
      )}
    </>
  );
}
