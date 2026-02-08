import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { MqttBridge } from "./mqtt.js";
import { CameraSchema, RoomSchema, RoomDimensionsSchema, RoomLightSchema, FurnitureItemSchema, EntityConfigSchema, extractEntitiesFromExposes, resolveEntityPayload } from "./config/config.js";
import type { ConfigStore } from "./config/config.js";
import type { AutomationEngine } from "./automations.js";
import { AutomationSchema } from "./automations.js";
import { createNodeWebSocket } from "@hono/node-ws";
import { createChatRoute } from "./chat/index.js";
import { authMiddleware, authRoutes } from "./auth.js";
import { buildDeviceResponse } from "./tools.js";

export function createApp(bridge: MqttBridge, config: ConfigStore, automations: AutomationEngine) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // --- Auth (no-ops when AUTH_PASSWORD is unset) ---
  app.route("/", authRoutes());
  app.use("*", authMiddleware());

  // --- AI Chat ---
  app.route("/", createChatRoute(bridge, config, automations));

  app

    // --- Devices ---
    .get("/api/devices", (c) => {
      const devices = [...bridge.devices.values()]
        .filter(d => d.type !== "Coordinator")
        .map(d => buildDeviceResponse(bridge, config, d.ieee_address))
        .filter(Boolean);
      return c.json(devices);
    })

    .get("/api/devices/:id", (c) => {
      const id = c.req.param("id");
      const device = buildDeviceResponse(bridge, config, id);
      if (!device) return c.json({ error: "Device not found" }, 404);
      return c.json(device);
    })

    .post("/api/devices/refresh", (c) => {
      bridge.refreshStates();
      return c.json({ ok: true });
    })

    .post("/api/devices/:id/set",
      zValidator("json", z.record(z.string(), z.unknown())),
      (c) => {
        const id = c.req.param("id");
        if (!bridge.devices.has(id)) return c.json({ error: "Device not found" }, 404);
        const payload = c.req.valid("json");
        bridge.setDeviceState(id, payload as Record<string, unknown>);
        return c.json({ ok: true });
      },
    )

    .post("/api/devices/:id/entities/:entityKey/set",
      zValidator("json", z.record(z.string(), z.unknown())),
      (c) => {
        const id = c.req.param("id");
        const entityKey = c.req.param("entityKey");
        const device = bridge.devices.get(id);
        if (!device) return c.json({ error: "Device not found" }, 404);

        const exposes = device.definition?.exposes ?? [];
        const extracted = extractEntitiesFromExposes(exposes);
        const entity = extracted.find(e => e.key === entityKey);
        if (!entity) return c.json({ error: "Entity not found" }, 404);

        const canonical = c.req.valid("json") as Record<string, unknown>;
        const resolved = resolveEntityPayload(entity, canonical);
        bridge.setDeviceState(id, resolved);
        return c.json({ ok: true });
      },
    )

    .put("/api/devices/:id/config",
      zValidator("json", z.object({
        name: z.string().optional(),
        entities: z.record(z.string(), EntityConfigSchema).optional(),
      })),
      (c) => {
        const id = c.req.param("id");
        const body = c.req.valid("json");
        config.setDevice(id, body);
        return c.json({ ok: true });
      },
    )

    // --- Config ---
    .get("/api/config", (c) => {
      return c.json(config.get());
    })

    .get("/api/config/room", (c) => {
      const room = config.getRoom();
      if (!room) return c.json({ error: "Room not configured" }, 404);
      return c.json(room);
    })

    .put("/api/config/room",
      zValidator("json", RoomSchema),
      (c) => {
        const room = c.req.valid("json");
        config.setRoom(room);
        bridge.emit("config_change");
        return c.json({ ok: true });
      },
    )

    .put("/api/config/room/camera",
      zValidator("json", CameraSchema),
      (c) => {
        const camera = c.req.valid("json");
        config.setRoomCamera(camera);
        return c.json({ ok: true });
      },
    )

    .patch("/api/config/room",
      zValidator("json", z.object({
        dimensions: RoomDimensionsSchema.optional(),
        floor: z.string().optional(),
        furniture: z.array(FurnitureItemSchema).optional(),
        lights: z.array(RoomLightSchema).optional(),
      })),
      (c) => {
        const patch = c.req.valid("json");
        try {
          config.patchRoom(patch);
          bridge.emit("config_change");
          return c.json({ ok: true });
        } catch (e: unknown) {
          return c.json({ error: (e as Error).message }, 400);
        }
      },
    )

    .put("/api/config/room/furniture/:name",
      zValidator("json", FurnitureItemSchema),
      (c) => {
        const name = c.req.param("name");
        const item = c.req.valid("json");
        try {
          config.upsertFurniture(name, item);
          bridge.emit("config_change");
          return c.json({ ok: true });
        } catch (e: unknown) {
          return c.json({ error: (e as Error).message }, 400);
        }
      },
    )

    .delete("/api/config/room/furniture/:name", (c) => {
      const name = c.req.param("name");
      const removed = config.removeFurniture(name);
      if (!removed) return c.json({ error: "Furniture not found" }, 404);
      bridge.emit("config_change");
      return c.json({ ok: true });
    })

    // --- Automations ---
    .get("/api/automations", (c) => {
      return c.json(automations.getAll());
    })

    .get("/api/automations/:id", (c) => {
      const id = c.req.param("id");
      const a = automations.get(id);
      if (!a) return c.json({ error: "Automation not found" }, 404);
      return c.json(a);
    })

    .post("/api/automations",
      zValidator("json", AutomationSchema),
      (c) => {
        const body = c.req.valid("json");
        try {
          const created = automations.create(body);
          return c.json(created, 201);
        } catch (e: unknown) {
          return c.json({ error: (e as Error).message }, 409);
        }
      },
    )

    .put("/api/automations/:id",
      zValidator("json", AutomationSchema.partial().omit({ id: true })),
      (c) => {
        const id = c.req.param("id");
        const body = c.req.valid("json");
        try {
          const updated = automations.update(id, body);
          return c.json(updated);
        } catch (e: unknown) {
          return c.json({ error: (e as Error).message }, 404);
        }
      },
    )

    .delete("/api/automations/:id", (c) => {
      const id = c.req.param("id");
      automations.remove(id);
      return c.json({ ok: true });
    })

    // --- WebSocket ---
    .get("/ws", upgradeWebSocket(() => {
      return {
        onOpen(_evt, ws) {
          const onStateChange = (data: unknown) => ws.send(JSON.stringify({ type: "state_change", data }));
          const onDevices = (data: unknown) => ws.send(JSON.stringify({ type: "devices", data }));
          const onAutoFire = (id: string, trigger: string) => ws.send(JSON.stringify({ type: "automation_fired", id, trigger }));
          const onConfigChange = () => ws.send(JSON.stringify({ type: "config_change" }));

          bridge.on("state_change", onStateChange);
          bridge.on("devices", onDevices);
          bridge.on("config_change", onConfigChange);

          // Store cleanup refs on the ws object
          (ws as unknown as Record<string, unknown>).__cleanup = () => {
            bridge.off("state_change", onStateChange);
            bridge.off("devices", onDevices);
            bridge.off("config_change", onConfigChange);
          };
        },
        onClose(_evt, ws) {
          const cleanup = (ws as unknown as Record<string, unknown>).__cleanup as (() => void) | undefined;
          cleanup?.();
        },
      };
    }));

  return { app, injectWebSocket };
}

export type AppType = ReturnType<typeof createApp>["app"];
