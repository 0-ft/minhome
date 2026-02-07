import { readFileSync, writeFileSync, existsSync } from "fs";
import { z } from "zod";

const DeviceConfigSchema = z.object({
  name: z.string().optional(),
  entities: z.record(z.string(), z.string()).optional(),
});

const RoomLightSchema = z.object({
  deviceId: z.string(),
  entityId: z.string().optional(),
  position: z.tuple([z.number(), z.number(), z.number()]),
  type: z.enum(["ceiling", "desk", "table", "floor"]),
});

const ConfigSchema = z.object({
  devices: z.record(z.string(), DeviceConfigSchema).default({}),
  room: z.object({
    lights: z.array(RoomLightSchema).default([]),
  }).default({ lights: [] }),
});

export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export class ConfigStore {
  private data: Config;

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      const raw = readFileSync(filePath, "utf-8");
      this.data = ConfigSchema.parse(JSON.parse(raw));
    } else {
      this.data = { devices: {}, room: { lights: [] } };
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

  getDevice(id: string): DeviceConfig | undefined {
    this.reload();
    return this.data.devices[id];
  }

  setDevice(id: string, update: Partial<DeviceConfig>): void {
    const existing = this.data.devices[id] ?? {};
    this.data.devices[id] = {
      ...existing,
      ...update,
      // Deep-merge entities so setting one doesn't wipe others
      entities: { ...existing.entities, ...update.entities },
    };
    this.save();
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + "\n");
  }
}

