import { z } from "zod";

export const DeviceConfigSchema = z.object({
  name: z.string().optional(),
  entities: z.record(z.string(), z.string()).optional(),
});

export type DeviceConfig = z.infer<typeof DeviceConfigSchema>;

