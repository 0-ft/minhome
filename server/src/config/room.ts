import { z } from "zod";

// ── Furniture primitives ──────────────────────────────────

const Vec3 = z.tuple([z.number(), z.number(), z.number()])
  .describe("[x, y, z] in metres. x = west→east, y = up, z = north→south. Origin is at the NW corner of the room at floor level.");

const Vec2 = z.tuple([z.number(), z.number()])
  .describe("[x, y] 2D point in metres, used for extrude polygon cross-sections.");

const FurnitureBoxSchema = z.object({
  type: z.literal("box"),
  position: Vec3.describe("Centre of the box [x, y, z] in metres."),
  rotation: Vec3.optional().describe("Euler rotation [rx, ry, rz] in radians. Optional, defaults to no rotation."),
  size: Vec3.describe("[width, height, depth] of the box in metres."),
  color: z.string().describe("CSS colour string, e.g. '#8b7355' or 'tan'."),
}).describe("A rectangular cuboid furniture piece.");

const FurnitureCylinderSchema = z.object({
  type: z.literal("cylinder"),
  position: Vec3.describe("Centre of the cylinder [x, y, z] in metres."),
  rotation: Vec3.optional().describe("Euler rotation [rx, ry, rz] in radians. Optional, defaults to no rotation."),
  radius: z.number().describe("Radius of the cylinder in metres."),
  height: z.number().describe("Height of the cylinder in metres."),
  color: z.string().describe("CSS colour string, e.g. '#8b7355' or 'tan'."),
}).describe("A cylindrical furniture piece (e.g. table legs, lamp stands).");

const FurnitureExtrudeSchema = z.object({
  type: z.literal("extrude"),
  position: Vec3.describe("Base position [x, y, z] of the extrusion in metres."),
  rotation: Vec3.optional().describe("Euler rotation [rx, ry, rz] in radians. Optional, defaults to no rotation."),
  points: z.array(Vec2).min(3).describe("Array of [x, y] 2D points defining the polygon cross-section to extrude. Minimum 3 points."),
  depth: z.number().describe("Extrusion depth (height) in metres."),
  color: z.string().describe("CSS colour string, e.g. '#8b7355' or 'tan'."),
}).describe("A polygon extruded along the Y axis — useful for irregular shapes like keyboard wedges or angled surfaces.");

export const FurnitureItemSchema = z.discriminatedUnion("type", [
  FurnitureBoxSchema,
  FurnitureCylinderSchema,
  FurnitureExtrudeSchema,
]).describe("A single furniture piece. Discriminated on 'type': 'box' (cuboid), 'cylinder', or 'extrude' (polygon extrusion).");

export type FurnitureItem = z.infer<typeof FurnitureItemSchema>;

// ── Room lights ───────────────────────────────────────────

export const RoomLightSchema = z.object({
  deviceId: z.string().describe("IEEE address of the Zigbee device that controls this light, e.g. '0xa4c138d2b1cf1389'."),
  entityId: z.string().optional().describe("Entity/endpoint ID if the device has multiple endpoints, e.g. 'l1', 'l2'. Omit for single-endpoint devices."),
  position: Vec3.describe("Position [x, y, z] of the light orb in the 3D scene, in metres."),
  type: z.enum(["ceiling", "desk", "table", "floor"]).describe("Light mounting type. Affects visual rendering style."),
}).describe("A light source in the 3D room scene, linked to a real Zigbee device. Its visual state (on/off, brightness, colour temperature) is driven by live device data.");

export type RoomLight = z.infer<typeof RoomLightSchema>;

// ── Room dimensions ───────────────────────────────────────

export const RoomDimensionsSchema = z.object({
  width: z.number().describe("Room width in metres (west→east, the X axis)."),
  height: z.number().describe("Room height (floor→ceiling) in metres (the Y axis)."),
  depth: z.number().describe("Room depth in metres (north→south, the Z axis)."),
}).describe("Overall room bounding box in metres.");

export type RoomDimensions = z.infer<typeof RoomDimensionsSchema>;

// ── Camera ────────────────────────────────────────────────

export const CameraSchema = z.object({
  position: Vec3.describe("Camera position [x, y, z] in metres."),
  target: Vec3.describe("The point [x, y, z] the camera looks at."),
  zoom: z.number().describe("Orthographic zoom level (higher = more zoomed in). Typical range 80–150."),
}).describe("Saved orthographic camera pose. Managed by the UI 'save camera' button — generally don't modify via API.");

export type CameraConfig = z.infer<typeof CameraSchema>;

// ── Combined room schema ──────────────────────────────────

export const RoomSchema = z.object({
  dimensions: RoomDimensionsSchema,
  floor: z.string().describe("CSS colour string for the floor surface, e.g. '#cdc0ae'."),
  furniture: z.array(FurnitureItemSchema).describe("Array of furniture pieces to render in the room."),
  lights: z.array(RoomLightSchema).describe("Array of light sources placed in the room, each linked to a real Zigbee device."),
  camera: CameraSchema.optional().describe("Saved camera position. Optional — omit to use the default viewpoint. Preserved automatically when updating room config."),
}).describe("Full 3D room configuration. Defines the room geometry, furniture layout, and light placements for the room visualisation.");

export type RoomConfig = z.infer<typeof RoomSchema>;
