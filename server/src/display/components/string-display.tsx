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

  return componentSuccess(
    <div
      tw="font-sans flex flex-1 min-w-0 min-h-0 items-center justify-center text-black text-center font-semibold leading-[1.2]"
      style={{ fontSize: computedFontSize }}
    >
      {config.text}
    </div>,
  );
}
