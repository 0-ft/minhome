import type { CSSProperties } from "react";
import { z } from "zod";
import { componentSuccess, type DisplayComponentResult } from "./component-result.js";

export const StringDisplayComponentConfigSchema = z.object({
  kind: z.literal("string_display"),
  text: z.string(),
  font_size: z.number().positive().optional(),
});

export type StringDisplayComponentConfig = z.infer<typeof StringDisplayComponentConfigSchema>;

export function createStringDisplayElement(config: StringDisplayComponentConfig): DisplayComponentResult {
  const computedFontSize = Math.max(12, Math.round(config.font_size ?? 20));

  const style: CSSProperties = {
    display: "flex",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    color: "#000",
    textAlign: "center",
    fontFamily: "DejaVu Sans",
    fontSize: computedFontSize,
    fontWeight: 600,
    lineHeight: 1.2,
  };

  return componentSuccess(
    <div style={style}>
      {config.text}
    </div>,
  );
}
