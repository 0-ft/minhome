import { z } from "zod";

// ── Furniture primitives ──────────────────────────────────

const Vec3 = z.tuple([z.number(), z.number(), z.number()]);
const Vec2 = z.tuple([z.number(), z.number()]);

const FurnitureBoxSchema = z.object({
  type: z.literal("box"),
  position: Vec3,
  rotation: Vec3.optional(),
  size: Vec3,
  color: z.string(),
});

const FurnitureCylinderSchema = z.object({
  type: z.literal("cylinder"),
  position: Vec3,
  rotation: Vec3.optional(),
  radius: z.number(),
  height: z.number(),
  color: z.string(),
});

const FurnitureExtrudeSchema = z.object({
  type: z.literal("extrude"),
  position: Vec3,
  rotation: Vec3.optional(),
  points: z.array(Vec2).min(3),
  depth: z.number(),
  color: z.string(),
});

export const FurnitureItemSchema = z.discriminatedUnion("type", [
  FurnitureBoxSchema,
  FurnitureCylinderSchema,
  FurnitureExtrudeSchema,
]);

export type FurnitureItem = z.infer<typeof FurnitureItemSchema>;

// ── Room lights ───────────────────────────────────────────

export const RoomLightSchema = z.object({
  deviceId: z.string(),
  entityId: z.string().optional(),
  position: Vec3,
  type: z.enum(["ceiling", "desk", "table", "floor"]),
});

export type RoomLight = z.infer<typeof RoomLightSchema>;

// ── Room dimensions ───────────────────────────────────────

export const RoomDimensionsSchema = z.object({
  width: z.number(),
  height: z.number(),
  depth: z.number(),
});

export type RoomDimensions = z.infer<typeof RoomDimensionsSchema>;

// ── Camera ────────────────────────────────────────────────

export const CameraSchema = z.object({
  position: Vec3,
  target: Vec3,
  zoom: z.number(),
});

export type CameraConfig = z.infer<typeof CameraSchema>;

// ── Combined room schema ──────────────────────────────────

export const RoomSchema = z.object({
  dimensions: RoomDimensionsSchema,
  floor: z.string(),
  furniture: z.array(FurnitureItemSchema),
  lights: z.array(RoomLightSchema),
  camera: CameraSchema.optional(),
});

export type RoomConfig = z.infer<typeof RoomSchema>;

