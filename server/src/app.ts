import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { MqttBridge } from "./mqtt.js";
import { CameraSchema, RoomSchema, RoomDimensionsSchema, RoomLightSchema, FurnitureItemSchema, EntityConfigSchema, extractEntitiesFromExposes, resolveEntityPayload, withTransition } from "./config/config.js";
import type { ConfigStore } from "./config/config.js";
import type { ChatStore } from "./config/chats.js";
import { ListStatusIdSchema, type ListStore } from "./config/lists.js";
import type { VibeStore } from "./config/vibes.js";
import { applyVibe, captureVibeSettings, findUnknownSettings, fixedEntityColors, normalizeSettingInput, VibeSettingInputSchema, watchActiveVibes, withActivity } from "./vibes.js";
import { renderVibeArt } from "./vibe-art.js";
import { CHECKPOINT_MAX_TTL_SECONDS, CheckpointStore } from "./checkpoints.js";
import type { AutomationEngine } from "./automations.js";
import { AutomationSchema } from "./automations.js";
import { createNodeWebSocket } from "@hono/node-ws";
import { createChatRoute } from "./chat/index.js";
import { authMiddleware, authRoutes } from "./auth.js";
import type { TokenStore } from "./config/tokens.js";
import { createDisplayRoute } from "./display/display.js";
import { buildDeviceResponse, type ToolContext, type VoiceDeviceInfo } from "./tools.js";
import { createVoiceWSHandler, type AudioStreamRegistry, type BridgeRef } from "./voice.js";
import { createBrowserVoiceWSHandler } from "./voice-browser-ws.js";
import { SharedAudioSource } from "./audio-utils.js";
import { debugLog, type DebugLogType } from "./debug-log.js";

export function createApp(
  bridge: MqttBridge,
  config: ConfigStore,
  chats: ChatStore,
  lists: ListStore,
  vibes: VibeStore,
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

  // Notified when the set of active vibes changes (lights reached or left a vibe)
  const vibeActivityListeners = new Set<() => void>();
  watchActiveVibes(bridge, vibes, () => vibeActivityListeners.forEach((fn) => fn()));

  const checkpoints = new CheckpointStore(bridge);

  const toolCtx: ToolContext = { bridge, config, chats, lists, vibes, checkpoints, automations, sendToBridge, audioStreams, audioSources, voiceDevices };

  // --- Auth (no-ops when AUTH_PASSWORD_HASH is unset) ---
  app.route("/", authRoutes());
  app.use("*", authMiddleware(tokens));

  // --- TRMNL e-ink display ---
  app.route("/", createDisplayRoute(config, lists));

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
        const device = bridge.devices.get(id);
        if (!device) return c.json({ error: "Device not found" }, 404);
        // Light changes fade by DEFAULT_TRANSITION_SECONDS unless the body sets `transition`
        const payload = c.req.valid("json") as Record<string, unknown>;
        bridge.setDeviceState(id, withTransition(extractEntitiesFromExposes(device.definition?.exposes ?? []), payload));
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

        // Light changes fade by DEFAULT_TRANSITION_SECONDS unless the body sets `transition` (seconds)
        const canonical = c.req.valid("json") as Record<string, unknown>;
        const resolved = resolveEntityPayload(entity, canonical);
        bridge.setDeviceState(id, withTransition([entity], resolved));
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

    // --- Lists ---
    .get("/api/lists", (c) => {
      return c.json(lists.getAllLists());
    })

    .post("/api/lists",
      zValidator("json", z.object({
        id: z.string().trim().min(1),
        name: z.string().trim().min(1),
        include_in_system_prompt: z.boolean().optional(),
        view: z.enum(["list", "kanban"]).optional(),
        columns: z.array(z.object({
          id: z.string().trim().min(1),
          name: z.string().trim().min(1),
          collapsed: z.boolean().optional(),
          icon: z.string().optional(),
        })).min(1).optional(),
        complete_status_ids: z.array(z.string().trim().min(1)).optional(),
      })),
      (c) => {
        const body = c.req.valid("json");
        try {
          const list = lists.createList({
            id: body.id,
            name: body.name,
            includeInSystemPrompt: body.include_in_system_prompt,
            view: body.view,
            columns: body.columns?.map((column) => ({
              id: column.id,
              name: column.name,
              collapsed: column.collapsed ?? false,
              icon: column.icon,
            })),
            completeStatusIds: body.complete_status_ids,
          });
          return c.json(list, 201);
        } catch (e: unknown) {
          const message = (e as Error).message;
          const code = message.includes("already exists") ? 409 : 400;
          return c.json({ error: message }, code);
        }
      },
    )

    .get("/api/lists/:listId", (c) => {
      const listId = c.req.param("listId");
      const list = lists.getList(listId);
      if (!list) return c.json({ error: "List not found" }, 404);
      return c.json(list);
    })

    .patch("/api/lists/:listId",
      zValidator("json", z.object({
        name: z.string().trim().min(1).optional(),
        include_in_system_prompt: z.boolean().optional(),
        view: z.enum(["list", "kanban"]).optional(),
        columns: z.array(z.object({
          id: z.string().trim().min(1),
          name: z.string().trim().min(1),
          collapsed: z.boolean().optional(),
          icon: z.string().optional(),
        })).min(1).optional(),
        complete_status_ids: z.array(z.string().trim().min(1)).optional(),
      })),
      (c) => {
        const listId = c.req.param("listId");
        const body = c.req.valid("json");
        try {
          const list = lists.updateList(listId, {
            name: body.name,
            includeInSystemPrompt: body.include_in_system_prompt,
            view: body.view,
            columns: body.columns?.map((column) => ({
              id: column.id,
              name: column.name,
              collapsed: column.collapsed ?? false,
              icon: column.icon,
            })),
            completeStatusIds: body.complete_status_ids,
          });
          return c.json({ ok: true, list });
        } catch (e: unknown) {
          const message = (e as Error).message;
          const code = message.includes("not found") ? 404 : 400;
          return c.json({ error: message }, code);
        }
      },
    )

    .delete("/api/lists/:listId", (c) => {
      const listId = c.req.param("listId");
      const removed = lists.deleteList(listId);
      if (!removed) return c.json({ error: "List not found" }, 404);
      return c.json({ ok: true });
    })

    .put("/api/lists/:listId/items/:itemId",
      zValidator("json", z.object({
        title: z.string().optional(),
        body: z.string().optional(),
        status_id: ListStatusIdSchema.optional(),
        list_name: z.string().optional(),
        include_in_system_prompt: z.boolean().optional(),
      })),
      (c) => {
        const listId = c.req.param("listId");
        const itemId = Number.parseInt(c.req.param("itemId"), 10);
        if (!Number.isInteger(itemId) || itemId < 1) {
          return c.json({ error: "Invalid item ID" }, 400);
        }
        const body = c.req.valid("json");
        try {
          const item = lists.upsertItem(
            listId,
            {
              id: itemId,
              title: body.title,
              body: body.body,
              statusId: body.status_id,
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

    .patch("/api/lists/:listId/items/:itemId/status",
      zValidator("json", z.object({ status_id: ListStatusIdSchema })),
      (c) => {
        const listId = c.req.param("listId");
        const itemId = Number.parseInt(c.req.param("itemId"), 10);
        if (!Number.isInteger(itemId) || itemId < 1) {
          return c.json({ error: "Invalid item ID" }, 400);
        }
        const { status_id } = c.req.valid("json");
        try {
          const item = lists.setItemStatus(listId, itemId, status_id);
          return c.json({ ok: true, item });
        } catch (e: unknown) {
          const message = (e as Error).message;
          const code = message.includes("not found") ? 404 : 400;
          return c.json({ error: message }, code);
        }
      },
    )

    .delete("/api/lists/:listId/items/:itemId", (c) => {
      const listId = c.req.param("listId");
      const itemId = Number.parseInt(c.req.param("itemId"), 10);
      if (!Number.isInteger(itemId) || itemId < 1) {
        return c.json({ error: "Invalid item ID" }, 400);
      }
      const removed = lists.deleteItem(listId, itemId);
      if (!removed) return c.json({ error: "List item not found" }, 404);
      return c.json({ ok: true });
    })

    // Card order on the entities page (vibes and entity cards ordered separately)
    .get("/api/config/views/entities", (c) => c.json(config.getEntitiesView()))

    .patch("/api/config/views/entities",
      zValidator("json", z.object({
        entityOrder: z.array(z.string()).optional(),
        vibeOrder: z.array(z.string()).optional(),
      })),
      (c) => {
        const view = config.setEntitiesView(c.req.valid("json"));
        bridge.emit("config_change");
        return c.json(view);
      },
    )

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

    // --- Vibes ---
    // Each vibe carries `active`: whether the lights currently match it
    .get("/api/vibes", (c) => c.json(withActivity(bridge, vibes.getAll())))

    .get("/api/vibes/:id", (c) => {
      const vibe = vibes.get(c.req.param("id"));
      if (!vibe) return c.json({ error: "Vibe not found" }, 404);
      return c.json(withActivity(bridge, [vibe])[0]);
    })

    .post("/api/vibes",
      zValidator("json", z.object({
        name: z.string().trim().min(1),
        icon: z.string().optional(),
        off_unspecified: z.boolean().optional(),
        entities: z.array(VibeSettingInputSchema).default([]),
      })),
      (c) => {
        const body = c.req.valid("json");
        const entities = body.entities.map(normalizeSettingInput);
        const unknown = findUnknownSettings(bridge, entities);
        if (unknown.length > 0) return c.json({ error: `Unknown entities: ${unknown.join(", ")}` }, 400);
        try {
          return c.json(vibes.create({ name: body.name, icon: body.icon, offUnspecified: body.off_unspecified, entities }), 201);
        } catch (e: unknown) {
          return c.json({ error: (e as Error).message }, 400);
        }
      },
    )

    .post("/api/vibes/capture",
      zValidator("json", z.object({
        name: z.string().trim().min(1),
        icon: z.string().optional(),
        off_unspecified: z.boolean().optional(),
      })),
      (c) => {
        const body = c.req.valid("json");
        const vibe = vibes.create({
          name: body.name,
          icon: body.icon,
          offUnspecified: body.off_unspecified,
          entities: captureVibeSettings(bridge),
        });
        return c.json(vibe, 201);
      },
    )

    .patch("/api/vibes/:id",
      zValidator("json", z.object({
        name: z.string().trim().min(1).optional(),
        icon: z.string().optional(),
        off_unspecified: z.boolean().optional(),
        entities: z.array(VibeSettingInputSchema).optional(),
        /** Replace the settings with the current state of every entity. */
        recapture: z.boolean().optional(),
      })),
      (c) => {
        const body = c.req.valid("json");
        const entities = body.recapture
          ? captureVibeSettings(bridge)
          : body.entities?.map(normalizeSettingInput);
        const unknown = entities ? findUnknownSettings(bridge, entities) : [];
        if (unknown.length > 0) return c.json({ error: `Unknown entities: ${unknown.join(", ")}` }, 400);
        try {
          const vibe = vibes.update(c.req.param("id"), {
            name: body.name,
            icon: body.icon,
            offUnspecified: body.off_unspecified,
            entities,
          });
          return c.json(vibe);
        } catch (e: unknown) {
          const message = (e as Error).message;
          return c.json({ error: message }, message.includes("not found") ? 404 : 400);
        }
      },
    )

    .delete("/api/vibes/:id", (c) => {
      try {
        vibes.delete(c.req.param("id"));
        return c.json({ ok: true });
      } catch (e: unknown) {
        return c.json({ error: (e as Error).message }, 404);
      }
    })

    // Procedural artwork for a vibe; ?width=&height= set the canvas (default 400x250)
    .get("/api/vibes/:id/art.svg", (c) => {
      const vibe = vibes.get(c.req.param("id"));
      if (!vibe) return c.json({ error: "Vibe not found" }, 404);
      const size = (raw: string | undefined) => {
        const n = Number(raw);
        return Number.isFinite(n) && n >= 16 && n <= 4096 ? Math.round(n) : undefined;
      };
      const svg = renderVibeArt(
        { id: vibe.id, entities: vibe.entities, fixedColors: fixedEntityColors(bridge, config) },
        { width: size(c.req.query("width")), height: size(c.req.query("height")) },
      );
      return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" });
    })

    // Optional JSON body: { "transition": seconds, "force": true }. Only lights that
    // differ from the vibe get commands, unless forced or the vibe is already active.
    .post("/api/vibes/:id/apply", async (c) => {
      const vibe = vibes.get(c.req.param("id"));
      if (!vibe) return c.json({ error: "Vibe not found" }, 404);
      const body = z.object({
        transition: z.number().min(0).max(60).optional(),
        /** Send every setting even to lights already in their target state. */
        force: z.boolean().optional(),
      }).safeParse(await c.req.json().catch(() => ({})));
      if (!body.success) return c.json({ error: body.error.message }, 400);
      return c.json(applyVibe(bridge, vibe, body.data));
    })

    // --- Checkpoints: temporary snapshots of light states, e.g. for previews ---
    .get("/api/checkpoints", (c) => c.json(checkpoints.list()))

    .post("/api/checkpoints",
      zValidator("json", z.object({
        /** Lifetime in seconds (default 1 hour). */
        ttl: z.number().min(1).max(CHECKPOINT_MAX_TTL_SECONDS).optional(),
        /** "restore" returns the lights to the checkpoint when it expires; "discard" (default) just drops it. */
        onExpiry: z.enum(["restore", "discard"]).optional(),
        label: z.string().max(100).optional(),
      })),
      (c) => {
        const body = c.req.valid("json");
        return c.json(checkpoints.create({ ttlSeconds: body.ttl, onExpiry: body.onExpiry, label: body.label }), 201);
      },
    )

    .get("/api/checkpoints/:id", (c) => {
      const checkpoint = checkpoints.get(c.req.param("id"));
      if (!checkpoint) return c.json({ error: "Checkpoint not found" }, 404);
      return c.json(checkpoint);
    })

    // Optional JSON body: { "ttl": seconds } to change the lifetime from now
    .post("/api/checkpoints/:id/keepalive", async (c) => {
      const body = z.object({ ttl: z.number().min(1).max(CHECKPOINT_MAX_TTL_SECONDS).optional() })
        .safeParse(await c.req.json().catch(() => ({})));
      if (!body.success) return c.json({ error: body.error.message }, 400);
      try {
        return c.json(checkpoints.keepalive(c.req.param("id"), body.data.ttl));
      } catch (e: unknown) {
        return c.json({ error: (e as Error).message }, 404);
      }
    })

    // Optional JSON body: { "transition": seconds, "force": true } (force also
    // re-sends entities that already match the checkpoint)
    .post("/api/checkpoints/:id/restore", async (c) => {
      const body = z.object({
        transition: z.number().min(0).max(60).optional(),
        force: z.boolean().optional(),
      })
        .safeParse(await c.req.json().catch(() => ({})));
      if (!body.success) return c.json({ error: body.error.message }, 400);
      try {
        return c.json(checkpoints.restore(c.req.param("id"), body.data));
      } catch (e: unknown) {
        return c.json({ error: (e as Error).message }, 404);
      }
    })

    .delete("/api/checkpoints/:id", (c) => {
      try {
        checkpoints.discard(c.req.param("id"));
        return c.json({ ok: true });
      } catch (e: unknown) {
        return c.json({ error: (e as Error).message }, 404);
      }
    })

    // --- WebSocket ---
    .get("/ws", upgradeWebSocket(() => {
      let cleanup: (() => void) | undefined;
      return {
        onOpen(_evt, ws) {
          const onStateChange = (data: unknown) => ws.send(JSON.stringify({ type: "state_change", data }));
          const onDevices = (data: unknown) => ws.send(JSON.stringify({ type: "devices", data }));
          const onConfigChange = () => ws.send(JSON.stringify({ type: "config_change" }));
          const onAutomationsChange = () => ws.send(JSON.stringify({ type: "automations_change" }));
          const onListsChange = () => ws.send(JSON.stringify({ type: "lists_change" }));
          const onChatsChange = () => ws.send(JSON.stringify({ type: "chats_change" }));
          const onVibesChange = () => ws.send(JSON.stringify({ type: "vibes_change" }));

          bridge.on("state_change", onStateChange);
          bridge.on("devices", onDevices);
          bridge.on("config_change", onConfigChange);
          automations.onChanged(onAutomationsChange);
          lists.onChanged(onListsChange);
          chats.onChanged(onChatsChange);
          vibes.onChanged(onVibesChange);
          vibeActivityListeners.add(onVibesChange);

          cleanup = () => {
            bridge.off("state_change", onStateChange);
            bridge.off("devices", onDevices);
            bridge.off("config_change", onConfigChange);
            automations.offChanged(onAutomationsChange);
            lists.offChanged(onListsChange);
            chats.offChanged(onChatsChange);
            vibes.offChanged(onVibesChange);
            vibeActivityListeners.delete(onVibesChange);
            cleanup = undefined;
          };
        },
        onClose() { cleanup?.(); },
        onError() { cleanup?.(); },
      };
    }))

    // --- Voice Bridge WebSocket ---
    .get("/ws/voice", upgradeWebSocket(
      createVoiceWSHandler({ audioStreams, toolCtx, bridgeRef })
    ))

    // --- Browser voice WebSocket ---
    .get("/ws/voice/browser", upgradeWebSocket(
      createBrowserVoiceWSHandler({ toolCtx })
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
      let cleanup: (() => void) | undefined;
      return {
        onOpen(_evt, ws) {
          const onEntry = (entry: unknown) => {
            ws.send(JSON.stringify({ type: "debug_entry", data: entry }));
          };
          debugLog.on("entry", onEntry);
          cleanup = () => {
            debugLog.off("entry", onEntry);
            cleanup = undefined;
          };
        },
        onClose() { cleanup?.(); },
        onError() { cleanup?.(); },
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
