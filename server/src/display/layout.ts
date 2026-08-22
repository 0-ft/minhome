import { z } from "zod";
import { CalendarDisplayComponentConfigSchema } from "./components/calendar-display.js";
import { PolymarketGraphDisplayComponentConfigSchema } from "./components/polymarket-graph-display.js";
import { StringDisplayComponentConfigSchema } from "./components/string-display.js";
import { ListDisplayComponentConfigSchema } from "./components/list-display.js";

export const DisplayComponentConfigSchema = z.discriminatedUnion("kind", [
  CalendarDisplayComponentConfigSchema,
  ListDisplayComponentConfigSchema,
  PolymarketGraphDisplayComponentConfigSchema,
  StringDisplayComponentConfigSchema,
]);

export type DisplayComponentConfig = z.infer<typeof DisplayComponentConfigSchema>;

/**
 * Layout is expressed in the framework's own primitives rather than an abstraction
 * over them: each value maps to a `layout--<value>` class. Keeping the names
 * identical means the framework docs are the reference, and a modifier added
 * upstream needs only an entry here.
 */
export const LayoutModifierSchema = z.enum([
  // main-axis direction
  "row",
  "col",
  // block placement
  "top",
  "bottom",
  "center",
  "left",
  "right",
  // cross/main alignment
  "align-start",
  "align-center",
  "align-end",
  "justify-start",
  "justify-center",
  "justify-end",
  // stretch behaviour
  "stretch",
  "stretch-x",
  "stretch-y",
  "stretch-main",
  "stretch-cross",
]);

export type LayoutModifier = z.infer<typeof LayoutModifierSchema>;

export const ColumnConfigSchema = z.object({
  component: DisplayComponentConfigSchema,
});

export type ColumnConfig = z.infer<typeof ColumnConfigSchema>;

/**
 * A screen's contents. Replaces the old fractional `region` rectangles: the
 * framework sizes columns itself, so positions are no longer ours to compute.
 */
export const ScreenLayoutSchema = z.object({
  /** `view--full` or `view--half`. */
  view: z.enum(["full", "half"]).default("full"),
  /** Applied to the `.layout` element as `layout--<modifier>`. */
  layout: z.array(LayoutModifierSchema).default([]),
  /** Rendered as sibling `.column`s inside a single `.columns`. */
  columns: z.array(ColumnConfigSchema).min(1),
});

export type ScreenLayout = z.infer<typeof ScreenLayoutSchema>;
