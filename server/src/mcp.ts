#!/usr/bin/env tsx
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { hc } from "hono/client";
import type { AppType } from "./app.js";
import { AutomationSchema } from "./automations.js";
import { RoomDimensionsSchema, RoomLightSchema, FurnitureItemSchema } from "./config/config.js";

const BASE_URL = process.env.MINHOME_URL ?? "http://localhost:3111";
const api = hc<AppType>(BASE_URL);

const server = new McpServer({
  name: "minhome",
  version: "0.1.0",
});

// --- Tools ---

server.tool("list_devices", "List all Zigbee devices with their current state", {}, async () => {
  const res = await api.api.devices.$get();
  const devices = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(devices, null, 2) }] };
});

server.tool(
  "get_device",
  "Get detailed info and state for a single device",
  { id: z.string().describe("Device IEEE address, e.g. 0xa4c138d2b1cf1389") },
  async ({ id }) => {
    const res = await api.api.devices[":id"].$get({ param: { id } });
    const device = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(device, null, 2) }] };
  },
);

server.tool(
  "control_entity",
  "Send a command to a specific entity on a device (e.g. turn on/off, set brightness, change color). Use canonical property names (state, brightness, color_temp) — the server resolves suffixed names automatically. For single-entity devices, use entity='main'.",
  {
    id: z.string().describe("Device IEEE address"),
    entity: z.string().describe("Entity key, e.g. 'main' for single-entity devices, 'l1'/'l2'/'l3' for multi-entity"),
    payload: z.record(z.string(), z.unknown()).describe('Command payload with canonical property names, e.g. {"state":"ON","brightness":200}'),
  },
  async ({ id, entity, payload }) => {
    const res = await api.api.devices[":id"].entities[":entityKey"].set.$post({
      param: { id, entityKey: entity },
      json: payload,
    });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "control_device",
  "Send a raw command to a device for device-level properties that don't belong to any entity (e.g. power_on_behavior). For entity state changes (on/off, brightness, color), use control_entity instead.",
  {
    id: z.string().describe("Device IEEE address"),
    payload: z.record(z.string(), z.unknown()).describe('Command payload, e.g. {"power_on_behavior":"previous"}'),
  },
  async ({ id, payload }) => {
    const res = await api.api.devices[":id"].set.$post({ param: { id }, json: payload });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "rename_device",
  "Set a friendly display name for a device",
  {
    id: z.string().describe("Device IEEE address"),
    name: z.string().describe("New display name"),
  },
  async ({ id, name }) => {
    const res = await api.api.devices[":id"].config.$put({ param: { id }, json: { name } });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "rename_entity",
  "Set a friendly display name for a specific entity/endpoint within a device (e.g. one socket of a multi-socket smart plug)",
  {
    id: z.string().describe("Device IEEE address"),
    entity_id: z.string().describe("Entity/endpoint identifier, e.g. 'l1', 'l2', 'l3'"),
    name: z.string().describe("New display name for the entity"),
  },
  async ({ id, entity_id, name }) => {
    const res = await api.api.devices[":id"].config.$put({
      param: { id },
      json: { entities: { [entity_id]: { name } } },
    });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

// --- Room config ---
// Coordinate system: x = west→east, y = up, z = north→south. Origin at NW corner, floor level.
// All positions/sizes in metres. Colours are CSS strings.
// Furniture types: 'box' (position=centre, size=[w,h,d]), 'cylinder' (position=centre, radius, height),
//   'extrude' (position=base, points=2D polygon, depth), 'group' (name + items array of primitives).
// All have optional name, rotation ([rx,ry,rz] radians), and color fields.

server.tool("get_room_config", "Read the current 3D room configuration (dimensions, furniture, lights). Always call this before making changes.", {}, async () => {
  const res = await api.api.config.room.$get();
  const body = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
});

server.tool(
  "set_room_dimensions",
  "Update room dimensions and/or floor colour. Only provided fields are changed.",
  {
    dimensions: RoomDimensionsSchema.optional().describe("Room bounding box {width, height, depth} in metres"),
    floor: z.string().optional().describe("CSS floor colour"),
  },
  async (params) => {
    const res = await api.api.config.room.$patch({ json: params });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "set_room_lights",
  "Replace the room's light placements. Each light links to a device entity by IEEE address + entity key.",
  {
    lights: z.array(RoomLightSchema).describe("Full lights array — replaces existing"),
  },
  async ({ lights }) => {
    const res = await api.api.config.room.$patch({ json: { lights } });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "update_room_furniture",
  "Replace the entire furniture array. Use get_room_config first, then send back the full modified array. For editing a single piece, prefer upsert_furniture_item instead.",
  {
    furniture: z.array(FurnitureItemSchema).describe("Full furniture array — replaces existing"),
  },
  async ({ furniture }) => {
    const res = await api.api.config.room.$patch({ json: { furniture } });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "upsert_furniture_item",
  "Add or update a single named furniture item. Looks up by name and replaces it, or appends if not found. The item can be a primitive (box/cylinder/extrude) or a group of primitives.",
  {
    name: z.string().describe("Name of the furniture item to find and replace (or insert if new)"),
    item: FurnitureItemSchema.describe("The furniture item data"),
  },
  async ({ name, item }) => {
    const res = await api.api.config.room.furniture[":name"].$put({ param: { name }, json: item });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

server.tool(
  "remove_furniture_item",
  "Remove a furniture item by name.",
  {
    name: z.string().describe("Name of the furniture item to remove"),
  },
  async ({ name }) => {
    const res = await api.api.config.room.furniture[":name"].$delete({ param: { name } });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

// --- Automations ---

server.tool("list_automations", "List all automation rules", {}, async () => {
  const res = await api.api.automations.$get();
  const automations = await res.json();
  return { content: [{ type: "text", text: JSON.stringify(automations, null, 2) }] };
});

server.tool(
  "create_automation",
  "Create a new automation rule",
  AutomationSchema.shape,
  async (automation) => {
    const res = await api.api.automations.$post({ json: automation });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "update_automation",
  "Update an existing automation rule. Provide the automation ID and any fields to change.",
  {
    id: z.string().describe("ID of the automation to update"),
    ...AutomationSchema.omit({ id: true }).partial().shape,
  },
  async ({ id, ...patch }) => {
    const res = await api.api.automations[":id"].$put({ param: { id }, json: patch });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

server.tool(
  "delete_automation",
  "Delete an automation rule",
  { id: z.string().describe("Automation ID") },
  async ({ id }) => {
    const res = await api.api.automations[":id"].$delete({ param: { id } });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  },
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[mcp] Minhome MCP server running on stdio");
}

main().catch((err) => {
  console.error("[mcp] Fatal:", err);
  process.exit(1);
});
