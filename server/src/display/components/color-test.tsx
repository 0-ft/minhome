import React, { type CSSProperties } from "react";
import { z } from "zod";
import { componentSuccess, type DisplayComponentResult } from "./component-result.js";

export const ColorTestComponentConfigSchema = z.object({
  kind: z.literal("color_test"),
  colors: z.number().int().min(2).max(32).default(4),
});

export type ColorTestComponentConfig = z.infer<typeof ColorTestComponentConfigSchema>;

function greyscaleHex(index: number, total: number): string {
  const value = Math.round((index / (total - 1)) * 255);
  const hex = value.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

export function createColorTestElement(config: ColorTestComponentConfig): DisplayComponentResult {
  const colors = config.colors;

  const wrapperStyle: CSSProperties = {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    gap: 0,
  };

  const swatchStyle: CSSProperties = {
    flex: 1,
    height: "100%",
  };

  return componentSuccess(
    <div style={wrapperStyle}>
      {Array.from({ length: colors }, (_, i) => (
        <div key={i} style={{ ...swatchStyle, backgroundColor: greyscaleHex(i, colors) }} />
      ))}
    </div>,
  );
}
