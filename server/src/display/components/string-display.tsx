import { z } from "zod";
import { componentSuccess, type DisplayComponentResult } from "./component-result.js";

export const StringDisplayComponentConfigSchema = z.object({
  kind: z.literal("string_display"),
  text: z.string(),
  /** Framework size modifier; the framework scales the actual pixels per device. */
  size: z.enum(["small", "medium", "large", "xlarge"]).default("large"),
});

export type StringDisplayComponentConfig = z.infer<typeof StringDisplayComponentConfigSchema>;

export function createStringDisplayElement(config: StringDisplayComponentConfig): DisplayComponentResult {
  return componentSuccess(
    <div className="flex flex--center h--full">
      <span className={`value value--${config.size}`}>{config.text}</span>
    </div>,
  );
}
