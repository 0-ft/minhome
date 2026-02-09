import { z } from "zod";

// ── Shared vectors ────────────────────────────────────────

const Vec3 = z.array(z.number()).length(3)
  .describe("[x, y, z] in metres. x = west→east, y = up, z = north→south. Origin is at the NW corner of the room at floor level.");

const Vec2 = z.array(z.number()).length(2)
  .describe("[x, y] 2D point in metres, used for extrude polygon cross-sections.");

// ── Furniture primitives ──────────────────────────────────

const FurnitureBoxSchema = z.object({
  type: z.literal("box"),
  name: z.string().optional().describe("Optional human-readable label for this piece, e.g. 'desk-top', 'shelf-3'. Useful for LLM comprehension."),
  position: Vec3.describe("Centre of the box [x, y, z] in metres."),
  rotation: Vec3.optional().describe("Euler rotation [rx, ry, rz] in radians. Optional, defaults to no rotation."),
  size: Vec3.describe("[width, height, depth] of the box in metres."),
  color: z.string().describe("CSS colour string, e.g. '#8b7355' or 'tan'."),
}).describe("A rectangular cuboid furniture piece.");

const FurnitureCylinderSchema = z.object({
  type: z.literal("cylinder"),
  name: z.string().optional().describe("Optional human-readable label for this piece. Useful for LLM comprehension."),
  position: Vec3.describe("Centre of the cylinder [x, y, z] in metres."),
  rotation: Vec3.optional().describe("Euler rotation [rx, ry, rz] in radians. Optional, defaults to no rotation."),
  radius: z.number().describe("Radius of the cylinder in metres."),
  height: z.number().describe("Height of the cylinder in metres."),
  color: z.string().describe("CSS colour string, e.g. '#8b7355' or 'tan'."),
}).describe("A cylindrical furniture piece (e.g. table legs, lamp stands).");

const FurnitureExtrudeSchema = z.object({
  type: z.literal("extrude"),
  name: z.string().optional().describe("Optional human-readable label for this piece. Useful for LLM comprehension."),
  position: Vec3.describe("Base position [x, y, z] of the extrusion in metres."),
  rotation: Vec3.optional().describe("Euler rotation [rx, ry, rz] in radians. Optional, defaults to no rotation."),
  points: z.array(Vec2).min(3).describe("Array of [x, y] 2D points defining the polygon cross-section to extrude. Minimum 3 points."),
  depth: z.number().describe("Extrusion depth (height) in metres."),
  color: z.string().describe("CSS colour string, e.g. '#8b7355' or 'tan'."),
}).describe("A polygon extruded along the Y axis — useful for irregular shapes like keyboard wedges or angled surfaces.");

/** A single renderable furniture primitive (box, cylinder, or extrude). */
export const FurniturePrimitiveSchema = z.discriminatedUnion("type", [
  FurnitureBoxSchema,
  FurnitureCylinderSchema,
  FurnitureExtrudeSchema,
]).describe("A single furniture primitive. Discriminated on 'type': 'box' (cuboid), 'cylinder', or 'extrude' (polygon extrusion).");

export type FurniturePrimitive = z.infer<typeof FurniturePrimitiveSchema>;

/** A named group of primitives that form one logical piece of furniture. */
export const FurnitureGroupSchema = z.object({
  type: z.literal("group"),
  name: z.string().describe("Name of the furniture group, e.g. 'desk', 'shelving-unit-NE', 'bed'. Helps LLMs understand which primitives belong together."),
  items: z.array(FurniturePrimitiveSchema).min(1).describe("The individual primitives that make up this piece of furniture."),
}).describe("A named group of furniture primitives that form a single logical piece (e.g. a desk with legs, a shelving unit with posts and shelves). Flattened for rendering — the grouping is purely semantic.");

export type FurnitureGroup = z.infer<typeof FurnitureGroupSchema>;

/** A furniture entry is either a standalone primitive or a named group. */
export const FurnitureItemSchema = z.discriminatedUnion("type", [
  FurnitureBoxSchema,
  FurnitureCylinderSchema,
  FurnitureExtrudeSchema,
  FurnitureGroupSchema,
]).describe("A furniture entry: either a standalone primitive ('box', 'cylinder', 'extrude') or a 'group' of primitives forming one logical piece of furniture.");

export type FurnitureItem = z.infer<typeof FurnitureItemSchema>;

// ── Room lights ───────────────────────────────────────────

export const RoomLightSchema = z.object({
  deviceId: z.string().describe("IEEE address of the Zigbee device that controls this light, e.g. '0xa4c138d2b1cf1389'."),
  entityId: z.string().default("main").describe("Entity key for the light entity on this device, e.g. 'main' for single-entity devices, 'l1', 'l2' for multi-entity. Defaults to 'main'."),
  position: Vec3.describe("Position [x, y, z] of the light orb in the 3D scene, in metres."),
  type: z.enum(["ceiling", "desk", "table", "floor"]).describe("Light mounting type. Affects visual rendering style."),
}).describe("A light source in the 3D room scene, linked to a real Zigbee device entity. Its visual state (on/off, brightness, colour temperature) is driven by live device data.");

export type RoomLight = z.infer<typeof RoomLightSchema>;

// ── Room sensors ──────────────────────────────────────────

export const RoomSensorSchema = z.object({
  deviceId: z.string().describe("IEEE address of the Zigbee sensor device, e.g. '0xa4c138f959e3ad1b'."),
  entityId: z.string().default("main").describe("Entity key on this device. Defaults to 'main'."),
  position: Vec3.describe("Position [x, y, z] of the sensor in the 3D scene, in metres."),
  rotation: Vec3.optional().describe("Euler rotation [rx, ry, rz] in radians. Optional, defaults to no rotation."),
  type: z.enum(["motion", "contact", "temperature", "generic"]).describe("Sensor category. Affects default colour of the visual and ripple."),
  shape: FurniturePrimitiveSchema.optional().describe("Optional custom shape for the sensor visual. If omitted, defaults to a small orb (sphere). Use a box/cylinder/extrude to represent physical sensor hardware like a button disc. The shape's position is relative to the sensor's position."),
}).describe("A sensor placed in the 3D room scene, linked to a real Zigbee sensor device. Triggers a ripple animation when its state changes.");

export type RoomSensor = z.infer<typeof RoomSensorSchema>;

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
  sensors: z.array(RoomSensorSchema).optional().describe("Array of sensor devices placed in the room. Each triggers a ripple animation on state change."),
  camera: CameraSchema.optional().describe("Saved camera position. Optional — omit to use the default viewpoint. Preserved automatically when updating room config."),
}).describe("Full 3D room configuration. Defines the room geometry, furniture layout, light placements, and sensor placements for the room visualisation.");

export type RoomConfig = z.infer<typeof RoomSchema>;
