import { existsSync, readFileSync, writeFileSync } from "fs";
import { z } from "zod";

export const VibeColorSchema = z.object({
  hue: z.number().min(0).max(360),
  saturation: z.number().min(0).max(100),
});

/** Target state for one entity, under canonical property names. */
export const VibeEntitySettingSchema = z.object({
  device: z.string().trim().min(1),
  entity: z.string().trim().min(1),
  state: z.enum(["ON", "OFF"]),
  brightness: z.number().int().min(1).max(254).optional(),
  color_temp: z.number().int().positive().optional(),
  color: VibeColorSchema.optional(),
}).refine((s) => !(s.color && s.color_temp !== undefined), {
  message: "Set either color or color_temp, not both",
});
export type VibeEntitySetting = z.infer<typeof VibeEntitySettingSchema>;

export const VibeSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  /** Lucide icon name (kebab-case). */
  icon: z.string().optional(),
  /** Turn off every controllable entity not listed in `entities` when applied. */
  offUnspecified: z.boolean().default(true),
  entities: z.array(VibeEntitySettingSchema).default([]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Vibe = z.infer<typeof VibeSchema>;

const VibesFileSchema = z.object({
  vibes: z.array(VibeSchema).default([]),
});
type VibesFile = z.infer<typeof VibesFileSchema>;

export interface VibeInput {
  name: string;
  icon?: string;
  offUnspecified?: boolean;
  entities?: VibeEntitySetting[];
}

/** Slug used as a vibe's id, e.g. "Late Night" → "late-night". */
export function vibeSlug(name: string): string {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "vibe";
}

/** Keep one setting per entity (last wins), so a vibe never targets an entity twice. */
function dedupeSettings(settings: VibeEntitySetting[]): VibeEntitySetting[] {
  const byEntity = new Map<string, VibeEntitySetting>();
  for (const setting of settings) byEntity.set(`${setting.device}:${setting.entity}`, setting);
  return [...byEntity.values()];
}

export class VibeStore {
  private data: VibesFile;
  private changeListeners = new Set<() => void>();

  constructor(private filePath: string) {
    if (existsSync(filePath)) {
      this.data = VibesFileSchema.parse(JSON.parse(readFileSync(filePath, "utf-8")));
    } else {
      this.data = { vibes: [] };
      this.save();
    }
  }

  /** Re-read from disk so hand-edits to vibes.json are picked up */
  private reload(): void {
    if (existsSync(this.filePath)) {
      this.data = VibesFileSchema.parse(JSON.parse(readFileSync(this.filePath, "utf-8")));
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2) + "\n");
    this.changeListeners.forEach((fn) => fn());
  }

  onChanged(fn: () => void): void { this.changeListeners.add(fn); }
  offChanged(fn: () => void): void { this.changeListeners.delete(fn); }

  getAll(): Vibe[] {
    this.reload();
    return this.data.vibes;
  }

  get(id: string): Vibe | undefined {
    this.reload();
    return this.data.vibes.find((vibe) => vibe.id === id);
  }

  create(input: VibeInput): Vibe {
    this.reload();
    const base = vibeSlug(input.name);
    let id = base;
    for (let n = 2; this.data.vibes.some((vibe) => vibe.id === id); n++) id = `${base}-${n}`;

    const now = new Date().toISOString();
    const vibe = VibeSchema.parse({
      id,
      name: input.name,
      icon: input.icon,
      offUnspecified: input.offUnspecified ?? true,
      entities: dedupeSettings(input.entities ?? []),
      createdAt: now,
      updatedAt: now,
    });
    this.data.vibes.push(vibe);
    this.save();
    return vibe;
  }

  update(id: string, patch: Partial<VibeInput>): Vibe {
    this.reload();
    const vibe = this.data.vibes.find((existing) => existing.id === id);
    if (!vibe) throw new Error("Vibe not found");
    if (patch.name !== undefined) vibe.name = z.string().trim().min(1).parse(patch.name);
    if (patch.icon !== undefined) vibe.icon = patch.icon || undefined;
    if (patch.offUnspecified !== undefined) vibe.offUnspecified = patch.offUnspecified;
    if (patch.entities !== undefined) {
      vibe.entities = dedupeSettings(z.array(VibeEntitySettingSchema).parse(patch.entities));
    }
    vibe.updatedAt = new Date().toISOString();
    this.save();
    return vibe;
  }

  delete(id: string): void {
    this.reload();
    const index = this.data.vibes.findIndex((vibe) => vibe.id === id);
    if (index === -1) throw new Error("Vibe not found");
    this.data.vibes.splice(index, 1);
    this.save();
  }
}
