import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { MqttBridge } from "./mqtt.js";
import type { ConfigStore } from "./config.js";
import type { AutomationEngine } from "./automations.js";
import { AutomationSchema } from "./automations.js";
import { createNodeWebSocket } from "@hono/node-ws";
import { createChatRoute } from "./chat/index.js";

export function createApp(bridge: MqttBridge, config: ConfigStore, automations: AutomationEngine) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // --- AI Chat ---
  app.route("/", createChatRoute(bridge, config, automations));

  app

    // --- Devices ---
    .get("/api/devices", (c) => {
      const devices = [...bridge.devices.values()]
        .filter(d => d.type !== "Coordinator")
        .map(d => {
          const custom = config.getDevice(d.ieee_address);
          const state = bridge.states.get(d.ieee_address);
          return {
            id: d.ieee_address,
            friendly_name: d.friendly_name,
            name: custom?.name ?? d.friendly_name,
            entities: custom?.entities ?? {},
            type: d.type,
            vendor: d.definition?.vendor ?? null,
            model: d.definition?.model ?? null,
            description: d.definition?.description ?? null,
            supported: d.supported ?? false,
            state: state ?? {},
            exposes: d.definition?.exposes ?? [],
          };
        });
      return c.json(devices);
    })

    .get("/api/devices/:id", (c) => {
      const id = c.req.param("id");
      const d = bridge.devices.get(id);
      if (!d) return c.json({ error: "Device not found" }, 404);
      const custom = config.getDevice(id);
      const state = bridge.states.get(id);
      return c.json({
        id: d.ieee_address,
        friendly_name: d.friendly_name,
        name: custom?.name ?? d.friendly_name,
        entities: custom?.entities ?? {},
        type: d.type,
        vendor: d.definition?.vendor ?? null,
        model: d.definition?.model ?? null,
        description: d.definition?.description ?? null,
        supported: d.supported ?? false,
        state: state ?? {},
        exposes: d.definition?.exposes ?? [],
      });
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

    .put("/api/devices/:id/config",
      zValidator("json", z.object({
        name: z.string().optional(),
        entities: z.record(z.string(), z.string()).optional(),
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

          bridge.on("state_change", onStateChange);
          bridge.on("devices", onDevices);

          // Store cleanup refs on the ws object
          (ws as unknown as Record<string, unknown>).__cleanup = () => {
            bridge.off("state_change", onStateChange);
            bridge.off("devices", onDevices);
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

