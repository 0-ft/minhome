import { readFileSync, writeFileSync, existsSync } from "fs";
import { z } from "zod";
import { DeviceConfigSchema, EntityConfigSchema, extractEntitiesFromExposes } from "./devices.js";
import { RoomSchema, type FurnitureItem } from "./room.js";
import type { CalendarSourceConfig } from "../calendar/service.js";
import { TileConfigSchema } from "../display/tiles.js";

// Re-export sub-module types for consumers
export { DeviceConfigSchema, EntityConfigSchema } from "./devices.js";
export type { DeviceConfig, EntityConfig, ExtractedEntity, EntityFeatures, EntityResponse } from "./devices.js";
export { extractEntitiesFromExposes, buildEntityResponses, resolveEntityPayload, resolveCanonicalProperty, partitionEntityState } from "./devices.js";
export { RoomSchema, RoomDimensionsSchema, FurniturePrimitiveSchema, FurnitureGroupSchema, FurnitureItemSchema, RoomLightSchema, CameraSchema } from "./room.js";
export type { RoomConfig, RoomDimensions, FurniturePrimitive, FurnitureGroup, FurnitureItem, RoomLight, CameraConfig } from "./room.js";

// ── Combined config ──────────────────────────────────────

export const VoiceOptions = ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse", "marin", "cedar"] as const;
export const VoiceSchema = z.enum(VoiceOptions);
export type Voice = z.infer<typeof VoiceSchema>;

export const CalendarSourceSchema = z.object({
  source_url: z.string().url(),
});

export const CalendarsConfigSchema = z.record(z.string(), CalendarSourceSchema).default({});
export type CalendarsConfig = z.infer<typeof CalendarsConfigSchema>;

export const DisplayConfigSchema = z.object({
  /** How often the device should refresh, in seconds. */
  refresh_rate: z.number().positive().default(300),
  /** Display layout orientation. */
  orientation: z.enum(["landscape", "portrait"]).default("landscape"),
  /** PNG color depth in bits per pixel (1 -> 2 colours, 2 -> 4 colours). */
  color_depth: z.number().int().min(1).max(2).default(1),
  /** Provisioned TRMNL devices keyed by MAC address. */
  devices: z.record(z.string(), z.object({
    token: z.string().min(1),
    friendly_id: z.string().min(1).optional(),
    tiles: z.array(TileConfigSchema).default([]),
  })).default({}),
});

export type DisplayConfig = z.infer<typeof DisplayConfigSchema>;

const ConfigSchema = z.object({
  devices: z.record(z.string(), DeviceConfigSchema).default({}),
  room: RoomSchema.optional(),
  voice: VoiceSchema.optional(),
  calendars: CalendarsConfigSchema.optional(),
  display: DisplayConfigSchema.optional(),
  /** Maximum debug log file size in MB before old entries are dropped. Default 10. */
  debugLogMaxSizeMB: z.number().positive().default(10),
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
      this.data = ConfigSchema.parse({ devices: {} });
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

  getVoice(): Voice {
    this.reload();
    return this.data.voice ?? "ash";
  }

  setVoice(voice: Voice): void {
    this.reload();
    this.data.voice = voice;
    this.save();
  }

  getDisplay(): DisplayConfig {
    this.reload();
    return this.data.display ?? DisplayConfigSchema.parse({});
  }

  setDisplay(display: DisplayConfig): void {
    this.reload();
    this.data.display = display;
    this.save();
  }

  getCalendars(): CalendarsConfig {
    this.reload();
    return this.data.calendars ?? CalendarsConfigSchema.parse({});
  }

  getCalendarSource(calendarId: string): CalendarSourceConfig | undefined {
    this.reload();
    return this.data.calendars?.[calendarId];
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

  setRoomCamera(camera: { position: number[]; target: number[]; zoom: number }): void {
    this.reload();
    if (this.data.room) {
      this.data.room.camera = camera;
      this.save();
    }
  }

  /**
   * Merge partial room updates into the existing room config.
   * Only provided fields are overwritten; others are preserved.
   */
  patchRoom(patch: Partial<Pick<z.infer<typeof RoomSchema>, "dimensions" | "floor" | "furniture" | "lights">>): void {
    this.reload();
    if (!this.data.room) {
      throw new Error("Room not configured — use setRoom first");
    }
    if (patch.dimensions !== undefined) this.data.room.dimensions = patch.dimensions;
    if (patch.floor !== undefined) this.data.room.floor = patch.floor;
    if (patch.furniture !== undefined) this.data.room.furniture = patch.furniture;
    if (patch.lights !== undefined) this.data.room.lights = patch.lights;
    this.save();
  }

  /**
   * Find a furniture item by name and replace it, or append if not found.
   * For groups, matches on the group `name`. For primitives, matches on the optional `name` field.
   */
  upsertFurniture(name: string, item: FurnitureItem): void {
    this.reload();
    if (!this.data.room) {
      throw new Error("Room not configured — use setRoom first");
    }
    const idx = this.data.room.furniture.findIndex(
      (f) => ("name" in f && f.name === name),
    );
    if (idx >= 0) {
      this.data.room.furniture[idx] = item;
    } else {
      this.data.room.furniture.push(item);
    }
    this.save();
  }

  /**
   * Remove a furniture item by name. Returns true if found and removed.
   */
  removeFurniture(name: string): boolean {
    this.reload();
    if (!this.data.room) return false;
    const idx = this.data.room.furniture.findIndex(
      (f) => ("name" in f && f.name === name),
    );
    if (idx < 0) return false;
    this.data.room.furniture.splice(idx, 1);
    this.save();
    return true;
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
