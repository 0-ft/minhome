import { readFileSync, writeFileSync, existsSync } from "fs";
import { z } from "zod";
import { DeviceConfigSchema, EntityConfigSchema, extractEntitiesFromExposes } from "./devices.js";
import { RoomSchema } from "./room.js";

// Re-export sub-module types for consumers
export { DeviceConfigSchema, EntityConfigSchema } from "./devices.js";
export type { DeviceConfig, EntityConfig, ExtractedEntity, EntityFeatures, EntityResponse } from "./devices.js";
export { extractEntitiesFromExposes, buildEntityResponses, resolveEntityPayload, resolveCanonicalProperty, partitionEntityState } from "./devices.js";
export { RoomSchema, RoomDimensionsSchema, FurniturePrimitiveSchema, FurnitureGroupSchema, FurnitureItemSchema, RoomLightSchema, CameraSchema } from "./room.js";
export type { RoomConfig, RoomDimensions, FurniturePrimitive, FurnitureGroup, FurnitureItem, RoomLight, CameraConfig } from "./room.js";

// ── Combined config ──────────────────────────────────────

const ConfigSchema = z.object({
  devices: z.record(z.string(), DeviceConfigSchema).default({}),
  room: RoomSchema.optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

// ── Config store ─────────────────────────────────────────

export class ConfigStore {
  private data: Config;

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      this.data = ConfigSchema.parse(JSON.parse(raw));
    } else {
      this.data = { devices: {} };
      this.save();
    }
  }

  /** Re-read from disk so hand-edits to config.json are picked up */
  private reload(): void {
    if (existsSync(this.filePath)) {
      const raw = readFileSync(this.filePath, "utf-8");
      this.data = ConfigSchema.parse(JSON.parse(raw));
    }
  }

  get(): Config {
    this.reload();
    return this.data;
  }

  getDevice(id: string): z.infer<typeof DeviceConfigSchema> | undefined {
    this.reload();
    return this.data.devices[id];
  }

  setDevice(id: string, update: Partial<z.infer<typeof DeviceConfigSchema>>): void {
    const existing = this.data.devices[id] ?? {};
    this.data.devices[id] = {
      ...existing,
      ...update,
      // Deep-merge entities so setting one doesn't wipe others
      entities: { ...existing.entities, ...update.entities },
    };
    this.save();
  }

  getRoom(): Config["room"] | undefined {
    this.reload();
    return this.data.room;
  }

  setRoom(room: z.infer<typeof RoomSchema>): void {
    this.reload();
    // Preserve camera if existing and not provided in the update
    if (this.data.room?.camera && !room.camera) {
      room.camera = this.data.room.camera;
    }
    this.data.room = room;
    this.save();
  }

  setRoomCamera(camera: { position: [number, number, number]; target: [number, number, number]; zoom: number }): void {
    this.reload();
    if (this.data.room) {
      this.data.room.camera = camera;
      this.save();
    }
  }

  /**
   * Auto-populate missing entities in config from Z2M exposes.
   * Called when Z2M device list arrives. Writes back to config file
   * if any entities were added.
   */
  autoPopulateEntities(z2mDevices: Array<{ ieee_address: string; type: string; definition?: { exposes?: unknown[] } | null }>): void {
    this.reload();
    let changed = false;

    for (const d of z2mDevices) {
      if (d.type === "Coordinator") continue;

      const exposes = d.definition?.exposes ?? [];
      const extracted = extractEntitiesFromExposes(exposes);
      if (extracted.length === 0) continue;

      const existing = this.data.devices[d.ieee_address];
      const existingEntities = existing?.entities ?? {};

      // Check if all extracted entities are already present in config
      const missing = extracted.filter(e => !(e.key in existingEntities));
      if (missing.length === 0) continue;

      // Add missing entities with empty config (no name override)
      const newEntities = { ...existingEntities };
      for (const e of missing) {
        newEntities[e.key] = {};
      }

      this.data.devices[d.ieee_address] = {
        ...existing,
        entities: newEntities,
      };
      changed = true;
    }

    if (changed) {
      this.save();
      console.log("[config] Auto-populated missing entities from Z2M exposes");
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + "\n");
  }
}
