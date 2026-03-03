import React from "react";
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

  return componentSuccess(
    <div tw="flex flex-1 min-w-0 min-h-0 gap-0">
      {Array.from({ length: colors }, (_, i) => (
        <div key={i} tw="flex-1 h-full" style={{ backgroundColor: greyscaleHex(i, colors) }} />
      ))}
    </div>,
  );
}
