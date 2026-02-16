import { createElement, type CSSProperties } from "react";
import { z } from "zod";
import { componentSuccess, type DisplayComponentResult } from "./component-result.js";

export const StringDisplayComponentConfigSchema = z.object({
  kind: z.literal("string_display"),
  text: z.string(),
  font_size: z.number().positive().optional(),
  padding: z.number().nonnegative().optional(),
  border_width: z.number().positive().optional(),
});

export type StringDisplayComponentConfig = z.infer<typeof StringDisplayComponentConfigSchema>;

export function createStringDisplayElement(
  config: StringDisplayComponentConfig,
  width: number,
  height: number,
): DisplayComponentResult {
  const borderWidth = Math.max(1, Math.round(config.border_width ?? 2));
  const padding = Math.max(0, Math.round(config.padding ?? 10));
  const computedFontSize = Math.max(
    12,
    Math.round(config.font_size ?? Math.min(width, height) * 0.2),
  );

  const style: CSSProperties = {
    width,
    height,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    border: `${borderWidth}px solid #000`,
    backgroundColor: "#fff",
    color: "#000",
    padding,
    textAlign: "center",
    fontFamily: "DejaVu Sans",
    fontSize: computedFontSize,
    fontWeight: 600,
    lineHeight: 1.2,
  };

  return componentSuccess(createElement(
    "div",
    { style },
    config.text,
  ));
}
