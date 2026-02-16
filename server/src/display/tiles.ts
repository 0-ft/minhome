import { z } from "zod";
import { CalendarDisplayComponentConfigSchema } from "./components/calendar-display.js";
import { ColorTestComponentConfigSchema } from "./components/color-test.js";
import { StringDisplayComponentConfigSchema } from "./components/string-display.js";

export const TileRegionSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().positive().max(1),
  h: z.number().positive().max(1),
}).refine((region) => region.x + region.w <= 1, {
  message: "Tile region x + w must be <= 1",
  path: ["w"],
}).refine((region) => region.y + region.h <= 1, {
  message: "Tile region y + h must be <= 1",
  path: ["h"],
});

export type TileRegion = z.infer<typeof TileRegionSchema>;

export const TileComponentConfigSchema = z.discriminatedUnion("kind", [
  CalendarDisplayComponentConfigSchema,
  ColorTestComponentConfigSchema,
  StringDisplayComponentConfigSchema,
]);

export type TileComponentConfig = z.infer<typeof TileComponentConfigSchema>;

export const TileConfigSchema = z.object({
  region: TileRegionSchema,
  component: TileComponentConfigSchema,
});

export type TileConfig = z.infer<typeof TileConfigSchema>;
