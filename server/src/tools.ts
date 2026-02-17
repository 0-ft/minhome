import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { MqttBridge } from "./mqtt.js";
import type { ConfigStore } from "./config/config.js";
import type { ChatStore } from "./config/chats.js";
import { TodoStatusSchema, type TodoStore } from "./config/todos.js";
import type { AutomationEngine } from "./automations.js";
import {
  RoomDimensionsSchema,
  RoomLightSchema,
  FurnitureItemSchema,
  VoiceSchema,
  extractEntitiesFromExposes,
  buildEntityResponses,
  resolveEntityPayload,
} from "./config/config.js";
import { generateTTS } from "./tts.js";
import { SharedAudioSource } from "./audio-utils.js";

// ── Context passed to every tool execute function ─────────

export interface VoiceDeviceInfo {
  name: string;
  model?: string;
  version?: string;
}

export interface ToolContext {
  bridge: MqttBridge;
  config: ConfigStore;
  chats: ChatStore;
  todos: TodoStore;
  automations: AutomationEngine;
  /** Send a JSON message to the connected voice bridge. */
  sendToBridge?: (msg: object) => void;
  /** Registry of active audio streams for HTTP serving. */
  audioStreams?: Map<string, ReadableStream<Uint8Array>>;
  /** Registry of fan-out audio sources (announcements — replayable to multiple devices). */
  audioSources?: Map<string, SharedAudioSource>;
  /** Connected voice devices reported by the bridge (device_id → info). */
  voiceDevices?: Map<string, VoiceDeviceInfo>;
}

// ── Tool definition type ──────────────────────────────────

export interface ToolDef {
  description: string;
  parameters: z.ZodType;
  execute: (params: any, ctx: ToolContext) => Promise<unknown>;
}

const ColorHSPayloadSchema = z.object({
  hue: z.number().min(0).max(360),
  saturation: z.number().min(0).max(100),
}).strict();

const ColorHexPayloadSchema = z.object({
  hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
}).strict();

const ColorXYPayloadSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
}).strict();

const ColorPayloadSchema = z.union([ColorHSPayloadSchema, ColorHexPayloadSchema, ColorXYPayloadSchema]);

const StatePayloadSchema = z.union([z.enum(["ON", "OFF", "TOGGLE"]), z.boolean()]);

const DeviceCommandPayloadSchema = z.object({
  // Canonical entity properties (resolved to endpoint-specific MQTT properties server-side).
  state: StatePayloadSchema.optional(),
  brightness: z.number().int().min(0).max(254).optional(),
  color_temp: z.number().int().positive().optional(),
  color: ColorPayloadSchema.optional(),
}).passthrough();

// ── Helper: build full device response (shared with app.ts) ─

function buildDeviceResponse(bridge: MqttBridge, config: ConfigStore, id: string) {
  const d = bridge.devices.get(id);
  if (!d) return null;
  const custom = config.getDevice(id);
  const state = bridge.states.get(id) ?? {};
  const exposes = d.definition?.exposes ?? [];
  const extracted = extractEntitiesFromExposes(exposes);
  const deviceName = custom?.name ?? d.friendly_name;
  const entities = buildEntityResponses(extracted, deviceName, custom?.entities, state);

  return {
    id: d.ieee_address,
    friendly_name: d.friendly_name,
    name: deviceName,
    entities,
    type: d.type,
    vendor: d.definition?.vendor ?? null,
    model: d.definition?.model ?? null,
    description: d.definition?.description ?? null,
    supported: d.supported ?? false,
    state,
    exposes,
  };
}

// ── Tool schemas (description + parameters, no execute) ──
// Importable by automations.ts to build per-tool ActionTool variants.

export const toolSchemas = {
  list_devices: {
    description: "List all Zigbee devices with their current state",
    parameters: z.object({}),
  },
  get_device: {
    description: "Get detailed info and state for a single device",
    parameters: z.object({
      id: z.string().describe("Device IEEE address, e.g. 0xa4c138d2b1cf1389"),
    }),
  },
  control_entity: {
    description:
      "Send a command to a specific entity on a device (e.g. turn on/off, set brightness, change colour). " +
      "Use canonical property names (state, brightness, color_temp, color) — the server resolves suffixed names automatically. " +
      "For colour-changing lights, set colour with: {\"color\":{\"hue\":N,\"saturation\":N}} (hue 0-360, sat 0-100) or {\"color\":{\"hex\":\"#RRGGBB\"}}. " +
      "For single-entity devices, use entity='main'.",
    parameters: z.object({
      id: z.string().describe("Device IEEE address"),
      entity: z.string().describe("Entity key, e.g. 'main' for single-entity devices, 'l1'/'l2'/'l3' for multi-entity"),
      payload: DeviceCommandPayloadSchema.describe(
        'Command payload with canonical property names, e.g. {"state":"ON","brightness":200,"color":{"hue":120,"saturation":100}}',
      ),
    }),
  },
  control_device: {
    description:
      "Send a raw command to a device for device-level properties that don't belong to any entity " +
      "(e.g. power_on_behavior). For entity state changes (on/off, brightness, color), use control_entity instead.",
    parameters: z.object({
      id: z.string().describe("Device IEEE address"),
      payload: DeviceCommandPayloadSchema.describe('Command payload, e.g. {"power_on_behavior":"previous"}'),
    }),
  },
  rename_device: {
    description: "Set a friendly display name for a device",
    parameters: z.object({
      id: z.string().describe("Device IEEE address"),
      name: z.string().describe("New display name"),
    }),
  },
  rename_entity: {
    description:
      "Set a friendly display name for a specific entity/endpoint within a device " +
      "(e.g. one socket of a multi-socket smart plug)",
    parameters: z.object({
      id: z.string().describe("Device IEEE address"),
      entity_id: z.string().describe("Entity/endpoint identifier, e.g. 'l1', 'l2', 'l3'"),
      name: z.string().describe("New display name for the entity"),
    }),
  },
  get_room_config: {
    description:
      "Read the current 3D room configuration (dimensions, furniture, lights). Always call this before making changes.",
    parameters: z.object({}),
  },
  set_room_dimensions: {
    description: "Update room dimensions and/or floor colour. Only provided fields are changed.",
    parameters: z.object({
      dimensions: RoomDimensionsSchema.optional().describe("Room bounding box {width, height, depth} in metres"),
      floor: z.string().optional().describe("CSS floor colour"),
    }),
  },
  set_room_lights: {
    description: "Replace the room's light placements. Each light links to a device entity by IEEE address + entity key.",
    parameters: z.object({
      lights: z.array(RoomLightSchema).describe("Full lights array — replaces existing"),
    }),
  },
  update_room_furniture: {
    description:
      "Replace the entire furniture array. Use get_room_config first, then send back the full modified array. " +
      "For editing a single piece, prefer upsert_furniture_item instead.",
    parameters: z.object({
      furniture: z.array(FurnitureItemSchema).describe("Full furniture array — replaces existing"),
    }),
  },
  upsert_furniture_item: {
    description:
      "Add or update a single named furniture item. Looks up by name and replaces it, or appends if not found. " +
      "The item can be a primitive (box/cylinder/extrude) or a group of primitives.",
    parameters: z.object({
      name: z.string().describe("Name of the furniture item to find and replace (or insert if new)"),
      item: FurnitureItemSchema.describe("The furniture item data"),
    }),
  },
  remove_furniture_item: {
    description: "Remove a furniture item by name.",
    parameters: z.object({
      name: z.string().describe("Name of the furniture item to remove"),
    }),
  },
  list_todo_lists: {
    description: "List all todo lists and their items.",
    parameters: z.object({}),
  },
  get_todo_list: {
    description: "Get a single todo list by ID.",
    parameters: z.object({
      list_id: z.string().describe("Todo list ID"),
    }),
  },
  upsert_todo_item: {
    description:
      "Create or update a todo item in a list. If the list does not exist it will be created.",
    parameters: z.object({
      list_id: z.string().describe("Todo list ID"),
      item_id: z.number().int().positive().describe("Todo item ID"),
      title: z.string().optional().describe("Todo title (required when creating a new item)"),
      body: z.string().optional().describe("Optional markdown body text"),
      status: TodoStatusSchema.optional().describe("Todo item status (must be a valid status on the target list)"),
      list_name: z.string().optional().describe("Optional todo list name (used when creating/updating list metadata)"),
      include_in_system_prompt: z.boolean().optional().describe("Whether this list should be included in the AI system prompt"),
    }),
  },
  set_todo_item_status: {
    description: "Set the status for a todo item by list and item ID.",
    parameters: z.object({
      list_id: z.string().describe("Todo list ID"),
      item_id: z.number().int().positive().describe("Todo item ID"),
      status: TodoStatusSchema.describe("Todo item status (must be a valid status on the target list)"),
    }),
  },
  delete_todo_item: {
    description: "Delete a todo item from a list.",
    parameters: z.object({
      list_id: z.string().describe("Todo list ID"),
      item_id: z.number().int().positive().describe("Todo item ID"),
    }),
  },
  set_voice: {
    description:
      "Change the voice used for spoken responses. " +
      "Available voices: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar.",
    parameters: z.object({
      voice: VoiceSchema.describe("The voice to use for spoken responses"),
    }),
  },
  announce: {
    description:
      "Send a spoken announcement to a voice device. " +
      "The text will be converted to speech and played on the device. " +
      "Use this to proactively inform the user, e.g. 'The front door was opened' or 'Timer is done'.",
    parameters: z.object({
      text: z.string().describe("The text to speak as an announcement"),
      device_id: z
        .string()
        .optional()
        .describe("Target device ID (omit to announce on all connected devices)"),
      voice: VoiceSchema.optional().describe("Override the configured voice for this announcement. Only set if requested."),
      instructions: z
        .string()
        .optional()
        .describe("Voice instructions for the TTS model, e.g. 'speak in an excited german accent'"),
    }),
  },
} as const satisfies Record<string, { description: string; parameters: z.ZodType }>;

// ── All tool definitions (excluding automation-management tools) ──

export function createTools(): Record<string, ToolDef> {
  return {
    // --- Devices ---

    list_devices: {
      ...toolSchemas.list_devices,
      execute: async (_params, { bridge, config }) => {
        return [...bridge.devices.values()]
          .filter((d) => d.type !== "Coordinator")
          .map((d) => buildDeviceResponse(bridge, config, d.ieee_address))
          .filter(Boolean);
      },
    },

    get_device: {
      ...toolSchemas.get_device,
      execute: async ({ id }, { bridge, config }) => {
        const device = buildDeviceResponse(bridge, config, id);
        if (!device) throw new Error("Device not found");
        return device;
      },
    },

    control_entity: {
      ...toolSchemas.control_entity,
      execute: async (args, { bridge }) => {
        const { id, entity, payload: explicitPayload, ...rest } = args;
        // AI sometimes flattens payload fields into top-level args — reconstruct payload
        const payload = explicitPayload && typeof explicitPayload === "object"
          ? explicitPayload as Record<string, unknown>
          : Object.keys(rest).length > 0 ? rest : {};

        const device = bridge.devices.get(id);
        if (!device) throw new Error("Device not found");

        const exposes = device.definition?.exposes ?? [];
        const extracted = extractEntitiesFromExposes(exposes);
        const entityDef = extracted.find((e) => e.key === entity);
        if (!entityDef) throw new Error("Entity not found");

        const resolved = resolveEntityPayload(entityDef, payload);
        bridge.setDeviceState(id, resolved);
        return { ok: true };
      },
    },

    control_device: {
      ...toolSchemas.control_device,
      execute: async ({ id, payload }, { bridge }) => {
        if (!bridge.devices.has(id)) throw new Error("Device not found");
        bridge.setDeviceState(id, payload);
        return { ok: true };
      },
    },

    rename_device: {
      ...toolSchemas.rename_device,
      execute: async ({ id, name }, { config }) => {
        config.setDevice(id, { name });
        return { ok: true };
      },
    },

    rename_entity: {
      ...toolSchemas.rename_entity,
      execute: async ({ id, entity_id, name }, { config }) => {
        config.setDevice(id, { entities: { [entity_id]: { name } } });
        return { ok: true };
      },
    },

    // --- Room config ---

    get_room_config: {
      ...toolSchemas.get_room_config,
      execute: async (_params, { config }) => {
        return config.getRoom() ?? { error: "Room not configured" };
      },
    },

    set_room_dimensions: {
      ...toolSchemas.set_room_dimensions,
      execute: async (params, { config, bridge }) => {
        config.patchRoom(params);
        bridge.emit("config_change");
        return { ok: true };
      },
    },

    set_room_lights: {
      ...toolSchemas.set_room_lights,
      execute: async ({ lights }, { config, bridge }) => {
        config.patchRoom({ lights });
        bridge.emit("config_change");
        return { ok: true };
      },
    },

    update_room_furniture: {
      ...toolSchemas.update_room_furniture,
      execute: async ({ furniture }, { config, bridge }) => {
        config.patchRoom({ furniture });
        bridge.emit("config_change");
        return { ok: true };
      },
    },

    upsert_furniture_item: {
      ...toolSchemas.upsert_furniture_item,
      execute: async ({ name, item }, { config, bridge }) => {
        config.upsertFurniture(name, item);
        bridge.emit("config_change");
        return { ok: true };
      },
    },

    remove_furniture_item: {
      ...toolSchemas.remove_furniture_item,
      execute: async ({ name }, { config, bridge }) => {
        const removed = config.removeFurniture(name);
        if (!removed) throw new Error("Furniture not found");
        bridge.emit("config_change");
        return { ok: true };
      },
    },

    // --- Todos ---

    list_todo_lists: {
      ...toolSchemas.list_todo_lists,
      execute: async (_params, { todos }) => {
        return todos.getAllLists();
      },
    },

    get_todo_list: {
      ...toolSchemas.get_todo_list,
      execute: async ({ list_id }, { todos }) => {
        const list = todos.getList(list_id);
        if (!list) throw new Error("Todo list not found");
        return list;
      },
    },

    upsert_todo_item: {
      ...toolSchemas.upsert_todo_item,
      execute: async (
        { list_id, item_id, title, body, status, list_name, include_in_system_prompt },
        { todos },
      ) => {
        const item = todos.upsertItem(
          list_id,
          {
            id: item_id,
            title,
            body,
            status,
          },
          {
            name: list_name,
            includeInSystemPrompt: include_in_system_prompt,
          },
        );

        return {
          ok: true,
          list: todos.getList(list_id),
          item,
        };
      },
    },

    set_todo_item_status: {
      ...toolSchemas.set_todo_item_status,
      execute: async ({ list_id, item_id, status }, { todos }) => {
        const item = todos.setItemStatus(list_id, item_id, status);
        return {
          ok: true,
          item,
        };
      },
    },

    delete_todo_item: {
      ...toolSchemas.delete_todo_item,
      execute: async ({ list_id, item_id }, { todos }) => {
        const removed = todos.deleteItem(list_id, item_id);
        if (!removed) throw new Error("Todo item not found");
        return { ok: true };
      },
    },

    // --- Voice ---

    set_voice: {
      ...toolSchemas.set_voice,
      execute: async ({ voice }, { config }) => {
        config.setVoice(voice);
        return { ok: true, voice };
      },
    },

    announce: {
      ...toolSchemas.announce,
      execute: async ({ text, device_id, voice, instructions }, { config, sendToBridge, audioSources }) => {
        if (!sendToBridge) throw new Error("Voice bridge not available");
        if (!audioSources) throw new Error("Audio source registry not available");

        // Generate TTS stream and wrap in SharedAudioSource for fan-out
        const stream = await generateTTS(text, config, { voice, instructions });
        const announceId = randomUUID();
        const audioPath = `/audio/${announceId}`;
        audioSources.set(announceId, new SharedAudioSource(stream));

        // Send announce message to bridge (one device or all)
        const isBroadcast = !device_id || device_id === "all";
        if (!isBroadcast) {
          sendToBridge({ type: "announce", device_id, audio_path: audioPath, announce_id: announceId });
        } else {
          // Broadcast: bridge will forward to all connected devices
          sendToBridge({ type: "announce_all", audio_path: audioPath, announce_id: announceId });
        }

        return { ok: true, announce_id: announceId };
      },
    },
  };
}

export { buildDeviceResponse };

