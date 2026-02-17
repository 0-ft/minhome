import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { MqttBridge } from "./mqtt.js";
import { CameraSchema, RoomSchema, RoomDimensionsSchema, RoomLightSchema, FurnitureItemSchema, EntityConfigSchema, extractEntitiesFromExposes, resolveEntityPayload } from "./config/config.js";
import type { ConfigStore } from "./config/config.js";
import type { ChatStore } from "./config/chats.js";
import { TodoStatusSchema, type TodoStore } from "./config/todos.js";
import type { AutomationEngine } from "./automations.js";
import { AutomationSchema } from "./automations.js";
import { createNodeWebSocket } from "@hono/node-ws";
import { createChatRoute } from "./chat/index.js";
import { authMiddleware, authRoutes } from "./auth.js";
import type { TokenStore } from "./config/tokens.js";
import { createDisplayRoute } from "./display/display.js";
import { buildDeviceResponse, type ToolContext, type VoiceDeviceInfo } from "./tools.js";
import { createVoiceWSHandler, type AudioStreamRegistry, type BridgeRef } from "./voice.js";
import { SharedAudioSource } from "./audio-utils.js";
import { debugLog, type DebugLogType } from "./debug-log.js";

export function createApp(
  bridge: MqttBridge,
  config: ConfigStore,
  chats: ChatStore,
  todos: TodoStore,
  automations: AutomationEngine,
  tokens: TokenStore,
) {
  const app = new Hono();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

  // Shared registry of active audio streams for voice response playback
  const audioStreams: AudioStreamRegistry = new Map();

  // Fan-out audio sources — for announcements (one source → many device readers)
  const audioSources: Map<string, SharedAudioSource> = new Map();

  // Connected voice devices reported by the bridge
  const voiceDevices: Map<string, VoiceDeviceInfo> = new Map();

  // Bridge WebSocket ref — populated when bridge connects
  const bridgeRef: { current: BridgeRef | null } = { current: null };
  const sendToBridge = (msg: object) => {
    if (!bridgeRef.current) {
      console.warn("[voice] No bridge connected — dropping message:", (msg as any).type);
      return;
    }
    bridgeRef.current.send(JSON.stringify(msg));
  };

  const toolCtx: ToolContext = { bridge, config, chats, todos, automations, sendToBridge, audioStreams, audioSources, voiceDevices };

  // --- Auth (no-ops when AUTH_PASSWORD is unset) ---
  app.route("/", authRoutes());
  app.use("*", authMiddleware(tokens));

  // --- TRMNL e-ink display ---
  app.route("/", createDisplayRoute(config, todos));

  // --- AI Chat ---
  app.route("/", createChatRoute(toolCtx));

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

    // --- Todos ---
    .get("/api/todos", (c) => {
      return c.json(todos.getAllLists());
    })

    .post("/api/todos/lists",
      zValidator("json", z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        include_in_system_prompt: z.boolean().optional(),
        view: z.enum(["list", "kanban"]).optional(),
        columns: z.array(z.object({
          status: z.string().trim().min(1),
          collapsed: z.boolean().optional(),
          icon: z.string().optional(),
        })).min(1).optional(),
      })),
      (c) => {
        const body = c.req.valid("json");
        try {
          const list = todos.createList({
            id: body.id,
            name: body.name,
            includeInSystemPrompt: body.include_in_system_prompt,
            view: body.view,
            columns: body.columns?.map((column) => ({
              status: column.status,
              collapsed: column.collapsed ?? false,
              icon: column.icon,
            })),
          });
          return c.json(list, 201);
        } catch (e: unknown) {
          const message = (e as Error).message;
          const code = message.includes("already exists") ? 409 : 400;
          return c.json({ error: message }, code);
        }
      },
    )

    .get("/api/todos/:listId", (c) => {
      const listId = c.req.param("listId");
      const list = todos.getList(listId);
      if (!list) return c.json({ error: "Todo list not found" }, 404);
      return c.json(list);
    })

    .patch("/api/todos/:listId",
      zValidator("json", z.object({
        name: z.string().trim().min(1).optional(),
        include_in_system_prompt: z.boolean().optional(),
        view: z.enum(["list", "kanban"]).optional(),
        columns: z.array(z.object({
          status: z.string().trim().min(1),
          collapsed: z.boolean().optional(),
          icon: z.string().optional(),
        })).min(1).optional(),
      })),
      (c) => {
        const listId = c.req.param("listId");
        const body = c.req.valid("json");
        try {
          const list = todos.updateList(listId, {
            name: body.name,
            includeInSystemPrompt: body.include_in_system_prompt,
            view: body.view,
            columns: body.columns?.map((column) => ({
              status: column.status,
              collapsed: column.collapsed ?? false,
              icon: column.icon,
            })),
          });
          return c.json({ ok: true, list });
        } catch (e: unknown) {
          const message = (e as Error).message;
          const code = message.includes("not found") ? 404 : 400;
          return c.json({ error: message }, code);
        }
      },
    )

    .delete("/api/todos/:listId", (c) => {
      const listId = c.req.param("listId");
      const removed = todos.deleteList(listId);
      if (!removed) return c.json({ error: "Todo list not found" }, 404);
      return c.json({ ok: true });
    })

    .put("/api/todos/:listId/items/:itemId",
      zValidator("json", z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        status: TodoStatusSchema.optional(),
        list_name: z.string().optional(),
        include_in_system_prompt: z.boolean().optional(),
      })),
      (c) => {
        const listId = c.req.param("listId");
        const itemId = Number.parseInt(c.req.param("itemId"), 10);
        if (!Number.isInteger(itemId) || itemId < 1) {
          return c.json({ error: "Invalid todo item ID" }, 400);
        }
        const body = c.req.valid("json");
        try {
          const item = todos.upsertItem(
            listId,
            {
              id: itemId,
              title: body.title,
              body: body.body,
              status: body.status,
            },
            {
              name: body.list_name,
              includeInSystemPrompt: body.include_in_system_prompt,
            },
          );
          return c.json({ ok: true, item });
        } catch (e: unknown) {
          return c.json({ error: (e as Error).message }, 400);
        }
      },
    )

    .patch("/api/todos/:listId/items/:itemId/status",
      zValidator("json", z.object({ status: TodoStatusSchema })),
      (c) => {
        const listId = c.req.param("listId");
        const itemId = Number.parseInt(c.req.param("itemId"), 10);
        if (!Number.isInteger(itemId) || itemId < 1) {
          return c.json({ error: "Invalid todo item ID" }, 400);
        }
        const { status } = c.req.valid("json");
        try {
          const item = todos.setItemStatus(listId, itemId, status);
          return c.json({ ok: true, item });
        } catch (e: unknown) {
          const message = (e as Error).message;
          const code = message.includes("not found") ? 404 : 400;
          return c.json({ error: message }, code);
        }
      },
    )

    .delete("/api/todos/:listId/items/:itemId", (c) => {
      const listId = c.req.param("listId");
      const itemId = Number.parseInt(c.req.param("itemId"), 10);
      if (!Number.isInteger(itemId) || itemId < 1) {
        return c.json({ error: "Invalid todo item ID" }, 400);
      }
      const removed = todos.deleteItem(listId, itemId);
      if (!removed) return c.json({ error: "Todo item not found" }, 404);
      return c.json({ ok: true });
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
          const onConfigChange = () => ws.send(JSON.stringify({ type: "config_change" }));
          const onAutomationsChange = () => ws.send(JSON.stringify({ type: "automations_change" }));
          const onTodosChange = () => ws.send(JSON.stringify({ type: "todos_change" }));
          const onChatsChange = () => ws.send(JSON.stringify({ type: "chats_change" }));

          bridge.on("state_change", onStateChange);
          bridge.on("devices", onDevices);
          bridge.on("config_change", onConfigChange);
          automations.onChanged(onAutomationsChange);
          todos.onChanged(onTodosChange);
          chats.onChanged(onChatsChange);

          // Store cleanup refs on the ws object
          (ws as unknown as Record<string, unknown>).__cleanup = () => {
            bridge.off("state_change", onStateChange);
            bridge.off("devices", onDevices);
            bridge.off("config_change", onConfigChange);
            automations.offChanged(onAutomationsChange);
            todos.offChanged(onTodosChange);
            chats.offChanged(onChatsChange);
          };
        },
        onClose(_evt, ws) {
          const cleanup = (ws as unknown as Record<string, unknown>).__cleanup as (() => void) | undefined;
          cleanup?.();
        },
      };
    }))

    // --- Voice Bridge WebSocket ---
    .get("/ws/voice", upgradeWebSocket(
      createVoiceWSHandler({ audioStreams, toolCtx, bridgeRef })
    ))

    // --- Audio streaming for voice responses ---
    .get("/audio/:sessionId", (c) => {
      const sessionId = c.req.param("sessionId");

      // Check shared audio sources first (announcements — fan-out to many readers)
      const source = audioSources.get(sessionId);
      if (source) {
        console.log(`[audio] Creating fan-out reader for announcement ${sessionId}`);
        return new Response(source.createReader(), {
          headers: {
            "Content-Type": "audio/wav",
            "Transfer-Encoding": "chunked",
            "Cache-Control": "no-cache, no-store",
          },
        });
      }

      // Fall back to streaming audio (realtime voice sessions — single consumer)
      const stream = audioStreams.get(sessionId);
      if (!stream) {
        return c.json({ error: "Audio stream not found" }, 404);
      }
      console.log(`[audio] Device fetching audio stream for ${sessionId}`);
      return new Response(stream, {
        headers: {
          "Content-Type": "audio/wav",
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-cache, no-store",
        },
      });
    })

    // --- Debug log ---
    .get("/api/debug/logs", (c) => {
      const type = c.req.query("type") as DebugLogType | undefined;
      const beforeRaw = c.req.query("before");
      const limitRaw = c.req.query("limit");
      const before = beforeRaw != null ? Number(beforeRaw) : undefined;
      const limit = limitRaw != null ? Number(limitRaw) : undefined;

      if ((beforeRaw != null && !Number.isFinite(before)) || (limitRaw != null && !Number.isFinite(limit))) {
        return c.json({ error: "Invalid pagination parameters" }, 400);
      }

      return c.json(debugLog.getPage({ type, before, limit }));
    })

    .delete("/api/debug/logs", (c) => {
      debugLog.clear();
      return c.json({ ok: true });
    })

    // --- Debug log WebSocket ---
    .get("/ws/debug", upgradeWebSocket(() => {
      return {
        onOpen(_evt, ws) {
          const onEntry = (entry: unknown) => {
            ws.send(JSON.stringify({ type: "debug_entry", data: entry }));
          };
          debugLog.on("entry", onEntry);
          (ws as unknown as Record<string, unknown>).__debugCleanup = () => {
            debugLog.off("entry", onEntry);
          };
        },
        onClose(_evt, ws) {
          const cleanup = (ws as unknown as Record<string, unknown>).__debugCleanup as (() => void) | undefined;
          cleanup?.();
        },
      };
    }));

  // --- Instrument MQTT bridge for debug logging ---
  bridge.on("state_change", (data: unknown) => {
    const d = data as { deviceId: string; friendlyName: string; state: unknown };
    debugLog.add("mqtt_state_change", `State: ${d.friendlyName}`, d);
  });

  bridge.on("mqtt_message", (data: unknown) => {
    const d = data as { topic: string; payload: string };
    debugLog.add("mqtt_message", `MQTT: ${d.topic}`, d);
  });

  return { app, injectWebSocket, toolCtx };
}

export type AppType = ReturnType<typeof createApp>["app"];
